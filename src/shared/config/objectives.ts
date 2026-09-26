/**
 * Eventos de onda (objetivos com estado autoritativo) e desafios opcionais.
 * Eventos mudam a onda; desafios são opcionais e dão recompensa extra sem serem necessários para vencer.
 */

export type WaveEventKind = 'bonfire' | 'ritual' | 'escort' | 'cart';
export const WAVE_EVENT_KINDS: readonly WaveEventKind[] = ['bonfire', 'ritual', 'escort', 'cart'];

export interface WaveEventDef {
  kind: WaveEventKind;
  name: string;
  /** Texto curto para o HUD. */
  goal: string;
  success: string;
  failure: string;
}

export const WAVE_EVENTS: Record<WaveEventKind, WaveEventDef> = {
  bonfire: {
    kind: 'bonfire',
    name: 'Proteja a fogueira',
    goal: 'Inimigos perto da fogueira a apagam',
    success: 'Fogueira protegida: equipe cura 30% e ganha +1 carta',
    failure: 'A fogueira quase apagou: inimigos +15% de dano até o fim da onda',
  },
  ritual: {
    kind: 'ritual',
    name: 'Interrompa o ritual',
    goal: 'Mate o Acólito Ritualista antes do fim',
    success: 'Ritual interrompido: +25% de suprema para a equipe',
    failure: 'O ritual se completou: dois lobisomens atravessam o véu',
  },
  escort: {
    kind: 'escort',
    name: 'Escolte o sobrevivente',
    goal: 'Fique perto dele até a fogueira',
    success: 'Sobrevivente salvo: equipe cura 30% e ganha +1 carta',
    failure: 'O sobrevivente caiu: a horda fica mais faminta (+15% de dano)',
  },
  cart: {
    kind: 'cart',
    name: 'Detenha o carrinho funerário',
    goal: 'Destrua o carrinho antes que chegue ao centro',
    success: 'Carrinho destruído: +25% de suprema para a equipe',
    failure: 'O carrinho chegou: caixões se abrem no centro',
  },
};

export const EVENT_RULES = {
  bonfire: { hp: 100, radius: 72, damagePerEnemyPerSecond: 2.2, maxDamagePerSecond: 12 },
  ritual: { channelSeconds: 40, failSpawn: ['werewolf', 'werewolf'] as const },
  escort: { hp: 120, speed: 46, followRadius: 90, arriveRadius: 60, radius: 7, aloneSpeedMul: 0.4 },
  cart: { arriveRadius: 70, failSpawn: 6 },
  failDamageMul: 1.15,
  successHealRatio: 0.3,
  successUlt: 25,
} as const;

// ---------------------------------------------------------------- desafios

export type ChallengeKind = 'noDowns' | 'speed' | 'altar' | 'fireUntouched' | 'elite';
export const CHALLENGE_KINDS: readonly ChallengeKind[] = ['noDowns', 'speed', 'altar', 'fireUntouched', 'elite'];

export type ChallengeReward = 'card' | 'heal' | 'ult';

export interface ChallengeDef {
  kind: ChallengeKind;
  name: string;
  reward: ChallengeReward;
  rewardText: string;
}

export const CHALLENGES: Record<ChallengeKind, ChallengeDef> = {
  noDowns: { kind: 'noDowns', name: 'Ninguém cai nesta onda', reward: 'card', rewardText: '+1 carta no próximo intervalo' },
  speed: { kind: 'speed', name: 'Limpe a onda a tempo', reward: 'ult', rewardText: '+30% de suprema para a equipe' },
  altar: { kind: 'altar', name: 'Proteja o altar', reward: 'heal', rewardText: 'Equipe cura 35% no intervalo' },
  fireUntouched: { kind: 'fireUntouched', name: 'Nada toca a fogueira', reward: 'card', rewardText: '+1 carta no próximo intervalo' },
  elite: { kind: 'elite', name: 'Elimine o elite marcado', reward: 'ult', rewardText: '+30% de suprema para a equipe' },
};

export const CHALLENGE_RULES = {
  /** Chance de uma onda comum (sem chefe) ter desafio. */
  chance: 0.65,
  /** Segundos para "limpe a onda a tempo": base + por orçamento da onda. */
  speedBase: 45,
  speedPerBudget: 1.1,
  altar: { hp: 80, radius: 48, damagePerEnemyPerSecond: 3 },
  fire: { radius: 72 },
  elite: { seconds: 45 },
  healRatio: 0.35,
  ult: 30,
} as const;

/** Incompatibilidades evento × desafio (não sorteados juntos). */
export const INCOMPATIBLE: Partial<Record<WaveEventKind, readonly ChallengeKind[]>> = {
  bonfire: ['fireUntouched', 'altar'],
  escort: ['altar', 'speed', 'fireUntouched'],
  cart: ['fireUntouched'],
  ritual: ['elite'],
};
