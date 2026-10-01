/**
 * Simulação autoritativa. Não depende de DOM, Phaser nem de rede: recebe intenções
 * (inputs/escolhas/votos) e produz estado + eventos identificados.
 */
import { AFFIX_IDS, AFFIX_RULES, affixChance, affixesFor, type AffixId } from '../../shared/config/affixes.js';
import { CHAPTERS, type ChapterDef, chapterOfWave, CLIMATE_EFFECTS, type Route, ROUTE, TRAVEL_SECONDS } from '../../shared/config/chapters.js';
import { BERSERKER, CLASS_RANGE, CLASSES, type ClassId, HEAL_RULES, type HealSource, HUNTER, JOTA, LAPANHA, MAYCON, MELEE_RULES, NECRO, PLAYER_RULES, TANK, VAMPIRE } from '../../shared/config/classes.js';
import { COMBOS } from '../../shared/config/combos.js';
import { ATK, BOSS_AI, BOSS_STAGGER_IMMUNITY, CC_DR, ENEMIES, ENEMY_TYPES, type EnemyType } from '../../shared/config/enemies.js';
import { BASE_OFFER_COUNT, INTERMISSION_SECONDS, LEGENDARY_MAX_PER_BUILD, MAX_OFFER_COUNT, UPGRADE_BY_ID, UPGRADE_CAPS } from '../../shared/config/upgrades.js';
import { BANISH_PER_MATCH, memoryReward, REROLLS_PER_MATCH, sanitizePerks } from '../../shared/config/meta.js';
import { NO_SYNERGY, synergyTotals } from '../../shared/config/synergies.js';
import { CHECKPOINT, isCheckpointWave, SCALING, TOTAL_WAVES, WAVES, waveInChapter } from '../../shared/config/waves.js';
import { DT, sec, SHOT_HEIGHT, TICK_RATE, TILE } from '../../shared/constants.js';
import { circleFree, lineOfSight, moveCircle, resolveCircle } from '../../shared/collision.js';
import { type ArenaMap, Obst, blocksShot, breakableAt, cloneMap, getMap, mapIndex, WORLD_H, WORLD_W } from '../../shared/map.js';
import { angleDiff, clamp, dist, dist2, Rng } from '../../shared/math.js';
import { BTN, type InputFrame, type MoveParams, stepMovement } from '../../shared/movement.js';
import {
  actionCode, type ActionName, type DebugCommand, type DenyReason, ENEMY_FLAGS, type EnemyTuple, enemyAttackCode, type EnemyAttackName,
  enemyStateCode, type EnemyStateName, type GameEvent, type GameEventBody, type MatchStats, type Phase, PLAYER_FLAGS,
  LOB_KINDS, PROJECTILE_KINDS, type ProjectileKind, type ProjTuple, type SnapPlayer, type SnapYou, type WaveInfo, ZONE_KINDS,
  type ZoneKind, type ZoneTuple,
} from '../../shared/protocol.js';
import { brainFor } from './ai/brains.js';
import { choosePlayer, decayThreat, onDamage, seedThreat } from './ai/threat.js';
import { rememberAttack, thinkTicks } from './ai/utility.js';
import { FAIR } from '../../shared/config/enemyAI.js';
import { Director } from './director.js';
import { kitFor } from './kits/index.js';
import { chargeFrac, slideBump } from './kits/lapanha.js';
import { detonateGuardian } from './kits/tank.js';
import { addPickup, damageBreakable, resetBreakables, respawnSomeBreakables, stepPickups } from './loot.js';
import { clearMinions, hitMinion, minionAggro, stepMinions } from './minions.js';
import { FlowField } from './nav.js';
import { absorbWithShield, addShield, applyWound, clearAfflictions, type HealUse, healPlayer, newTelemetry, stunPlayer, tickPlayerHealth } from './healing.js';
import { affixReward, bossObjectiveDamageMul, countObjectives, Objectives, spawnBossObjectives, tickBossObjectives } from './objectives.js';
import { playerSay } from './lines.js';
import { isBat, jotaDamageBonus, jotaDown, newJotaState } from './kits/jota.js';
import { WorldTelemetry } from './telemetry.js';
import { SpatialHash } from './spatial.js';
import type { Action, Enemy, Minion, Pickup, Player, Projectile, Slot, Target, Zone } from './types.js';
import { legendaryCount, rollUpgrades } from './upgrades.js';

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
  /** Explosões de suprema não carregam outra suprema em hordas densas. */
  noUlt?: boolean;
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
  /** Atordoamento raro (s) se o golpe acertar de fato (esquiva e bloqueio evitam). */
  stun?: number;
}

export type HitResult = 'hit' | 'blocked' | 'parried' | 'evaded' | 'ignored';

const EMPTY_INPUT = (seq: number, x: number, y: number): InputFrame => ({ seq, mx: 0, my: 0, ax: x + 10, ay: y, held: 0, pressed: 0 });

export class World {
  /** Mapa ativo (clone mutável: caixas e barris quebram). */
  map: ArenaMap = cloneMap(getMap('village'));
  chapter: ChapterDef = CHAPTERS[0] as ChapterDef;
  readonly rng: Rng;
  readonly seed: number;
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
  /** Caminho dos inimigos até o sobrevivente durante a escolta. */
  escortField: FlowField | null = null;
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
  /** Oferta anterior de cada jogador (evita repetir as mesmas cartas seguidas). */
  readonly lastOffers = new Map<number, string[]>();
  picks = new Map<number, string>();
  bossId = 0;
  intro: WaveInfo['intro'] = null;
  bard: { x: number; y: number } | null = null;
  matchStartTick = 0;
  lastKillTick = 0;
  onPhaseChange: ((phase: Phase) => void) | null = null;
  onOffersChange: (() => void) | null = null;
  onModsChange: (() => void) | null = null;
  onRouteChange: (() => void) | null = null;
  /**
   * Último checkpoint (onda de chefe/minichefe vencida): estado de cada jogador NO FIM da onda,
   * antes das escolhas do intervalo. Voltar a ele desfaz as melhorias tomadas depois.
   */
  checkpoint: { wave: number; players: Map<number, { mods: Record<string, number>; maxHp: number; maxStamina: number; penalty: number }> } | null = null;
  /** Quantas vezes a equipe voltou ao checkpoint nesta partida. */
  wipes = 0;
  /** Telemetria de balanceamento (servidor; não vai para os clientes). */
  readonly tele = new WorldTelemetry();
  /** Dano válido do último acerto (sem excesso sobre a vida restante; 0 em objetivos/invulneráveis). */
  lastValid = 0;
  /** Dano válido por inimigo no último `meleeArc`. */
  readonly arcValid = new Map<number, number>();

  constructor(opts: WorldOptions) {
    this.seed = opts.seed;
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
      lastShotTick: -9999,
      ultLockT: 0,
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
      buffs: { madness: 0, exhausted: 0, feast: 0, tauntDr: 0, guardBroken: 0, chill: 0, burn: 0, stunRes: 0, slowed: 0, retreat: 0, harvest: 0 },
      slowMul: 1,
      blocking: false,
      blockDir: 0,
      guardianCharge: 0,
      guardianCounter: false,
      guardianCounterUntil: 0,
      guardianGuardStart: -9999,
      guardianLastUltBlock: -9999,
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
      healBudget: HEAL_RULES.combatPerSecond[cls],
      queue: [],
      last: EMPTY_INPUT(0, start.x, start.y),
      ack: 0,
      held: 0,
      buffered: null,
      mods: {},
      connected: true,
      lastPing: -9999,
      lastDodgeTick: -9999,
      stats: { kills: 0, damage: 0, downs: 0, revives: 0, taken: 0, rr: 0, bn: 0, bosses: 0, mem: 0 },
      perks: [],
      rerolls: REROLLS_PER_MATCH,
      banishes: BANISH_PER_MATCH,
      banished: [],
      syn: { ...NO_SYNERGY },
      inBastion: false,
      bastionHeal: 0,
      woundT: 0,
      woundBlockT: 0,
      woundBy: 0,
      recentHeal: 0,
      shieldHp: 0,
      shieldT: 0,
      guardCdT: 0,
      heartCdT: 0,
      pressureId: 0,
      pressureN: 0,
      stillT: 0,
      harvestRate: 0,
      harvestFreeQ: false,
      lastPieceOn: false,
      fairToggle: false,
      harvestHitBudget: LAPANHA.harvest.hitHealPerSecond,
      lastSayTick: -9999,
      charge: -1,
      hpPenalty: 0,
      jota: newJotaState(),
      tele: newTelemetry(),
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
    this.escortField = new FlowField(this.map);
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
      clearAfflictions(p);
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
    this.intro = null;
  }

  // ------------------------------------------------------------------ partida

  /** v1.6: ondas concluídas e chefes abatidos na partida (para Lembranças e estatísticas). */
  wavesCleared = 0;
  minibossKills = 0;
  bossKills = 0;

  startMatch(): void {
    this.wavesCleared = 0;
    this.minibossKills = 0;
    this.bossKills = 0;
    this.wave = 0;
    this.checkpoint = null;
    this.wipes = 0;
    this.route = null;
    this.routeResult = null;
    this.votes.clear();
    this.objectives.reset();
    this.director.reset();
    this.setChapter(1);
    this.matchStartTick = this.tick;
    let i = 0;
    for (const p of this.players.values()) this.resetPlayerForMatch(p, i++);
    this.tele.reset();
    this.lastOffers.clear();
    this.beginWave(1);
    for (const p of this.players.values()) playerSay(this, p, 'matchStart', true);
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
    p.stats = { kills: 0, damage: 0, downs: 0, revives: 0, taken: 0, rr: 0, bn: 0, bosses: 0, mem: 0 };
    p.rerolls = REROLLS_PER_MATCH + (p.perks.includes('rr1') ? 1 : 0);
    p.banishes = BANISH_PER_MATCH + (p.perks.includes('bn1') ? 1 : 0);
    p.banished = [];
    p.syn = { ...NO_SYNERGY };
    p.buffs = { madness: 0, exhausted: 0, feast: 0, tauntDr: 0, guardBroken: 0, chill: 0, burn: 0, stunRes: 0, slowed: 0, retreat: 0, harvest: 0 };
    p.slowMul = 1;
    clearAfflictions(p);
    p.shieldHp = 0;
    p.shieldT = 0;
    p.guardCdT = 0;
    p.heartCdT = 0;
    p.recentHeal = 0;
    p.harvestFreeQ = false;
    p.fairToggle = false;
    p.tele = newTelemetry();
    p.thirst = 0;
    p.resonance = 0;
    p.convergence = 0;
    p.rage = 0;
    p.essence = 0;
    p.bonusCards = 0;
    p.comboStep = 0;
    p.guardianCharge = 0;
    p.guardianCounter = false;
    p.guardianCounterUntil = 0;
    p.guardianGuardStart = -9999;
    p.guardianLastUltBlock = -9999;
    p.hpPenalty = 0;
    // Dote do Veterano: 1 carta comum de classe aleatória (perk de meta-progressão)
    if (p.perks.includes('start')) {
      const pool = [...UPGRADE_BY_ID.values()].filter((u) => u.cls === p.cls && u.rarity === 'common' && u.kind === 'numeric' && !u.onlyFor);
      const pick = pool.length ? this.rng.pick(pool) : null;
      if (pick) p.mods[pick.id] = 1;
    }
    this.refreshSynergies(p);
  }

  private setPhase(ph: Phase): void {
    this.phase = ph;
    this.onPhaseChange?.(ph);
  }

  private beginWave(n: number): void {
    this.intro = null;
    this.wave = n;
    const def = WAVES[n - 1];
    this.waveTitle = def?.title ?? '';
    const players = Math.max(1, this.players.size);
    const risk = this.route === 'risk';
    this.director.start(n, players, { budgetMul: risk ? ROUTE.risk.budgetMul : 1, extraElites: risk ? ROUTE.risk.extraElites : 0 });
    this.objectives.beginWave(n);
    this.pickBardSpot();
    this.phaseTimer = sec(3);
    this.lastKillTick = this.tick;
    this.offers.clear();
    this.offerBonus.clear();
    this.picks.clear();
    this.storm = { active: false, t: this.chapter.storm ? sec(this.chapter.storm.every * 0.6) : 0 };
    for (const p of this.players.values()) clearAfflictions(p);
    this.tele.beginWave(n, this.tick);
    this.setPhase('wave');
    if (n > 1) for (const p of this.players.values()) playerSay(this, p, 'waveStart');
  }

  /** Um local cênico, alcançável e estável para todos os clientes durante a onda. */
  private pickBardSpot(): void {
    const map = this.map;
    const previous = this.bard;
    const field = new FlowField(map);
    const start = map.starts[0] ?? map.campfire;
    field.compute(start.x, start.y);
    const valid = (x: number, y: number): boolean =>
      circleFree(map, x, y, 12) && field.at(x, y) !== 0xffff &&
      dist2(x, y, map.campfire.x, map.campfire.y) > 340 ** 2 &&
      map.starts.every((s) => dist2(x, y, s.x, s.y) > 420 ** 2) &&
      map.spawns.every((s) => dist2(x, y, s.x, s.y) > 95 ** 2) &&
      dist2(x, y, map.points.boss.x, map.points.boss.y) > 110 ** 2 &&
      (!previous || dist2(x, y, previous.x, previous.y) > 180 ** 2);
    const candidates: { x: number; y: number }[] = [];
    const scenic = new Set([Obst.Ruin, Obst.Tree, Obst.Tomb, Obst.Crypt, Obst.Hedge, Obst.Pillar, Obst.Statue, Obst.Obelisk, Obst.House]);
    for (const o of map.objects) {
      if (!scenic.has(o.kind)) continue;
      const cx = (o.tx + o.tw / 2) * TILE;
      const cy = (o.ty + o.th / 2) * TILE;
      for (const [dx, dy] of [[-64, 0], [64, 0], [0, -64], [0, 64], [-48, -48], [48, -48], [-48, 48], [48, 48]]) {
        const x = Math.round((cx + dx) / TILE) * TILE + TILE / 2;
        const y = Math.round((cy + dy) / TILE) * TILE + TILE / 2;
        if (valid(x, y)) candidates.push({ x, y });
      }
    }
    if (!candidates.length) for (let ty = 2; ty < map.h - 2; ty += 2) for (let tx = 2; tx < map.w - 2; tx += 2) {
      const x = (tx + 0.5) * TILE;
      const y = (ty + 0.5) * TILE;
      if (valid(x, y)) candidates.push({ x, y });
    }
    const roll = new Rng((this.seed ^ Math.imul(this.wave, 0x9e3779b9) ^ Math.imul(mapIndex(map.id), 0x85ebca6b)) >>> 0);
    this.bard = candidates.length ? candidates[roll.int(0, candidates.length - 1)] as { x: number; y: number } : null;
  }

  guardianReductionAt(x: number, y: number): number {
    let reduction = 0;
    for (const p of this.players.values()) {
      if (p.status !== 0 || p.cls !== 'tank' || p.action?.name !== 'r') continue;
      if (dist2(x, y, p.x, p.y) > TANK.bastion.radius ** 2) continue;
      reduction = Math.max(reduction, TANK.bastion.reduction + this.mod(p, 't_protector'));
    }
    return 1 - reduction;
  }

  recordGuardianDamage(x: number, y: number, actual: number): void {
    if (actual <= 0) return;
    for (const p of this.players.values()) {
      if (p.status !== 0 || p.cls !== 'tank' || p.action?.name !== 'r') continue;
      if (dist2(x, y, p.x, p.y) > TANK.bastion.radius ** 2) continue;
      p.guardianCharge = Math.min(TANK.bastion.bonusCap / TANK.bastion.damageRatio, p.guardianCharge + actual);
    }
  }

  private beginIntermission(): void {
    this.tele.endWave(this.tick, this);
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
      clearAfflictions(p);
      p.buffs.harvest = 0;
      p.shieldHp = 0;
      p.shieldT = 0;
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
      const offer = rollUpgrades(this.rng, p, count, this.lastOffers.get(p.id) ?? [], p.banished);
      this.offers.set(p.id, offer);
      this.lastOffers.set(p.id, offer);
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

  /** Recalcula o cache de sinergias (tags de build + combinações) a partir das cartas atuais. */
  refreshSynergies(p: Player): void {
    p.syn = synergyTotals(p.mods);
  }

  /** v1.6: perks de meta-progressão enviados pelo cliente (só ids conhecidos; vale na próxima partida). */
  setPerks(pid: number, raw: unknown): void {
    const p = this.players.get(pid);
    if (p && this.phase === 'lobby') p.perks = sanitizePerks(raw);
  }

  /** Reroll: sorteia uma oferta nova (limitado por partida). Só antes de confirmar a escolha. */
  rerollOffer(pid: number): boolean {
    const p = this.players.get(pid);
    const cur = this.offers.get(pid);
    if (this.phase !== 'intermission' || !p || !cur || this.picks.has(pid) || p.rerolls <= 0) return false;
    p.rerolls--;
    p.stats.rr = (p.stats.rr ?? 0) + 1;
    const offer = rollUpgrades(this.rng, p, cur.length, cur, p.banished);
    this.offers.set(pid, offer);
    this.lastOffers.set(pid, offer);
    this.onOffersChange?.();
    return true;
  }

  /** Banir: remove uma carta da oferta para o resto da partida e a substitui por outra. */
  banishCard(pid: number, id: string): boolean {
    const p = this.players.get(pid);
    const cur = this.offers.get(pid);
    if (this.phase !== 'intermission' || !p || !cur || this.picks.has(pid) || p.banishes <= 0 || !cur.includes(id)) return false;
    p.banishes--;
    p.stats.bn = (p.stats.bn ?? 0) + 1;
    p.banished.push(id);
    const rest = cur.filter((c) => c !== id);
    const repl = rollUpgrades(this.rng, p, 1, cur, [...p.banished, ...rest]);
    const offer = cur.map((c) => (c === id ? (repl[0] ?? '') : c)).filter((c) => c !== '');
    this.offers.set(pid, offer);
    this.lastOffers.set(pid, offer);
    this.onOffersChange?.();
    return true;
  }

  /** A melhoria ainda pode ser acumulada e não conflita com uma bifurcação já tomada. */
  canTake(p: Player, id: string): boolean {
    const def = UPGRADE_BY_ID.get(id);
    if (!def || (p.mods[id] ?? 0) >= def.maxStacks) return false;
    if (def.cls !== null && def.cls !== p.cls) return false;
    if (def.rarity === 'legendary' && (p.mods[id] ?? 0) === 0 && legendaryCount(p) >= LEGENDARY_MAX_PER_BUILD) return false;
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
      if (id === 'g_vigor' || id === 'g_hide') {
        p.maxHp += def.value;
        p.hp += def.value;
      } else if (id === 'g_breath' || id === 'g_lung') {
        p.maxStamina += def.value;
      }
      this.refreshSynergies(p);
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
    this.tele.endWave(this.tick, this);
    for (const p of this.players.values()) playerSay(this, p, victory ? 'victory' : 'defeat', true);
    this.setPhase(victory ? 'victory' : 'defeat');
  }

  god = false;
  /** Depuração: impede o fim da onda (cenários de teste isolados). */
  holdWave = false;

  /** Comandos de depuração (apenas com UV_DEBUG=1). */
  debug(c: DebugCommand, n: number, s: string): void {
    if (c === 'wave' && n >= 1 && n <= TOTAL_WAVES) {
      const ch = chapterOfWave(n);
      if (ch.n !== this.chapter.n) this.setChapter(ch.n);
      else this.clearTransient();
      this.bossId = 0;
      this.beginWave(n);
    } else if (c === 'phase') {
      const boss = this.enemies.get(this.bossId);
      if (boss?.def.tier === 'boss' && boss.state !== 'dead') boss.hp = Math.min(boss.hp, Math.round(boss.maxHp * 0.28));
    } else if (c === 'ult') {
      for (const p of this.players.values()) {
        p.ult = PLAYER_RULES.ultMax;
        if (p.cls === 'necromancer') p.essence = NECRO.essence.max;
      }
    } else if (c === 'god') this.god = !this.god;
    else if (c === 'hold') this.holdWave = !this.holdWave;
    else if (c === 'kill') {
      for (const e of this.enemies.values()) if (!e.def.objective) this.killEnemy(e, null);
    } else if (c === 'tele') {
      // telemetria no console do servidor (ferramenta de balanceamento)
      console.log('[telemetria]', JSON.stringify(this.tele.report(this), null, 1));
    } else if (c === 'wound') {
      // aplica a Ferida Profana no primeiro jogador (capturas/testes); n = 1 força a fase de bloqueio
      const p = [...this.players.values()][0];
      if (p) {
        if (n === 0) p.woundT = 0;
        applyWound(this, p, [...this.enemies.values()].find((e) => e.type === 'shadowAcolyte') ?? null);
      }
    } else if (c === 'stun') {
      const p = [...this.players.values()][0];
      if (p) stunPlayer(this, p, n > 0 ? n / 10 : 0.5);
    } else if (c === 'hp') {
      // vida do primeiro jogador em % (capturas de estado crítico e testes do Lapanha)
      const p = [...this.players.values()][0];
      if (p) p.hp = Math.max(1, Math.round((p.maxHp * Math.min(100, n)) / 100));
    } else if (c === 'event' || c === 'challenge') {
      this.objectives.debugForce(c, s, n);
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
    if (this.intro) {
      // Congelamento autoritativo: inputs recebidos durante a apresentação não
      // ficam enfileirados para disparar todos de uma vez na retomada.
      for (const p of this.players.values()) p.queue.length = 0;
      const arriving = this.enemies.get(this.intro.id);
      if (arriving?.state === 'spawn' && this.intro.t > this.intro.d - this.intro.reveal)
        arriving.stateT = Math.min(20, arriving.stateT + 1);
      if (--this.intro.t <= 0) this.intro = null;
      return;
    }
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
    if (this.tick % 15 === 0 && this.escortField) {
      const survivor = [...this.minions.values()].find((m) => m.kind === 'survivor' && m.state !== 'dead');
      if (survivor) this.escortField.compute(survivor.x, survivor.y);
    }
    // campo até a fogueira acompanha caixas quebradas (carrinho e sobrevivente)
    if (this.tick % 30 === 0 && this.fireField) this.fireField.compute(this.map.campfire.x, this.map.campfire.y + 48);
    this.rebuildHash();
    this.stepStorm();
    this.stepPlayers(false);
    if (this.phaseTimer > 0) this.phaseTimer--;
    else this.director.tick();
    if (this.intro) return;
    this.stepEnemies();
    stepMinions(this);
    this.stepProjectiles();
    this.stepZones();
    stepPickups(this);
    this.objectives.tick();
    this.cleanup();
    this.checkEnd();
  }

  /** Salva o estado de cada jogador ao vencer uma onda de chefe/minichefe (antes das escolhas). */
  private saveCheckpoint(): void {
    const players = new Map<number, { mods: Record<string, number>; maxHp: number; maxStamina: number; penalty: number }>();
    for (const p of this.players.values()) players.set(p.id, { mods: { ...p.mods }, maxHp: p.maxHp, maxStamina: p.maxStamina, penalty: p.hpPenalty });
    this.checkpoint = { wave: this.wave, players };
    this.emit({ k: 'msg', txt: `CHECKPOINT SALVO — onda ${this.wave}`, c: 'good' });
    this.emit({ k: 'fx', n: 'checkpoint', x: this.map.campfire.x, y: this.map.campfire.y, a: 0, o: 0, r: 0 });
  }

  /**
   * Todos caíram depois de um checkpoint: volta para a onda seguinte a ele. Melhorias tomadas desde
   * então se perdem e cada jogador perde CHECKPOINT.hpPenalty da vida base (acumula, com teto).
   */
  private restoreCheckpoint(): void {
    const cp = this.checkpoint;
    if (!cp) return;
    this.wipes++;
    this.tele.endWave(this.tick, this);
    const next = cp.wave + 1;
    const ch = chapterOfWave(next);
    if (ch.n !== this.chapter.n) this.setChapter(ch.n);
    else this.clearTransient();
    this.offers.clear();
    this.picks.clear();
    let lost = 0;
    let i = 0;
    for (const p of this.players.values()) {
      const snap = cp.players.get(p.id);
      const before = Object.values(p.mods).reduce((a, n) => a + n, 0);
      const penalty = Math.min(CHECKPOINT.maxPenalty, p.hpPenalty + CHECKPOINT.hpPenalty);
      if (snap) {
        p.mods = { ...snap.mods };
        p.maxStamina = snap.maxStamina;
        p.maxHp = Math.max(1, Math.round(snap.maxHp - p.base.hp * (penalty - snap.penalty)));
      } else p.maxHp = Math.max(1, Math.round(p.maxHp - p.base.hp * (penalty - p.hpPenalty)));
      lost = Math.max(lost, before - Object.values(p.mods).reduce((a, n) => a + n, 0));
      p.hpPenalty = penalty;
      const s = this.map.starts[i++ % this.map.starts.length] ?? this.map.campfire;
      p.move.x = s.x;
      p.move.y = s.y;
      p.move.ft = 0;
      p.move.stamina = p.maxStamina;
      p.status = 0;
      p.hp = p.maxHp;
      p.bleed = 0;
      p.reviveProgress = 0;
      p.revivingId = 0;
      p.action = null;
      p.blocking = false;
      p.buffered = null;
      p.cd = { q: 0, e: 0 };
      p.shieldHp = 0;
      p.shieldT = 0;
      p.rage = 0;
      p.essence = 0;
      p.charge = -1;
      p.jota = newJotaState();
      for (const k of Object.keys(p.buffs) as (keyof Player['buffs'])[]) p.buffs[k] = 0;
      clearAfflictions(p);
      this.emit({ k: 'respawn', pi: p.id });
      this.refreshSynergies(p);
    }
    this.onModsChange?.();
    const pct = Math.round(Math.min(CHECKPOINT.maxPenalty, this.wipes * CHECKPOINT.hpPenalty) * 100);
    this.emit({ k: 'msg', txt: `De volta ao checkpoint (onda ${next}). -${pct}% de vida máxima${lost > 0 ? `, ${lost} melhoria${lost > 1 ? 's' : ''} perdida${lost > 1 ? 's' : ''}` : ''}.`, c: 'bad' });
    this.beginWave(next);
    this.phaseTimer = sec(CHECKPOINT.restartSeconds);
    this.emit({ k: 'fx', n: 'checkpointRestore', x: this.map.campfire.x, y: this.map.campfire.y, a: 0, o: 0, r: 0 });
    for (const p of this.players.values()) playerSay(this, p, 'checkpoint', true);
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
      if (this.checkpoint) this.restoreCheckpoint();
      else this.endMatch(false);
      return;
    }
    if (!this.holdWave && this.director.complete() && !this.objectives.blocking()) {
      this.objectives.endWave();
      this.wavesCleared = Math.max(this.wavesCleared, this.wave);
      if (this.wave >= TOTAL_WAVES) this.endMatch(true);
      else {
        if (isCheckpointWave(this.wave)) this.saveCheckpoint();
        this.beginIntermission();
      }
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
    if (p.blocking) moveMul = Math.min(moveMul, TANK.guard.moveMul);
    if (p.buffs.guardBroken > 0 || p.status !== 0) moveMul = 0;
    if (p.revivingId) moveMul = Math.min(moveMul, 0.25);
    // bônus de velocidade de cartas somados, com teto global
    const cardSpeed = Math.min(
      UPGRADE_CAPS.moveSpeed,
      this.mod(p, 'g_agility') + (p.action ? 0 : this.mod(p, 'g_step')) + (p.buffs.retreat > 0 ? this.mod(p, 'g_retreat') : 0) + p.syn.moveSpeed,
    );
    let speed = b.speed * (1 + cardSpeed + thirstSpeed);
    if (isBat(p)) speed *= JOTA.bat.speedMul;
    if (p.buffs.chill > 0) speed *= CLIMATE_EFFECTS.chill.speedMul;
    if (p.buffs.exhausted > 0) speed *= BERSERKER.madness.exhaustSpeedMul;
    if (p.buffs.slowed > 0) speed *= p.slowMul;
    return {
      radius: p.r,
      speed,
      moveMul,
      canDodge: this.canAct(p) && !p.blocking,
      dodgeCost: b.dodge.cost * (1 - this.mod(p, 'g_dodge')),
      dodgeSpeed: b.dodge.speed * (isBat(p) ? JOTA.bat.dodgeMul : 1),
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
      if (pressedSlot === 'r' && p.cls === 'tank' && p.action?.name === 'r' && p.action.t >= 8) {
        detonateGuardian(this, p);
        return;
      }
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
    const kit = kitFor(p.cls);
    if ((slot === 'q' || slot === 'e') && p.cd[slot] > 0) {
      // Lapanha: E durante a recarga esmaga a casca que ainda está no chão
      if (kit.startDuringCooldown?.(this, p, slot)) {
        p.buffered = null;
        return true;
      }
      this.deny(p, 'cd');
      return false;
    }
    const r = kit.start(this, p, slot);
    if (r !== null) {
      this.deny(p, r);
      return false;
    }
    if (slot === 'r') {
      p.ult = 0;
      this.emit({ k: 'ult', pi: p.id });
      playerSay(this, p, 'ult', true);
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
    // Mãos Rápidas: velocidade do básico (carta somada, com teto)
    const sm = (opts.speedMul ?? 1) * (name.startsWith('basic') ? 1 + Math.min(UPGRADE_CAPS.attackSpeed, this.mod(p, 'g_haste') + p.syn.attackSpeed) : 1);
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
    // Berserker: com Fúria alta os golpes saem mais baratos e a stamina volta a subir mais cedo
    const furious = p.cls === 'berserker' && p.rage >= BERSERKER.fury.high;
    if (furious) cost *= BERSERKER.fury.staminaCostMulHigh;
    if (p.move.stamina < cost) return false;
    p.move.stamina -= cost;
    p.staminaDelay = sec(p.base.staminaDelay * (furious ? BERSERKER.fury.staminaDelayMulHigh : 1));
    return true;
  }

  /** Redução de recarga de cartas (somada, com teto global). */
  cardCdr(p: Player, slot: 'q' | 'e'): number {
    return Math.min(UPGRADE_CAPS.cooldown, this.mod(p, 'g_focus') + this.mod(p, slot === 'q' ? 'g_qcd' : 'g_ecd') + p.syn.cooldown);
  }

  setCooldown(p: Player, slot: 'q' | 'e', seconds: number): void {
    const focus = 1 - this.cardCdr(p, slot);
    const t = Math.max(sec(0.5), Math.round(sec(seconds) * focus));
    p.cd[slot] = t;
    p.cdMax[slot] = t;
  }

  addUlt(p: Player, amt: number): void {
    if (p.status !== 0 || p.ultLockT > 0) return;
    // Safra Abençoada: a Polpa não enche durante a própria suprema
    if (p.buffs.harvest > 0) return;
    p.ult = Math.min(PLAYER_RULES.ultMax, p.ult + amt * (1 + this.mod(p, 'g_devotion')));
  }

  /** Toda cura de jogador passa pela função central (ver healing.ts). */
  healPlayer(p: Player, amt: number, src: HealSource, use?: HealUse): number {
    return healPlayer(this, p, amt, src, use);
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
    if (p.ultLockT > 0) p.ultLockT--;
    const madnessBefore = p.buffs.madness;
    for (const k of Object.keys(p.buffs) as (keyof Player['buffs'])[]) if (p.buffs[k] > 0) p.buffs[k]--;
    if (madnessBefore === 1 && p.buffs.madness === 0 && p.cls === 'berserker') {
      const exhaustion = (p.mods['b_iron'] ?? 0) > 0 ? this.mod(p, 'b_iron') : BERSERKER.madness.exhaustion;
      p.buffs.exhausted = sec(exhaustion);
      this.emit({ k: 'fx', n: 'exhausted', x: p.x, y: p.y - 20, a: 0, o: p.id, r: 0 });
    }
    if (p.comboT > 0 && --p.comboT === 0) p.comboStep = 0;
    if (p.thirstT > 0 && --p.thirstT === 0) p.thirst = 0;
    if (p.buffs.slowed === 0) p.slowMul = 1;
    // teto de cura por segundo, Ferida Profana, escudo e telemetria
    tickPlayerHealth(this, p);
    if (this.tick % TICK_RATE === 0) p.harvestHitBudget = LAPANHA.harvest.hitHealPerSecond;
    // parado (Caçador de Névoa pressiona quem fica parado junto a objetivos)
    if (p.last.mx === 0 && p.last.my === 0) p.stillT++;
    else p.stillT = 0;

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
      const regen = p.base.staminaRegen * (1 + this.mod(p, 'g_recovery') + this.mod(p, 'g_rhythm'));
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
        playerSay(this, p, 'reviveAlly', true);
        playerSay(this, target, 'revived', true);
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
    m *= this.guardianReductionAt(p.x, p.y);
    if (p.inBastion) m *= 0.6;
    if (p.buffs.tauntDr > 0) m *= 0.7;
    m *= 1 - Math.min(UPGRADE_CAPS.damageReduction, this.mod(p, 'g_skin') + (this.objectives.playerInArea(p) ? this.mod(p, 'g_objective') : 0) + p.syn.damageReduction);
    if (p.surrounded) m *= 1.25;
    if (CLASS_RANGE[p.cls] === 'melee') m *= MELEE_RULES.damageTakenMul;
    if (p.cls === 'vampire' && p.action?.name === 'e') m *= VAMPIRE.vortex.damageTaken;
    // Última Vigília: o Guardião vira a muralha
    if (p.cls === 'tank' && p.action?.name === 'r') m *= 1 - TANK.bastion.selfReduction;
    // Modo Batman: menos frágil
    if (isBat(p)) m *= JOTA.bat.damageTaken;
    if (p.cls === 'berserker') {
      if (p.buffs.madness > 0) m *= 1 + (p.mods['b_iron'] ? BERSERKER.madness.ironDamageTaken : BERSERKER.madness.damageTaken);
      else if (p.rage >= BERSERKER.fury.high) m *= BERSERKER.fury.damageTakenMulHigh;
    }
    return m;
  }

  /** Aplica um golpe inimigo em um jogador (bloqueio, i-frames e reduções no servidor). */
  hitPlayer(p: Player, h: EnemyHit): HitResult {
    if (p.status !== 0) return 'ignored';
    if (p.iframes > 0) {
      // Retirada Tática: esquivar de um ataque de verdade acelera por um instante
      if ((p.mods['g_retreat'] ?? 0) > 0 && this.tick - p.lastDodgeTick < 12) p.buffs.retreat = sec(1.5);
      return 'evaded';
    }
    if (this.god) return 'evaded';
    const kit = kitFor(p.cls);
    if (h.blockable && kit.onIncoming) {
      const r = kit.onIncoming(this, p, h);
      if (r !== null) return r;
    }
    let dmg = h.dmg * this.damageTakenMul(p);
    dmg = absorbWithShield(this, p, dmg);
    const hpBefore = p.hp;
    if (dmg > 0) this.damagePlayerRaw(p, dmg, h.heavy);
    this.recordGuardianDamage(p.x, p.y, hpBefore - p.hp);
    if (h.stun && p.status === 0) stunPlayer(this, p, h.stun);
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
    p.tele.taken += Math.min(dmg, dmg + Math.min(0, p.hp));
    p.stats.taken = (p.stats.taken ?? 0) + Math.min(dmg, dmg + Math.min(0, p.hp));
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
      p.buffs.harvest = 0;
      if (p.cls === 'jota') jotaDown(p);
      p.shieldHp = 0;
      p.shieldT = 0;
      clearAfflictions(p);
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
    // Defesa Improvisada: escudo ao cair abaixo de 25% (recarga longa)
    if ((p.mods['g_guard'] ?? 0) > 0 && p.guardCdT <= 0 && p.hp / p.maxHp < 0.25) {
      addShield(p, this.mod(p, 'g_guard') + p.syn.guardShield, 4);
      p.guardCdT = sec(40);
      this.emit({ k: 'fx', n: 'shieldUp', x: p.x, y: p.y - 12, a: 0, o: p.id, r: 0 });
    }
    if (p.hp / p.maxHp < 0.3) playerSay(this, p, 'lowHp');
    if (heavy && p.buffs.madness <= 0 && !(p.action && (p.action.name === 'r' || p.action.name === 'stun'))) {
      p.action = null;
      this.startAction(p, 'hurt', { windup: 0, active: 0, recovery: PLAYER_RULES.heavyHitStagger }, { moveMul: 0.2 });
      if (p.action) (p.action as Action).cancelFrom = 999;
    }
  }

  // ------------------------------------------------------------------ dano a inimigos

  damageMul(p: Player, e: Enemy, kind?: HitOpts['kind']): number {
    // bônus de cartas SOMADOS com teto global (nunca multiplicam entre si)
    let card = this.mod(p, 'g_fury') + p.syn.damage;
    if (e.hp >= e.maxHp) card += this.mod(p, 'g_first');
    if (e.type === 'acolyte' || e.type === 'shadowAcolyte' || e.type === 'highAcolyte' || e.type === 'ritualist') card += this.mod(p, 'g_support');
    let m = 1 + Math.min(UPGRADE_CAPS.damage, card);
    if (p.cls === 'vampire') {
      m += p.thirst * VAMPIRE.thirst.damagePerStack;
      if (p.buffs.feast > 0) m += VAMPIRE.feast.damageBonus;
    }
    // A marca recompensa a pontaria do Caçador, sem multiplicar armadilhas e áreas.
    if (p.cls === 'hunter' && kind === 'proj' && e.markBy === p.id && e.markT > 0) m += e.marks * (HUNTER.mark.bonusPerStack + this.mod(p, 'h_mark'));
    if (p.cls === 'jota') m += jotaDamageBonus(this, p, e);
    if (p.cls === 'berserker') {
      m += BERSERKER.fury.maxDamageBonus * (p.rage / BERSERKER.fury.max);
      if (p.buffs.madness > 0) m += BERSERKER.madness.damageBonus;
      if (p.rage >= BERSERKER.fury.high) m += this.mod(p, 'b_rage');
    }
    return m;
  }

  /**
   * Aplica dano a um inimigo. Retorna o DANO VÁLIDO (sem o excesso além da vida restante; 0 para
   * objetivos, estacionários e inimigos que não podem ser feridos): é a base de toda cura por acerto.
   */
  hitEnemy(p: Player | null, e: Enemy, base: number, o: HitOpts): number {
    this.lastValid = 0;
    if (e.state === 'dead' || e.state === 'spawn') return 0;
    if (e.state === 'roar' && e.def.tier === 'boss') base *= 0.35;
    base *= bossObjectiveDamageMul(this, e);
    // Casca Traiçoeira: vulnerável logo após escorregar
    if (e.vulnT > 0) base *= LAPANHA.peel.vulnerableMul;
    // Visão Sombria do Maycon: marcados recebem mais dano de toda a equipe
    if (e.dsT > 0) base *= e.dsMul;
    // Portador do Ossário: o escudo frontal absorve (projéteis são tratados em stepProjectiles)
    let poiseMul = 1;
    if (e.shieldHp > 0 && o.kind !== 'proj' && this.shieldFaces(e, o.fromX, o.fromY)) {
      const S = ATK.ossuaryBearer.shield;
      const heavy = o.poise >= S.heavyPoise;
      const sMul = heavy ? S.heavyShieldMul : o.kind === 'aoe' ? S.aoeShieldMul : S.meleeShieldMul;
      this.damageShield(e, base * sMul * (p ? 1 + this.mod(p, 'g_breaker') : 1), p);
      base *= o.kind === 'aoe' ? S.aoeBodyMul : S.meleeBodyMul;
      poiseMul = heavy ? 1 : S.projPoiseMul * 2;
    }
    // Caçador de Névoa exposto na recuperação do salto
    if (e.type === 'mistStalker' && e.atk === 'mistLeap' && e.state === 'recover') poiseMul *= ATK.mistStalker.leap.recoverPoiseMul;
    // Combo Caçador exposto: um acerto em área nele velado suprime o velamento por um instante
    // (ver mistStalkerMove) e dá um pequeno bônus de dano aos golpes seguintes nessa janela
    // (bossObjectiveDamageMul) — não ao golpe que expõe.
    if (e.type === 'mistStalker' && e.veiled && o.kind === 'aoe' && e.exposedT <= 0) {
      e.exposedT = sec(COMBOS.exposeVeiled.seconds);
      this.emit({ k: 'fx', n: 'comboExpose', x: e.x, y: e.y - e.r - 4, a: 0, o: e.id, r: 0 });
    }
    const mul = p && !o.raw ? this.damageMul(p, e, o.kind) : 1;
    const dmg = Math.max(1, Math.round(base * mul));
    const hpBefore = e.hp;
    e.hp -= dmg;
    e.lastHitTick = this.tick;
    const valid = e.def.objective || e.def.stationary ? 0 : Math.max(0, Math.min(dmg, hpBefore));
    this.lastValid = valid;
    // canalizações contra objetivos são interrompidas por qualquer golpe de jogador
    if (p && e.atk === 'siege' && e.state === 'windup') this.objectives.breakSiege(e);
    this.emit({ k: 'dmg', tg: 'e', ti: e.id, v: dmg, x: e.x, y: e.y - e.r - 6, c: mul >= 1.3 ? 'crit' : 'n', s: p?.id ?? 0 });
    if (p && valid > 0) onDamage(this, p, e, valid, !!o.fromMinion);
    if (p) {
      p.stats.damage += dmg;
      if (!o.noUlt && (!e.def.objective || e.type === 'funeralCart' || e.type === 'ritualist')) this.addUlt(p, dmg * p.base.ultPerDamage * (o.fromMinion ? NECRO.minionUltMul : 1));
      if (!o.fromMinion) {
        kitFor(p.cls).onDealt?.(this, p, e, dmg, o);
        if (p.cls === 'berserker') this.addRage(p, dmg * BERSERKER.fury.perDamageDealt);
      }
    }
    // poise / stagger (Blindado recebe só parte). Cartas: Golpe Estável e Pressão Constante.
    let poise = o.poise;
    if (p && !o.fromMinion) {
      poise *= 1 + this.mod(p, 'g_poise');
      if ((p.mods['g_pressure'] ?? 0) > 0 && o.kind !== 'aoe') {
        if (p.pressureId === e.id) p.pressureN++;
        else {
          p.pressureId = e.id;
          p.pressureN = 1;
        }
        if (p.pressureN >= 3) {
          poise += this.mod(p, 'g_pressure');
          p.pressureN = 0;
        }
      }
    }
    // Combo Casca Traiçoeira: golpe pesado enquanto o alvo ainda está tonto do escorregão
    // (vulnT) atordoa na hora, sem precisar estourar a barra de postura — um único
    // aproveitamento por escorregão (consome vulnT já aqui).
    if (e.vulnT > 0 && poise >= COMBOS.slipFollowUp.poiseThreshold && e.staggerImmune <= 0 && !e.def.stationary) {
      e.vulnT = 0;
      this.stagger(e, COMBOS.slipFollowUp.stunSeconds);
      this.emit({ k: 'fx', n: 'comboFollowUp', x: e.x, y: e.y - e.r - 4, a: 0, o: e.id, r: 0 });
      this.emit({ k: 'sfx', n: 'comboFollowUp', x: e.x, y: e.y });
    } else if (poise > 0 && e.staggerImmune <= 0 && !e.def.stationary) {
      e.poise += poise * poiseMul * (e.affix === 'armored' ? AFFIX_RULES.armoredPoiseMul : 1);
      if (e.poise >= e.def.poise) this.stagger(e, e.def.staggerTime);
    }
    if (o.kb > 0 && !e.def.stationary) this.knockback(e, o.fromX, o.fromY, o.kb);
    if (e.hp <= 0) this.killEnemy(e, p);
    return valid;
  }

  /** O escudo do Portador cobre a direção de onde vem o golpe? (servidor decide frente/lado/costas) */
  shieldFaces(e: Enemy, fromX: number, fromY: number): boolean {
    if (e.shieldHp <= 0) return false;
    const a = Math.atan2(fromY - e.y, fromX - e.x);
    return Math.abs(angleDiff(a, e.shieldDir)) <= (ATK.ossuaryBearer.shield.arc * Math.PI) / 360;
  }

  damageShield(e: Enemy, dmg: number, by: Player | null): void {
    if (e.shieldHp <= 0) return;
    e.shieldHp = Math.max(0, e.shieldHp - dmg);
    if (by) by.stats.damage += Math.round(dmg);
    if (e.shieldHp <= 0) {
      this.emit({ k: 'fx', n: 'shieldBreak', x: e.x + Math.cos(e.shieldDir) * 10, y: e.y + Math.sin(e.shieldDir) * 6, a: e.shieldDir, o: e.id, r: ATK.ossuaryBearer.debrisSeconds });
      this.emit({ k: 'sfx', n: 'shieldBreak', x: e.x, y: e.y });
      if (by) this.addUlt(by, 4);
      // Combo Escudo quebrado: um pulso sem dano atordoa comuns próximos por um instante —
      // recompensa focar o escudo em equipe. Nunca afeta elites/minichefes/chefes.
      if (by) {
        const B = COMBOS.shieldBreakPulse;
        for (const o of this.enemiesInCircle(e.x, e.y, B.radius)) {
          if (o === e || o.def.tier !== 'common') continue;
          this.stagger(o, B.stunSeconds);
        }
        this.emit({ k: 'fx', n: 'comboChain', x: e.x, y: e.y, a: 0, o: e.id, r: B.radius });
      }
    }
  }

  stagger(e: Enemy, seconds: number): void {
    if (e.state === 'dead' || e.state === 'spawn' || e.def.stationary) return;
    e.poise = 0;
    if (e.atk === 'march' && e.state === 'windup') this.emit({ k: 'fx', n: 'marchBreak', x: e.x, y: e.y, a: 0, o: e.id, r: ATK.shadowAcolyte.march.radius });
    if (e.atk === 'wound' && e.state === 'windup') {
      const t = this.players.get(e.aimPid);
      if (t) t.tele.woundsInterrupted++;
      this.emit({ k: 'fx', n: 'woundBreak', x: e.x, y: e.y - 10, a: 0, o: e.id, r: 0 });
    }
    if (e.atk === 'siege' && e.state === 'windup') this.objectives.breakSiege(e);
    // Combo Marca de Ossos: atordoar/quebrar a postura de um alvo marcado dá um pouco de
    // Essência na hora para quem marcou, além da recompensa normal ao matá-lo (cooldown por
    // inimigo evita farm repetido no mesmo alvo).
    if (e.boneBy > 0 && e.boneT > 0 && e.markStaggerCd <= 0) {
      const nec = this.players.get(e.boneBy);
      if (nec && nec.cls === 'necromancer' && nec.status === 0) {
        this.addEssence(nec, COMBOS.markStagger.essence);
        e.markStaggerCd = sec(COMBOS.markStagger.cooldown);
        this.emit({ k: 'fx', n: 'comboMark', x: e.x, y: e.y - e.r - 6, a: 0, o: e.id, r: 0 });
      }
    }
    e.aimPid = 0;
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
    const vulnerable: EnemyAttackName[] = ['orb', 'rune', 'pounce', 'slipper', 'lunge', 'march', 'mistLeap', 'wound', 'siege'];
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

  /**
   * Controle com resistência (chefes/elites) e retornos decrescentes. Retorna duração aplicada (s).
   * `tag` identifica a fonte da lentidão (por padrão a classe de quem aplicou, ou 'field' para
   * zonas/cartas sem dono direto) — usado só pelo Combo Gélido, abaixo.
   */
  applyCC(e: Enemy, kind: 'root' | 'slow' | 'stun', seconds: number, slowMul = 0.5, source: Player | null = null, tag?: string): number {
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
      // Combo Gélido: uma segunda lentidão de fonte diferente sobre um alvo já lento vira um
      // atordoamento breve. Passa pela mesma resistência/DR do atordoamento comum (chamada
      // recursiva abaixo), então chefes/elites já resistem tanto quanto resistiriam a um
      // atordoamento normal; `freezeCd` impede reativar repetidamente no mesmo alvo.
      const srcTag = tag ?? (source ? `c:${source.cls}` : 'field');
      if (cc.slow > 0 && cc.freezeCd <= 0 && cc.slowSrc && cc.slowSrc !== srcTag) {
        cc.freezeCd = sec(COMBOS.freeze.cooldown);
        if (this.applyCC(e, 'stun', COMBOS.freeze.seconds, 1, source) > 0) {
          this.emit({ k: 'fx', n: 'comboFreeze', x: e.x, y: e.y - e.r - 4, a: 0, o: e.id, r: 0 });
          this.emit({ k: 'sfx', n: 'comboFreeze', x: e.x, y: e.y });
        }
      }
      cc.slow = Math.max(cc.slow, t);
      cc.slowMul = Math.min(cc.slowMul === 0 ? 1 : cc.slowMul, slowMul);
      cc.slowSrc = srcTag;
    }
    if (kind !== 'slow') {
      cc.drCount++;
      cc.drUntil = this.tick + sec(CC_DR.window);
    }
    if (source) this.addUlt(source, PLAYER_RULES.ultPerCc);
    // Visão Sombria: tudo que o Maycon controla fica marcado
    if (source?.cls === 'maycon') {
      const sharp = (source.mods['y_sight'] ?? 0) > 0;
      e.dsT = Math.max(e.dsT, sec(MAYCON.darkSight.seconds + (sharp ? 1 : 0)));
      e.dsMul = Math.max(e.dsT > 0 ? e.dsMul : 1, MAYCON.darkSight.damageMul + this.mod(source, 'y_sight'));
    }
    return dur;
  }

  killEnemy(e: Enemy, by: Player | null): void {
    if (e.state === 'dead') return;
    if (e.atk === 'wound' && e.state === 'windup') {
      const t = this.players.get(e.aimPid);
      if (t) t.tele.woundsInterrupted++;
    }
    e.state = 'dead';
    e.hp = 0;
    const objective = !!e.def.objective;
    if (!objective) this.lastKillTick = this.tick;
    if (by && !objective) {
      by.stats.kills++;
      if (e.def.tier === 'elite' && (by.mods['g_second'] ?? 0) > 0) by.move.stamina = Math.min(by.maxStamina, by.move.stamina + this.mod(by, 'g_second'));
      // Sede de Sangue do Berserker: abates devolvem vida (dentro do teto por segundo)
      if (by.cls === 'berserker') this.healPlayer(by, e.def.tier === 'common' ? BERSERKER.bloodlust.healPerKill : BERSERKER.bloodlust.healPerEliteKill, 'bloodlust');
    }
    if (!objective && (e.def.miniboss || e.def.tier === 'boss')) {
      if (e.def.tier === 'boss') this.bossKills++;
      else this.minibossKills++;
      for (const p of this.players.values()) playerSay(this, p, e.def.tier === 'boss' ? 'bossDown' : 'minibossDown', true);
    }
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
    this.arcValid.clear();
    for (const e of hits) this.arcValid.set(e.id, this.hitEnemy(p, e, spec.damage * dmgMul, { poise: spec.poise, kb: spec.knockback, fromX: p.x, fromY: p.y, kind: 'melee' }));
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
        damageBreakable(this, bi, spec.damage * dmgMul * (1 + this.mod(p, 'g_breaker')), p);
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
        damageBreakable(this, bi, dmg * (by ? 1 + this.mod(by, 'g_breaker') : 1), by);
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
      pierceFalloff: 1,
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
      lob: 0,
      a: 0,
      b: 0,
      ...o,
    };
    if (pr.team === 'p') {
      const shooter = this.players.get(pr.owner);
      if (shooter) shooter.lastShotTick = this.tick;
    }
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
    const ricochetRange = HUNTER.upgrades.ricochetRange;
    let bd = ricochetRange * ricochetRange;
    for (const e of this.enemiesInCircle(from.x, from.y, ricochetRange)) {
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
      kind: pr.kind === 'prompt' || pr.kind === 'batarang' ? pr.kind : 'bolt', team: 'p', owner: pr.owner, x: from.x + Math.cos(a) * (from.r + 4), y: from.y + Math.sin(a) * (from.r + 4),
      vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, r: pr.r, dmg: pr.dmg * HUNTER.upgrades.ricochetDamage, range: 130, pierce: 0, poise: pr.poise, kb: pr.kb, ricochet: 0,
    });
    for (const id of pr.hit) np.hit.add(id);
    this.emit({ k: 'fx', n: 'ricochet', x: from.x, y: from.y - 6, a, o: 0, r: 0 });
  }

  /**
   * Altura (px) em que uma fruta em arco é DESENHADA acima do próprio ponto de colisão.
   * Mesma fórmula do cliente (ver scene.ts): SHOT_HEIGHT + parábola pela fração do voo.
   */
  private lobLift(pr: Projectile): number {
    const peak = pr.kind === 'bigMelon' || pr.kind === 'chokeBomb' ? LAPANHA.ripe.arcHeight : LAPANHA.melon.arcHeight;
    const k = clamp(1 - pr.range / pr.lob, 0, 1);
    return SHOT_HEIGHT + 4 * peak * k * (1 - k);
  }

  /**
   * A fruta encosta no inimigo na TELA? As melancias vivem no plano do chão mas são desenhadas
   * `lobLift` px acima, então o ponto de colisão fica atrás dos pés enquanto o sprite já cobre o
   * corpo do inimigo. Sem esta leitura, a melancia atravessa visualmente o inimigo sem contar
   * acerto (o jogador vê o acerto e o servidor não). A janela vertical é generosa de propósito:
   * corrige o acerto perdido sem tirar nenhum acerto que já valia.
   */
  private lobTouches(pr: Projectile, lift: number, e: Enemy): boolean {
    if (Math.abs(pr.x - e.x) > e.r + pr.r) return false;
    const drawnY = pr.y - lift;
    const bodyTop = e.y - (e.r * 2.2 + 14);
    return drawnY >= bodyTop - pr.r && drawnY <= e.y + pr.r;
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
        // a Melancia Madura sobe num arco alto: passa por cima de paredes (e de caixas, abaixo)
        const overWall = pr.kind === 'bigMelon' || pr.kind === 'chokeBomb';
        if (pr.kind !== 'slipper' && (pr.range <= 0 || (!overWall && blocksShot(this.map, tx, ty)))) {
          this.projectileEnd(pr, true);
          break;
        }
        if (pr.x < 0 || pr.y < 0 || pr.x > WORLD_W || pr.y > WORLD_H) {
          pr.dead = true;
          break;
        }
        if (pr.team === 'p') {
          const owner = this.players.get(pr.owner) ?? null;
          const kit = owner ? kitFor(owner.cls) : null;
          // caixas e barris param projéteis de jogadores (a Melancia Madura passa por cima em arco)
          const bi = overWall ? -1 : breakableAt(this.map, tx, ty);
          if (bi >= 0) {
            if (!LOB_KINDS.has(pr.kind)) damageBreakable(this, bi, pr.dmg, owner);
            this.projectileEnd(pr, true);
            break;
          }
          // frutas em arco: o acerto vale onde a fruta APARECE (ver lobTouches); a consulta larga
          // é só broad-phase, o teste fino é o do sprite
          const lob = LOB_KINDS.has(pr.kind) && pr.lob > 0;
          const lift = lob ? this.lobLift(pr) : 0;
          this.hash.query(pr.x, pr.y, pr.r + lift, (e) => {
            if (pr.dead || pr.hit.has(e.id) || e.state === 'dead' || e.state === 'spawn') return;
            if (pr.kind === 'bigMelon') return;
            if (lob && !this.lobTouches(pr, lift, e)) return;
            pr.hit.add(e.id);
            if (kit?.projectileHit?.(this, pr, e)) return;
            // escudo frontal do Portador: o projétil para (não atravessa nem ricocheteia)
            const fromX = pr.x - pr.vx * 0.05;
            const fromY = pr.y - pr.vy * 0.05;
            if (e.shieldHp > 0 && this.shieldFaces(e, fromX, fromY)) {
              const S = ATK.ossuaryBearer.shield;
              this.damageShield(e, pr.dmg * S.projShieldMul, owner);
              this.hitEnemy(owner, e, pr.dmg * S.projBodyMul, { poise: pr.poise * S.projPoiseMul, kb: 0, fromX: e.x + Math.cos(e.shieldDir + Math.PI) * 20, fromY: e.y + Math.sin(e.shieldDir + Math.PI) * 20, kind: 'proj', noProc: true });
              this.emit({ k: 'fx', n: 'shieldBlock', x: e.x + Math.cos(e.shieldDir) * 10, y: e.y + Math.sin(e.shieldDir) * 6, a: e.shieldDir, o: e.id, r: 0 });
              this.emit({ k: 'sfx', n: 'shieldBlock', x: e.x, y: e.y });
              pr.dead = true;
              return;
            }
            this.hitEnemy(owner, e, pr.dmg, { poise: pr.poise, kb: pr.kb, fromX: pr.x - pr.vx * 0.05, fromY: pr.y - pr.vy * 0.05, kind: 'proj' });
            if (pr.ricochet > 0) {
              pr.ricochet--;
              this.ricochetFrom(pr, e);
            }
            if (pr.pierce > 0) {
              pr.pierce--;
              pr.dmg *= pr.pierceFalloff;
            }
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
            if (pr.kind === 'woundBolt') {
              if (res === 'hit') applyWound(this, p, this.enemies.get(-pr.owner) ?? null);
              else if (res !== 'ignored' && pr.b === 0) p.tele.woundsAvoided++;
              pr.b = 1;
            }
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
              hitMinion(this, m, pr.dmg, pr.owner < 0 ? this.enemies.get(-pr.owner) : undefined);
              if (pr.kind !== 'slipper') pr.dead = true;
            }
          }
        }
      }
    }
  }

  private projectileEnd(pr: Projectile, wall: boolean): void {
    pr.dead = true;
    if (pr.team === 'p') {
      const owner = this.players.get(pr.owner);
      if (owner && kitFor(owner.cls).projectileEnd?.(this, pr)) return;
    } else if (pr.kind === 'woundBolt' && pr.b === 0) {
      // a Ferida errou (parede/alcance): conta como evitada para o alvo
      const t = this.players.get(pr.a);
      if (t) t.tele.woundsAvoided++;
      pr.b = 1;
    }
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
              if (z.b > 0 && z.age % TICK_RATE === 0) this.healPlayer(p, z.b, 'bastion');
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
    for (const m of this.minions.values()) if (m.state !== 'dead' && dist2(m.x, m.y, z.x, z.y) <= (z.r + m.r) ** 2) {
      const attacker = z.owner < 0 ? this.enemies.get(-z.owner) : undefined;
      hitMinion(this, m, z.b, attacker);
    }
    const fx = z.kind === 'rune' ? 'runeBlast' : z.kind === 'moonPulse' ? 'moonBlast' : z.kind === 'nova' || z.kind === 'iceSpike' ? 'frostBlast' : 'eruptionBlast';
    this.emit({ k: 'fx', n: fx, x: z.x, y: z.y, a: 0, o: 0, r: z.r });
  }

  private cleanup(): void {
    if (this.projectiles.some((p) => p.dead)) this.projectiles = this.projectiles.filter((p) => !p.dead);
    if (this.zones.some((z) => z.dead)) this.zones = this.zones.filter((z) => !z.dead);
    for (const [id, e] of this.enemies) if (e.state === 'dead') this.enemies.delete(id);
  }

  // ------------------------------------------------------------------ inimigos

  /** Inicia a apresentação só para spawns oficiais do diretor (não spawns de debug/teste). */
  startBossIntro(e: Enemy): void {
    if (this.phase !== 'wave' || this.intro || (!e.def.miniboss && e.def.tier !== 'boss')) return;
    const reveal = sec(1.2);
    const d = reveal + sec(e.def.miniboss ? 2.7 : 3.5);
    this.intro = { id: e.id, et: e.typeIdx, x: Math.round(e.x), y: Math.round(e.y), t: d, d, reveal };
    for (const p of this.players.values()) p.queue.length = 0;
  }

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
      cc: { root: 0, slow: 0, slowMul: 0, stun: 0, pullX: 0, pullY: 0, pullStr: 0, pullT: 0, drCount: 0, drUntil: 0, slowSrc: '', freezeCd: 0 },
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
      hasteMul: 0,
      hasteT: 0,
      shieldHp: type === 'ossuaryBearer' ? ATK.ossuaryBearer.shield.hp * hpMul : 0,
      shieldMax: type === 'ossuaryBearer' ? ATK.ossuaryBearer.shield.hp * hpMul : 0,
      shieldDir: Math.PI / 2,
      veiled: false,
      aiT: (x + y) % 15,
      repositionT: 0,
      coverX: x,
      coverY: y,
      lockedId: 0,
      farT: 0,
      lockedSince: 0,
      threat: new Map(),
      role: 'none',
      zoneT: 0,
      slideT: 0,
      slideVx: 0,
      slideVy: 0,
      vulnT: 0,
      dsT: 0,
      dsMul: 1,
      aimPid: 0,
      lastCastTick: -9999,
      markStaggerCd: 0,
      aiMode: 'approach',
      aiModeT: 0,
      aiSide: 1,
      aiLastX: x,
      aiLastY: y,
      aiUnstickT: 0,
      retreated: false,
      retreatT: 0,
      thinkT: 0,
      recent: [],
      heatT: 0,
      desperate: false,
    };
    e.aiSide = e.id % 2 === 0 ? 1 : -1;
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
    this.tele.onSpawn(type);
    if (!def.objective) this.objectives.assignRole(e);
    seedThreat(this, e);
    if (boss) {
      this.bossId = e.id;
      spawnBossObjectives(this, e);
    } else if (def.miniboss) this.bossId = e.id;
    return e;
  }

  /** Alvo atual do inimigo: provocação > servo próximo (aggro) > jogador mais próximo pelo caminho. */
  targetOf(e: Enemy): Target | null {
    if (e.def.tier === 'boss' || e.def.miniboss) return this.bossTarget(e);
    if (e.tauntT > 0) {
      const t = choosePlayer(this, e);
      if (t && t.id === e.tauntBy) return t;
    }
    // funções táticas em missões (ocupar fogueira/altar, caçar o sobrevivente)
    if (e.role !== 'none') {
      const t = this.objectives.roleTarget(e);
      if (t) return t;
    }
    if (e.minionTarget) {
      const m = this.minions.get(e.minionTarget);
      if (m && m.state !== 'dead' && e.targetT > 0) return m;
      e.minionTarget = 0;
    }
    // alvo por ameaça + utilidade de papel, com histerese (ai/threat.ts)
    const fresh = e.targetT <= 0;
    const best = choosePlayer(this, e);
    if (fresh) {
      const m = minionAggro(this, e, best ? dist(e.x, e.y, best.x, best.y) : Infinity);
      if (m) {
        e.minionTarget = m.id;
        return m;
      }
    }
    return best;
  }

  /** Direção de perseguição usando campo de fluxo; linha reta quando há visão e está perto. */
  chaseDir(e: Enemy, t: Target): [number, number] {
    const dx = t.x - e.x;
    const dy = t.y - e.y;
    const d = Math.hypot(dx, dy) || 1;
    if ((d < 110 || t.isMinion || t.isPoint) && lineOfSight(this.map, e.x, e.y, t.x, t.y) && circleFree(this.map, e.x + (dx / d) * 10, e.y + (dy / d) * 10, e.r)) {
      return [dx / d, dy / d];
    }
    const f = t.isPoint
      ? this.objectives.pointField
      : t.isMinion
        ? (t as Minion).kind === 'survivor' ? this.escortField : this.fields.get((t as Minion).owner)
        : this.fields.get(t.id);
    const dir = f?.direction(e.x, e.y);
    if (dir && (dir[0] !== 0 || dir[1] !== 0)) return dir;
    return [dx / d, dy / d];
  }

  /**
   * Chefes e minichefes: mesma tabela de ameaça + utilidade dos demais (ai/threat.ts), com pesos
   * de chefe (ameaça manda; quem fustiga de longe não é ignorado), permanência mínima de
   * `TARGETING.minHold.boss` s, troca antecipada por salto grande de ameaça e trava de provocação
   * de `BOSS_AI.tauntLock` s. Servos não desviam a atenção de chefes. Conta o tempo longe do
   * alvo (`farT`) para a perseguição acelerada.
   */
  private bossTarget(e: Enemy): Player | null {
    const cur = choosePlayer(this, e);
    if (cur) {
      if (dist(e.x, e.y, cur.x, cur.y) > BOSS_AI.pursuitDistance) e.farT++;
      else e.farT = 0;
    }
    return cur;
  }

  private enemySpeedMul(e: Enemy): number {
    let m = 1;
    if (!e.def.objective) {
      m *= this.chapter.enemies.speedMul;
      if (this.storm.active && this.chapter.storm) m *= this.chapter.storm.enemySpeedMul;
    }
    if (e.affix === 'furious' && e.hp <= e.maxHp * AFFIX_RULES.furiousThreshold) m *= AFFIX_RULES.furiousSpeedMul;
    if (e.hasteT > 0) m *= 1 + e.hasteMul;
    // chefes/minichefes aceleram quando o alvo travado foge (kite prolongado)
    if (e.farT > sec(BOSS_AI.pursuitDelay)) m *= BOSS_AI.pursuitSpeedMul;
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
      if (cc.slow > 0 && --cc.slow === 0) {
        cc.slowMul = 0;
        cc.slowSrc = '';
      }
      if (cc.freezeCd > 0) cc.freezeCd--;
      if (cc.pullT > 0) cc.pullT--;
      if (e.staggerImmune > 0) e.staggerImmune--;
      if (e.tauntT > 0) e.tauntT--;
      if (e.markT > 0 && --e.markT === 0) e.marks = 0;
      if (e.boneT > 0 && --e.boneT === 0) e.boneBy = 0;
      if (e.markStaggerCd > 0) e.markStaggerCd--;
      if (e.cursedT > 0) e.cursedT--;
      if (e.targetT > 0) e.targetT--;
      if (e.shoutCd > 0) e.shoutCd--;
      if (e.hasteT > 0 && --e.hasteT === 0) e.hasteMul = 0;
      if (e.vulnT > 0) e.vulnT--;
      if (e.dsT > 0) e.dsT--;
      // exposedT do Devorador (luas) é decrementado em tickBossObjectives; para outros tipos
      // (combo Caçador de Névoa velado exposto por área) o decaimento é genérico aqui.
      if (e.exposedT > 0 && e.type !== 'moonDevourer') e.exposedT--;
      if (this.tick % 15 === 0 && e.poise > 0) e.poise = Math.max(0, e.poise - e.def.poise * 0.15);
      if (e.def.tier === 'boss') tickBossObjectives(this, e);
      decayThreat(e);
      if (e.heatT > 0) e.heatT--;
      if (e.def.tier === 'boss' || e.def.miniboss) {
        // reta final ("desespero"): ritmo maior e reavaliação imediata do alvo; telegraphs intactos
        if (!e.desperate && e.hp <= e.maxHp * FAIR.desperationHp) {
          e.desperate = true;
          e.targetT = 0;
          e.lockedSince = 0;
        }
        if (e.desperate && this.tick % FAIR.desperationCdEvery === 0) {
          for (const k in e.cds) {
            const key = k as EnemyAttackName;
            if ((e.cds[key] ?? 0) > 0) e.cds[key] = (e.cds[key] ?? 0) - 1;
          }
        }
      }

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
      } else if (e.slideT > 0) {
        // escorregando na casca: sem controle da direção
      } else {
        const v = e.atk === 'siege' && e.state !== 'move' ? this.objectives.tickSiege(e) : brainFor(e.type).tick(this, e);
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
      if (e.slideT > 0) {
        e.slideT--;
        mx = e.slideVx * DT;
        my = e.slideVy * DT;
        slideBump(this, e);
        if (e.slideT === 0) {
          e.vulnT = sec(LAPANHA.peel.vulnerableSeconds);
          this.emit({ k: 'fx', n: 'slipEnd', x: e.x, y: e.y, a: 0, o: e.id, r: 0 });
        }
      }
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
    if (e.def.tier === 'boss' || e.def.miniboss) rememberAttack(e, atk);
  }

  setEnemyState(e: Enemy, s: EnemyStateName): void {
    // respiro de chefe/minichefe entre ataques: janela para reagir e punir
    if (s === 'move' && e.state !== 'move' && e.state !== 'stagger' && (e.def.tier === 'boss' || e.def.miniboss)) e.thinkT = thinkTicks(this, e);
    e.state = s;
    e.stateT = 0;
  }

  enemyMelee(e: Enemy, range: number, arc: number, dmg: number, heavy: boolean, stun = 0): void {
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
      const r = this.hitPlayer(p, { dmg: dmg * this.edm(e), heavy, fromX: e.x, fromY: e.y, enemy: e, proj: null, blockable: true, stun });
      if (r === 'hit') this.emit({ k: 'sfx', n: heavy ? 'heavyHit' : 'playerHit', x: p.x, y: p.y });
    }
    for (const m of this.minions.values()) {
      if (m.state === 'dead' || m.state === 'rise' || e.hitBy.has(-m.id)) continue;
      if (!inArc(m.x, m.y, m.r)) continue;
      e.hitBy.add(-m.id);
      hitMinion(this, m, dmg * this.edm(e), e);
    }
  }

  enemyCircle(e: Enemy, x: number, y: number, r: number, dmg: number, heavy: boolean, blockable = false, stun = 0): void {
    for (const p of this.players.values()) {
      if (p.status !== 0 || e.hitBy.has(p.id)) continue;
      if (dist2(x, y, p.x, p.y) > (r + p.r) ** 2) continue;
      e.hitBy.add(p.id);
      this.hitPlayer(p, { dmg: dmg * this.edm(e), heavy, fromX: x, fromY: y, enemy: e, proj: null, blockable, stun });
    }
    for (const m of this.minions.values()) {
      if (m.state === 'dead' || m.state === 'rise' || e.hitBy.has(-m.id)) continue;
      if (dist2(x, y, m.x, m.y) > (r + m.r) ** 2) continue;
      e.hitBy.add(-m.id);
      hitMinion(this, m, dmg * this.edm(e), e);
    }
  }

  /** Inimigos marcados pela Visão Sombria agora (HUD do Maycon). */
  private darkSightCount(_p: Player): number {
    let n = 0;
    for (const e of this.enemies.values()) if (e.dsT > 0 && e.state !== 'dead') n++;
    return Math.min(99, n);
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
      if (p.action?.name === 'stun') f |= PLAYER_FLAGS.stunned;
      if (p.buffs.stunRes > 0) f |= PLAYER_FLAGS.stunResist;
      if (p.buffs.slowed > 0) f |= PLAYER_FLAGS.slowed;
      if (p.woundT > 0) f |= PLAYER_FLAGS.wounded;
      if (p.woundBlockT > 0) f |= PLAYER_FLAGS.woundBlock;
      if (p.buffs.harvest > 0) f |= PLAYER_FLAGS.harvest;
      if (p.shieldHp > 0) f |= PLAYER_FLAGS.shielded;
      if (p.cls === 'maycon' && this.zones.some((z) => z.kind === 'brew' && z.owner === p.id && !z.dead)) f |= PLAYER_FLAGS.brewing;
      if (p.cls === 'tank' && p.action?.name === 'r') f |= PLAYER_FLAGS.bulwark;
      if (p.cls === 'jota') {
        if (p.jota.batT > 0) f |= PLAYER_FLAGS.batman;
        if (p.jota.hotT > 0) f |= PLAYER_FLAGS.compact;
      }
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
        ul: Math.ceil(p.ultLockT / TICK_RATE),
        k:
          p.cls === 'vampire' ? p.thirst
          : p.cls === 'dog' ? p.resonance
          : p.cls === 'mage' ? p.convergence
          : p.cls === 'berserker' ? Math.round(p.rage)
          : p.cls === 'necromancer' ? p.essence
          : p.cls === 'tank' ? Math.round(Math.min(100, p.guardianCharge * TANK.bastion.damageRatio / TANK.bastion.bonusCap * 100))
          : p.cls === 'lapanha' ? Math.ceil(p.buffs.harvest / 3)
          : p.cls === 'maycon' ? this.darkSightCount(p)
          : p.cls === 'jota' ? Math.round(p.jota.ctx)
          : p.comboStep,
        cn: p.connected ? 1 : 0,
        dg: p.lastDodgeTick,
        wd: Math.ceil(p.woundT / 3),
        wb: Math.ceil(p.woundBlockT / 3),
        wo: p.woundT > 0 ? p.woundBy : 0,
        sh: Math.ceil(p.shieldHp),
        ch: a && a.name === 'charge' ? Math.round(chargeFrac(a) * 100) : p.cls === 'jota' && p.jota.batT > 0 ? Math.max(1, Math.round((p.jota.batT / p.jota.batMax) * 100)) : -1,
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
    const wounding = new Set<number>();
    for (const p of this.players.values()) if (p.woundT > 0 && p.woundBy) wounding.add(p.woundBy);
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
      if (e.hasteT > 0) f |= ENEMY_FLAGS.hasted;
      if (e.veiled) f |= ENEMY_FLAGS.veiled;
      if (e.role === 'siege') f |= ENEMY_FLAGS.siege;
      if (e.role === 'raider' && this.objectives.event?.kind === 'escort') {
        const m = this.minions.get(this.objectives.event.entity);
        if (m && dist2(e.x, e.y, m.x, m.y) < 140 * 140) f |= ENEMY_FLAGS.raider;
      }
      if (wounding.has(e.id)) f |= ENEMY_FLAGS.wounding;
      if (e.vulnT > 0) f |= ENEMY_FLAGS.vulnerable;
      if (e.dsT > 0) f |= ENEMY_FLAGS.darkSight;
      if (e.slideT > 0) f |= ENEMY_FLAGS.sliding;
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
        e.shieldMax > 0 ? Math.ceil((e.shieldHp / e.shieldMax) * 100) : -1,
        Math.round(e.shieldDir * 100),
        e.state === 'windup' && e.atk === 'wound' ? e.aimPid : 0,
      ]);
    }
    return out;
  }

  snapProjectiles(): ProjTuple[] {
    return this.projectiles.map((p) => [
      p.id, p.kindIdx, Math.round(p.x), Math.round(p.y), Math.round(p.vx), Math.round(p.vy), p.team === 'p' ? p.owner : -1,
      p.lob > 0 ? Math.max(0, Math.min(100, Math.round((1 - p.range / p.lob) * 100))) : -1,
    ]);
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
      intro: this.intro ? { ...this.intro } : null,
      ch: this.chapter.n,
      mp: mapIndex(this.map.id),
      st: this.storm.active ? 1 : 0,
      rt: this.route === 'risk' ? 1 : this.route === 'safe' ? 2 : 0,
      ev: info.ev,
      cg: info.cg,
      bo,
      bd: this.bard ? [Math.round(this.bard.x), Math.round(this.bard.y)] : null,
    };
  }

  matchStats(): Record<number, MatchStats> {
    const out: Record<number, MatchStats> = {};
    const victory = this.phase === 'victory';
    for (const p of this.players.values()) {
      const mem = memoryReward({ waves: this.wavesCleared, minibosses: this.minibossKills, bosses: this.bossKills, victory }, p.perks);
      out[p.id] = { ...p.stats, bosses: this.bossKills, mem };
    }
    return out;
  }

  /** Há Necromante na partida (para enviar cadáveres no snapshot). */
  hasNecro(): boolean {
    for (const p of this.players.values()) if (p.cls === 'necromancer') return true;
    return false;
  }
}
