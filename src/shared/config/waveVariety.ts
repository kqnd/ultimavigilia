/**
 * Variedade procedural das ondas comuns. Cada onda ganha um "plano" gerado de forma determinística
 * a partir de (semente da partida, número da onda) com um Rng PRÓPRIO — nunca o Rng global do
 * mundo — então refazer a onda (checkpoint) ou rodar um teste com a mesma semente dá o mesmo plano.
 *
 * Regras de ouro (ver BALANCEAMENTO.md, "v1.6"):
 * - o orçamento da onda NÃO muda: só a mistura de tipos, o tamanho/ritmo dos grupos e os portões;
 * - só reponderam-se tipos que a onda já declara em `weights` (desbloqueios e limites de especiais
 *   continuam valendo);
 * - ondas de chefe/minichefe (checkpoints) e ondas de respiro/evento ficam sem modificador;
 * - ondas 1–2 (introdução) ficam intactas.
 */
import { ENEMIES, type EnemyType } from './enemies.js';
import type { WaveDef } from './waves.js';
import { Rng } from '../math.js';

/** Arquétipos: o "papel" do inimigo, usado para inclinar a mistura da onda. */
export type Archetype = 'swarm' | 'fast' | 'tank' | 'caster';
export const ARCHETYPES: readonly Archetype[] = ['swarm', 'fast', 'tank', 'caster'];

/** Não há inimigos voadores na campanha: o arquétipo "voador" fica fora do escopo. */
export const ARCHETYPE_OF: Partial<Record<EnemyType, Archetype>> = {
  shambler: 'swarm',
  runner: 'fast',
  mistStalker: 'fast',
  werewolf: 'fast',
  father: 'tank',
  ossuaryBearer: 'tank',
  acolyte: 'caster',
  shadowAcolyte: 'caster',
};

export const ARCHETYPE_NAME: Record<Archetype, string> = { swarm: 'enxame', fast: 'velocistas', tank: 'brutamontes', caster: 'conjuradores' };

export type WaveModifierId = 'horde' | 'elites' | 'siege';

export interface WaveModifierDef {
  name: string;
  /** Aviso mostrado no HUD ao começar a onda. */
  notice: string;
  /** Primeira onda em que pode sair. */
  minWave: number;
  /** Peso no sorteio entre modificadores. */
  weight: number;
}

export const WAVE_MODIFIERS: Record<WaveModifierId, WaveModifierDef> = {
  horde: { name: 'Horda', notice: 'HORDA: muitos inimigos fracos, em grupos maiores e mais seguidos!', minWave: 3, weight: 3 },
  elites: { name: 'Elites', notice: 'ELITES: poucos, mas pesados. Cuidado com os fortes!', minWave: 6, weight: 2 },
  siege: { name: 'Cerco', notice: 'CERCO: os mortos avançam por apenas dois portões!', minWave: 4, weight: 2 },
};

export const VARIETY = {
  /** Primeira onda com inclinação de arquétipo. */
  tiltFromWave: 3,
  /** Multiplicador de peso do arquétipo favorecido. */
  tiltMul: 1.8,
  /** Chance de uma onda elegível receber um modificador. */
  modifierChance: 0.28,
  horde: { commonMul: 1.8, eliteMul: 0.5, groupMin: 1, groupMax: 2, interval: 0.85, maxAlive: 1.15 },
  elites: { eliteMul: 2.2, commonMul: 0.8, groupMax: -1, interval: 1.1 },
  siege: { gates: 2, groupMin: 1, interval: 0.9 },
  /** Ondas com 4+ portões descartam um (direção de ataque variada). */
  dropGateFrom: 4,
} as const;

export interface WavePlan {
  weights: Partial<Record<EnemyType, number>>;
  groupMin: number;
  groupMax: number;
  interval: number;
  maxAlive: number;
  tilt: Archetype | null;
  modifier: WaveModifierId | null;
  /** Índices de `map.spawns` usados nesta onda (null = todos). */
  gateFocus: number[] | null;
}

/** Semente do plano: mistura estável de semente da partida e onda (independente da ordem de chamadas). */
export const planSeed = (seed: number, wave: number): number => (seed ^ Math.imul(wave, 0x7f4a7c15) ^ 0x51ed270b) >>> 0;

/** Ondas de checkpoint (chefe/minichefe) permanecem exatamente como definidas. */
const isFixed = (def: WaveDef): boolean => !!(def.boss || def.miniboss);

/** A onda aceita modificador (não é chefe, respiro nem evento fixo)? */
export const modifierEligible = (wave: number, def: WaveDef): boolean => !isFixed(def) && !def.breather && !def.event && wave >= 3;

export function planWave(wave: number, def: WaveDef, seed: number, gateCount: number, unlocked: (t: EnemyType) => boolean = () => true): WavePlan {
  const plan: WavePlan = {
    weights: { ...def.weights },
    groupMin: def.groupMin,
    groupMax: def.groupMax,
    interval: def.interval,
    maxAlive: def.maxAlive,
    tilt: null,
    modifier: null,
    gateFocus: null,
  };
  if (isFixed(def) || wave < VARIETY.tiltFromWave) return plan;
  const rng = new Rng(planSeed(seed, wave));
  const w = plan.weights;
  const types = (Object.keys(w) as EnemyType[]).filter(unlocked);

  // 1) inclinação de arquétipo (só entre os que a onda já tem)
  const present = ARCHETYPES.filter((a) => types.some((t) => ARCHETYPE_OF[t] === a));
  if (present.length >= 2) {
    const tilt = rng.pick(present);
    plan.tilt = tilt;
    for (const t of types) if (ARCHETYPE_OF[t] === tilt) w[t] = (w[t] ?? 0) * VARIETY.tiltMul;
  }

  // 2) modificador ocasional
  const roll = rng.next();
  const pickRoll = rng.next();
  if (modifierEligible(wave, def) && roll < VARIETY.modifierChance) {
    const ids = (Object.keys(WAVE_MODIFIERS) as WaveModifierId[]).filter((id) => wave >= WAVE_MODIFIERS[id].minWave);
    let r = pickRoll * ids.reduce((s, id) => s + WAVE_MODIFIERS[id].weight, 0);
    let mod = ids[0] as WaveModifierId;
    for (const id of ids) {
      r -= WAVE_MODIFIERS[id].weight;
      if (r <= 0) {
        mod = id;
        break;
      }
    }
    plan.modifier = mod;
    const elite = (t: EnemyType): boolean => ENEMIES[t].tier === 'elite';
    if (mod === 'horde') {
      const H = VARIETY.horde;
      for (const t of types) w[t] = (w[t] ?? 0) * (elite(t) ? H.eliteMul : H.commonMul);
      plan.groupMin += H.groupMin;
      plan.groupMax += H.groupMax;
      plan.interval *= H.interval;
      plan.maxAlive = Math.round(plan.maxAlive * H.maxAlive);
    } else if (mod === 'elites') {
      const E = VARIETY.elites;
      for (const t of types) w[t] = (w[t] ?? 0) * (elite(t) ? E.eliteMul : E.commonMul);
      plan.groupMax = Math.max(plan.groupMin, plan.groupMax + E.groupMax);
      plan.interval *= E.interval;
    } else {
      plan.groupMin = Math.min(plan.groupMax, plan.groupMin + VARIETY.siege.groupMin);
      plan.interval *= VARIETY.siege.interval;
    }
  }

  // 3) direção de ataque: portões usados na onda (embaralhamento Fisher-Yates com o Rng do plano)
  if (gateCount >= 2) {
    const order = Array.from({ length: gateCount }, (_, i) => i);
    for (let i = order.length - 1; i > 0; i--) {
      const j = rng.int(0, i);
      [order[i], order[j]] = [order[j] as number, order[i] as number];
    }
    if (plan.modifier === 'siege') plan.gateFocus = order.slice(0, VARIETY.siege.gates).sort((a, b) => a - b);
    else if (gateCount >= VARIETY.dropGateFrom) plan.gateFocus = order.slice(1).sort((a, b) => a - b);
  }
  return plan;
}

/**
 * Preenche a fila com sorteio ponderado até esgotar o orçamento (o último sorteio pode estourar
 * até o custo do maior inimigo). Idêntico ao laço histórico do diretor: o `rng` consome uma
 * chamada por inimigo, então ondas fixas mantêm a sequência anterior.
 */
export function fillQueue(entries: readonly (readonly [EnemyType, number])[], budget: number, rng: { next(): number }, onPick?: (t: EnemyType) => void): EnemyType[] {
  const out: EnemyType[] = [];
  const total = entries.reduce((s, [, v]) => s + v, 0);
  let guard = 0;
  while (budget > 0.5 && guard++ < 500) {
    let r = rng.next() * total;
    let pick: EnemyType = entries[0]?.[0] ?? 'shambler';
    for (const [t, v] of entries) {
      r -= v;
      if (r <= 0) {
        pick = t;
        break;
      }
    }
    out.push(pick);
    budget -= ENEMIES[pick].budget;
    onPick?.(pick);
  }
  return out;
}
