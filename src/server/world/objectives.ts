/**
 * Eventos de onda, desafios opcionais e objetivos de chefe (luas falsas / totens).
 * Todo o estado vive aqui, no servidor; os clientes só recebem o resumo em `WaveInfo`.
 */
import { AFFIX_RULES } from '../../shared/config/affixes.js';
import { COMBOS } from '../../shared/config/combos.js';
import { ATK, ENEMIES, type EnemyType, SPECIAL_RULES, SPECIAL_TYPES, type SpecialType } from '../../shared/config/enemies.js';
import {
  CHALLENGE_KINDS, CHALLENGE_RULES, CHALLENGES, type ChallengeKind, EVENT_RULES, INCOMPATIBLE, SIEGE_RULES, WAVE_EVENT_KINDS, WAVE_EVENTS, type WaveEventKind,
} from '../../shared/config/objectives.js';
import { WAVES, waveInChapter } from '../../shared/config/waves.js';
import { DT, sec } from '../../shared/constants.js';
import { circleFree, lineOfSight, resolveCircle } from '../../shared/collision.js';
import { dist, dist2 } from '../../shared/math.js';
import type { ObjectiveInfo } from '../../shared/protocol.js';
import { addPickup } from './loot.js';
import { spawnMinion } from './minions.js';
import { FlowField } from './nav.js';
import type { Enemy, Minion, Player, Target } from './types.js';
import type { World } from './world.js';

interface EventState {
  kind: WaveEventKind;
  /** 0 em andamento, 1 sucesso, 2 falha. */
  state: 0 | 1 | 2;
  hp: number;
  maxHp: number;
  t: number;
  maxT: number;
  entity: number;
  delay: number;
}

interface ChallengeState {
  kind: ChallengeKind;
  state: 0 | 1 | 2;
  hp: number;
  maxHp: number;
  t: number;
  maxT: number;
  x: number;
  y: number;
  target: number;
}

/** Objetivo de área sob pressão (fogueira do evento ou altar do desafio). */
interface AreaState {
  kind: 'bonfire' | 'altar';
  x: number;
  y: number;
  r: number;
  /** Inimigos pressionando agora, dano/s atual, teto de dano/s. */
  pressers: number;
  dps: number;
  cap: number;
  danger: 0 | 1 | 2;
  /** Ticks com a área limpa e cura já recuperada nesta onda. */
  clearT: number;
  recovered: number;
  assaults: number;
  lastAlarm: number;
}

interface EscortState {
  startDist: number;
  ambush: number;
  lastHitTick: number;
  alarmTick: number;
  raiders: number;
}

const ESCORT_RAIDERS: ReadonlySet<EnemyType> = new Set<EnemyType>(['shambler', 'runner', 'acolyte', 'ossuaryBearer']);
const SIEGE_UNITS: ReadonlySet<EnemyType> = new Set<EnemyType>(['shambler', 'runner', 'acolyte', 'ossuaryBearer', 'father', 'shadowAcolyte']);
const SIEGE_CASTERS: ReadonlySet<EnemyType> = new Set<EnemyType>(['acolyte', 'shadowAcolyte', 'highAcolyte']);
const GOLDEN = 2.399963;

export class Objectives {
  event: EventState | null = null;
  challenge: ChallengeState | null = null;
  /** Multiplicador de dano inimigo por falha de evento (até o fim da onda). */
  enemyDamageMul = 1;
  /** Recompensas pendentes para o próximo intervalo. */
  pending = { cards: 0, heal: 0, ult: 0 };
  /** Área sob pressão (fogueira/altar) e campo de fluxo até ela. */
  area: AreaState | null = null;
  pointField: FlowField | null = null;
  private fieldKey = '';
  private escort: EscortState | null = null;

  constructor(private readonly w: World) {}

  reset(): void {
    this.event = null;
    this.challenge = null;
    this.enemyDamageMul = 1;
    this.pending = { cards: 0, heal: 0, ult: 0 };
    this.area = null;
    this.escort = null;
  }

  private playersScale(per: number): number {
    return 1 + per * Math.max(0, this.w.players.size - 1);
  }

  // ------------------------------------------------------------------ início da onda

  beginWave(wave: number): void {
    const w = this.w;
    this.event = null;
    this.challenge = null;
    this.enemyDamageMul = 1;
    this.area = null;
    this.escort = null;
    const def = WAVES[wave - 1];
    if (!def) return;
    const bossWave = !!def.boss;
    // evento fixo da onda
    if (def.event && !bossWave) this.startEvent(def.event);
    // desafio opcional
    const firstOfChapter = waveInChapter(wave) === 0;
    if (!bossWave && !def.breather && !firstOfChapter && wave > 1 && w.rng.chance(CHALLENGE_RULES.chance)) {
      const evNow = this.event as EventState | null;
      const bad = new Set<ChallengeKind>(evNow ? (INCOMPATIBLE[evNow.kind] ?? []) : []);
      const hasElite = !!def.guaranteed && Object.keys(def.guaranteed).length > 0;
      if (!hasElite) bad.add('elite');
      if (def.miniboss) bad.add('speed');
      const pool = CHALLENGE_KINDS.filter((k) => !bad.has(k));
      if (pool.length) this.startChallenge(w.rng.pick(pool));
    }
  }

  private startEvent(kind: WaveEventKind): void {
    const w = this.w;
    const st: EventState = { kind, state: 0, hp: 0, maxHp: 0, t: -1, maxT: -1, entity: 0, delay: kind === 'escort' ? 0 : sec(3) };
    if (kind === 'bonfire') {
      st.hp = st.maxHp = Math.round(EVENT_RULES.bonfire.hp * this.playersScale(SIEGE_RULES.hpPerExtraPlayer));
      this.setArea('bonfire', w.map.campfire.x, w.map.campfire.y, EVENT_RULES.bonfire.radius);
    } else if (kind === 'ritual') {
      st.t = st.maxT = sec(EVENT_RULES.ritual.channelSeconds);
    } else if (kind === 'escort') {
      st.hp = st.maxHp = Math.round(EVENT_RULES.escort.hp * this.playersScale(SIEGE_RULES.hpPerExtraPlayer));
    } else if (kind === 'cart') {
      st.hp = st.maxHp = 1;
    }
    this.event = st;
    // Na escolta, a equipe começa junto ao sobrevivente durante a preparação da onda.
    if (kind === 'escort') this.spawnEventEntity(st);
    w.emit({ k: 'msg', txt: `EVENTO: ${WAVE_EVENTS[kind].name}`, c: 'info' });
  }

  private startChallenge(kind: ChallengeKind): void {
    const w = this.w;
    const def = WAVES[w.wave - 1];
    const c: ChallengeState = { kind, state: 0, hp: 0, maxHp: 0, t: -1, maxT: -1, x: 0, y: 0, target: 0 };
    if (kind === 'speed') c.t = c.maxT = sec(CHALLENGE_RULES.speedBase + (def?.budget ?? 30) * CHALLENGE_RULES.speedPerBudget);
    if (kind === 'altar') {
      const spot = w.rng.pick(w.map.points.altar);
      c.x = spot.x;
      c.y = spot.y;
      c.hp = c.maxHp = Math.round(CHALLENGE_RULES.altar.hp * this.playersScale(SIEGE_RULES.hpPerExtraPlayer));
      this.setArea('altar', c.x, c.y, CHALLENGE_RULES.altar.radius);
    }
    this.challenge = c;
    w.emit({ k: 'msg', txt: `DESAFIO: ${CHALLENGES[kind].name} (${CHALLENGES[kind].rewardText})`, c: 'info' });
  }

  private setArea(kind: 'bonfire' | 'altar', x: number, y: number, r: number): void {
    const cap = SIEGE_RULES.maxPerSecond[kind] * this.playersScale(SIEGE_RULES.perExtraPlayer);
    this.area = { kind, x, y, r, pressers: 0, dps: 0, cap, danger: 0, clearT: 0, recovered: 0, assaults: 0, lastAlarm: -9999 };
    this.refreshField(true);
  }

  /** Campo de fluxo até o objetivo de área (recalculado quando caixas quebram). */
  private refreshField(force = false): void {
    const a = this.area;
    if (!a) return;
    const key = `${this.w.map.id}:${Math.round(a.x)}:${Math.round(a.y)}`;
    if (!this.pointField || key !== this.fieldKey) {
      this.pointField = new FlowField(this.w.map);
      this.fieldKey = key;
      force = true;
    }
    if (force) this.pointField.compute(a.x, a.y);
  }

  /** Depuração: força um evento ou desafio na onda atual (capturas e testes). */
  debugForce(c: 'event' | 'challenge', kind: string, hpPct: number): void {
    if (c === 'event' && (WAVE_EVENT_KINDS as readonly string[]).includes(kind)) {
      this.area = null;
      this.startEvent(kind as WaveEventKind);
      if (this.event && hpPct > 0 && this.event.maxHp > 1) this.event.hp = (this.event.maxHp * hpPct) / 100;
      if (this.event) this.event.delay = 0;
    } else if (c === 'challenge' && (CHALLENGE_KINDS as readonly string[]).includes(kind)) {
      this.startChallenge(kind as ChallengeKind);
      if (this.challenge && hpPct > 0 && this.challenge.maxHp > 0) this.challenge.hp = (this.challenge.maxHp * hpPct) / 100;
    }
    for (const e of this.w.enemies.values()) if (e.state !== 'dead' && !e.def.objective && e.role === 'none') this.assignRole(e);
  }

  /** O evento em curso impede o fim da onda (escolta, carrinho e ritual têm solução garantida no tempo). */
  blocking(): boolean {
    const e = this.event;
    if (!e || e.state !== 0) return false;
    return e.kind === 'escort' || e.kind === 'cart' || e.kind === 'ritual';
  }

  // ------------------------------------------------------------------ funções táticas

  /** Quantos inimigos devem ter a função de ocupar a área agora. */
  private desiredAttackers(kind: 'bonfire' | 'altar'): number {
    let alive = 0;
    for (const e of this.w.enemies.values()) if (e.state !== 'dead' && !e.def.objective && e.def.tier !== 'boss') alive++;
    const max = SIEGE_RULES.maxAttackers + SIEGE_RULES.attackersPerExtraPlayer * Math.max(0, this.w.players.size - 1);
    return Math.min(max, Math.ceil(alive * SIEGE_RULES.share[kind]));
  }

  private countRole(role: Enemy['role']): number {
    let n = 0;
    for (const e of this.w.enemies.values()) if (e.state !== 'dead' && e.role === role) n++;
    return n;
  }

  /** Decide a função de um inimigo que acabou de surgir (parte da horda vai ao objetivo). */
  assignRole(e: Enemy): void {
    if (e.role !== 'none' || e.def.objective || e.def.tier === 'boss' || e.def.miniboss) return;
    const w = this.w;
    if (this.area && SIEGE_UNITS.has(e.type)) {
      // Portadores e unidades resistentes lideram a ocupação; comuns completam a cota
      const lead = e.type === 'ossuaryBearer' || e.type === 'father';
      if (lead || this.countRole('siege') < this.desiredAttackers(this.area.kind)) e.role = 'siege';
      return;
    }
    const ev = this.event;
    if (ev && ev.kind === 'escort' && ev.state === 0 && ESCORT_RAIDERS.has(e.type)) {
      if (e.type === 'ossuaryBearer' || w.rng.chance(EVENT_RULES.escort.raiderShare)) e.role = 'raider';
    }
  }

  /** Alvo de quem tem função tática (null = alvo normal). */
  roleTarget(e: Enemy): Target | null {
    const w = this.w;
    if (e.role === 'siege') {
      const a = this.area;
      if (!a) {
        e.role = 'none';
        return null;
      }
      // quem chega perto vira luta: a ocupação não ignora jogadores
      let near: Player | null = null;
      let nd: number = SIEGE_RULES.defendRadius;
      for (const p of w.players.values()) {
        if (p.status !== 0) continue;
        const d = dist(e.x, e.y, p.x, p.y);
        if (d < nd) {
          nd = d;
          near = p;
        }
      }
      if (near) return near;
      const slot = this.slotFor(e, a);
      return { id: 0, x: slot.x, y: slot.y, r: 4, status: 0, isPoint: true };
    }
    if (e.role === 'raider') {
      const ev = this.event;
      const m = ev && ev.kind === 'escort' && ev.state === 0 ? w.minions.get(ev.entity) : undefined;
      if (!m || m.state === 'dead') {
        e.role = 'none';
        return null;
      }
      if (m.state === 'rise') return null;
      if (dist(e.x, e.y, m.x, m.y) > EVENT_RULES.escort.raiderRange) return null;
      // defende-se de quem cola nele
      for (const p of w.players.values()) if (p.status === 0 && dist(e.x, e.y, p.x, p.y) < 34) return p;
      return m;
    }
    return null;
  }

  /** Vaga ao redor do objetivo (distribuída; nunca todos no mesmo pixel do centro). */
  private slotFor(e: Enemy, a: AreaState): { x: number; y: number } {
    const ang = e.id * GOLDEN;
    const rr = a.r * (0.3 + 0.45 * (((e.id * 7) % 10) / 10));
    const x = a.x + Math.cos(ang) * rr;
    const y = a.y + Math.sin(ang) * rr * 0.8;
    if (circleFree(this.w.map, x, y, e.r)) return { x, y };
    const pos = { x, y };
    resolveCircle(this.w.map, pos, e.r);
    return dist(pos.x, pos.y, a.x, a.y) <= a.r ? pos : { x: a.x, y: a.y };
  }

  /** O jogador está dentro da área de uma missão (fogueira, altar ou perto do sobrevivente)? */
  playerInArea(p: Player): boolean {
    const a = this.area;
    if (a && dist2(p.x, p.y, a.x, a.y) <= (a.r + 8) ** 2) return true;
    const ev = this.event;
    if (ev && ev.kind === 'escort' && ev.state === 0) {
      const m = this.w.minions.get(ev.entity);
      if (m && dist2(p.x, p.y, m.x, m.y) <= EVENT_RULES.escort.followRadius ** 2) return true;
    }
    return false;
  }

  // ------------------------------------------------------------------ canalização contra o objetivo

  /** Acólitos com função de cerco canalizam à distância contra fogueira/altar (ondas avançadas). */
  trySiege(e: Enemy): boolean {
    const a = this.area;
    const w = this.w;
    if (!a || e.role !== 'siege' || !SIEGE_CASTERS.has(e.type) || w.wave < SIEGE_RULES.rangedFromWave) return false;
    if ((e.cds.siege ?? 0) > 0 || e.state !== 'move') return false;
    const S = ATK.siege;
    const d = dist(e.x, e.y, a.x, a.y);
    if (d > S.range || d < a.r * 0.6 || !lineOfSight(w.map, e.x, e.y, a.x, a.y)) return false;
    w.startEnemyAttack(e, 'siege', a.x, a.y);
    w.emit({ k: 'fx', n: 'siegeStart', x: e.x, y: e.y, a: Math.atan2(a.y - e.y, a.x - e.x), o: e.id, r: S.windup });
    w.emit({ k: 'sfx', n: 'siegeCharge', x: e.x, y: e.y });
    return true;
  }

  /** Estados da canalização (substitui o cérebro enquanto dura). */
  tickSiege(e: Enemy): [number, number] {
    const S = ATK.siege;
    const w = this.w;
    e.stateT++;
    if (e.state === 'windup') {
      const a = this.area;
      if (!a) {
        w.setEnemyState(e, 'move');
        e.atk = 'none';
        return [0, 0];
      }
      if (e.stateT >= S.windup) {
        this.damageArea(SIEGE_RULES.siegeDamage[a.kind]);
        w.emit({ k: 'fx', n: 'siegeHit', x: a.x, y: a.y - 8, a: Math.atan2(a.y - e.y, a.x - e.x), o: e.id, r: dist(e.x, e.y, a.x, a.y) });
        w.emit({ k: 'sfx', n: 'siegeHit', x: a.x, y: a.y });
        e.cds.siege = sec(S.cooldown);
        w.setEnemyState(e, 'recover');
      }
    } else if (e.state === 'recover' && e.stateT >= S.recovery) {
      w.setEnemyState(e, 'move');
      e.atk = 'none';
    }
    return [0, 0];
  }

  /** Canalização interrompida (golpe de jogador, stagger, interrupção). */
  breakSiege(e: Enemy): void {
    if (e.atk !== 'siege' || e.state !== 'windup') return;
    this.w.emit({ k: 'fx', n: 'siegeBreak', x: e.x, y: e.y - 10, a: 0, o: e.id, r: 0 });
    e.cds.siege = sec(ATK.siege.cooldown * 0.5);
    this.w.setEnemyState(e, 'recover');
  }

  private damageArea(amount: number): void {
    const a = this.area;
    if (!a || amount <= 0) return;
    if (a.kind === 'bonfire' && this.event && this.event.state === 0) this.event.hp -= amount;
    else if (a.kind === 'altar' && this.challenge && this.challenge.state === 0) this.challenge.hp -= amount;
    this.w.tele.objectiveDamage(a.kind, amount);
  }

  // ------------------------------------------------------------------ tick

  tick(): void {
    this.tickArea();
    this.tickEvent();
    this.tickChallenge();
  }

  private enemiesNear(x: number, y: number, r: number): number {
    let n = 0;
    for (const e of this.w.enemies.values()) {
      if (e.state === 'dead' || e.state === 'spawn' || e.def.objective) continue;
      if (dist2(e.x, e.y, x, y) <= r * r) n++;
    }
    return n;
  }

  /**
   * Pressão sobre fogueira/altar: só quem está DENTRO da área contribui (categoria × tempo
   * contínuo dentro), com teto por segundo. Área limpa por um tempo recupera devagar e pouco.
   */
  private tickArea(): void {
    const a = this.area;
    const w = this.w;
    if (!a) return;
    const alive = a.kind === 'bonfire' ? this.event?.kind === 'bonfire' && this.event.state === 0 && this.event.delay <= 0 : this.challenge?.kind === 'altar' && this.challenge.state === 0;
    if (!alive) {
      if ((a.kind === 'bonfire' && this.event?.state !== 0) || (a.kind === 'altar' && this.challenge?.state !== 0)) this.area = null;
      return;
    }
    if (w.tick % 30 === 0) this.refreshField(true);
    const S = SIEGE_RULES;
    let pts = 0;
    let n = 0;
    const types: EnemyType[] = [];
    for (const e of w.enemies.values()) {
      if (e.state === 'dead' || e.state === 'spawn' || e.state === 'air' || e.def.objective) continue;
      if (dist2(e.x, e.y, a.x, a.y) > a.r * a.r) {
        e.zoneT = 0;
        continue;
      }
      e.zoneT++;
      n++;
      types.push(e.type);
      const tier = e.def.tier === 'boss' ? 'boss' : e.def.miniboss ? 'miniboss' : e.def.tier;
      const ramp = S.rampStart + (S.rampMax - S.rampStart) * Math.min(1, e.zoneT / sec(S.rampSeconds));
      pts += S.perTier[tier] * ramp;
    }
    const chapterMul = S.chapterMul[w.chapter.n - 1] ?? 1;
    const dps = Math.min(a.cap, pts * S.basePerSecond[a.kind] * chapterMul);
    a.pressers = n;
    a.dps = dps;
    if (dps > 0) {
      this.damageArea(dps * DT);
      a.clearT = 0;
      if (w.tick % 20 === 0) w.emit({ k: 'fx', n: a.kind === 'bonfire' ? 'fireHurt' : 'altarHurt', x: a.x, y: a.y - 10, a: n, o: 0, r: a.r });
    } else if (++a.clearT > sec(S.recoverDelay)) {
      // área limpa: recuperação lenta e limitada
      const capLeft = S.recoverCapPerWave[a.kind] - a.recovered;
      const st = a.kind === 'bonfire' ? this.event : this.challenge;
      if (st && capLeft > 0 && st.hp < st.maxHp) {
        const v = Math.min(capLeft, S.recoverPerSecond * DT, st.maxHp - st.hp);
        st.hp += v;
        a.recovered += v;
      }
    }
    w.tele.objectivePressure(a.kind, n, types);
    // estado de perigo + som progressivo (não repete o mesmo alerta)
    const st = a.kind === 'bonfire' ? this.event : this.challenge;
    const frac = st ? st.hp / Math.max(1, st.maxHp) : 1;
    const danger: 0 | 1 | 2 = frac < S.criticalHp || dps >= S.criticalPressure * a.cap ? 2 : n > 0 || frac < S.threatenedHp ? 1 : 0;
    if (danger > a.danger || (danger === 2 && w.tick - a.lastAlarm > sec(2.5))) {
      w.emit({ k: 'sfx', n: danger === 2 ? 'objCritical' : 'objThreat', x: a.x, y: a.y });
      a.lastAlarm = w.tick;
    }
    a.danger = danger;
    // assaltos coordenados em momentos marcados da onda
    this.tickAssault(a);
  }

  private tickAssault(a: AreaState): void {
    const w = this.w;
    const A = SIEGE_RULES.assault;
    if (a.kind === 'altar' && w.wave < A.altarFromWave) return;
    const marks = A.at[a.kind];
    const at = marks[a.assaults];
    if (at === undefined || w.director.progress() < at || w.phaseTimer > 0) return;
    a.assaults++;
    // dois portões destacados, longe dos jogadores
    const gates = [...w.map.spawns]
      .map((g) => ({ g, d: w.alivePlayers().reduce((m, p) => Math.min(m, dist(p.x, p.y, g.x, g.y)), Infinity) }))
      .filter((x) => x.d > 160)
      .sort((x, y) => (w.rng.next() - 0.5) + (y.d - x.d) * 0.002);
    const chosen = gates.slice(0, 2).map((x) => x.g);
    if (!chosen.length) return;
    const types: EnemyType[] = [];
    const scale = this.playersScale(A.perExtraPlayer);
    for (let i = 0; i < Math.round(A.base.length * scale); i++) types.push(A.base[i % A.base.length] as EnemyType);
    for (const t of A.specials as readonly SpecialType[]) if (w.wave >= SPECIAL_RULES.unlockWave[t] && w.director.specialFits(t)) types.push(t);
    const pts = types.map((_, i) => {
      const g = chosen[i % chosen.length] as { x: number; y: number };
      return { x: g.x + ((i * 11) % 30) - 15, y: g.y + ((i * 17) % 24) - 12 };
    });
    w.director.plannedGroup(pts, types, sec(A.warnSeconds), 'siege', 'assaultWarn');
    w.emit({ k: 'msg', txt: a.kind === 'bonfire' ? 'ASSALTO: a horda mira a fogueira! Defendam os portões marcados.' : 'ASSALTO: o altar vai ser invadido! Posicionem-se.', c: 'bad' });
    w.emit({ k: 'sfx', n: 'assaultHorn', x: a.x, y: a.y });
    w.tele.assault(a.kind);
  }

  private tickEvent(): void {
    const w = this.w;
    const ev = this.event;
    if (!ev || ev.state !== 0) return;
    if (ev.delay > 0) {
      ev.delay--;
      if (ev.delay === 0) this.spawnEventEntity(ev);
      return;
    }
    switch (ev.kind) {
      case 'bonfire': {
        if (ev.hp <= 0) this.failEvent(ev);
        break;
      }
      case 'ritual': {
        const e = w.enemies.get(ev.entity);
        if (!e || e.state === 'dead') {
          this.succeedEvent(ev);
          break;
        }
        ev.t--;
        if (ev.t <= 0) {
          // o ritual se completa: o acólito some e dois lobisomens atravessam o véu
          e.state = 'dead';
          w.enemies.delete(e.id);
          w.emit({ k: 'fx', n: 'ritualDone', x: e.x, y: e.y, a: 0, o: 0, r: 40 });
          for (const t of EVENT_RULES.ritual.failSpawn) w.director.spawnNear(t, e.x, e.y);
          this.failEvent(ev);
        }
        break;
      }
      case 'escort': {
        const m = w.minions.get(ev.entity);
        if (!m || m.state === 'dead') {
          this.failEvent(ev);
          break;
        }
        this.tickEscort(ev, m);
        ev.hp = m.hp;
        if (dist(m.x, m.y, w.map.campfire.x, w.map.campfire.y) <= EVENT_RULES.escort.arriveRadius) {
          w.minions.delete(m.id);
          w.emit({ k: 'fx', n: 'survivorSafe', x: m.x, y: m.y, a: 0, o: 0, r: 20 });
          this.succeedEvent(ev);
        }
        break;
      }
      case 'cart': {
        const e = w.enemies.get(ev.entity);
        if (!e || e.state === 'dead') {
          this.succeedEvent(ev);
          break;
        }
        ev.hp = e.hp;
        ev.maxHp = e.maxHp;
        if (dist(e.x, e.y, w.map.campfire.x, w.map.campfire.y) <= EVENT_RULES.cart.arriveRadius) {
          e.state = 'dead';
          w.enemies.delete(e.id);
          w.emit({ k: 'fx', n: 'cartArrive', x: e.x, y: e.y, a: 0, o: 0, r: 60 });
          for (let i = 0; i < EVENT_RULES.cart.failSpawn; i++) w.director.spawnNear('shambler', e.x, e.y);
          this.failEvent(ev);
        }
        break;
      }
    }
  }

  // ------------------------------------------------------------------ escolta

  /** Ritmo da escolta: emboscadas nos marcos do caminho, respiro e chegada mais perigosa. */
  private tickEscort(ev: EventState, m: Minion): void {
    const w = this.w;
    const E = EVENT_RULES.escort;
    const st = this.escort;
    if (!st || m.state === 'rise') return;
    // regeneração só fora de combate e limitada
    if (w.tick - st.lastHitTick > sec(E.regenDelay) && m.hp < m.maxHp * E.regenCap) m.hp = Math.min(m.maxHp * E.regenCap, m.hp + E.regenPerSecond * DT);
    // atacantes do sobrevivente (HUD / alerta)
    if (w.tick % 10 === 0) {
      let n = 0;
      for (const e of w.enemies.values()) if (e.state !== 'dead' && e.role === 'raider' && dist2(e.x, e.y, m.x, m.y) < 140 * 140) n++;
      st.raiders = n;
    }
    const fd = w.fireField?.at(m.x, m.y) ?? 0xffff;
    if (fd === 0xffff || st.startDist <= 0) return;
    const progress = 1 - fd / st.startDist;
    const next = E.ambushAt[st.ambush];
    if (next !== undefined && progress >= next && w.phaseTimer <= 0) {
      this.ambush(st.ambush, m);
      st.ambush++;
    }
    void ev;
  }

  private ambush(i: number, m: Minion): void {
    const w = this.w;
    const E = EVENT_RULES.escort;
    const dir = w.fireField?.direction(m.x, m.y) ?? [0, 1];
    const fx = dir[0] || 0;
    const fy = dir[1] || 1;
    const side = i % 2 === 0 ? 1 : -1;
    const final = i === E.ambushAt.length - 1;
    // candidatos: à frente (interceptar a rota) e pelos lados, alternando
    const wanted: [number, number][] = [
      [fx * E.interceptAhead - fy * 50 * side, fy * E.interceptAhead + fx * 50 * side],
      [-fy * 170 * side, fx * 170 * side],
      final ? [fy * 170 * side, -fx * 170 * side] : [fx * 120 + fy * 150 * side, fy * 120 - fx * 150 * side],
    ];
    const pts: { x: number; y: number }[] = [];
    const ok = (x: number, y: number): boolean => {
      if (!circleFree(w.map, x, y, 10)) return false;
      const d = dist(x, y, m.x, m.y);
      if (d < E.ambushMin || d > E.ambushMax + 60) return false;
      for (const p of w.alivePlayers()) if (dist(x, y, p.x, p.y) < E.ambushPlayerSafe) return false;
      return (w.fields.values().next().value?.at(x, y) ?? 0) !== 0xffff;
    };
    for (const [dx, dy] of wanted) {
      for (let k = 0; k < 10 && pts.length < 3; k++) {
        const a = Math.atan2(dy, dx) + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 0.25;
        const r = Math.hypot(dx, dy) * (1 + (k % 3) * 0.1);
        const x = m.x + Math.cos(a) * r;
        const y = m.y + Math.sin(a) * r;
        if (ok(x, y)) {
          pts.push({ x, y });
          break;
        }
      }
    }
    if (!pts.length) return;
    const types: EnemyType[] = [...(E.ambushBase[i] ?? E.ambushBase[0] ?? [])] as EnemyType[];
    const extraN = Math.round(types.length * 0.5 * Math.max(0, w.players.size - 1));
    for (let k = 0; k < extraN; k++) types.push(k % 2 ? 'runner' : 'shambler');
    for (const t of (E.ambushSpecials[i] ?? []) as readonly SpecialType[]) {
      if ((SPECIAL_TYPES as readonly string[]).includes(t) && w.wave >= SPECIAL_RULES.unlockWave[t] && w.director.specialFits(t)) types.push(t);
    }
    const spots = types.map((_, k) => {
      const b = pts[k % pts.length] as { x: number; y: number };
      return { x: b.x + ((k * 13) % 28) - 14, y: b.y + ((k * 7) % 22) - 11 };
    });
    const warn = sec(E.ambushWarnSeconds);
    w.director.plannedGroup(spots, types, warn, 'raider', 'ambushWarn');
    w.director.holdGroups(warn + sec(E.calmSeconds));
    w.emit({ k: 'msg', txt: final ? 'A fogueira está perto — ÚLTIMA EMBOSCADA!' : i === 0 ? 'Emboscada à frente! Protejam o sobrevivente.' : 'Emboscada pelos lados!', c: 'bad' });
    w.emit({ k: 'sfx', n: 'ambushWarn', x: m.x, y: m.y });
    w.tele.ambush();
  }

  /** Dano no sobrevivente: alerta sonoro com limite de frequência e aviso de golpe grave. */
  onSurvivorHit(m: Minion, dmg: number): void {
    const w = this.w;
    const st = this.escort;
    const E = EVENT_RULES.escort;
    if (!st) return;
    st.lastHitTick = w.tick;
    w.tele.objectiveDamage('escort', dmg);
    if (w.tick - st.alarmTick > sec(E.alarmEvery)) {
      st.alarmTick = w.tick;
      w.emit({ k: 'sfx', n: 'survivorAlarm', x: m.x, y: m.y });
      w.emit({ k: 'fx', n: 'survivorAlert', x: m.x, y: m.y - 20, a: 0, o: 0, r: 0 });
    }
    if (dmg >= m.maxHp * E.heavyHitFrac) w.emit({ k: 'fx', n: 'survivorHeavy', x: m.x, y: m.y - 14, a: 0, o: 0, r: dmg });
  }

  private spawnEventEntity(ev: EventState): void {
    const w = this.w;
    const players = Math.max(1, w.players.size);
    if (ev.kind === 'ritual') {
      const far = this.farthestFromPlayers(w.map.points.ritual);
      const e = w.spawnEnemy('ritualist', far.x, far.y, players);
      e.state = 'move';
      ev.entity = e.id;
    } else if (ev.kind === 'cart') {
      const gate = this.farthestFromPlayers(w.map.spawns);
      const e = w.spawnEnemy('funeralCart', gate.x, gate.y, players);
      e.state = 'move';
      ev.entity = e.id;
      ev.hp = e.hp;
      ev.maxHp = e.maxHp;
    } else if (ev.kind === 'escort') {
      const gate = w.map.spawns.reduce((best, pt) =>
        dist2(pt.x, pt.y, w.map.campfire.x, w.map.campfire.y) > dist2(best.x, best.y, w.map.campfire.x, w.map.campfire.y) ? pt : best,
      w.map.spawns[0] ?? w.map.campfire);
      const E = EVENT_RULES.escort;
      const m = spawnMinion(w, 0, 'survivor', gate.x, gate.y, { hp: ev.maxHp, ttl: sec(999), speed: E.speed, damage: 0, r: E.radius });
      ev.entity = m?.id ?? 0;
      if (m) {
        w.escortField?.compute(m.x, m.y);
        const fd = w.fireField?.at(m.x, m.y) ?? 0xffff;
        this.escort = { startDist: fd === 0xffff ? 0 : fd, ambush: 0, lastHitTick: -9999, alarmTick: -9999, raiders: 0 };
        let i = 0;
        for (const p of w.players.values()) {
          if (p.status !== 0) continue;
          const a = (i++ / Math.max(1, w.players.size)) * Math.PI * 2;
          const pos = { x: m.x + Math.cos(a) * 28, y: m.y + Math.sin(a) * 28 };
          if (!circleFree(w.map, pos.x, pos.y, p.r)) resolveCircle(w.map, pos, p.r);
          p.move.x = pos.x;
          p.move.y = pos.y;
          p.move.ft = 0;
        }
        w.emit({ k: 'msg', txt: 'Fique perto do sobrevivente e proteja-o até a fogueira!', c: 'info' });
      }
    }
  }

  private farthestFromPlayers<T extends { x: number; y: number }>(pts: readonly T[]): T {
    const ps = this.w.alivePlayers();
    let best = pts[0] as T;
    let bd = -1;
    for (const pt of pts) {
      const d = ps.reduce((m, p) => Math.min(m, dist(p.x, p.y, pt.x, pt.y)), Infinity);
      if (d > bd) {
        bd = d;
        best = pt;
      }
    }
    return best;
  }

  private succeedEvent(ev: EventState): void {
    if (ev.state !== 0) return;
    ev.state = 1;
    const def = WAVE_EVENTS[ev.kind];
    if (ev.kind === 'bonfire' || ev.kind === 'escort') {
      this.pending.heal = Math.max(this.pending.heal, EVENT_RULES.successHealRatio);
      this.pending.cards += 1;
    } else this.pending.ult += EVENT_RULES.successUlt;
    this.w.tele.mission(ev.kind, true, this.w.wave);
    this.w.emit({ k: 'msg', txt: def.success, c: 'good' });
  }

  private failEvent(ev: EventState): void {
    if (ev.state !== 0) return;
    ev.state = 2;
    if (ev.kind === 'bonfire' || ev.kind === 'escort') this.enemyDamageMul = EVENT_RULES.failDamageMul;
    this.w.tele.mission(ev.kind, false, this.w.wave);
    this.w.emit({ k: 'msg', txt: WAVE_EVENTS[ev.kind].failure, c: 'bad' });
  }

  private tickChallenge(): void {
    const w = this.w;
    const c = this.challenge;
    if (!c || c.state !== 0) return;
    switch (c.kind) {
      case 'speed':
        if (--c.t <= 0) this.failChallenge(c);
        break;
      case 'altar': {
        // pressão calculada em tickArea
        if (c.hp <= 0) this.failChallenge(c);
        break;
      }
      case 'fireUntouched':
        if (this.enemiesNear(w.map.campfire.x, w.map.campfire.y, CHALLENGE_RULES.fire.radius) > 0) this.failChallenge(c);
        break;
      case 'elite': {
        if (!c.target) {
          for (const e of w.enemies.values()) {
            if (e.state === 'dead' || e.def.tier !== 'elite' || e.def.objective || e.def.miniboss) continue;
            e.priority = true;
            c.target = e.id;
            c.t = c.maxT = sec(CHALLENGE_RULES.elite.seconds);
            w.emit({ k: 'msg', txt: `Elite marcado: ${ENEMIES[e.type].name}!`, c: 'info' });
            break;
          }
          break;
        }
        const e = w.enemies.get(c.target);
        if (!e || e.state === 'dead') this.succeedChallenge(c);
        else if (--c.t <= 0) {
          e.priority = false;
          this.failChallenge(c);
        }
        break;
      }
      default:
        break;
    }
  }

  onDown(): void {
    const c = this.challenge;
    if (c && c.state === 0 && c.kind === 'noDowns') this.failChallenge(c);
  }

  private succeedChallenge(c: ChallengeState): void {
    if (c.state !== 0) return;
    c.state = 1;
    const def = CHALLENGES[c.kind];
    const mul = this.w.route === 'risk' ? 2 : 1;
    if (def.reward === 'card') this.pending.cards += 1;
    else if (def.reward === 'heal') this.pending.heal = Math.max(this.pending.heal, Math.min(1, CHALLENGE_RULES.healRatio * mul));
    else this.pending.ult += CHALLENGE_RULES.ult * mul;
    if (c.kind === 'altar') this.w.tele.mission('altar', true, this.w.wave);
    this.w.emit({ k: 'msg', txt: `DESAFIO CUMPRIDO: ${def.rewardText}${mul > 1 ? ' (×2 pela rota de risco)' : ''}`, c: 'good' });
  }

  private failChallenge(c: ChallengeState): void {
    if (c.state !== 0) return;
    c.state = 2;
    if (c.kind === 'altar') this.w.tele.mission('altar', false, this.w.wave);
    this.w.emit({ k: 'msg', txt: `Desafio perdido: ${CHALLENGES[c.kind].name}`, c: 'bad' });
  }

  /** Fim da onda: resolve o que depende de "sobreviver até o fim". */
  endWave(): void {
    const ev = this.event;
    if (ev && ev.state === 0 && ev.kind === 'bonfire') this.succeedEvent(ev);
    const c = this.challenge;
    if (c && c.state === 0) {
      if (c.kind === 'noDowns' || c.kind === 'speed' || c.kind === 'altar' || c.kind === 'fireUntouched') this.succeedChallenge(c);
      else if (c.kind === 'elite') this.failChallenge(c);
    }
    this.enemyDamageMul = 1;
    this.area = null;
    for (const e of this.w.enemies.values()) e.role = 'none';
  }

  /** Aplica e zera as recompensas pendentes (no início do intervalo). */
  grantRewards(): void {
    const w = this.w;
    const r = this.pending;
    for (const p of w.players.values()) {
      if (r.heal > 0 && p.status === 0) w.healPlayer(p, p.maxHp * r.heal, 'reward');
      if (r.ult > 0) w.addUlt(p, r.ult);
      if (r.cards > 0) p.bonusCards += r.cards;
    }
    this.pending = { cards: 0, heal: 0, ult: 0 };
  }

  info(): { ev: ObjectiveInfo | null; cg: ObjectiveInfo | null } {
    const ev = this.event;
    const c = this.challenge;
    const a = this.area;
    const pct = (v: number, m: number): number => (m > 0 ? Math.max(0, Math.min(100, Math.round((v / m) * 100))) : -1);
    const areaInfo = (k: 'bonfire' | 'altar'): { n?: number; d?: number } => (a && a.kind === k ? { n: a.pressers, d: a.danger } : {});
    let escortInfo: { n?: number; d?: number } = {};
    if (ev && ev.kind === 'escort' && this.escort) {
      const frac = ev.maxHp > 0 ? ev.hp / ev.maxHp : 1;
      escortInfo = { n: this.escort.raiders, d: frac < 0.3 ? 2 : this.escort.raiders > 0 || frac < 0.6 ? 1 : 0 };
    }
    return {
      ev: ev
        ? { k: ev.kind, s: ev.state, p: ev.kind === 'ritual' ? pct(ev.t, ev.maxT) : pct(ev.hp, ev.maxHp), t: ev.t, ...(ev.kind === 'bonfire' ? areaInfo('bonfire') : ev.kind === 'escort' ? escortInfo : {}) }
        : null,
      cg: c
        ? { k: c.kind, s: c.state, p: c.kind === 'altar' ? pct(c.hp, c.maxHp) : c.kind === 'elite' || c.kind === 'speed' ? pct(c.t, c.maxT) : -1, t: c.t, ...(c.kind === 'altar' ? { x: Math.round(c.x), y: Math.round(c.y), ...areaInfo('altar') } : {}) }
        : null,
    };
  }

  /** Posição do altar (para o cliente desenhar). */
  altarPos(): { x: number; y: number } | null {
    const c = this.challenge;
    return c && c.kind === 'altar' ? { x: c.x, y: c.y } : null;
  }
}

// ================================================================== objetivos de chefe

/** Chamado quando o chefe surge: acende as luas falsas / ergue os totens. */
export function spawnBossObjectives(w: World, boss: Enemy): void {
  if (boss.type === 'moonDevourer') lightMoons(w, boss);
  else if (boss.type === 'patriarch') {
    for (const pt of w.map.points.totems) {
      const t = w.spawnEnemy('abyssTotem', pt.x, pt.y, Math.max(1, w.players.size));
      t.state = 'move';
      t.objT = sec(ATK.abyssTotem.orb.interval) + w.rng.int(0, 40);
    }
    if (w.map.points.totems.length) w.emit({ k: 'msg', txt: 'O Patriarca está protegido: destrua os Totens do Abismo!', c: 'boss' });
  }
}

export function lightMoons(w: World, boss: Enemy): void {
  let n = 0;
  for (const pt of w.map.points.moons) {
    const m = w.spawnEnemy('falseMoon', pt.x, pt.y, Math.max(1, w.players.size));
    m.state = 'move';
    m.objT = sec(ATK.falseMoon.pulse.interval) + n * 40;
    n++;
  }
  boss.relightT = 0;
  if (n) w.emit({ k: 'msg', txt: 'Luas falsas protegem o Devorador: apague-as!', c: 'boss' });
}

export function countObjectives(w: World, type: EnemyType): number {
  let n = 0;
  for (const e of w.enemies.values()) if (e.type === type && e.state !== 'dead') n++;
  return n;
}

/** Multiplicador de dano recebido: chefes com objetivos (luas/totens) e combo do Caçador exposto. */
export function bossObjectiveDamageMul(w: World, e: Enemy): number {
  if (e.type === 'moonDevourer') {
    if (e.exposedT > 0) return ATK.falseMoon.exposedDamageMul;
    return Math.max(ATK.falseMoon.minDamageMul, 1 - ATK.falseMoon.damageReductionPerMoon * countObjectives(w, 'falseMoon'));
  }
  if (e.type === 'patriarch' && e.phase === 1 && countObjectives(w, 'abyssTotem') > 0) return ATK.patriarch.shieldedDamageMul;
  // Combo Caçador exposto: reusa o mesmo campo/flag do Devorador (nunca no mesmo tipo de inimigo).
  if (e.type === 'mistStalker' && e.exposedT > 0) return COMBOS.exposeVeiled.mul;
  return 1;
}

/** Luas apagadas → Devorador exposto; depois as luas reacendem enquanto ele viver. */
export function tickBossObjectives(w: World, boss: Enemy): void {
  if (boss.type !== 'moonDevourer' || !w.map.points.moons.length) return;
  const F = ATK.falseMoon;
  if (boss.exposedT > 0) {
    boss.exposedT--;
    if (boss.exposedT === 0) boss.relightT = sec(F.relightDelay - F.exposedTime);
    return;
  }
  if (boss.relightT > 0) {
    if (--boss.relightT === 0) lightMoons(w, boss);
    return;
  }
  if (countObjectives(w, 'falseMoon') === 0 && boss.state !== 'spawn') {
    boss.exposedT = sec(F.exposedTime);
    w.emit({ k: 'msg', txt: 'As luas se apagaram: o Devorador está EXPOSTO!', c: 'good' });
    w.emit({ k: 'fx', n: 'exposed', x: boss.x, y: boss.y - 30, a: 0, o: 0, r: 60 });
  }
}

/** Recompensa extra de elite com afixo: item de cura garantido e suprema para quem está perto. */
export function affixReward(w: World, e: Enemy): void {
  const R = AFFIX_RULES.reward;
  if (R.guaranteedHeal) addPickup(w, 'heal', e.x, e.y);
  for (const p of w.players.values()) if (p.status === 0 && dist2(p.x, p.y, e.x, e.y) <= R.nearbyRadius ** 2) w.addUlt(p, R.ultToNearby);
}

export function objectiveEntities(w: World): { survivor: Minion | null } {
  let survivor: Minion | null = null;
  for (const m of w.minions.values()) if (m.kind === 'survivor') survivor = m;
  return { survivor };
}
