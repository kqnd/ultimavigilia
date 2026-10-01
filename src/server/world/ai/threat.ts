/**
 * Ameaça e escolha de alvo (v1.6).
 *
 * Cada inimigo mantém uma tabela jogador -> ameaça (dano válido, cura aliada, provocação), que
 * decai exponencialmente. A escolha de alvo é uma utilidade ponderada por papel (distância de
 * caminho, ameaça, afinidade de papel, prioridade de quem cura/reza) com histerese:
 *  - reavalia em intervalos, não a cada tick;
 *  - o alvo atual ganha bônus e o candidato precisa vencer por margem;
 *  - há tempo mínimo de permanência, rompido só por salto grande de ameaça;
 *  - provocação trava o alvo (e dá ameaça de topo) por um período após acabar.
 */
import { CLASS_RANGE } from '../../../shared/config/classes.js';
import { DT, sec, TILE } from '../../../shared/constants.js';
import { TARGETING, THREAT } from '../../../shared/config/enemyAI.js';
import { BOSS_AI } from '../../../shared/config/enemies.js';
import { lineOfSight } from '../../../shared/collision.js';
import { clamp, dist } from '../../../shared/math.js';
import type { Enemy, Player } from '../types.js';
import type { World } from '../world.js';
import { aiCache, archetypeOf } from './context.js';

export type TierKey = 'common' | 'elite' | 'miniboss' | 'boss';

export const tierKey = (e: Enemy): TierKey => (e.def.tier === 'boss' ? 'boss' : e.def.miniboss ? 'miniboss' : e.def.tier === 'elite' ? 'elite' : 'common');
const isBossy = (e: Enemy): boolean => e.def.tier === 'boss' || !!e.def.miniboss;

/** Ameaça bruta (pontos) que equivale a 1.0 para este inimigo. */
export const threatCap = (e: Enemy): number => Math.max(1, e.maxHp * THREAT.cap[tierKey(e)]);

export function addThreat(e: Enemy, pid: number, amount: number): void {
  if (!(amount > 0) || e.def.objective || e.def.stationary) return;
  e.threat.set(pid, (e.threat.get(pid) ?? 0) + amount);
}

/** Ameaça normalizada 0..1 do jogador neste inimigo. */
export const threatNorm = (e: Enemy, pid: number): number => clamp((e.threat.get(pid) ?? 0) / threatCap(e), 0, 1);

/** Dano válido causado por jogador (ou servo, via dono, com peso menor). */
export function onDamage(w: World, p: Player, e: Enemy, valid: number, fromMinion: boolean): void {
  if (valid <= 0) return;
  const d = dist(p.x, p.y, e.x, e.y);
  const far = d > THREAT.farRange;
  addThreat(e, p.id, valid * (far ? THREAT.farMul : 1) * (fromMinion ? 0.5 : 1));
  if (far && isBossy(e)) e.heatT = sec(4);
  void w;
}

/** Cura que um jogador recebe: inimigos por perto passam a ver o curado como ameaça. */
export function onHeal(w: World, p: Player, got: number): void {
  if (got < 1) return;
  for (const e of w.enemiesInCircle(p.x, p.y, THREAT.healRadius)) {
    if (e.state === 'dead' || e.def.objective) continue;
    addThreat(e, p.id, got * THREAT.healMul);
  }
}

/** Decaimento exponencial por tick; remove entradas desprezíveis. */
export function decayThreat(e: Enemy): void {
  if (!e.threat.size) return;
  const f = Math.exp(-DT / THREAT.window[tierKey(e)]);
  const floor = threatCap(e) * THREAT.prune;
  for (const [pid, v] of e.threat) {
    const nv = v * f;
    if (nv < floor) e.threat.delete(pid);
    else e.threat.set(pid, nv);
  }
}

/** Ao surgir: o jogador mais próximo recebe um pouco de ameaça (primeiro alvo estável). */
export function seedThreat(w: World, e: Enemy): void {
  if (e.def.objective || e.def.stationary) return;
  let best: Player | null = null;
  let bd = Infinity;
  for (const p of w.players.values()) {
    if (p.status !== 0) continue;
    const d = dist(p.x, p.y, e.x, e.y);
    if (d < bd) {
      bd = d;
      best = p;
    }
  }
  if (best) addThreat(e, best.id, threatCap(e) * THREAT.spawnSeed);
}

/** Distância de caminho (px) até o jogador, pelo campo de fluxo. */
export function pathPx(w: World, e: Enemy, p: Player): number {
  const f = w.fields.get(p.id);
  const fd = f ? f.at(e.x, e.y) : 0xffff;
  if (fd === 0xffff) return dist(e.x, e.y, p.x, p.y) * 1.5 + 160;
  return fd * (TILE / 10);
}

const hpFrac = (p: Player): number => clamp(p.hp / Math.max(1, p.maxHp), 0, 1);
const RANGE_FRAIL = { ranged: 1, mid: 0.6, melee: 0.2 } as const;

/** Afinidade de papel (0..1): o que este tipo de inimigo gosta de caçar. */
export function roleFit(w: World, e: Enemy, p: Player, d: number): number {
  const arch = archetypeOf(e);
  switch (arch.role) {
    case 'brute': {
      const tank = p.cls === 'tank' || p.buffs.tauntDr > 0;
      return tank ? 1 : CLASS_RANGE[p.cls] === 'melee' ? 0.55 : CLASS_RANGE[p.cls] === 'mid' ? 0.3 : 0.1;
    }
    case 'swarm': {
      // distribui o cerco: jogadores já muito visados valem menos
      const load = (aiCache(w).load.get(p.id) ?? 0) - (e.targetId === p.id ? 1 : 0);
      return clamp(1 - load / 8, 0, 1);
    }
    case 'skirmisher': {
      const crowd = w.enemiesInCircle(p.x, p.y, 70).length - 1;
      const isolation = clamp(1 - crowd / 4, 0, 1);
      return 0.45 * RANGE_FRAIL[CLASS_RANGE[p.cls]] + 0.35 * isolation + 0.2 * (1 - hpFrac(p));
    }
    case 'shooter': {
      const reach = d < 330 && lineOfSight(w.map, e.x, e.y, p.x, p.y) ? 1 : 0;
      return 0.35 * RANGE_FRAIL[CLASS_RANGE[p.cls]] + 0.3 * reach + 0.2 * clamp(p.recentHeal / TARGETING.healSat, 0, 1) + 0.15 * (1 - hpFrac(p));
    }
    case 'boss':
      return (({ ranged: 3, mid: 2, melee: 1 } as const)[CLASS_RANGE[p.cls]] * 1) / 3;
  }
}

/** Prioridade (0..1): quem está curando, rezando (revivendo) ou muito ferido, se estiver ao alcance. */
export function priorityFit(p: Player, d: number): number {
  const reviving = p.revivingId ? 1 : 0;
  const healing = clamp(p.recentHeal / TARGETING.healSat, 0, 1) * 0.8;
  const hurt = hpFrac(p) < 0.4 ? ((0.4 - hpFrac(p)) / 0.4) * 0.6 : 0;
  return Math.max(reviving, healing, hurt) * Math.exp(-d / TARGETING.priorityReach);
}

export interface TargetScore {
  total: number;
  dist: number;
  threat: number;
  role: number;
  priority: number;
}

export function scoreTarget(w: World, e: Enemy, p: Player, current: boolean): TargetScore {
  const arch = archetypeOf(e);
  const W = TARGETING.weights[arch.role];
  const d = dist(e.x, e.y, p.x, p.y);
  const df = Math.exp(-pathPx(w, e, p) / TARGETING.distScale);
  const th = threatNorm(e, p.id);
  const rf = roleFit(w, e, p, d);
  const pf = priorityFit(p, d);
  const sticky = current ? TARGETING.sticky[isBossy(e) ? 'boss' : 'common'] : 0;
  return { total: W.dist * df + W.threat * th + W.role * rf + W.priority * pf + sticky, dist: df, threat: th, role: rf, priority: pf };
}

const valid = (p: Player | undefined): p is Player => !!p && p.status === 0 && p.connected;

/**
 * Escolhe o jogador-alvo do inimigo. Mantém `targetId`/`lockedId`; `targetT` é a contagem até a
 * próxima reavaliação e `lockedSince` o tick até o qual vale a permanência mínima.
 */
export function choosePlayer(w: World, e: Enemy): Player | null {
  const bossy = isBossy(e);
  const key = bossy ? 'boss' : 'common';
  // provocação: trava total e ameaça de topo; mantém o provocador por um tempo depois
  if (e.tauntT > 0) {
    const t = w.players.get(e.tauntBy);
    if (valid(t)) {
      let top = 0;
      for (const [pid] of e.threat) if (pid !== t.id) top = Math.max(top, threatNorm(e, pid));
      const want = clamp(top + THREAT.tauntBonus, 0, 1) * threatCap(e);
      if ((e.threat.get(t.id) ?? 0) < want) e.threat.set(t.id, want);
      e.targetId = t.id;
      e.lockedId = t.id;
      e.lockedSince = w.tick + sec(bossy ? BOSS_AI.tauntLock : TARGETING.tauntHold[key]);
      e.targetT = TARGETING.evalTicks[key];
      return t;
    }
  }
  let cur: Player | undefined = w.players.get(e.targetId);
  if (!valid(cur)) cur = undefined;
  if (cur && e.targetT > 0) return cur;

  // reavaliação
  let best: Player | null = null;
  let bestScore = -Infinity;
  let curScore = -Infinity;
  let curThreat = 0;
  const scores = new Map<number, TargetScore>();
  for (const p of w.players.values()) {
    if (!valid(p)) continue;
    const s = scoreTarget(w, e, p, cur?.id === p.id);
    scores.set(p.id, s);
    if (p.id === cur?.id) {
      curScore = s.total;
      curThreat = s.threat;
    }
    if (s.total > bestScore) {
      bestScore = s.total;
      best = p;
    }
  }
  e.targetT = TARGETING.evalTicks[key] + (e.id % 6);
  if (cur && best && best.id !== cur.id) {
    const holding = w.tick < e.lockedSince;
    const bestThreat = scores.get(best.id)?.threat ?? 0;
    const broke = bestThreat - curThreat >= TARGETING.threatBreak;
    if ((holding && !broke) || bestScore < curScore + TARGETING.margin[key]) best = cur;
  }
  const chosen = best;
  if ((chosen?.id ?? 0) !== e.targetId) {
    e.lockedSince = w.tick + sec(TARGETING.minHold[key]);
    e.farT = 0;
  }
  e.targetId = chosen?.id ?? 0;
  e.lockedId = e.targetId;
  return chosen;
}
