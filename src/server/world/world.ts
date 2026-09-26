/**
 * Simulação autoritativa. Não depende de DOM, Phaser nem de rede: recebe intenções
 * (inputs/escolhas/votos) e produz estado + eventos identificados.
 */
import { AFFIX_IDS, AFFIX_RULES, affixChance, affixesFor, type AffixId } from '../../shared/config/affixes.js';
import { CHAPTERS, type ChapterDef, chapterOfWave, CLIMATE_EFFECTS, type Route, ROUTE, TRAVEL_SECONDS } from '../../shared/config/chapters.js';
import { BERSERKER, CLASSES, type ClassId, NECRO, PLAYER_RULES, VAMPIRE } from '../../shared/config/classes.js';
import { BOSS_STAGGER_IMMUNITY, CC_DR, ENEMIES, ENEMY_TYPES, type EnemyType } from '../../shared/config/enemies.js';
import { BASE_OFFER_COUNT, INTERMISSION_SECONDS, MAX_OFFER_COUNT, UPGRADE_BY_ID } from '../../shared/config/upgrades.js';
import { SCALING, TOTAL_WAVES, WAVES, waveInChapter } from '../../shared/config/waves.js';
import { DT, sec, TICK_RATE, TILE } from '../../shared/constants.js';
import { circleFree, lineOfSight, moveCircle, resolveCircle } from '../../shared/collision.js';
import { type ArenaMap, blocksShot, breakableAt, cloneMap, getMap, mapIndex, WORLD_H, WORLD_W } from '../../shared/map.js';
import { angleDiff, clamp, dist, dist2, Rng } from '../../shared/math.js';
import { BTN, type InputFrame, type MoveParams, stepMovement } from '../../shared/movement.js';
import {
  actionCode, type ActionName, type DenyReason, ENEMY_FLAGS, type EnemyTuple, enemyAttackCode, type EnemyAttackName,
  enemyStateCode, type EnemyStateName, type GameEvent, type GameEventBody, type MatchStats, type Phase, PLAYER_FLAGS,
  PROJECTILE_KINDS, type ProjectileKind, type ProjTuple, type SnapPlayer, type SnapYou, type WaveInfo, ZONE_KINDS,
  type ZoneKind, type ZoneTuple,
} from '../../shared/protocol.js';
import { brainFor } from './ai/brains.js';
import { Director } from './director.js';
import { kitFor } from './kits/index.js';
import { addPickup, damageBreakable, resetBreakables, respawnSomeBreakables, stepPickups } from './loot.js';
import { clearMinions, hitMinion, minionAggro, stepMinions } from './minions.js';
import { FlowField } from './nav.js';
import { affixReward, bossObjectiveDamageMul, countObjectives, Objectives, spawnBossObjectives, tickBossObjectives } from './objectives.js';
import { SpatialHash } from './spatial.js';
import type { Action, Enemy, Minion, Pickup, Player, Projectile, Slot, Target, Zone } from './types.js';
import { rollUpgrades } from './upgrades.js';

export interface WorldOptions {
  seed: number;
  solo: boolean;
}

export interface HitOpts {
  poise: number;
  kb: number;
  fromX: number;
  fromY: number;
  kind: 'melee' | 'proj' | 'aoe';
  /** Não conta para marcas/sede (ex.: dano contínuo). */
  noProc?: boolean;
  /** Ignora bônus de dano do jogador. */
  raw?: boolean;
  /** Dano vindo de servo (não dispara passivas de ataque do dono). */
  fromMinion?: boolean;
}

export interface EnemyHit {
  dmg: number;
  heavy: boolean;
  fromX: number;
  fromY: number;
  enemy: Enemy | null;
  proj: Projectile | null;
  /** Pode ser aparado/bloqueado. */
  blockable: boolean;
}

export type HitResult = 'hit' | 'blocked' | 'parried' | 'evaded' | 'ignored';

const EMPTY_INPUT = (seq: number, x: number, y: number): InputFrame => ({ seq, mx: 0, my: 0, ax: x + 10, ay: y, held: 0, pressed: 0 });

export class World {
  /** Mapa ativo (clone mutável: caixas e barris quebram). */
  map: ArenaMap = cloneMap(getMap('village'));
  chapter: ChapterDef = CHAPTERS[0] as ChapterDef;
  readonly rng: Rng;
  readonly solo: boolean;
  tick = 0;
  phase: Phase = 'lobby';
  wave = 0;
  waveTitle = '';
  phaseTimer = 0;
  paused = false;
  readonly players = new Map<number, Player>();
  readonly enemies = new Map<number, Enemy>();
  readonly minions = new Map<number, Minion>();
  projectiles: Projectile[] = [];
  zones: Zone[] = [];
  pickups: Pickup[] = [];
  breakHp = new Float32Array(0);
  readonly hash = new SpatialHash<Enemy>(64);
  readonly fields = new Map<number, FlowField>();
  /** Campo de fluxo até a fogueira (carrinho funerário, sobrevivente). */
  fireField: FlowField | null = null;
  readonly director: Director;
  readonly objectives: Objectives;
  /** Dano já causado a chefes por cada invocação do Exército (teto por conjuração). */
  readonly armyBossDamage = new Map<number, number>();
  /** Última fala do Pai (evita repetição imediata). */
  lastShout = '';
  /** Rota escolhida para o capítulo atual. */
  route: Route | null = null;
  readonly votes = new Map<number, Route>();
  routeResult: Route | null = null;
  /** Tempestade do clima. */
  storm = { active: false, t: 0 };
  /** Eventos gerados desde a última coleta pela sala. */
  private pending: GameEvent[] = [];
  private nextEventId = 1;
  private nextEntityId = 1;
  offers = new Map<number, string[]>();
  offerBonus = new Map<number, string>();
  picks = new Map<number, string>();
  bossId = 0;
  matchStartTick = 0;
  lastKillTick = 0;
  onPhaseChange: ((phase: Phase) => void) | null = null;
  onOffersChange: (() => void) | null = null;
  onModsChange: (() => void) | null = null;
  onRouteChange: (() => void) | null = null;

  constructor(opts: WorldOptions) {
    this.rng = new Rng(opts.seed);
    this.solo = opts.solo;
    this.director = new Director(this);
    this.objectives = new Objectives(this);
    resetBreakables(this);
  }

  // ------------------------------------------------------------------ utilidades

  newId(): number {
    return this.nextEntityId++;
  }

  emit(ev: GameEventBody): void {
    this.pending.push({ ...ev, id: this.nextEventId++ } as GameEvent);
  }

  drainEvents(): GameEvent[] {
    const out = this.pending;
    this.pending = [];
    return out;
  }

  alivePlayers(): Player[] {
    const out: Player[] = [];
    for (const p of this.players.values()) if (p.status === 0) out.push(p);
    return out;
  }

  /** Multiplicador de dano de um inimigo (onda, falha de evento, maldição do Ritualista). */
  edm(e: Enemy): number {
    return e.dmgMul * this.objectives.enemyDamageMul * (e.cursedT > 0 ? 0.8 : 1);
  }

  /** Servos andam mais rápido na tempestade? Não: só a horda se adapta ao clima. */
  stormMinionMul(): number {
    return 1;
  }

  // ------------------------------------------------------------------ jogadores

  addPlayer(id: number, name: string, cls: ClassId): Player {
    const base = CLASSES[cls];
    const start = this.map.starts[this.players.size % this.map.starts.length] ?? this.map.campfire;
    const move = { x: start.x, y: start.y, fvx: 0, fvy: 0, ft: 0, stamina: base.stamina, dodgeCd: 0 };
    const p: Player = {
      id,
      name,
      cls,
      base,
      r: base.radius,
      move,
      get x() {
        return this.move.x;
      },
      get y() {
        return this.move.y;
      },
      aim: 0,
      aimX: start.x + 10,
      aimY: start.y,
      hp: base.hp,
      maxHp: base.hp,
      maxStamina: base.stamina,
      staminaDelay: 0,
      status: 0,
      bleed: 0,
      reviveProgress: 0,
      revivingId: 0,
      action: null,
      cd: { q: 0, e: 0 },
      cdMax: { q: 1, e: 1 },
      ult: 0,
      iframes: 0,
      buffs: { madness: 0, exhausted: 0, feast: 0, tauntDr: 0, guardBroken: 0, chill: 0, burn: 0 },
      blocking: false,
      blockDir: 0,
      thirst: 0,
      thirstT: 0,
      resonance: 0,
      convergence: 0,
      lastAbility: null,
      comboStep: 0,
      comboT: 0,
      rage: 0,
      rageIdle: 0,
      essence: 0,
      bonusCards: 0,
      biteHealed: 0,
      surrounded: false,
      healBudget: VAMPIRE.healPerSecondCap,
      queue: [],
      last: EMPTY_INPUT(0, start.x, start.y),
      ack: 0,
      held: 0,
      buffered: null,
      mods: {},
      connected: true,
      lastPing: -9999,
      lastDodgeTick: -9999,
      stats: { kills: 0, damage: 0, downs: 0, revives: 0 },
      inBastion: false,
      bastionHeal: 0,
    };
    this.players.set(id, p);
    this.fields.set(id, new FlowField(this.map));
    return p;
  }

  removePlayer(id: number): void {
    const p = this.players.get(id);
    if (!p) return;
    clearMinions(this, id);
    this.players.delete(id);
    this.fields.delete(id);
    for (const e of this.enemies.values()) {
      if (e.targetId === id) e.targetId = 0;
      if (e.tauntBy === id) {
        e.tauntBy = 0;
        e.tauntT = 0;
      }
    }
    this.offers.delete(id);
    this.picks.delete(id);
    this.votes.delete(id);
  }

  mod(p: Player, id: string): number {
    const n = p.mods[id] ?? 0;
    if (!n) return 0;
    return n * (UPGRADE_BY_ID.get(id)?.value ?? 0);
  }

  pushInputs(pid: number, frames: InputFrame[]): void {
    const p = this.players.get(pid);
    if (!p) return;
    for (const f of frames) {
      const lastSeq = p.queue.length ? (p.queue[p.queue.length - 1] as InputFrame).seq : p.ack;
      if (f.seq <= lastSeq) continue; // repetido/antigo
      p.queue.push(f);
    }
    // fila limitada: descarta os mais antigos preservando botões pressionados
    while (p.queue.length > 12) {
      const old = p.queue.shift() as InputFrame;
      const nxt = p.queue[0] as InputFrame;
      nxt.pressed |= old.pressed;
      p.ack = old.seq;
    }
  }

  setConnected(pid: number, c: boolean): void {
    const p = this.players.get(pid);
    if (!p) return;
    p.connected = c;
    if (!c) {
      p.queue.length = 0;
      p.held = 0;
      p.blocking = false;
      p.buffered = null;
      clearMinions(this, pid); // servos não ficam órfãos lutando sozinhos
    }
  }

  // ------------------------------------------------------------------ capítulos e mapas

  /** Troca de capítulo: novo mapa (clone), campos de fluxo, quebráveis e limpeza de entidades. */
  setChapter(n: number): void {
    const ch = CHAPTERS[n - 1] ?? (CHAPTERS[0] as ChapterDef);
    this.chapter = ch;
    this.map = cloneMap(getMap(ch.map));
    this.clearTransient();
    resetBreakables(this);
    for (const id of this.fields.keys()) this.fields.set(id, new FlowField(this.map));
    this.fireField = new FlowField(this.map);
    this.fireField.compute(this.map.campfire.x, this.map.campfire.y + 48);
    this.storm = { active: false, t: 0 };
    let i = 0;
    for (const p of this.players.values()) {
      const s = this.map.starts[i % this.map.starts.length] ?? this.map.campfire;
      p.move.x = s.x;
      p.move.y = s.y;
      p.move.ft = 0;
      p.move.fvx = 0;
      p.move.fvy = 0;
      p.aimX = s.x + 10;
      p.aimY = s.y;
      p.action = null;
      p.blocking = false;
      i++;
    }
  }

  /** Remove tudo que é transitório (inimigos, projéteis, zonas, itens, servos, objetivos). */
  private clearTransient(): void {
    this.enemies.clear();
    this.projectiles = [];
    this.zones = [];
    this.pickups = [];
    clearMinions(this);
    this.armyBossDamage.clear();
    this.bossId = 0;
  }

  // ------------------------------------------------------------------ partida

  startMatch(): void {
    this.wave = 0;
    this.route = null;
    this.routeResult = null;
    this.votes.clear();
    this.objectives.reset();
    this.director.reset();
    this.setChapter(1);
    this.matchStartTick = this.tick;
    let i = 0;
    for (const p of this.players.values()) this.resetPlayerForMatch(p, i++);
    this.beginWave(1);
  }

  private resetPlayerForMatch(p: Player, i: number): void {
    const s = this.map.starts[i % this.map.starts.length] ?? this.map.campfire;
    p.move.x = s.x;
    p.move.y = s.y;
    p.move.ft = 0;
    p.move.stamina = p.base.stamina;
    p.maxHp = p.base.hp;
    p.hp = p.maxHp;
    p.maxStamina = p.base.stamina;
    p.status = 0;
    p.action = null;
    p.cd = { q: 0, e: 0 };
    p.ult = 0;
    p.mods = {};
    p.stats = { kills: 0, damage: 0, downs: 0, revives: 0 };
    p.buffs = { madness: 0, exhausted: 0, feast: 0, tauntDr: 0, guardBroken: 0, chill: 0, burn: 0 };
    p.thirst = 0;
    p.resonance = 0;
    p.convergence = 0;
    p.rage = 0;
    p.essence = 0;
    p.bonusCards = 0;
    p.comboStep = 0;
  }

  private setPhase(ph: Phase): void {
    this.phase = ph;
    this.onPhaseChange?.(ph);
  }

  private beginWave(n: number): void {
    this.wave = n;
    const def = WAVES[n - 1];
    this.waveTitle = def?.title ?? '';
    const players = Math.max(1, this.players.size);
    const risk = this.route === 'risk';
    this.director.start(n, players, { budgetMul: risk ? ROUTE.risk.budgetMul : 1, extraElites: risk ? ROUTE.risk.extraElites : 0 });
    this.objectives.beginWave(n);
    this.phaseTimer = sec(3);
    this.lastKillTick = this.tick;
    this.offers.clear();
    this.offerBonus.clear();
    this.picks.clear();
    this.storm = { active: false, t: this.chapter.storm ? sec(this.chapter.storm.every * 0.6) : 0 };
    this.setPhase('wave');
  }

  private beginIntermission(): void {
    this.phaseTimer = sec(INTERMISSION_SECONDS);
    this.projectiles = this.projectiles.filter((pr) => pr.team === 'p');
    this.zones = this.zones.filter((z) => z.kind === 'trap');
    clearMinions(this);
    this.armyBossDamage.clear();
    this.pickups = this.pickups.filter((it) => it.kind === 'heal');
    this.storm.active = false;
    let i = 0;
    for (const p of this.players.values()) {
      if (p.status !== 0) {
        const s = this.map.starts[i % this.map.starts.length] ?? this.map.campfire;
        p.move.x = s.x;
        p.move.y = s.y;
        p.move.ft = 0;
        p.status = 0;
        p.hp = Math.round(p.maxHp * PLAYER_RULES.respawnHpRatio);
        this.emit({ k: 'respawn', pi: p.id });
      } else {
        p.hp = Math.min(p.maxHp, p.hp + Math.round(p.maxHp * 0.35));
      }
      p.action = null;
      p.bleed = 0;
      p.reviveProgress = 0;
      p.buffs.burn = 0;
      p.buffs.chill = 0;
      i++;
    }
    this.objectives.grantRewards();
    respawnSomeBreakables(this);
    for (const p of this.players.values()) {
      const riskBonus = this.route === 'risk' ? ROUTE.risk.offerBonus : 0;
      const cardBonus = p.bonusCards > 0 ? 1 : 0;
      const count = Math.min(MAX_OFFER_COUNT, BASE_OFFER_COUNT + riskBonus + cardBonus);
      const used = Math.max(0, count - BASE_OFFER_COUNT - riskBonus);
      if (used > 0) p.bonusCards -= used;
      this.offers.set(p.id, rollUpgrades(this.rng, p, count));
      const why: string[] = [];
      if (riskBonus) why.push('rota de risco');
      if (used) why.push('desafio/evento');
      this.offerBonus.set(p.id, why.join(' + '));
    }
    this.picks.clear();
    this.setPhase('intermission');
    this.onOffersChange?.();
  }

  pickUpgrade(pid: number, id: string): boolean {
    if (this.phase !== 'intermission') return false;
    const p = this.players.get(pid);
    const opts = this.offers.get(pid);
    if (!p || !opts || !opts.includes(id) || this.picks.has(pid)) return false;
    const def = UPGRADE_BY_ID.get(id);
    if (!def) return false;
    if (!this.canTake(p, id)) return false;
    this.picks.set(pid, id);
    this.onOffersChange?.();
    return true;
  }

  /** A melhoria ainda pode ser acumulada e não conflita com uma bifurcação já tomada. */
  canTake(p: Player, id: string): boolean {
    const def = UPGRADE_BY_ID.get(id);
    if (!def || (p.mods[id] ?? 0) >= def.maxStacks) return false;
    return !(def.fork && Object.keys(p.mods).some((k) => k !== id && (p.mods[k] ?? 0) > 0 && UPGRADE_BY_ID.get(k)?.fork === def.fork));
  }

  private applyPicks(): void {
    for (const p of this.players.values()) {
      const opts = this.offers.get(p.id);
      if (!opts || opts.length === 0) continue;
      // sem confirmação até o fim do tempo: primeira opção válida
      const id = this.picks.get(p.id) ?? opts.find((o) => this.canTake(p, o));
      if (!id || !this.canTake(p, id)) continue;
      const def = UPGRADE_BY_ID.get(id);
      if (!def) continue;
      const cur = p.mods[id] ?? 0;
      p.mods[id] = cur + 1;
      if (id === 'g_vigor') {
        p.maxHp += def.value;
        p.hp += def.value;
      } else if (id === 'g_breath') {
        p.maxStamina += def.value;
      }
    }
    this.onModsChange?.();
  }

  /** Fim do intervalo: próxima onda ou, se começa um capítulo, votação de rota. */
  private afterIntermission(): void {
    this.applyPicks();
    const next = this.wave + 1;
    if (waveInChapter(next) === 0 && next > 1) this.beginRoute();
    else this.beginWave(next);
  }

  private beginRoute(): void {
    this.votes.clear();
    this.routeResult = null;
    this.phaseTimer = sec(ROUTE.voteSeconds);
    this.setPhase('route');
    this.onRouteChange?.();
  }

  vote(pid: number, r: Route): boolean {
    if (this.phase !== 'route' || !this.players.has(pid) || this.routeResult) return false;
    this.votes.set(pid, r);
    this.onRouteChange?.();
    return true;
  }

  voteCounts(): { risk: number; safe: number } {
    let risk = 0;
    let safe = 0;
    for (const v of this.votes.values()) if (v === 'risk') risk++;
    else safe++;
    return { risk, safe };
  }

  /** Apuração: maioria vence; empate (ou nenhum voto) = rota segura. */
  private resolveRoute(): void {
    const { risk, safe } = this.voteCounts();
    const r: Route = risk > safe ? 'risk' : safe > risk ? 'safe' : ROUTE.tieBreak;
    this.route = r;
    this.routeResult = r;
    if (r === 'safe') {
      for (const p of this.players.values()) {
        p.status = 0;
        p.hp = p.maxHp;
        p.bleed = 0;
        this.addUlt(p, ROUTE.safe.ultGain);
      }
    }
    this.emit({ k: 'msg', txt: `Rota escolhida: ${r === 'risk' ? ROUTE.risk.name : ROUTE.safe.name}`, c: r === 'risk' ? 'bad' : 'good' });
    this.onRouteChange?.();
    this.beginTravel();
  }

  private beginTravel(): void {
    const next = chapterOfWave(this.wave + 1);
    this.setChapter(next.n);
    this.phaseTimer = sec(TRAVEL_SECONDS);
    this.setPhase('travel');
  }

  private endMatch(victory: boolean): void {
    this.projectiles = [];
    this.zones = [];
    clearMinions(this);
    this.pickups = [];
    this.storm.active = false;
    this.setPhase(victory ? 'victory' : 'defeat');
  }

  god = false;

  /** Comandos de depuração (apenas com UV_DEBUG=1). */
  debug(c: 'wave' | 'ult' | 'god' | 'kill' | 'spawn', n: number, s: string): void {
    if (c === 'wave' && n >= 1 && n <= TOTAL_WAVES) {
      const ch = chapterOfWave(n);
      if (ch.n !== this.chapter.n) this.setChapter(ch.n);
      else this.clearTransient();
      this.bossId = 0;
      this.beginWave(n);
    } else if (c === 'ult') {
      for (const p of this.players.values()) {
        p.ult = PLAYER_RULES.ultMax;
        if (p.cls === 'necromancer') p.essence = NECRO.essence.max;
      }
    } else if (c === 'god') this.god = !this.god;
    else if (c === 'kill') {
      for (const e of this.enemies.values()) if (!e.def.objective) this.killEnemy(e, null);
    } else if (c === 'spawn' && (ENEMY_TYPES as readonly string[]).includes(s)) {
      const p = [...this.players.values()][0];
      if (!p) return;
      for (let i = 0; i < Math.max(1, Math.min(120, n)); i++) {
        const a = (i / Math.max(1, n)) * Math.PI * 2;
        const e = this.spawnEnemy(s as EnemyType, p.x + Math.cos(a) * (90 + (i % 5) * 18), p.y + Math.sin(a) * (90 + (i % 5) * 18), this.players.size);
        e.state = 'move';
      }
    }
  }

  /** Volta ao lobby limpando todo o estado de partida. */
  resetToLobby(): void {
    this.clearTransient();
    this.offers.clear();
    this.picks.clear();
    this.votes.clear();
    this.wave = 0;
    this.route = null;
    this.routeResult = null;
    this.paused = false;
    this.director.reset();
    this.objectives.reset();
    for (const p of [...this.players.keys()]) this.removePlayer(p);
    this.setChapter(1);
    this.setPhase('lobby');
  }

  // ------------------------------------------------------------------ passo principal

  step(): void {
    if (this.paused) return;
    this.tick++;
    if (this.phase === 'lobby' || this.phase === 'victory' || this.phase === 'defeat') return;
    if (this.phase === 'travel') {
      // cinemática: ninguém se move; ao fim começa a primeira onda do novo capítulo
      for (const p of this.players.values()) p.queue.length = 0;
      if (--this.phaseTimer <= 0) this.beginWave(this.wave + 1);
      return;
    }
    if (this.phase === 'intermission' || this.phase === 'route') {
      this.stepPlayers(true);
      this.stepProjectiles();
      stepPickups(this);
      this.cleanup();
      this.phaseTimer--;
      if (this.phase === 'intermission') {
        const connected = [...this.players.values()].filter((p) => p.connected);
        const allPicked = connected.length > 0 && connected.every((p) => this.picks.has(p.id));
        if (this.phaseTimer <= 0 || allPicked) this.afterIntermission();
      } else {
        const connected = [...this.players.values()].filter((p) => p.connected);
        const allVoted = connected.length > 0 && connected.every((p) => this.votes.has(p.id));
        if (this.phaseTimer <= 0 || allVoted) this.resolveRoute();
      }
      return;
    }
    // fase de onda
    if (this.tick % 6 === 0) this.updateFields();
    // campo até a fogueira acompanha caixas quebradas (carrinho e sobrevivente)
    if (this.tick % 30 === 0 && this.fireField) this.fireField.compute(this.map.campfire.x, this.map.campfire.y + 48);
    this.rebuildHash();
    this.stepStorm();
    this.stepPlayers(false);
    if (this.phaseTimer > 0) this.phaseTimer--;
    else this.director.tick();
    this.stepEnemies();
    stepMinions(this);
    this.stepProjectiles();
    this.stepZones();
    stepPickups(this);
    this.objectives.tick();
    this.cleanup();
    this.checkEnd();
  }

  private stepStorm(): void {
    const st = this.chapter.storm;
    if (!st) return;
    if (--this.storm.t > 0) return;
    if (this.storm.active) {
      this.storm.active = false;
      this.storm.t = sec(st.every);
    } else {
      this.storm.active = true;
      this.storm.t = sec(st.duration);
      this.emit({ k: 'msg', txt: `${st.name}! A horda se move mais rápido.`, c: 'bad' });
    }
  }

  private updateFields(): void {
    for (const p of this.players.values()) {
      if (p.status !== 0) continue;
      this.fields.get(p.id)?.compute(p.x, p.y);
    }
  }

  private rebuildHash(): void {
    this.hash.clear();
    for (const e of this.enemies.values()) if (e.state !== 'dead') this.hash.insert(e);
  }

  private checkEnd(): void {
    if (this.phase !== 'wave') return;
    const ps = [...this.players.values()];
    if (ps.length === 0) return;
    if (ps.every((p) => p.status !== 0)) {
      this.endMatch(false);
      return;
    }
    if (this.director.complete() && !this.objectives.blocking()) {
      this.objectives.endWave();
      if (this.wave >= TOTAL_WAVES) this.endMatch(true);
      else this.beginIntermission();
    }
  }

  // ------------------------------------------------------------------ jogadores: entrada e ações

  private stepPlayers(peaceful: boolean): void {
    for (const p of this.players.values()) {
      const n = p.queue.length > 3 ? 2 : p.queue.length > 0 ? 1 : 0;
      for (let k = 0; k < n; k++) this.processInput(p, p.queue.shift() as InputFrame, peaceful);
      this.updatePlayer(p, peaceful);
    }
    if (!peaceful) this.updateRevives();
  }

  canAct(p: Player): boolean {
    if (p.status !== 0) return false;
    if (p.buffs.guardBroken > 0) return false;
    const a = p.action;
    if (!a) return true;
    if (a.name === 'hurt' || a.name === 'guardBreak') return false;
    return a.t >= a.cancelFrom;
  }

  moveParams(p: Player): MoveParams {
    const b = p.base;
    const thirstSpeed = p.cls === 'vampire' ? p.thirst * VAMPIRE.thirst.speedPerStack : 0;
    let moveMul = 1;
    if (p.action) moveMul = p.action.moveMul;
    if (p.blocking) moveMul = Math.min(moveMul, 0.45);
    if (p.buffs.guardBroken > 0 || p.status !== 0) moveMul = 0;
    if (p.revivingId) moveMul = Math.min(moveMul, 0.25);
    let speed = b.speed * (1 + this.mod(p, 'g_agility') + thirstSpeed);
    if (p.buffs.chill > 0) speed *= CLIMATE_EFFECTS.chill.speedMul;
    if (p.buffs.exhausted > 0) speed *= BERSERKER.madness.exhaustSpeedMul;
    return {
      radius: p.r,
      speed,
      moveMul,
      canDodge: this.canAct(p) && !p.blocking,
      dodgeCost: b.dodge.cost,
      dodgeSpeed: b.dodge.speed,
      dodgeTicks: b.dodge.ticks,
      dodgeCooldown: b.dodge.cooldown,
      slowFloorMul: CLIMATE_EFFECTS.slowFloorMul,
    };
  }

  private processInput(p: Player, f: InputFrame, peaceful: boolean): void {
    p.ack = f.seq;
    p.last = f;
    p.held = f.held;
    p.aimX = f.ax;
    p.aimY = f.ay;
    p.aim = Math.atan2(f.ay - p.y, f.ax - p.x);
    if (p.status !== 0) return;
    const params = this.moveParams(p);
    const pressedSlot: Slot | null =
      f.pressed & BTN.r ? 'r' : f.pressed & BTN.e ? 'e' : f.pressed & BTN.q ? 'q' : f.pressed & BTN.attack ? 'basic' : null;
    const staminaBefore = p.move.stamina;
    const res = stepMovement(p.move, f, params, this.map);
    if (res.dodged) {
      p.iframes = p.base.dodge.iframes;
      p.lastDodgeTick = this.tick;
      p.action = null;
      p.buffered = null;
      p.staminaDelay = sec(p.base.staminaDelay);
      this.emit({ k: 'sfx', n: 'dodge', x: p.x, y: p.y });
    } else if (f.pressed & BTN.dodge) {
      if (staminaBefore < p.base.dodge.cost && this.canAct(p)) this.deny(p, 'st');
      else if (!this.canAct(p)) p.buffered = { slot: 'dodge', t: PLAYER_RULES.inputBufferTicks };
    }
    if (pressedSlot && !peaceful) {
      if (this.canAct(p)) this.tryStart(p, pressedSlot);
      else p.buffered = { slot: pressedSlot, t: PLAYER_RULES.inputBufferTicks };
    }
  }

  /** Esquiva que estava no buffer: configura o deslocamento forçado sem mover neste tick. */
  private startBufferedDodge(p: Player): void {
    const d = p.base.dodge;
    if (p.move.ft > 0 || p.move.dodgeCd > 0 || p.move.stamina < d.cost || p.blocking) return;
    let dx = p.last.mx;
    let dy = p.last.my;
    if (dx === 0 && dy === 0) {
      dx = Math.cos(p.aim);
      dy = Math.sin(p.aim);
    }
    const l = Math.hypot(dx, dy) || 1;
    p.move.fvx = (dx / l) * d.speed;
    p.move.fvy = (dy / l) * d.speed;
    p.move.ft = d.ticks;
    p.move.stamina -= d.cost;
    p.move.dodgeCd = d.ticks + d.cooldown;
    p.staminaDelay = sec(p.base.staminaDelay);
    p.iframes = d.iframes;
    p.lastDodgeTick = this.tick;
    p.action = null;
    this.emit({ k: 'sfx', n: 'dodge', x: p.x, y: p.y });
  }

  tryStart(p: Player, slot: Slot): boolean {
    if (slot === 'r' && p.ult < PLAYER_RULES.ultMax) {
      this.deny(p, 'ult');
      return false;
    }
    if ((slot === 'q' || slot === 'e') && p.cd[slot] > 0) {
      this.deny(p, 'cd');
      return false;
    }
    const kit = kitFor(p.cls);
    const r = kit.start(this, p, slot);
    if (r !== null) {
      this.deny(p, r);
      return false;
    }
    if (slot === 'r') {
      p.ult = 0;
      this.emit({ k: 'ult', pi: p.id });
    }
    p.buffered = null;
    return true;
  }

  deny(p: Player, r: DenyReason): void {
    this.emit({ k: 'deny', r, to: p.id });
  }

  /** Inicia uma ação temporizada. */
  startAction(
    p: Player,
    name: ActionName,
    timing: { windup: number; active?: number; recovery: number },
    opts: { dir?: number; moveMul?: number; tx?: number; ty?: number; n?: number; speedMul?: number } = {},
  ): Action {
    const sm = opts.speedMul ?? 1;
    const w = Math.max(0, Math.round(timing.windup / sm));
    const act = Math.max(0, Math.round((timing.active ?? 1) / sm));
    const rec = Math.max(1, Math.round(timing.recovery / sm));
    const total = w + act + rec;
    const a: Action = {
      name,
      t: 0,
      total,
      wu: w,
      ac: act,
      dir: opts.dir ?? p.aim,
      tx: opts.tx ?? p.aimX,
      ty: opts.ty ?? p.aimY,
      hit: new Set(),
      cancelFrom: w + act + Math.ceil(rec * 0.5),
      moveMul: opts.moveMul ?? 0.5,
      n: opts.n ?? 0,
    };
    p.action = a;
    return a;
  }

  spendStamina(p: Player, amt: number): boolean {
    if (amt <= 0) return true;
    let cost = amt;
    if (p.cls === 'berserker' && p.rage >= BERSERKER.fury.high) cost *= BERSERKER.fury.staminaCostMul;
    if (p.move.stamina < cost) return false;
    p.move.stamina -= cost;
    p.staminaDelay = sec(p.base.staminaDelay);
    return true;
  }

  setCooldown(p: Player, slot: 'q' | 'e', seconds: number): void {
    const focus = 1 - this.mod(p, 'g_focus');
    const t = Math.max(sec(0.5), Math.round(sec(seconds) * focus));
    p.cd[slot] = t;
    p.cdMax[slot] = t;
  }

  addUlt(p: Player, amt: number): void {
    if (p.status !== 0) return;
    p.ult = Math.min(PLAYER_RULES.ultMax, p.ult + amt * (1 + this.mod(p, 'g_devotion')));
  }

  healPlayer(p: Player, amt: number, capped: boolean): number {
    if (p.status !== 0 || amt <= 0) return 0;
    let a = amt;
    if (capped) {
      a = Math.min(a, p.healBudget);
      p.healBudget -= a;
    }
    const before = p.hp;
    p.hp = Math.min(p.maxHp, p.hp + a);
    const got = p.hp - before;
    if (got >= 1) this.emit({ k: 'dmg', tg: 'p', ti: p.id, v: Math.round(got), x: p.x, y: p.y - 18, c: 'heal', s: 0 });
    return got;
  }

  /** Berserker: Fúria gerada. */
  addRage(p: Player, amt: number): void {
    if (p.cls !== 'berserker' || p.status !== 0) return;
    p.rage = Math.min(BERSERKER.fury.max, p.rage + amt * (1 + this.mod(p, 'b_blood')));
    p.rageIdle = 0;
  }

  /** Necromante: Essência (com teto). */
  addEssence(p: Player, n: number): void {
    if (p.cls !== 'necromancer' || p.status !== 0 || n <= 0) return;
    const before = p.essence;
    p.essence = Math.min(NECRO.essence.max, p.essence + n);
    if (p.essence > before) this.emit({ k: 'fx', n: 'essence', x: p.x, y: p.y - 20, a: 0, o: p.id, r: p.essence - before });
  }

  private updatePlayer(p: Player, peaceful: boolean): void {
    const kit = kitFor(p.cls);
    if (p.cd.q > 0) p.cd.q--;
    if (p.cd.e > 0) p.cd.e--;
    if (p.iframes > 0) p.iframes--;
    const madnessBefore = p.buffs.madness;
    for (const k of Object.keys(p.buffs) as (keyof Player['buffs'])[]) if (p.buffs[k] > 0) p.buffs[k]--;
    if (madnessBefore === 1 && p.buffs.madness === 0 && p.cls === 'berserker' && !(p.mods['b_iron'] ?? 0)) {
      p.buffs.exhausted = sec(BERSERKER.madness.exhaustion);
      this.emit({ k: 'fx', n: 'exhausted', x: p.x, y: p.y - 20, a: 0, o: p.id, r: 0 });
    }
    if (p.comboT > 0 && --p.comboT === 0) p.comboStep = 0;
    if (p.thirstT > 0 && --p.thirstT === 0) p.thirst = 0;
    // teto de cura por segundo (vampiro)
    if (this.tick % TICK_RATE === 0) p.healBudget = VAMPIRE.healPerSecondCap;

    if (p.status === 1) {
      p.bleed--;
      if (p.bleed <= 0) {
        p.status = 2;
        p.reviveProgress = 0;
        this.emit({ k: 'sfx', n: 'death', x: p.x, y: p.y });
      }
      return;
    }
    if (p.status === 2) return;

    // queimadura (capítulo III)
    if (p.buffs.burn > 0 && p.buffs.burn % TICK_RATE === 0 && !this.god) {
      this.damagePlayerRaw(p, CLIMATE_EFFECTS.burn.damagePerSecond, false, true);
      if (p.status !== 0) return;
    }
    // Fúria do Berserker: decai fora de combate; travada no máximo durante a Loucura
    if (p.cls === 'berserker') {
      if (p.buffs.madness > 0) p.rage = BERSERKER.fury.max;
      else if (++p.rageIdle > sec(BERSERKER.fury.decayDelay)) p.rage = Math.max(0, p.rage - BERSERKER.fury.decayPerSecond * DT);
    }

    // stamina
    if (p.staminaDelay > 0) p.staminaDelay--;
    else if (!p.blocking && p.buffs.exhausted <= 0 && p.move.stamina < p.maxStamina) {
      const regen = p.base.staminaRegen * (1 + this.mod(p, 'g_recovery'));
      p.move.stamina = Math.min(p.maxStamina, p.move.stamina + regen * DT);
    }

    // ação em curso
    const a = p.action;
    if (a) {
      a.t++;
      kit.tickAction(this, p, a);
      if (p.action === a && a.t >= a.total) p.action = null;
    }
    kit.tickPassive?.(this, p);

    // buffer de entrada
    if (p.buffered) {
      p.buffered.t--;
      if (this.canAct(p)) {
        const b = p.buffered;
        p.buffered = null;
        if (b.slot === 'dodge') this.startBufferedDodge(p);
        else if (!peaceful) this.tryStart(p, b.slot);
      } else if (p.buffered.t <= 0) p.buffered = null;
    }
    if (peaceful) return;

    // cercado (fraqueza do caçador)
    if (p.cls === 'hunter' && this.tick % 5 === 0) {
      let n = 0;
      this.hash.query(p.x, p.y, 52, () => n++);
      p.surrounded = n >= 4;
    }
  }

  private updateRevives(): void {
    for (const p of this.players.values()) {
      if (p.status !== 0 || !p.connected) {
        p.revivingId = 0;
        continue;
      }
      if (!(p.held & BTN.interact)) {
        if (p.revivingId) this.cancelRevive(p);
        continue;
      }
      let target: Player | null = null;
      let best = PLAYER_RULES.reviveRange ** 2;
      for (const o of this.players.values()) {
        if (o.status !== 1) continue;
        const d = dist2(p.x, p.y, o.x, o.y);
        if (d <= best) {
          best = d;
          target = o;
        }
      }
      if (!target) {
        if (p.revivingId) this.cancelRevive(p);
        else if (this.tick % 20 === 0 && [...this.players.values()].some((o) => o.status === 1)) this.deny(p, 'range');
        continue;
      }
      if (p.revivingId !== target.id) {
        if (p.revivingId) this.cancelRevive(p);
        p.revivingId = target.id;
      }
      const speed = 1 + this.mod(p, 'g_bond');
      target.reviveProgress += speed;
      if (target.reviveProgress >= sec(PLAYER_RULES.reviveTime)) {
        target.status = 0;
        target.hp = Math.round(target.maxHp * PLAYER_RULES.reviveHpRatio);
        target.reviveProgress = 0;
        target.iframes = sec(1.2);
        target.action = null;
        p.revivingId = 0;
        p.stats.revives++;
        this.addUlt(p, PLAYER_RULES.ultPerRevive);
        this.emit({ k: 'revived', pi: target.id, by: p.id });
      }
    }
  }

  cancelRevive(p: Player): void {
    const t = this.players.get(p.revivingId);
    if (t && t.status === 1) t.reviveProgress = 0;
    p.revivingId = 0;
  }

  // ------------------------------------------------------------------ dano a jogadores

  /** Multiplicador de dano recebido pelo jogador (classes, zonas, melhorias). */
  private damageTakenMul(p: Player): number {
    let m = 1;
    if (p.inBastion) m *= 0.6;
    if (p.buffs.tauntDr > 0) m *= 0.7;
    m *= 1 - this.mod(p, 'g_skin');
    if (p.surrounded) m *= 1.25;
    if (p.cls === 'berserker') {
      if (p.buffs.madness > 0) m *= p.mods['b_iron'] ? 1 - this.mod(p, 'b_iron') : 1 + BERSERKER.madness.damageTaken;
      else m *= 1 + BERSERKER.fury.maxDamageTaken * (p.rage / BERSERKER.fury.max);
    }
    return m;
  }

  /** Aplica um golpe inimigo em um jogador (bloqueio, i-frames e reduções no servidor). */
  hitPlayer(p: Player, h: EnemyHit): HitResult {
    if (p.status !== 0) return 'ignored';
    if (p.iframes > 0) return 'evaded';
    if (this.god) return 'evaded';
    const kit = kitFor(p.cls);
    if (h.blockable && kit.onIncoming) {
      const r = kit.onIncoming(this, p, h);
      if (r !== null) return r;
    }
    const dmg = h.dmg * this.damageTakenMul(p);
    this.damagePlayerRaw(p, dmg, h.heavy);
    // clima: a horda adaptada aplica frio ou queimadura
    const onHit = this.chapter.enemies.onHit;
    if (onHit === 'chill') p.buffs.chill = sec(CLIMATE_EFFECTS.chill.duration);
    else if (onHit === 'burn') p.buffs.burn = sec(CLIMATE_EFFECTS.burn.duration);
    // afixo Sangrento: o atacante se cura
    const src = h.enemy;
    if (src && src.affix === 'bloody' && src.state !== 'dead') {
      // Cura baseada no dano real, não na enorme vida escalada dos minichefes/co-op.
      const heal = Math.min(src.maxHp * AFFIX_RULES.bloodyHealRatio, Math.max(1, Math.round(dmg)) * AFFIX_RULES.bloodyLifestealRatio);
      src.hp = Math.min(src.maxHp, src.hp + heal);
      this.emit({ k: 'fx', n: 'bloodyHeal', x: src.x, y: src.y - src.r - 6, a: 0, o: 0, r: 0 });
    }
    return 'hit';
  }

  damagePlayerRaw(p: Player, rawDmg: number, heavy: boolean, dot = false): void {
    const dmg = Math.max(1, Math.round(rawDmg));
    p.hp -= dmg;
    this.addUlt(p, dmg * PLAYER_RULES.ultPerDamageTaken);
    if (p.cls === 'berserker') this.addRage(p, dmg * BERSERKER.fury.perDamageTaken);
    this.emit({ k: 'dmg', tg: 'p', ti: p.id, v: dmg, x: p.x, y: p.y - 16, c: 'n', s: dot ? 1 : 0 });
    if (p.revivingId) this.cancelRevive(p);
    if (p.hp <= 0) {
      p.hp = 0;
      p.action = null;
      p.blocking = false;
      p.buffered = null;
      p.move.ft = 0;
      p.stats.downs++;
      p.buffs.burn = 0;
      clearMinions(this, p.id);
      this.objectives.onDown();
      if (this.solo || this.players.size === 1) {
        p.status = 2;
      } else {
        p.status = 1;
        p.bleed = sec(PLAYER_RULES.downedTime);
        p.reviveProgress = 0;
      }
      this.emit({ k: 'down', pi: p.id });
      return;
    }
    if (heavy && p.buffs.madness <= 0 && !(p.action && p.action.name === 'r')) {
      p.action = null;
      this.startAction(p, 'hurt', { windup: 0, active: 0, recovery: PLAYER_RULES.heavyHitStagger }, { moveMul: 0.2 });
      if (p.action) (p.action as Action).cancelFrom = 999;
    }
  }

  // ------------------------------------------------------------------ dano a inimigos

  damageMul(p: Player, e: Enemy): number {
    let m = 1 + this.mod(p, 'g_fury');
    if (p.cls === 'vampire') {
      m += p.thirst * VAMPIRE.thirst.damagePerStack;
      if (p.buffs.feast > 0) m += VAMPIRE.feast.damageBonus;
    }
    if (p.cls === 'hunter' && e.markBy === p.id && e.markT > 0) m += e.marks * (0.08 + this.mod(p, 'h_mark'));
    if (p.cls === 'berserker') {
      m += BERSERKER.fury.maxDamageBonus * (p.rage / BERSERKER.fury.max);
      if (p.buffs.madness > 0) m += BERSERKER.madness.damageBonus;
      if (p.rage >= BERSERKER.fury.high) m += this.mod(p, 'b_rage');
    }
    return m;
  }

  hitEnemy(p: Player | null, e: Enemy, base: number, o: HitOpts): number {
    if (e.state === 'dead' || e.state === 'spawn') return 0;
    if (e.state === 'roar' && e.def.tier === 'boss') base *= 0.35;
    base *= bossObjectiveDamageMul(this, e);
    const mul = p && !o.raw ? this.damageMul(p, e) : 1;
    const dmg = Math.max(1, Math.round(base * mul));
    e.hp -= dmg;
    e.lastHitTick = this.tick;
    this.emit({ k: 'dmg', tg: 'e', ti: e.id, v: dmg, x: e.x, y: e.y - e.r - 6, c: mul >= 1.3 ? 'crit' : 'n', s: p?.id ?? 0 });
    if (p) {
      p.stats.damage += dmg;
      if (!e.def.objective || e.type === 'funeralCart' || e.type === 'ritualist') this.addUlt(p, dmg * p.base.ultPerDamage);
      if (!o.fromMinion) {
        kitFor(p.cls).onDealt?.(this, p, e, dmg, o);
        if (p.cls === 'berserker') this.addRage(p, dmg * BERSERKER.fury.perDamageDealt);
      }
    }
    // poise / stagger (Blindado recebe só parte)
    if (o.poise > 0 && e.staggerImmune <= 0 && !e.def.stationary) {
      e.poise += o.poise * (e.affix === 'armored' ? AFFIX_RULES.armoredPoiseMul : 1);
      if (e.poise >= e.def.poise) this.stagger(e, e.def.staggerTime);
    }
    if (o.kb > 0 && !e.def.stationary) this.knockback(e, o.fromX, o.fromY, o.kb);
    if (e.hp <= 0) this.killEnemy(e, p);
    return dmg;
  }

  stagger(e: Enemy, seconds: number): void {
    if (e.state === 'dead' || e.state === 'spawn' || e.def.stationary) return;
    e.poise = 0;
    e.state = 'stagger';
    e.stateT = sec(seconds);
    e.atk = 'none';
    this.clearEnemyZones(e.id);
    if (e.def.tier === 'boss') e.staggerImmune = sec(BOSS_STAGGER_IMMUNITY);
    this.emit({ k: 'sfx', n: 'stagger', x: e.x, y: e.y });
  }

  /** Interrompe habilidade vulnerável (ex.: Pulso Magnético). Chefes ignoram. */
  interrupt(e: Enemy): boolean {
    if (e.def.tier === 'boss' || e.def.objective) return false;
    if (e.state !== 'windup') return false;
    const vulnerable: EnemyAttackName[] = ['orb', 'rune', 'pounce', 'slipper', 'lunge'];
    if (!vulnerable.includes(e.atk)) return false;
    this.stagger(e, 0.9);
    this.emit({ k: 'fx', n: 'interrupt', x: e.x, y: e.y - e.r, a: 0, o: 0, r: 0 });
    return true;
  }

  knockback(e: Enemy, fx: number, fy: number, speed: number): void {
    const k = speed * (1 - e.def.knockResist);
    if (k <= 1) return;
    let dx = e.x - fx;
    let dy = e.y - fy;
    const l = Math.hypot(dx, dy) || 1;
    dx /= l;
    dy /= l;
    e.kvx += dx * k;
    e.kvy += dy * k;
  }

  /** Controle com resistência (chefes/elites) e retornos decrescentes. Retorna duração aplicada (s). */
  applyCC(e: Enemy, kind: 'root' | 'slow' | 'stun', seconds: number, slowMul = 0.5, source: Player | null = null): number {
    if (e.state === 'dead' || e.def.stationary) return 0;
    const cc = e.cc;
    if (this.tick > cc.drUntil) cc.drCount = 0;
    const dr = kind === 'slow' ? 1 : Math.max(CC_DR.minMul, CC_DR.factor ** cc.drCount);
    const dur = seconds * e.def.ccResist * dr;
    if (dur <= 0.05) return 0;
    const t = sec(dur);
    if (kind === 'root') cc.root = Math.max(cc.root, t);
    else if (kind === 'stun') cc.stun = Math.max(cc.stun, t);
    else {
      cc.slow = Math.max(cc.slow, t);
      cc.slowMul = Math.min(cc.slowMul === 0 ? 1 : cc.slowMul, slowMul);
    }
    if (kind !== 'slow') {
      cc.drCount++;
      cc.drUntil = this.tick + sec(CC_DR.window);
    }
    if (source) this.addUlt(source, PLAYER_RULES.ultPerCc);
    return dur;
  }

  killEnemy(e: Enemy, by: Player | null): void {
    if (e.state === 'dead') return;
    e.state = 'dead';
    e.hp = 0;
    const objective = !!e.def.objective;
    if (!objective) this.lastKillTick = this.tick;
    if (by && !objective) by.stats.kills++;
    this.clearEnemyZones(e.id);
    this.emit({ k: 'die', ei: e.id, et: e.typeIdx, x: e.x, y: e.y });
    if (!objective) {
      // Restos Mortais: mortes próximas geram Essência para Necromantes (servos e aliados não contam)
      const E = NECRO.essence;
      const gain = e.def.tier === 'boss' ? E.perBoss : e.def.tier === 'elite' ? E.perElite : E.perCommon;
      for (const p of this.players.values()) {
        if (p.cls !== 'necromancer' || p.status !== 0) continue;
        const near = dist2(p.x, p.y, e.x, e.y) <= E.radius * E.radius;
        const marked = e.boneBy === p.id && e.boneT > 0;
        this.addEssence(p, (near ? gain : 0) + (marked ? E.markedBonus : 0));
      }
      if (e.def.tier !== 'boss') addPickup(this, 'corpse', e.x, e.y);
      if (e.affix) affixReward(this, e);
    } else {
      this.emit({ k: 'msg', txt: `${e.def.name} destruíd${e.type === 'funeralCart' ? 'o' : 'a'}!`, c: 'good' });
      if (e.type === 'abyssTotem' && countObjectives(this, 'abyssTotem') === 0) {
        this.emit({ k: 'msg', txt: 'Os totens caíram: o Patriarca desperta!', c: 'boss' });
      }
    }
    if (e.def.tier === 'boss') {
      // chefe morto limpa lacaios, objetivos e projéteis
      for (const o of this.enemies.values()) if (o !== e && o.state !== 'dead') this.killEnemy(o, null);
      this.projectiles = this.projectiles.filter((pr) => pr.team === 'p');
    }
  }

  private clearEnemyZones(eid: number): void {
    for (const z of this.zones) {
      if (z.owner === -eid && (z.kind === 'rune' || z.kind === 'leapMark' || z.kind === 'eruption' || z.kind === 'nova' || z.kind === 'iceSpike' || z.kind === 'moonPulse')) z.dead = true;
    }
  }

  /** Acerto corpo a corpo em arco a partir do jogador. Também quebra caixas/barris no arco. */
  meleeArc(
    p: Player,
    a: Action,
    spec: { damage: number; range: number; arc: number; poise: number; knockback: number },
    dmgMul = 1,
    rangeMul = 1,
  ): Enemy[] {
    const hits: Enemy[] = [];
    const range = spec.range * rangeMul;
    const half = (spec.arc * Math.PI) / 360;
    this.hash.query(p.x, p.y, range, (e) => {
      if (a.hit.has(e.id) || e.state === 'dead' || e.state === 'spawn') return;
      const ang = Math.atan2(e.y - p.y, e.x - p.x);
      const d = Math.hypot(e.x - p.x, e.y - p.y);
      const slack = Math.atan2(e.r, Math.max(1, d));
      if (spec.arc < 360 && Math.abs(angleDiff(ang, a.dir)) > half + slack) return;
      if (!lineOfSight(this.map, p.x, p.y, e.x, e.y) && d > e.r + 8) return;
      a.hit.add(e.id);
      hits.push(e);
    });
    for (const e of hits) this.hitEnemy(p, e, spec.damage * dmgMul, { poise: spec.poise, kb: spec.knockback, fromX: p.x, fromY: p.y, kind: 'melee' });
    // quebráveis no arco (uma vez por ação)
    const tx0 = Math.floor((p.x - range) / TILE);
    const tx1 = Math.floor((p.x + range) / TILE);
    const ty0 = Math.floor((p.y - range) / TILE);
    const ty1 = Math.floor((p.y + range) / TILE);
    for (let ty = ty0; ty <= ty1; ty++)
      for (let tx = tx0; tx <= tx1; tx++) {
        const bi = breakableAt(this.map, tx, ty);
        if (bi < 0 || a.hit.has(-1000 - bi)) continue;
        const cx = (tx + 0.5) * TILE;
        const cy = (ty + 0.5) * TILE;
        const d = Math.hypot(cx - p.x, cy - p.y);
        if (d > range + 12) continue;
        if (spec.arc < 360 && Math.abs(angleDiff(Math.atan2(cy - p.y, cx - p.x), a.dir)) > half + 0.35) continue;
        a.hit.add(-1000 - bi);
        damageBreakable(this, bi, spec.damage * dmgMul, p);
      }
    return hits;
  }

  /** Dano de área em caixas/barris. */
  breakInCircle(x: number, y: number, r: number, dmg: number, by: Player | null): void {
    const tx0 = Math.floor((x - r) / TILE);
    const tx1 = Math.floor((x + r) / TILE);
    const ty0 = Math.floor((y - r) / TILE);
    const ty1 = Math.floor((y + r) / TILE);
    for (let ty = ty0; ty <= ty1; ty++)
      for (let tx = tx0; tx <= tx1; tx++) {
        const bi = breakableAt(this.map, tx, ty);
        if (bi < 0) continue;
        if (dist2((tx + 0.5) * TILE, (ty + 0.5) * TILE, x, y) > (r + 12) ** 2) continue;
        damageBreakable(this, bi, dmg, by);
      }
  }

  enemiesInCircle(x: number, y: number, r: number): Enemy[] {
    const out: Enemy[] = [];
    this.hash.query(x, y, r, (e) => {
      if (e.state !== 'dead' && e.state !== 'spawn') out.push(e);
    });
    return out;
  }

  // ------------------------------------------------------------------ projéteis e zonas

  spawnProjectile(o: Partial<Projectile> & { kind: ProjectileKind; team: 'p' | 'e'; owner: number; x: number; y: number; vx: number; vy: number }): Projectile {
    const pr: Projectile = {
      id: this.newId(),
      kindIdx: PROJECTILE_KINDS.indexOf(o.kind),
      r: 4,
      dmg: 10,
      range: 300,
      pierce: 0,
      poise: 5,
      kb: 20,
      hit: new Set(),
      destructible: o.team === 'e',
      returnTo: 0,
      returning: false,
      ricochet: 0,
      tx: 0,
      ty: 0,
      splash: 0,
      dead: false,
      ...o,
    };
    this.projectiles.push(pr);
    return pr;
  }

  addZone(o: Partial<Zone> & { kind: ZoneKind; x: number; y: number; r: number; ttl: number; owner: number }): Zone {
    const z: Zone = { id: this.newId(), kindIdx: ZONE_KINDS.indexOf(o.kind), age: 0, extra: 0, a: 0, b: 0, dead: false, ...o };
    this.zones.push(z);
    return z;
  }

  /** Alvo de ricochete: inimigo mais próximo ainda não atingido. */
  private ricochetFrom(pr: Projectile, from: Enemy): void {
    let best: Enemy | null = null;
    let bd = 110 * 110;
    for (const e of this.enemiesInCircle(from.x, from.y, 110)) {
      if (e === from || pr.hit.has(e.id)) continue;
      const d = dist2(e.x, e.y, from.x, from.y);
      if (d < bd) {
        bd = d;
        best = e;
      }
    }
    if (!best) return;
    const a = Math.atan2(best.y - from.y, best.x - from.x);
    const sp = Math.hypot(pr.vx, pr.vy);
    const np = this.spawnProjectile({
      kind: 'bolt', team: 'p', owner: pr.owner, x: from.x + Math.cos(a) * (from.r + 4), y: from.y - 6 + Math.sin(a) * (from.r + 4),
      vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, r: pr.r, dmg: pr.dmg * 0.6, range: 130, pierce: 0, poise: pr.poise, kb: pr.kb, ricochet: 0,
    });
    for (const id of pr.hit) np.hit.add(id);
    this.emit({ k: 'fx', n: 'ricochet', x: from.x, y: from.y - 6, a, o: 0, r: 0 });
  }

  private stepProjectiles(): void {
    for (const pr of this.projectiles) {
      if (pr.dead) continue;
      if (pr.kind === 'slipper') {
        const owner = this.enemies.get(pr.returnTo);
        if (!pr.returning && dist2(pr.x, pr.y, pr.tx, pr.ty) < 12 * 12) {
          pr.returning = true;
          pr.hit.clear();
        }
        if (pr.returning) {
          if (!owner || owner.state === 'dead') {
            pr.dead = true;
            continue;
          }
          const a = Math.atan2(owner.y - pr.y, owner.x - pr.x);
          const sp = Math.hypot(pr.vx, pr.vy);
          pr.vx = Math.cos(a) * sp;
          pr.vy = Math.sin(a) * sp;
          if (dist2(pr.x, pr.y, owner.x, owner.y) < (owner.r + 6) ** 2) {
            pr.dead = true;
            continue;
          }
        }
      }
      const steps = Math.max(1, Math.ceil((Math.hypot(pr.vx, pr.vy) * DT) / 6));
      for (let s = 0; s < steps && !pr.dead; s++) {
        pr.x += (pr.vx * DT) / steps;
        pr.y += (pr.vy * DT) / steps;
        pr.range -= (Math.hypot(pr.vx, pr.vy) * DT) / steps;
        const tx = Math.floor(pr.x / TILE);
        const ty = Math.floor(pr.y / TILE);
        if (pr.kind !== 'slipper' && (pr.range <= 0 || blocksShot(this.map, tx, ty))) {
          this.projectileEnd(pr, true);
          break;
        }
        if (pr.x < 0 || pr.y < 0 || pr.x > WORLD_W || pr.y > WORLD_H) {
          pr.dead = true;
          break;
        }
        if (pr.team === 'p') {
          // caixas e barris param projéteis de jogadores
          const bi = breakableAt(this.map, tx, ty);
          if (bi >= 0) {
            damageBreakable(this, bi, pr.dmg, this.players.get(pr.owner) ?? null);
            this.projectileEnd(pr, true);
            break;
          }
          const owner = this.players.get(pr.owner) ?? null;
          this.hash.query(pr.x, pr.y, pr.r, (e) => {
            if (pr.dead || pr.hit.has(e.id) || e.state === 'dead' || e.state === 'spawn') return;
            pr.hit.add(e.id);
            this.hitEnemy(owner, e, pr.dmg, { poise: pr.poise, kb: pr.kb, fromX: pr.x - pr.vx * 0.05, fromY: pr.y - pr.vy * 0.05, kind: 'proj' });
            if (pr.ricochet > 0) {
              pr.ricochet--;
              this.ricochetFrom(pr, e);
            }
            if (pr.pierce > 0) pr.pierce--;
            else this.projectileEnd(pr, false);
          });
        } else {
          for (const p of this.players.values()) {
            if (pr.dead || p.status !== 0 || pr.hit.has(p.id)) continue;
            if (dist2(p.x, p.y, pr.x, pr.y) > (p.r + pr.r) ** 2) continue;
            pr.hit.add(p.id);
            const res = this.hitPlayer(p, {
              dmg: pr.dmg * this.objectives.enemyDamageMul,
              heavy: false,
              fromX: pr.x - pr.vx,
              fromY: pr.y - pr.vy,
              enemy: null,
              proj: pr,
              blockable: true,
            });
            if (res === 'evaded') continue;
            if (pr.kind !== 'slipper' || res !== 'hit') pr.dead = true;
            if (res === 'hit' || res === 'blocked' || res === 'parried') this.emit({ k: 'fx', n: 'projHit', x: pr.x, y: pr.y, a: 0, o: pr.kindIdx, r: 0 });
          }
          // servos também são atingidos (e param o projétil)
          if (!pr.dead && this.minions.size) {
            for (const m of this.minions.values()) {
              if (pr.dead || m.state === 'dead' || m.state === 'rise' || pr.hit.has(-m.id)) continue;
              if (dist2(m.x, m.y, pr.x, pr.y) > (m.r + pr.r) ** 2) continue;
              pr.hit.add(-m.id);
              hitMinion(this, m, pr.dmg);
              if (pr.kind !== 'slipper') pr.dead = true;
            }
          }
        }
      }
    }
  }

  private projectileEnd(pr: Projectile, wall: boolean): void {
    pr.dead = true;
    if (pr.splash > 0) {
      const owner = this.players.get(pr.owner) ?? null;
      for (const e of this.enemiesInCircle(pr.x, pr.y, pr.splash)) {
        if (pr.hit.has(e.id)) continue;
        this.hitEnemy(owner, e, pr.dmg * 0.6, { poise: 12, kb: 90, fromX: pr.x, fromY: pr.y, kind: 'aoe' });
      }
      this.breakInCircle(pr.x, pr.y, pr.splash, pr.dmg * 0.6, owner);
      this.emit({ k: 'fx', n: 'arcaneBurst', x: pr.x, y: pr.y, a: 0, o: pr.owner, r: pr.splash });
    } else if (wall) {
      this.emit({ k: 'fx', n: 'projWall', x: pr.x, y: pr.y, a: Math.atan2(pr.vy, pr.vx), o: pr.kindIdx, r: 0 });
    }
  }

  /** Destrói projéteis inimigos destrutíveis em um raio. */
  destroyEnemyProjectiles(x: number, y: number, r: number): number {
    let n = 0;
    for (const pr of this.projectiles) {
      if (pr.dead || pr.team !== 'e' || !pr.destructible) continue;
      if (dist2(pr.x, pr.y, x, y) <= r * r) {
        pr.dead = true;
        n++;
        this.emit({ k: 'fx', n: 'projPop', x: pr.x, y: pr.y, a: 0, o: pr.kindIdx, r: 0 });
      }
    }
    return n;
  }

  private stepZones(): void {
    for (const p of this.players.values()) p.inBastion = false;
    for (const e of this.enemies.values()) e.bastionSlow = false;
    for (const z of this.zones) {
      if (z.dead) continue;
      z.age++;
      z.ttl--;
      const owner = this.players.get(z.owner) ?? null;
      switch (z.kind) {
        case 'trap':
          if (z.age >= z.a) {
            for (const e of this.enemiesInCircle(z.x, z.y, z.r)) {
              if (e.state === 'air' || e.def.stationary) continue;
              kitFor('hunter').zoneTrigger?.(this, z, e, owner);
              z.dead = true;
              break;
            }
          }
          break;
        case 'glacial':
          for (const e of this.enemiesInCircle(z.x, z.y, z.r)) {
            if (e.def.stationary) continue;
            e.cc.slow = Math.max(e.cc.slow, 3);
            e.cc.slowMul = Math.min(e.cc.slowMul === 0 ? 1 : e.cc.slowMul, 1 - 0.45 * (e.def.tier === 'boss' ? 0.5 : 1));
            if (z.age % z.a === 0) this.hitEnemy(owner, e, z.b, { poise: 2, kb: 0, fromX: z.x, fromY: z.y, kind: 'aoe', noProc: true });
          }
          break;
        case 'bastion':
          for (const p of this.players.values()) {
            if (p.status === 0 && dist2(p.x, p.y, z.x, z.y) <= z.r * z.r) {
              p.inBastion = true;
              if (z.b > 0 && z.age % TICK_RATE === 0) this.healPlayer(p, z.b, false);
            }
          }
          for (const e of this.enemiesInCircle(z.x, z.y, z.r)) e.bastionSlow = true;
          break;
        case 'polarity':
          for (const e of this.enemiesInCircle(z.x, z.y, z.r)) {
            if (e.def.stationary) continue;
            const str = e.def.tier === 'common' ? z.a : e.def.tier === 'elite' ? z.b : 0;
            if (str <= 0) continue;
            e.cc.pullX = z.x;
            e.cc.pullY = z.y;
            e.cc.pullStr = str;
            e.cc.pullT = 2;
          }
          break;
        default:
          if (owner && z.owner > 0) kitFor(owner.cls).zoneTick?.(this, z, owner);
      }
      if (z.ttl <= 0 && !z.dead) {
        z.dead = true;
        if (owner) kitFor(owner.cls).zoneExpire?.(this, z, owner);
        if (z.kind === 'rune' || z.kind === 'eruption' || z.kind === 'moonPulse' || z.kind === 'nova' || z.kind === 'iceSpike') this.enemyZoneExpire(z);
      }
    }
  }

  private enemyZoneExpire(z: Zone): void {
    // explosão de área inimiga no fim do telegraph
    const src = this.enemies.get(-z.owner) ?? null;
    if (src && src.state === 'dead') return;
    const mul = this.objectives.enemyDamageMul;
    for (const p of this.players.values()) {
      if (p.status !== 0) continue;
      if (dist2(p.x, p.y, z.x, z.y) <= (z.r + p.r) ** 2) {
        this.hitPlayer(p, { dmg: z.b * mul, heavy: z.kind === 'eruption' || z.kind === 'nova', fromX: z.x, fromY: z.y, enemy: null, proj: null, blockable: false });
      }
    }
    for (const m of this.minions.values()) if (m.state !== 'dead' && dist2(m.x, m.y, z.x, z.y) <= (z.r + m.r) ** 2) hitMinion(this, m, z.b);
    const fx = z.kind === 'rune' ? 'runeBlast' : z.kind === 'moonPulse' ? 'moonBlast' : z.kind === 'nova' || z.kind === 'iceSpike' ? 'frostBlast' : 'eruptionBlast';
    this.emit({ k: 'fx', n: fx, x: z.x, y: z.y, a: 0, o: 0, r: z.r });
  }

  private cleanup(): void {
    if (this.projectiles.some((p) => p.dead)) this.projectiles = this.projectiles.filter((p) => !p.dead);
    if (this.zones.some((z) => z.dead)) this.zones = this.zones.filter((z) => !z.dead);
    for (const [id, e] of this.enemies) if (e.state === 'dead') this.enemies.delete(id);
  }

  // ------------------------------------------------------------------ inimigos

  spawnEnemy(type: EnemyType, x: number, y: number, players: number): Enemy {
    const def = ENEMIES[type];
    const boss = def.tier === 'boss';
    const chIdx = this.chapter.n - 1;
    const inCh = Math.max(0, waveInChapter(Math.max(1, this.wave)));
    const climate = this.chapter.enemies;
    const routeHp = this.route === 'safe' ? ROUTE.safe.hpMul : 1;
    const chapterHp = SCALING.chapterHp[chIdx] ?? 1;
    const hpMul = boss
      ? (1 + SCALING.bossHpPerPlayer * (players - 1)) * routeHp
      : def.objective
        ? 1 + SCALING.hpPerPlayer * (players - 1)
        : chapterHp * (1 + SCALING.hpPerWave * inCh) * (1 + SCALING.hpPerPlayer * (players - 1)) * climate.hpMul * routeHp * (def.miniboss ? 1 + 0.5 * (players - 1) : 1);
    const dmgMul = (SCALING.chapterDamage[chIdx] ?? 1) * (1 + SCALING.damagePerWave * inCh) * (def.damageMul ?? 1);
    const e: Enemy = {
      id: this.newId(),
      type,
      typeIdx: ENEMY_TYPES.indexOf(type),
      def,
      x,
      y,
      r: def.radius,
      kvx: 0,
      kvy: 0,
      hp: Math.round(def.hp * hpMul),
      maxHp: Math.round(def.hp * hpMul),
      dmgMul,
      state: 'spawn',
      stateT: 0,
      atk: 'none',
      facing: Math.PI / 2,
      tx: x,
      ty: y,
      targetId: 0,
      targetT: 0,
      cds: {},
      poise: 0,
      staggerImmune: 0,
      cc: { root: 0, slow: 0, slowMul: 0, stun: 0, pullX: 0, pullY: 0, pullStr: 0, pullT: 0, drCount: 0, drUntil: 0 },
      tauntBy: 0,
      tauntT: 0,
      markBy: 0,
      marks: 0,
      markT: 0,
      phase: 1,
      counter: 0,
      progressBest: 0xffff,
      progressT: 0,
      progressTarget: 0,
      enraged: false,
      shoutCd: sec(3),
      summonsLeft: 0,
      hitBy: new Set(),
      bastionSlow: false,
      lastHitTick: 0,
      affix: null,
      boneBy: 0,
      boneT: 0,
      cursedT: 0,
      minionTarget: 0,
      priority: false,
      exposedT: 0,
      relightT: 0,
      objT: 0,
    };
    // afixos: minichefes têm o afixo do tipo garantido; elites comuns sorteiam
    const options = affixesFor(type);
    if (options.length) {
      const bonus = this.route === 'risk' ? ROUTE.risk.affixBonus : 0;
      if (def.miniboss || this.rng.chance(affixChance(this.wave, bonus))) e.affix = this.rng.pick(options) as AffixId;
    }
    const pos = { x, y };
    resolveCircle(this.map, pos, e.r);
    e.x = pos.x;
    e.y = pos.y;
    this.enemies.set(e.id, e);
    if (boss) {
      this.bossId = e.id;
      spawnBossObjectives(this, e);
    } else if (def.miniboss) this.bossId = e.id;
    return e;
  }

  /** Alvo atual do inimigo: provocação > servo próximo (aggro) > jogador mais próximo pelo caminho. */
  targetOf(e: Enemy): Target | null {
    if (e.tauntT > 0) {
      const t = this.players.get(e.tauntBy);
      if (t && t.status === 0) return t;
    }
    if (e.minionTarget) {
      const m = this.minions.get(e.minionTarget);
      if (m && m.state !== 'dead' && e.targetT > 0) return m;
      e.minionTarget = 0;
    }
    let cur = this.players.get(e.targetId);
    if (cur && cur.status !== 0) cur = undefined;
    if (!cur || e.targetT <= 0) {
      let best: Player | null = null;
      let bestD = Infinity;
      let bestRaw = Infinity;
      for (const p of this.players.values()) {
        if (p.status !== 0) continue;
        const f = this.fields.get(p.id);
        const fd = f ? f.at(e.x, e.y) : 0xffff;
        const d = fd === 0xffff ? dist(e.x, e.y, p.x, p.y) / 3.2 + 500 : fd;
        const adj = cur && p.id === cur.id ? d * 0.8 : d;
        if (adj < bestD) {
          bestD = adj;
          best = p;
          bestRaw = dist(e.x, e.y, p.x, p.y);
        }
      }
      e.targetId = best?.id ?? 0;
      e.targetT = 20 + (e.id % 10);
      const m = minionAggro(this, e, bestRaw);
      if (m) {
        e.minionTarget = m.id;
        return m;
      }
      return best;
    }
    return cur;
  }

  /** Direção de perseguição usando campo de fluxo; linha reta quando há visão e está perto. */
  chaseDir(e: Enemy, t: Target): [number, number] {
    const dx = t.x - e.x;
    const dy = t.y - e.y;
    const d = Math.hypot(dx, dy) || 1;
    if ((d < 110 || t.isMinion) && lineOfSight(this.map, e.x, e.y, t.x, t.y) && circleFree(this.map, e.x + (dx / d) * 10, e.y + (dy / d) * 10, e.r)) {
      return [dx / d, dy / d];
    }
    const f = t.isMinion ? this.fields.get((t as Minion).owner) : this.fields.get(t.id);
    const dir = f?.direction(e.x, e.y);
    if (dir && (dir[0] !== 0 || dir[1] !== 0)) return dir;
    return [dx / d, dy / d];
  }

  private enemySpeedMul(e: Enemy): number {
    let m = 1;
    if (!e.def.objective) {
      m *= this.chapter.enemies.speedMul;
      if (this.storm.active && this.chapter.storm) m *= this.chapter.storm.enemySpeedMul;
    }
    if (e.affix === 'furious' && e.hp <= e.maxHp * AFFIX_RULES.furiousThreshold) m *= AFFIX_RULES.furiousSpeedMul;
    return m;
  }

  private stepEnemies(): void {
    const director = this.director;
    for (const e of this.enemies.values()) {
      if (e.state === 'dead') continue;
      for (const k in e.cds) {
        const key = k as EnemyAttackName;
        const v = e.cds[key] ?? 0;
        if (v > 0) e.cds[key] = v - 1;
      }
      const cc = e.cc;
      if (cc.root > 0) cc.root--;
      if (cc.stun > 0) cc.stun--;
      if (cc.slow > 0 && --cc.slow === 0) cc.slowMul = 0;
      if (cc.pullT > 0) cc.pullT--;
      if (e.staggerImmune > 0) e.staggerImmune--;
      if (e.tauntT > 0) e.tauntT--;
      if (e.markT > 0 && --e.markT === 0) e.marks = 0;
      if (e.boneT > 0 && --e.boneT === 0) e.boneBy = 0;
      if (e.cursedT > 0) e.cursedT--;
      if (e.targetT > 0) e.targetT--;
      if (e.shoutCd > 0) e.shoutCd--;
      if (this.tick % 15 === 0 && e.poise > 0) e.poise = Math.max(0, e.poise - e.def.poise * 0.15);
      if (e.def.tier === 'boss') tickBossObjectives(this, e);

      let dvx = 0;
      let dvy = 0;
      if (e.state === 'spawn') {
        e.stateT++;
        if (e.stateT >= (e.def.tier === 'boss' ? 45 : 18)) {
          e.state = 'move';
          e.stateT = 0;
        }
      } else if (e.state === 'stagger') {
        e.stateT--;
        if (e.stateT <= 0) {
          e.state = 'move';
          e.stateT = 0;
        }
      } else if (cc.stun > 0) {
        // atordoado: parado
      } else {
        const v = brainFor(e.type).tick(this, e);
        dvx = v[0];
        dvy = v[1];
      }
      if (e.def.stationary) continue;
      let spMul = this.enemySpeedMul(e);
      if (cc.slow > 0 && cc.slowMul > 0) spMul *= cc.slowMul;
      if (e.bastionSlow) spMul *= 0.8;
      if (e.enraged) spMul *= 1.6;
      if (cc.root > 0 || cc.stun > 0) spMul = 0;
      let mx = dvx * spMul * DT;
      let my = dvy * spMul * DT;
      if (cc.pullT > 0 && cc.pullStr > 0) {
        const px = cc.pullX - e.x;
        const py = cc.pullY - e.y;
        const pl = Math.hypot(px, py);
        if (pl > 6) {
          mx += (px / pl) * cc.pullStr * DT;
          my += (py / pl) * cc.pullStr * DT;
        }
      }
      mx += e.kvx * DT;
      my += e.kvy * DT;
      e.kvx *= 0.82;
      e.kvy *= 0.82;
      if (Math.abs(e.kvx) < 2) e.kvx = 0;
      if (Math.abs(e.kvy) < 2) e.kvy = 0;
      if (mx !== 0 || my !== 0) {
        const pos = { x: e.x, y: e.y };
        if (e.state === 'air') {
          pos.x += mx;
          pos.y += my;
          pos.x = clamp(pos.x, e.r, WORLD_W - e.r);
          pos.y = clamp(pos.y, e.r, WORLD_H - e.r);
        } else moveCircle(this.map, pos, e.r, mx, my);
        e.x = pos.x;
        e.y = pos.y;
      }
    }
    // separação entre inimigos e afastamento dos jogadores (objetivos fixos não se movem)
    this.rebuildHash();
    for (const e of this.enemies.values()) {
      if (e.state === 'dead' || e.state === 'air') continue;
      this.hash.query(e.x, e.y, e.r, (o) => {
        if (o.id <= e.id || o.state === 'dead' || o.state === 'air') return;
        const dx = o.x - e.x;
        const dy = o.y - e.y;
        const d = Math.hypot(dx, dy) || 0.01;
        const overlap = e.r + o.r - d;
        if (overlap <= 0) return;
        const es = !!e.def.stationary;
        const os = !!o.def.stationary;
        if (es && os) return;
        const me = e.r * e.r;
        const mo = o.r * o.r;
        const te = es ? 0 : os ? 1 : mo / (me + mo);
        const nx = dx / d;
        const ny = dy / d;
        e.x -= nx * overlap * te * 0.6;
        e.y -= ny * overlap * te * 0.6;
        o.x += nx * overlap * (1 - te) * 0.6;
        o.y += ny * overlap * (1 - te) * 0.6;
      });
      if (e.def.stationary) continue;
      for (const p of this.players.values()) {
        if (p.status !== 0) continue;
        const dx = e.x - p.x;
        const dy = e.y - p.y;
        const d = Math.hypot(dx, dy) || 0.01;
        const min = e.r + p.r - 2;
        if (d < min) {
          e.x += (dx / d) * (min - d);
          e.y += (dy / d) * (min - d);
        }
      }
      const pos = { x: e.x, y: e.y };
      resolveCircle(this.map, pos, e.r);
      e.x = pos.x;
      e.y = pos.y;
      if (!e.def.objective) director.watchStuck(e);
    }
  }

  // ------------------------------------------------------------------ ataques inimigos (helpers para cérebros)

  startEnemyAttack(e: Enemy, atk: EnemyAttackName, tx: number, ty: number): void {
    e.state = 'windup';
    e.stateT = 0;
    e.atk = atk;
    e.tx = tx;
    e.ty = ty;
    e.facing = Math.atan2(ty - e.y, tx - e.x);
    e.hitBy.clear();
  }

  setEnemyState(e: Enemy, s: EnemyStateName): void {
    e.state = s;
    e.stateT = 0;
  }

  enemyMelee(e: Enemy, range: number, arc: number, dmg: number, heavy: boolean): void {
    const half = (arc * Math.PI) / 360;
    const inArc = (x: number, y: number, r: number): boolean => {
      const d = dist(e.x, e.y, x, y);
      if (d > range + r + e.r * 0.5) return false;
      const ang = Math.atan2(y - e.y, x - e.x);
      return !(arc < 360 && Math.abs(angleDiff(ang, e.facing)) > half + 0.15);
    };
    for (const p of this.players.values()) {
      if (p.status !== 0 || e.hitBy.has(p.id)) continue;
      if (!inArc(p.x, p.y, p.r)) continue;
      e.hitBy.add(p.id);
      const r = this.hitPlayer(p, { dmg: dmg * this.edm(e), heavy, fromX: e.x, fromY: e.y, enemy: e, proj: null, blockable: true });
      if (r === 'hit') this.emit({ k: 'sfx', n: heavy ? 'heavyHit' : 'playerHit', x: p.x, y: p.y });
    }
    for (const m of this.minions.values()) {
      if (m.state === 'dead' || m.state === 'rise' || e.hitBy.has(-m.id)) continue;
      if (!inArc(m.x, m.y, m.r)) continue;
      e.hitBy.add(-m.id);
      hitMinion(this, m, dmg * this.edm(e));
    }
  }

  enemyCircle(e: Enemy, x: number, y: number, r: number, dmg: number, heavy: boolean, blockable = false): void {
    for (const p of this.players.values()) {
      if (p.status !== 0 || e.hitBy.has(p.id)) continue;
      if (dist2(x, y, p.x, p.y) > (r + p.r) ** 2) continue;
      e.hitBy.add(p.id);
      this.hitPlayer(p, { dmg: dmg * this.edm(e), heavy, fromX: x, fromY: y, enemy: e, proj: null, blockable });
    }
    for (const m of this.minions.values()) {
      if (m.state === 'dead' || m.state === 'rise' || e.hitBy.has(-m.id)) continue;
      if (dist2(x, y, m.x, m.y) > (r + m.r) ** 2) continue;
      e.hitBy.add(-m.id);
      hitMinion(this, m, dmg * this.edm(e));
    }
  }

  // ------------------------------------------------------------------ snapshots

  snapPlayers(): SnapPlayer[] {
    const out: SnapPlayer[] = [];
    for (const p of this.players.values()) {
      let f = 0;
      if (p.iframes > 0) f |= PLAYER_FLAGS.invuln;
      if (p.blocking) f |= PLAYER_FLAGS.blocking;
      if (p.buffs.madness > 0) f |= PLAYER_FLAGS.madness;
      if (p.buffs.exhausted > 0) f |= PLAYER_FLAGS.exhausted;
      if (p.buffs.feast > 0) f |= PLAYER_FLAGS.feast;
      if (p.inBastion) f |= PLAYER_FLAGS.bastion;
      if (p.convergence > 0) f |= PLAYER_FLAGS.empowered;
      if (p.cls === 'dog' && p.resonance >= 20 - this.mod(p, 'd_resonance')) f |= PLAYER_FLAGS.resonant;
      if (p.surrounded) f |= PLAYER_FLAGS.surrounded;
      if (p.buffs.tauntDr > 0) f |= PLAYER_FLAGS.taunting;
      if (p.cls === 'berserker' && p.rage >= BERSERKER.fury.high) f |= PLAYER_FLAGS.rage;
      if (p.buffs.chill > 0) f |= PLAYER_FLAGS.chill;
      if (p.buffs.burn > 0) f |= PLAYER_FLAGS.burn;
      if (p.revivingId) f |= PLAYER_FLAGS.reviving;
      if (p.action && p.action.name === 'e' && p.cls === 'berserker' && p.action.t <= BERSERKER.leap.ticks) f |= PLAYER_FLAGS.airborne;
      const a = p.action;
      out.push({
        id: p.id,
        c: p.cls,
        x: Math.round(p.x * 10) / 10,
        y: Math.round(p.y * 10) / 10,
        a: Math.round(p.aim * 1000),
        hp: Math.ceil(p.hp),
        mhp: p.maxHp,
        st: Math.round(p.move.stamina),
        mst: p.maxStamina,
        act: a ? actionCode(a.name) : p.blocking ? actionCode('block') : 0,
        at: a ? a.t : 0,
        ad: a ? Math.round(a.dir * 1000) : 0,
        s: p.status,
        bl: p.bleed,
        rv: p.status === 1 ? Math.round((p.reviveProgress / sec(PLAYER_RULES.reviveTime)) * 100) : 0,
        f,
        cd: [p.cd.q, p.cd.e],
        cm: [p.cdMax.q, p.cdMax.e],
        u: Math.floor(p.ult),
        k:
          p.cls === 'vampire' ? p.thirst
          : p.cls === 'dog' ? p.resonance
          : p.cls === 'mage' ? p.convergence
          : p.cls === 'berserker' ? Math.round(p.rage)
          : p.cls === 'necromancer' ? p.essence
          : p.comboStep,
        cn: p.connected ? 1 : 0,
        dg: p.lastDodgeTick,
      });
    }
    return out;
  }

  snapYou(pid: number): SnapYou | null {
    const p = this.players.get(pid);
    if (!p) return null;
    const mp = this.moveParams(p);
    return {
      ack: p.ack,
      x: p.move.x,
      y: p.move.y,
      fvx: p.move.fvx,
      fvy: p.move.fvy,
      ft: p.move.ft,
      st: p.move.stamina,
      dcd: p.move.dodgeCd,
      mm: mp.moveMul,
      cdg: mp.canDodge ? 1 : 0,
      sp: mp.speed,
    };
  }

  snapEnemies(): EnemyTuple[] {
    const out: EnemyTuple[] = [];
    for (const e of this.enemies.values()) {
      let f = 0;
      if (e.state === 'stagger') f |= ENEMY_FLAGS.stagger;
      if (e.cc.root > 0 || e.cc.stun > 0) f |= ENEMY_FLAGS.rooted;
      if (e.cc.slow > 0) f |= ENEMY_FLAGS.slowed;
      if (e.tauntT > 0) f |= ENEMY_FLAGS.taunted;
      if (e.phase >= 2) f |= ENEMY_FLAGS.phase2;
      if (e.cc.pullT > 0) f |= ENEMY_FLAGS.pulled;
      if (e.enraged) f |= ENEMY_FLAGS.enraged;
      if (e.def.tier === 'boss' && bossObjectiveDamageMul(this, e) < 1) f |= ENEMY_FLAGS.shielded;
      if (e.exposedT > 0) f |= ENEMY_FLAGS.exposed;
      if (e.priority) f |= ENEMY_FLAGS.priority;
      if (e.cursedT > 0) f |= ENEMY_FLAGS.cursed;
      out.push([
        e.id,
        e.typeIdx,
        Math.round(e.x * 10) / 10,
        Math.round(e.y * 10) / 10,
        Math.ceil(e.hp),
        e.maxHp,
        enemyStateCode(e.state),
        enemyAttackCode(e.atk),
        e.stateT,
        Math.round(e.facing * 100),
        Math.round(e.tx),
        Math.round(e.ty),
        f,
        e.affix ? AFFIX_IDS.indexOf(e.affix) : 0,
        e.boneT > 0 ? 8 : Math.min(7, e.marks),
        e.boneT > 0 ? e.boneBy : e.markBy,
      ]);
    }
    return out;
  }

  snapProjectiles(): ProjTuple[] {
    return this.projectiles.map((p) => [p.id, p.kindIdx, Math.round(p.x), Math.round(p.y), Math.round(p.vx), Math.round(p.vy), p.team === 'p' ? p.owner : -1]);
  }

  snapZones(): ZoneTuple[] {
    return this.zones.map((z) => [z.id, z.kindIdx, Math.round(z.x), Math.round(z.y), Math.round(z.r), z.ttl, z.owner, z.extra]);
  }

  waveInfo(): WaveInfo {
    let left = this.director.remaining();
    if (this.phase !== 'wave') left = 0;
    const info = this.objectives.info();
    const boss = this.bossId && this.enemies.has(this.bossId) ? this.bossId : 0;
    let bo: WaveInfo['bo'] = null;
    const b = boss ? this.enemies.get(boss) : undefined;
    if (b && b.type === 'moonDevourer' && this.map.points.moons.length) bo = { k: 'moon', n: countObjectives(this, 'falseMoon'), tot: this.map.points.moons.length, x: b.exposedT > 0 ? Math.ceil(b.exposedT / TICK_RATE) : 0 };
    else if (b && b.type === 'patriarch' && this.map.points.totems.length) bo = { k: 'totem', n: countObjectives(this, 'abyssTotem'), tot: this.map.points.totems.length, x: 0 };
    return {
      n: this.wave,
      left,
      ph: this.phase,
      tm: this.phaseTimer,
      title: this.waveTitle,
      boss,
      ch: this.chapter.n,
      mp: mapIndex(this.map.id),
      st: this.storm.active ? 1 : 0,
      rt: this.route === 'risk' ? 1 : this.route === 'safe' ? 2 : 0,
      ev: info.ev,
      cg: info.cg,
      bo,
    };
  }

  matchStats(): Record<number, MatchStats> {
    const out: Record<number, MatchStats> = {};
    for (const p of this.players.values()) out[p.id] = { ...p.stats };
    return out;
  }

  /** Há Necromante na partida (para enviar cadáveres no snapshot). */
  hasNecro(): boolean {
    for (const p of this.players.values()) if (p.cls === 'necromancer') return true;
    return false;
  }
}
