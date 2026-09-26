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
  bonfire: { hp: 140, radius: 72 },
  ritual: { channelSeconds: 40, failSpawn: ['werewolf', 'werewolf'] as const },
  escort: {
    hp: 150, speed: 46, followRadius: 90, arriveRadius: 60, radius: 7, aloneSpeedMul: 0.4,
    /** Regeneração só fora de combate (sem dano há `regenDelay` s), até `regenCap` da vida. */
    regenDelay: 6, regenPerSecond: 1.5, regenCap: 0.7,
    /** Fração de comuns que caçam o sobrevivente (o resto pressiona jogadores) e alcance de interesse. */
    raiderShare: 0.4, raiderRange: 330,
    /** Alerta sonoro no máximo a cada tantos segundos; "dano grave" = golpe acima desta fração. */
    alarmEvery: 3, heavyHitFrac: 0.08,
    /**
     * Ritmo: emboscadas quando a rota passa de cada marco (fração do caminho). A última é a chegada,
     * mais pesada. Depois de cada emboscada, o diretor segura novos grupos por `calmSeconds`.
     */
    ambushAt: [0.3, 0.6, 0.85] as readonly number[],
    ambushWarnSeconds: 2.5, calmSeconds: 5,
    /** Distâncias do sobrevivente para os pontos de emboscada (nunca em cima dele nem dos jogadores). */
    ambushMin: 130, ambushMax: 210, ambushPlayerSafe: 110, interceptAhead: 170,
    ambushBase: [
      ['shambler', 'shambler', 'runner', 'runner'],
      ['shambler', 'runner', 'runner', 'acolyte', 'shambler'],
      ['shambler', 'shambler', 'runner', 'runner', 'acolyte', 'shambler'],
    ] as readonly (readonly string[])[],
    /** Especial incluído em cada emboscada se já liberado (a final traz dois). */
    ambushSpecials: [['shadowAcolyte'], ['ossuaryBearer'], ['ossuaryBearer', 'shadowAcolyte']] as readonly (readonly string[])[],
  },
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
  altar: { hp: 120, radius: 48 },
  fire: { radius: 72 },
  elite: { seconds: 45 },
  healRatio: 0.35,
  ult: 30,
} as const;

/**
 * Pressão sobre objetivos de área (fogueira e altar): parte da horda recebe a função de ocupar a
 * área; o objetivo perde vida conforme quem está DENTRO dela (categoria × tempo contínuo), com
 * teto por segundo, sem dano fora da área nem depois que o inimigo morre ou sai.
 */
export const SIEGE_RULES = {
  /** Contribuição por categoria (pontos/s antes do teto). */
  perTier: { common: 1, elite: 2.2, miniboss: 3.5, boss: 3 },
  /** Base de dano/s por ponto de contribuição, por objetivo. */
  basePerSecond: { bonfire: 1.6, altar: 1.9 },
  /** Rampa: começa em `rampStart` e cresce até `rampMax` depois de `rampSeconds` contínuos dentro da área. */
  rampStart: 0.6, rampMax: 1.6, rampSeconds: 6,
  /** Teto de dano/s (solo) e escala por jogador extra (não linear). */
  maxPerSecond: { bonfire: 10, altar: 8 },
  perExtraPlayer: 0.25,
  /** Vida escala por jogador extra. */
  hpPerExtraPlayer: 0.3,
  /** Degrau por capítulo (ondas avançadas pressionam mais). */
  chapterMul: [1, 1.15, 1.3] as readonly number[],
  /** Área limpa por este tempo → recuperação lenta e limitada por onda. */
  recoverDelay: 2.5, recoverPerSecond: 1.5, recoverCapPerWave: { bonfire: 24, altar: 18 },
  /** Fração da horda com função de ocupar a área (comuns; elites resistentes entram sempre que possível). */
  share: { bonfire: 0.4, altar: 0.35 },
  maxAttackers: 9, attackersPerExtraPlayer: 3,
  /** Inimigo com função de ocupar ainda luta com quem chega a esta distância dele. */
  defendRadius: 46,
  /** Estados de perigo: crítico com vida < 25% ou pressão ≥ 70% do teto; ameaçado com alguém dentro ou vida < 50%. */
  criticalHp: 0.25, criticalPressure: 0.7, threatenedHp: 0.5,
  /** Canalização à distância liberada a partir desta onda (Acólitos). */
  rangedFromWave: 12,
  siegeDamage: { bonfire: 7, altar: 6 },
  /** Assaltos coordenados: aviso, portões destacados e composição planejada. */
  assault: {
    warnSeconds: 4,
    /** Momentos da onda (fração da fila já liberada) em que um assalto acontece. */
    at: { bonfire: [0.3, 0.7] as readonly number[], altar: [0.55] as readonly number[] },
    /** Altar só recebe assalto a partir desta onda. */
    altarFromWave: 12,
    base: ['runner', 'runner', 'runner', 'shambler', 'shambler', 'shambler'] as readonly string[],
    specials: ['ossuaryBearer', 'shadowAcolyte'] as readonly string[],
    perExtraPlayer: 0.5,
  },
} as const;

/** Incompatibilidades evento × desafio (não sorteados juntos). */
export const INCOMPATIBLE: Partial<Record<WaveEventKind, readonly ChallengeKind[]>> = {
  bonfire: ['fireUntouched', 'altar'],
  escort: ['altar', 'speed', 'fireUntouched'],
  cart: ['fireUntouched'],
  ritual: ['elite'],
};
