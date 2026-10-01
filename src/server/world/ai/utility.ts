/**
 * Utilidade (curvas 0..1 + escolha com recência/ruído) usada para ataques de chefes e
 * minichefes e para o modo de locomoção. Sem alocações pesadas por tick.
 */
import { FAIR, UTILITY } from '../../../shared/config/enemyAI.js';
import { sec } from '../../../shared/constants.js';
import { clamp, hash2 } from '../../../shared/math.js';
import type { Enemy } from '../types.js';
import type { World } from '../world.js';

/** Rampa linear: 0 em `lo`, 1 em `hi` (aceita lo > hi para curvas decrescentes). */
export const ramp = (x: number, lo: number, hi: number): number => clamp((x - lo) / (hi - lo || 1), 0, 1);
export const smooth = (t: number): number => t * t * (3 - 2 * t);
/** Janela: sobe de a a b, platô até c, desce até d. */
export const window4 = (x: number, a: number, b: number, c: number, d: number): number => (x < b ? ramp(x, a, b) : x <= c ? 1 : 1 - ramp(x, c, d));
/** Combina considerações 0..1 com compensação (um 0 isolado não veta por completo). */
export function combine(cs: readonly number[]): number {
  if (!cs.length) return 0;
  let p = 1;
  for (const c of cs) p *= c;
  const mod = 1 - 1 / cs.length;
  return p + (1 - p) * mod * p;
}

export interface AttackOption {
  atk: string;
  ready: boolean;
  /** Nota 0..1 (considerações já combinadas). */
  score: number;
}

/** Ruído determinístico 0..1 (não consome o rng da partida). */
export const noise = (w: World, e: Enemy, salt: number): number => hash2(w.tick, e.id, salt) / 4294967296;

/** Fator de recência: repetir o último ataque é penalizado; os dois anteriores, menos. */
export function recencyFactor(e: Enemy, atk: string): number {
  let f = 1;
  for (let i = 0; i < e.recent.length && i < UTILITY.recency.length; i++) if (e.recent[i] === atk) f *= UTILITY.recency[i] ?? 1;
  return f;
}

/** Escolhe a melhor opção pronta (nota × recência + ruído). null se nenhuma passa do mínimo. */
export function pickOption(w: World, e: Enemy, opts: readonly AttackOption[]): AttackOption | null {
  let best: AttackOption | null = null;
  let bestV: number = UTILITY.min;
  for (let i = 0; i < opts.length; i++) {
    const o = opts[i] as AttackOption;
    if (!o.ready || o.score <= 0) continue;
    const v = o.score * recencyFactor(e, o.atk) + noise(w, e, 31 + i) * UTILITY.jitter;
    if (v > bestV) {
      bestV = v;
      best = o;
    }
  }
  return best;
}

/** Respiro antes do próximo ataque de chefe/minichefe (ticks): janela de reação e de punição. */
export function thinkTicks(w: World, e: Enemy): number {
  const [lo, hi] = FAIR.thinkTicks[e.phase >= 2 ? 2 : 1] ?? FAIR.thinkTicks[1];
  const base = lo + noise(w, e, 7) * (hi - lo);
  return Math.round(base * (e.desperate ? FAIR.desperationThinkMul : 1));
}

/** Registra o ataque iniciado no histórico (chefes/minichefes). */
export function rememberAttack(e: Enemy, atk: string): void {
  e.recent.unshift(atk);
  if (e.recent.length > UTILITY.history) e.recent.length = UTILITY.history;
}

/** Quanto o alvo está fugindo/sendo fustigado de longe (0..1): reage com gap-closer/projétil. */
export function kiteHeat(e: Enemy, pursuitDist: number, d: number): number {
  const far = ramp(d, pursuitDist * 0.55, pursuitDist);
  const hit = e.heatT > 0 ? ramp(e.heatT, 0, sec(UTILITY.heatSeconds)) * 0.6 + 0.4 : 0;
  return Math.max(far, hit * 0.9, e.farT > sec(1) ? 1 : 0);
}
