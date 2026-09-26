/** Afixos de elite: sistema extensível. Um afixo por inimigo; chance e ondas controladas aqui. */
import type { EnemyType } from './enemies.js';

export type AffixId = 'bloody' | 'armored' | 'furious';
/** Índice 0 = sem afixo (usado no snapshot). */
export const AFFIX_IDS: readonly (AffixId | 'none')[] = ['none', 'bloody', 'armored', 'furious'];

export interface AffixDef {
  id: AffixId;
  /** Nome exibido acima do inimigo. */
  name: string;
  desc: string;
  /** Tipos que podem receber o afixo. */
  types: readonly EnemyType[];
  color: number;
}

export const AFFIXES: Record<AffixId, AffixDef> = {
  bloody: { id: 'bloody', name: 'Sangrento', desc: 'Recupera 50% do dano causado ao jogador, limitado a 8% da vida máxima.', types: ['werewolf', 'alphaWolf'], color: 0xec6a5e },
  armored: { id: 'armored', name: 'Blindado', desc: 'Recebe só 35% do stagger/poise.', types: ['acolyte', 'highAcolyte'], color: 0xa3a9bb },
  furious: { id: 'furious', name: 'Furioso', desc: 'Abaixo de 40% de vida: +50% de velocidade e ataques 40% mais frequentes.', types: ['father', 'elderFather'], color: 0xf6c257 },
};

export const AFFIX_RULES = {
  /** Primeira onda em que afixos aparecem. */
  fromWave: 4,
  /** Chance base e acréscimo por onda (limitada em maxChance). */
  baseChance: 0.2,
  chancePerWave: 0.015,
  maxChance: 0.6,
  bloodyHealRatio: 0.08,
  bloodyLifestealRatio: 0.5,
  armoredPoiseMul: 0.35,
  furiousThreshold: 0.4,
  furiousSpeedMul: 1.5,
  furiousCooldownMul: 0.6,
  /** Recompensas extras de um elite com afixo. */
  reward: { ultToNearby: 8, nearbyRadius: 220, guaranteedHeal: true },
} as const;

export function affixChance(wave: number, bonus = 0): number {
  if (wave < AFFIX_RULES.fromWave) return 0;
  return Math.min(AFFIX_RULES.maxChance, AFFIX_RULES.baseChance + AFFIX_RULES.chancePerWave * (wave - AFFIX_RULES.fromWave) + bonus);
}

export function affixesFor(t: EnemyType): AffixId[] {
  return (Object.keys(AFFIXES) as AffixId[]).filter((k) => AFFIXES[k].types.includes(t));
}
