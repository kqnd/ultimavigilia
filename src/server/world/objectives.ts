/**
 * Eventos de onda, desafios opcionais e objetivos de chefe (luas falsas / totens).
 * Todo o estado vive aqui, no servidor; os clientes só recebem o resumo em `WaveInfo`.
 */
import { AFFIX_RULES } from '../../shared/config/affixes.js';
import { ATK, ENEMIES, type EnemyType } from '../../shared/config/enemies.js';
import {
  CHALLENGE_KINDS, CHALLENGE_RULES, CHALLENGES, type ChallengeKind, EVENT_RULES, INCOMPATIBLE, WAVE_EVENTS, type WaveEventKind,
} from '../../shared/config/objectives.js';
import { WAVES, waveInChapter } from '../../shared/config/waves.js';
import { DT, sec } from '../../shared/constants.js';
import { circleFree, resolveCircle } from '../../shared/collision.js';
import { dist, dist2 } from '../../shared/math.js';
import type { ObjectiveInfo } from '../../shared/protocol.js';
import { addPickup } from './loot.js';
import { spawnMinion } from './minions.js';
import type { Enemy, Minion } from './types.js';
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

export class Objectives {
  event: EventState | null = null;
  challenge: ChallengeState | null = null;
  /** Multiplicador de dano inimigo por falha de evento (até o fim da onda). */
  enemyDamageMul = 1;
  /** Recompensas pendentes para o próximo intervalo. */
  pending = { cards: 0, heal: 0, ult: 0 };

  constructor(private readonly w: World) {}

  reset(): void {
    this.event = null;
    this.challenge = null;
    this.enemyDamageMul = 1;
    this.pending = { cards: 0, heal: 0, ult: 0 };
  }

  // ------------------------------------------------------------------ início da onda

  beginWave(wave: number): void {
    const w = this.w;
    this.event = null;
    this.challenge = null;
    this.enemyDamageMul = 1;
    const def = WAVES[wave - 1];
    if (!def) return;
    const bossWave = !!def.boss;
    // evento fixo da onda
    if (def.event && !bossWave) {
      const kind = def.event;
      const st: EventState = { kind, state: 0, hp: 0, maxHp: 0, t: -1, maxT: -1, entity: 0, delay: kind === 'escort' ? 0 : sec(3) };
      if (kind === 'bonfire') {
        st.hp = st.maxHp = EVENT_RULES.bonfire.hp;
      } else if (kind === 'ritual') {
        st.t = st.maxT = sec(EVENT_RULES.ritual.channelSeconds);
      } else if (kind === 'escort') {
        st.hp = st.maxHp = EVENT_RULES.escort.hp;
      } else if (kind === 'cart') {
        st.hp = st.maxHp = 1;
      }
      this.event = st;
      // Na escolta, a equipe começa junto ao sobrevivente durante a preparação da onda.
      if (kind === 'escort') this.spawnEventEntity(st);
      w.emit({ k: 'msg', txt: `EVENTO: ${WAVE_EVENTS[kind].name}`, c: 'info' });
    }
    // desafio opcional
    const firstOfChapter = waveInChapter(wave) === 0;
    if (!bossWave && !def.breather && !firstOfChapter && wave > 1 && w.rng.chance(CHALLENGE_RULES.chance)) {
      const bad = new Set<ChallengeKind>(this.event ? (INCOMPATIBLE[this.event.kind] ?? []) : []);
      const hasElite = !!def.guaranteed && Object.keys(def.guaranteed).length > 0;
      if (!hasElite) bad.add('elite');
      if (def.miniboss) bad.add('speed');
      const pool = CHALLENGE_KINDS.filter((k) => !bad.has(k));
      if (pool.length) {
        const kind = w.rng.pick(pool);
        const c: ChallengeState = { kind, state: 0, hp: 0, maxHp: 0, t: -1, maxT: -1, x: 0, y: 0, target: 0 };
        if (kind === 'speed') c.t = c.maxT = sec(CHALLENGE_RULES.speedBase + def.budget * CHALLENGE_RULES.speedPerBudget);
        if (kind === 'altar') {
          const spot = w.rng.pick(w.map.points.altar);
          c.x = spot.x;
          c.y = spot.y;
          c.hp = c.maxHp = CHALLENGE_RULES.altar.hp;
        }
        this.challenge = c;
        w.emit({ k: 'msg', txt: `DESAFIO: ${CHALLENGES[kind].name} (${CHALLENGES[kind].rewardText})`, c: 'info' });
      }
    }
  }

  /** O evento em curso impede o fim da onda (escolta, carrinho e ritual têm solução garantida no tempo). */
  blocking(): boolean {
    const e = this.event;
    if (!e || e.state !== 0) return false;
    return e.kind === 'escort' || e.kind === 'cart' || e.kind === 'ritual';
  }

  // ------------------------------------------------------------------ tick

  tick(): void {
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
        const R = EVENT_RULES.bonfire;
        const n = this.enemiesNear(w.map.campfire.x, w.map.campfire.y, R.radius);
        if (n > 0) {
          ev.hp -= Math.min(R.maxDamagePerSecond, n * R.damagePerEnemyPerSecond) * DT;
          if (w.tick % 20 === 0) w.emit({ k: 'fx', n: 'fireHurt', x: w.map.campfire.x, y: w.map.campfire.y - 10, a: 0, o: 0, r: R.radius });
        }
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
      const m = spawnMinion(w, 0, 'survivor', gate.x, gate.y, { hp: E.hp, ttl: sec(999), speed: E.speed, damage: 0, r: E.radius });
      ev.entity = m?.id ?? 0;
      if (m) {
        w.escortField?.compute(m.x, m.y);
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
    this.w.emit({ k: 'msg', txt: def.success, c: 'good' });
  }

  private failEvent(ev: EventState): void {
    if (ev.state !== 0) return;
    ev.state = 2;
    if (ev.kind === 'bonfire' || ev.kind === 'escort') this.enemyDamageMul = EVENT_RULES.failDamageMul;
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
        const R = CHALLENGE_RULES.altar;
        const n = this.enemiesNear(c.x, c.y, R.radius);
        if (n > 0) c.hp -= n * R.damagePerEnemyPerSecond * DT;
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
    this.w.emit({ k: 'msg', txt: `DESAFIO CUMPRIDO: ${def.rewardText}${mul > 1 ? ' (×2 pela rota de risco)' : ''}`, c: 'good' });
  }

  private failChallenge(c: ChallengeState): void {
    if (c.state !== 0) return;
    c.state = 2;
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
  }

  /** Aplica e zera as recompensas pendentes (no início do intervalo). */
  grantRewards(): void {
    const w = this.w;
    const r = this.pending;
    for (const p of w.players.values()) {
      if (r.heal > 0 && p.status === 0) w.healPlayer(p, p.maxHp * r.heal, false);
      if (r.ult > 0) w.addUlt(p, r.ult);
      if (r.cards > 0) p.bonusCards += r.cards;
    }
    this.pending = { cards: 0, heal: 0, ult: 0 };
  }

  info(): { ev: ObjectiveInfo | null; cg: ObjectiveInfo | null } {
    const ev = this.event;
    const c = this.challenge;
    const pct = (v: number, m: number): number => (m > 0 ? Math.max(0, Math.min(100, Math.round((v / m) * 100))) : -1);
    return {
      ev: ev ? { k: ev.kind, s: ev.state, p: ev.kind === 'ritual' ? pct(ev.t, ev.maxT) : pct(ev.hp, ev.maxHp), t: ev.t } : null,
      cg: c
        ? { k: c.kind, s: c.state, p: c.kind === 'altar' ? pct(c.hp, c.maxHp) : c.kind === 'elite' || c.kind === 'speed' ? pct(c.t, c.maxT) : -1, t: c.t, ...(c.kind === 'altar' ? { x: Math.round(c.x), y: Math.round(c.y) } : {}) }
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

/** Multiplicador de dano recebido por chefes com objetivos (luas/totens). */
export function bossObjectiveDamageMul(w: World, e: Enemy): number {
  if (e.type === 'moonDevourer') {
    if (e.exposedT > 0) return ATK.falseMoon.exposedDamageMul;
    return Math.max(ATK.falseMoon.minDamageMul, 1 - ATK.falseMoon.damageReductionPerMoon * countObjectives(w, 'falseMoon'));
  }
  if (e.type === 'patriarch' && e.phase === 1 && countObjectives(w, 'abyssTotem') > 0) return ATK.patriarch.shieldedDamageMul;
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
