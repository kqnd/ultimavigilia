/** Configuração tipada de inimigos e chefes. Tempos de ataque em ticks (30 Hz). */

export type EnemyType =
  | 'shambler' | 'runner' | 'werewolf' | 'acolyte' | 'father'
  | 'moonDevourer' | 'patriarch' | 'frostBride'
  | 'alphaWolf' | 'highAcolyte' | 'elderFather'
  | 'falseMoon' | 'abyssTotem' | 'funeralCart' | 'ritualist';
export const ENEMY_TYPES: readonly EnemyType[] = [
  'shambler', 'runner', 'werewolf', 'acolyte', 'father',
  'moonDevourer', 'patriarch', 'frostBride',
  'alphaWolf', 'highAcolyte', 'elderFather',
  'falseMoon', 'abyssTotem', 'funeralCart', 'ritualist',
];
export type Tier = 'common' | 'elite' | 'boss';

export interface EnemyDef {
  name: string;
  tier: Tier;
  hp: number;
  speed: number;
  radius: number;
  /** Poise máximo: dano de poise acumulado acima disto causa stagger. */
  poise: number;
  staggerTime: number;
  /** Multiplicador de duração de controles (1 = total, 0.3 = forte resistência). */
  ccResist: number;
  /** 0 = empurrado normalmente, 1 = imóvel. */
  knockResist: number;
  budget: number;
  contactDamage: number;
  /** Minichefe: barra no topo da tela, aura e recompensa maior. */
  miniboss?: boolean;
  /** Objetivo (lua falsa, totem, carrinho, ritualista): não conta como inimigo obrigatório da onda. */
  objective?: boolean;
  /** Não se move nem é empurrado. */
  stationary?: boolean;
  /** Cérebro/arte de base (minichefes reutilizam o comportamento do inimigo de origem). */
  base?: EnemyType;
  /** Multiplicador extra de dano (minichefes). */
  damageMul?: number;
}

export const ENEMIES: Record<EnemyType, EnemyDef> = {
  shambler: { name: 'Zumbi Cambaleante', tier: 'common', hp: 34, speed: 38, radius: 8, poise: 12, staggerTime: 0.6, ccResist: 1, knockResist: 0, budget: 1, contactDamage: 0 },
  runner: { name: 'Zumbi Corredor', tier: 'common', hp: 18, speed: 112, radius: 7, poise: 8, staggerTime: 0.5, ccResist: 1, knockResist: 0, budget: 1.3, contactDamage: 0 },
  acolyte: { name: 'Acólito Corrompido', tier: 'common', hp: 44, speed: 58, radius: 7, poise: 14, staggerTime: 0.7, ccResist: 1, knockResist: 0.1, budget: 3, contactDamage: 0 },
  werewolf: { name: 'Lobisomem', tier: 'elite', hp: 150, speed: 94, radius: 11, poise: 60, staggerTime: 0.8, ccResist: 0.6, knockResist: 0.5, budget: 7, contactDamage: 0 },
  father: { name: 'Pai de Família Amaldiçoado', tier: 'elite', hp: 240, speed: 50, radius: 12, poise: 90, staggerTime: 0.9, ccResist: 0.55, knockResist: 0.65, budget: 8, contactDamage: 0 },
  moonDevourer: { name: 'Devorador da Lua', tier: 'boss', hp: 2300, speed: 96, radius: 22, poise: 320, staggerTime: 1.2, ccResist: 0.3, knockResist: 0.92, budget: 0, contactDamage: 0 },
  patriarch: { name: 'Patriarca do Abismo', tier: 'boss', hp: 3400, speed: 62, radius: 24, poise: 420, staggerTime: 1.2, ccResist: 0.25, knockResist: 0.95, budget: 0, contactDamage: 0 },
  frostBride: { name: 'Noiva do Inverno', tier: 'boss', hp: 2800, speed: 70, radius: 20, poise: 360, staggerTime: 1.2, ccResist: 0.3, knockResist: 0.93, budget: 0, contactDamage: 0 },
  alphaWolf: { name: 'Lobisomem Alfa', tier: 'elite', hp: 900, speed: 100, radius: 14, poise: 150, staggerTime: 0.8, ccResist: 0.4, knockResist: 0.8, budget: 0, contactDamage: 0, miniboss: true, base: 'werewolf', damageMul: 1.4 },
  highAcolyte: { name: 'Acólito Supremo', tier: 'elite', hp: 720, speed: 60, radius: 10, poise: 120, staggerTime: 0.8, ccResist: 0.4, knockResist: 0.7, budget: 0, contactDamage: 0, miniboss: true, base: 'acolyte', damageMul: 1.3 },
  elderFather: { name: 'Pai Ancestral', tier: 'elite', hp: 1150, speed: 54, radius: 14, poise: 170, staggerTime: 0.9, ccResist: 0.4, knockResist: 0.85, budget: 0, contactDamage: 0, miniboss: true, base: 'father', damageMul: 1.35 },
  falseMoon: { name: 'Lua Falsa', tier: 'elite', hp: 170, speed: 0, radius: 12, poise: 9999, staggerTime: 0, ccResist: 0, knockResist: 1, budget: 0, contactDamage: 0, objective: true, stationary: true },
  abyssTotem: { name: 'Totem do Abismo', tier: 'elite', hp: 280, speed: 0, radius: 12, poise: 9999, staggerTime: 0, ccResist: 0, knockResist: 1, budget: 0, contactDamage: 0, objective: true, stationary: true },
  funeralCart: { name: 'Carrinho Funerário', tier: 'elite', hp: 460, speed: 24, radius: 15, poise: 9999, staggerTime: 0, ccResist: 0.5, knockResist: 1, budget: 0, contactDamage: 0, objective: true },
  ritualist: { name: 'Acólito Ritualista', tier: 'elite', hp: 240, speed: 0, radius: 9, poise: 9999, staggerTime: 0, ccResist: 0, knockResist: 1, budget: 0, contactDamage: 0, objective: true, stationary: true },
};

/** Tipo usado para cérebro/arte (minichefes usam o de base). */
export const brainType = (t: EnemyType): EnemyType => ENEMIES[t].base ?? t;
export const isBossTier = (t: EnemyType): boolean => ENEMIES[t].tier === 'boss';

/** Após um stagger, chefes ficam imunes a novo stagger por este tempo (s). */
export const BOSS_STAGGER_IMMUNITY = 5;
/** Retorno decrescente: cada controle dentro da janela reduz a duração do próximo. */
export const CC_DR = { window: 6, factor: 0.5, minMul: 0.15 } as const;

export const ATK = {
  shambler: { swipe: { windup: 16, active: 3, recovery: 14, damage: 9, range: 24, arc: 100, cooldown: 1.1 } },
  runner: { lunge: { windup: 10, dashTicks: 8, dashSpeed: 250, recovery: 16, damage: 7, triggerRange: 84, hitRadius: 12, cooldown: 1.6 } },
  werewolf: {
    pounce: { windup: 18, airTicks: 12, recovery: 16, damage: 18, landRadius: 30, maxRange: 180, minRange: 60, cooldown: 3.5 },
    claw: { windup: 10, active: 3, recovery: 12, damage: 12, range: 32, arc: 110, cooldown: 0.9 },
  },
  acolyte: {
    orb: { windup: 22, recovery: 12, damage: 12, speed: 150, radius: 6, range: 330, cooldown: 2.4 },
    rune: { windup: 34, recovery: 16, damage: 16, radius: 36, cooldown: 6.5, maxRange: 260 },
    keepMin: 130,
    keepMax: 220,
  },
  father: {
    slam: { windup: 22, active: 4, recovery: 18, damage: 22, range: 44, arc: 140, cooldown: 2.2 },
    slipper: { windup: 22, recovery: 14, damage: 14, speed: 300, radius: 7, maxRange: 250, cooldown: 4.5 },
    shoutCooldown: 9,
    shoutChance: 0.35,
  },
  moonDevourer: {
    leap: { windup: 20, airTicks: 18, recovery: 20, damage: 28, radius: 64, maxRange: 300, cooldown: 3.5 },
    claws: { windup: 16, active: 3, gap: 9, recovery: 16, damage: 22, range: 70, arc: 150, cooldown: 2.0 },
    howl: { windup: 45, radius: 110, knockback: 280 },
    crescent: { windup: 24, active: 4, recovery: 20, damage: 26, radius: 78, cooldown: 5 },
    phase2Speed: 1.25,
    phase2Leaps: 3,
  },
  patriarch: {
    eruption: { windup: 32, radius: 44, damage: 26, cooldown: 5.5, phase2Waves: 3, waveGap: 12 },
    sweep: { windup: 24, active: 4, recovery: 18, damage: 30, range: 116, arc: 120, cooldown: 3.2 },
    summon: { windup: 30, count: 4, maxAlive: 8, perPhase: 3, cooldown: 14 },
    burst: { windup: 20, count: 16, speed: 130, damage: 14, radius: 7, range: 420, cooldown: 7 },
    dash: { windup: 22, dashTicks: 10, distance: 230, damage: 30, hitRadius: 30, cooldown: 6 },
    transform: { windup: 60 },
    /** Protegido pelos totens: fração do dano que passa enquanto houver totem de pé. */
    shieldedDamageMul: 0.15,
    /** Fase 2: quando os totens caem. Sem totens no mapa, em 50% da vida; com totens de pé, à força em 35%. */
    phase2HpNoTotems: 0.5,
    phase2HpForced: 0.35,
  },
  frostBride: {
    shards: { windup: 20, count: 7, spread: 0.9, speed: 210, damage: 13, radius: 6, range: 360, cooldown: 3.2 },
    nova: { windup: 30, radius: 84, damage: 24, cooldown: 7 },
    spikes: { windup: 26, length: 260, width: 26, segments: 8, damage: 22, cooldown: 6 },
    summon: { windup: 28, count: 4, maxAlive: 10, cooldown: 16 },
    phase2Speed: 1.2,
    /** Fase 2 (estilhaços em leque maior, invocações) a partir desta fração de vida. */
    phase2At: 0.5,
  },
  falseMoon: { pulse: { interval: 6, windup: 1.2, radius: 60, damage: 12 }, damageReductionPerMoon: 0.2, minDamageMul: 0.2, exposedTime: 12, exposedDamageMul: 1.3, relightDelay: 25 },
  abyssTotem: { orb: { interval: 4, speed: 150, damage: 12, radius: 6, range: 300 } },
  ritualist: { channel: 40 },
  funeralCart: { arriveRadius: 70 },
} as const;

/** Falas do Pai de Família Amaldiçoado: bronca doméstica com um pé no além. */
export const FATHER_LINES: readonly string[] = [
  'VOLTA AQUI, MOLEQUE!',
  'VOU CONTAR ATÉ TRÊS!',
  'QUEM DEIXOU A LUZ ACESA?!',
  'NO MEU TEMPO ERA DIFERENTE!',
  'DINHEIRO NÃO NASCE EM ÁRVORE!',
  'VAI FICAR DE CASTIGO!',
  'ISSO AQUI NÃO É HOTEL!',
  'FECHA ESSA PORTA!',
  'UM... DOIS... DOIS E MEIO...',
  'TÁ PENSANDO QUE EU SOU O QUÊ?!',
  'A CONTA DE LUZ QUEM PAGA SOU EU!',
  'ESSE QUARTO TÁ UM CHIQUEIRO!',
  'NÃO ME FAÇA TIRAR O CHINELO!',
  'JÁ TIREI O CHINELO!',
  'QUE HORAS VOCÊ ACHA QUE SÃO?!',
  'MEIA-NOITE É HORA DE CHEGAR?!',
  'VOCÊ NÃO É TODO MUNDO!',
  'ENGOLE ESSE CHORO!',
  'DESLIGA ESSA TELEVISÃO!',
  'TÁ ACHANDO QUE A GELADEIRA É VITRINE?!',
  'QUEM MEXEU NO MEU CONTROLE?!',
  'CHEGOU BOLETO! DE NOVO!',
  'ISSO É HORA DE BRINCAR?!',
  'CADÊ O TROCO DO PÃO?!',
  'TIRA O PÉ DO SOFÁ!',
  'PORTA ABERTA É DINHEIRO PRA RUA!',
  'VAI ACORDAR O BAIRRO INTEIRO!',
  'EU VOU LÁ, HEIN! EU VOU LÁ!',
  'PERGUNTA PRA SUA MÃE!',
  'NA VOLTA A GENTE CONVERSA!',
  'O CHINELO VOLTA. SEMPRE VOLTA.',
  'NEM MORTO EU DESCANSO NESSA CASA!',
];
