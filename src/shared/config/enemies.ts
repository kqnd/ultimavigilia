/** Configuração tipada de inimigos e chefes. Tempos de ataque em ticks (30 Hz). */

export type EnemyType =
  | 'shambler' | 'runner' | 'werewolf' | 'acolyte' | 'father'
  | 'moonDevourer' | 'patriarch' | 'frostBride'
  | 'alphaWolf' | 'highAcolyte' | 'elderFather'
  | 'falseMoon' | 'abyssTotem' | 'funeralCart' | 'ritualist'
  | 'shadowAcolyte' | 'mistStalker' | 'ossuaryBearer';
export const ENEMY_TYPES: readonly EnemyType[] = [
  'shambler', 'runner', 'werewolf', 'acolyte', 'father',
  'moonDevourer', 'patriarch', 'frostBride',
  'alphaWolf', 'highAcolyte', 'elderFather',
  'falseMoon', 'abyssTotem', 'funeralCart', 'ritualist',
  'shadowAcolyte', 'mistStalker', 'ossuaryBearer',
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
  shadowAcolyte: { name: 'Acólito Sombrio', tier: 'common', hp: 58, speed: 60, radius: 7, poise: 16, staggerTime: 0.8, ccResist: 1, knockResist: 0.1, budget: 4.5, contactDamage: 0 },
  mistStalker: { name: 'Caçador de Névoa', tier: 'elite', hp: 95, speed: 100, radius: 8, poise: 34, staggerTime: 0.8, ccResist: 0.85, knockResist: 0.3, budget: 5.5, contactDamage: 0 },
  ossuaryBearer: { name: 'Portador do Ossário', tier: 'elite', hp: 190, speed: 36, radius: 11, poise: 70, staggerTime: 0.9, ccResist: 0.7, knockResist: 0.6, budget: 7, contactDamage: 0 },
  ritualist: { name: 'Acólito Ritualista', tier: 'elite', hp: 240, speed: 0, radius: 9, poise: 9999, staggerTime: 0, ccResist: 0, knockResist: 1, budget: 0, contactDamage: 0, objective: true, stationary: true },
};

/** Tipo usado para cérebro/arte (minichefes usam o de base). */
export const brainType = (t: EnemyType): EnemyType => ENEMIES[t].base ?? t;
export const isBossTier = (t: EnemyType): boolean => ENEMIES[t].tier === 'boss';

/** Após um stagger, chefes ficam imunes a novo stagger por este tempo (s). */
export const BOSS_STAGGER_IMMUNITY = 5;
/** Retorno decrescente: cada controle dentro da janela reduz a duração do próximo. */
/** Especiais anti-kite: limite simultâneo por tipo em solo (vivos + a surgir). */
export const SPECIAL_CAPS: Partial<Record<EnemyType, number>> = { shadowAcolyte: 2, mistStalker: 2, ossuaryBearer: 3 };
export type SpecialType = 'shadowAcolyte' | 'mistStalker' | 'ossuaryBearer';
export const SPECIAL_TYPES: readonly SpecialType[] = ['shadowAcolyte', 'mistStalker', 'ossuaryBearer'];
/**
 * Frequência dos especiais (v1.3): aparecem desde a onda de introdução, cada um primeiro sozinho;
 * o diretor garante presença mínima e alterna o tipo para não repetir.
 */
export const SPECIAL_RULES = {
  /** Primeira onda em que cada especial pode surgir (introdução isolada). */
  unlockWave: { shadowAcolyte: 4, ossuaryBearer: 6, mistStalker: 8 } as Record<SpecialType, number>,
  /** Limite simultâneo extra por jogador além do primeiro (arredondado para baixo). */
  capPerExtraPlayer: 0.5,
  /** A partir desta onda (e fora de chefes), toda onda comum traz ao menos um especial. */
  guaranteeFrom: 9,
  /** A partir desta onda, ondas comuns tendem a combinar dois tipos. */
  pairFrom: 15,
  /** Chance de uma onda comum a partir de `pairFrom` combinar dois tipos (o trio fica para as ondas marcadas). */
  pairChance: 0.6,
} as const;
/** Limite simultâneo de um especial para N jogadores. */
export const specialCap = (t: EnemyType, players: number): number | undefined => {
  const base = SPECIAL_CAPS[t];
  if (base === undefined) return undefined;
  return base + Math.floor(Math.max(0, players - 1) * SPECIAL_RULES.capPerExtraPlayer);
};

/** Chefes e minichefes: alvo prioritário inteligente, travado até provocação ou queda. */
export const BOSS_AI = {
  /** Peso por alcance da classe (maior = mais visado). */
  rangePriority: { ranged: 3, mid: 2, melee: 1 },
  /** Penalidade por distância de caminho (por px). */
  distanceWeight: 0.004,
  /** Após provocação, o chefe fica travado no provocador por este tempo (s). */
  tauntLock: 6,
  /** Perseguição: alvo além desta distância por este tempo faz o chefe acelerar. */
  pursuitDistance: 200, pursuitDelay: 1.5, pursuitSpeedMul: 1.3,
  /**
   * Ameaça: dano recente ao chefe entra na pontuação de alvo (com decaimento exponencial),
   * para não perseguir um único jogador à distância pelo resto da luta enquanto outros
   * batem nele de perto. `threatWindow` é a janela de decaimento (s, mesmo estilo de
   * HEAL_RULES.recentWindow); `threatWeight` converte ameaça acumulada em pontos de
   * prioridade (mesma escala de rangePriority/distanceWeight).
   */
  threatWindow: 8, threatWeight: 0.0016,
  /**
   * A cada `retargetSeconds` sem provocação, o chefe reavalia o alvo do zero (ameaça +
   * alcance + distância) mesmo com o alvo atual ainda vivo — evita perseguição infinita de
   * um único jogador quando há vários de longo alcance. `switchMargin` exige vantagem
   * mínima do novo alvo para trocar, evitando alternância por diferenças marginais.
   */
  retargetSeconds: 14, switchMargin: 1.2,
} as const;

export const CC_DR = { window: 6, factor: 0.5, minMul: 0.15 } as const;

export const ATK = {
  shambler: { swipe: { windup: 16, active: 3, recovery: 14, damage: 9, range: 24, arc: 100, cooldown: 1.1 } },
  runner: { lunge: { windup: 10, dashTicks: 8, dashSpeed: 250, recovery: 16, damage: 7, triggerRange: 84, hitRadius: 12, cooldown: 1.6 } },
  werewolf: {
    pounce: { windup: 18, airTicks: 12, recovery: 16, damage: 18, landRadius: 30, maxRange: 180, minRange: 60, cooldown: 3.5, minibossWindup: 26, minibossStun: 0.6 },
    claw: { windup: 10, active: 3, recovery: 12, damage: 12, range: 32, arc: 110, cooldown: 0.9 },
  },
  acolyte: {
    orb: { windup: 22, recovery: 12, damage: 12, speed: 150, radius: 6, range: 330, cooldown: 2.4 },
    rune: { windup: 34, recovery: 16, damage: 16, radius: 36, cooldown: 6.5, maxRange: 260 },
    keepMin: 130,
    keepMax: 220,
  },
  father: {
    slam: { windup: 22, active: 4, recovery: 18, damage: 22, range: 44, arc: 140, cooldown: 2.2, minibossWindup: 30, minibossStun: 0.6 },
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
    /**
     * Raios Lunares: pilares de pedra sobem primeiro (cobertura) e depois os raios explodem em
     * linha a partir do chefe. Quem está atrás de um pilar (sem linha de visão do chefe) não leva dano.
     */
    moonRays: {
      windup: 44, recovery: 24, damage: 24, length: 360, width: 30, rays: 3, phase2Rays: 5, segments: 9, cooldown: 10,
      pillars: 3, pillarDelay: 16, pillarSeconds: 14, pillarRing: [90, 190],
      /** Fase 3 (lua cheia): mais raios, 3 ondas, um pilar a mais e o ataque volta mais cedo. */
      phase3Rays: 6, phase3Pillars: 4, phase3CooldownMul: 0.6,
    },
    /** Fração de vida em que entra a fase 3. */
    phase3At: 0.25,
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
    /** Fendas do Abismo: buracos que puxam e ferem; surgem depois do aviso e ficam por alguns segundos. */
    rift: { windup: 36, recovery: 20, holes: 2, phase2Holes: 4, radius: 56, warn: 42, activeSeconds: 7, tickEvery: 15, tickDamage: 8, pull: 95, cooldown: 12, scatter: 170 },
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
    /** Campo de Gelo: manchas que ficam no chão (lentidão + dano por pulso) depois do aviso. */
    frostField: { windup: 34, recovery: 18, patches: 4, phase2Patches: 6, radius: 52, warn: 40, activeSeconds: 8, tickEvery: 15, tickDamage: 6, slow: 0.55, scatter: 150, cooldown: 11 },
    /** Muralha de Gelo: linha de pilares entre ela e o alvo; bloqueia estilhaços e divide a arena. */
    iceWall: { windup: 30, recovery: 18, pillars: 5, spacing: 34, ahead: 110, delay: 18, pillarSeconds: 10, cooldown: 13 },
  },
  falseMoon: { pulse: { interval: 6, windup: 1.2, radius: 60, damage: 12 }, damageReductionPerMoon: 0.2, minDamageMul: 0.2, exposedTime: 12, exposedDamageMul: 1.3, relightDelay: 25 },
  abyssTotem: { orb: { interval: 4, speed: 150, damage: 12, radius: 6, range: 300 } },
  ritualist: { channel: 40 },
  /** Acólito Sombrio — Condutor da Caçada: suporte que acelera a horda (Marcha Sombria). */
  shadowAcolyte: {
    march: {
      cooldown: 10, windup: 36, recovery: 10, radius: 150, duration: 5,
      /** Bônus de velocidade por categoria (não acumula; nova aplicação só renova a duração). */
      commonBonus: 0.2, eliteBonus: 0.1, bossBonus: 0.08,
      /** Peso mínimo de aliados perseguindo (comum 1, elite 2) para valer a conjuração. */
      minAllyWeight: 3,
      /** Aliados a menos disto do próprio alvo "já chegaram" e não contam. */
      arrivedDistance: 70,
      /** Outro Acólito conjurando a esta distância bloqueia a conjuração (mesmo grupo). */
      exclusiveRadius: 220,
      /** Primeira avaliação após surgir (s) e intervalo entre reavaliações quando falha (ticks). */
      firstDelay: 3, retryTicks: 20,
    },
    bolt: { windup: 20, recovery: 12, damage: 7, speed: 140, radius: 5, range: 300, cooldown: 4 },
    /**
     * Ferida Profana: canaliza ~0,9 s com símbolo no alvo e linha até o Acólito, depois lança um
     * pulso reto (não teleguiado). Se acertar: -70% de cura por 4 s (o primeiro 0,75 s bloqueia
     * toda a cura, claramente indicado). Não acumula; nova aplicação só renova até o limite.
     */
    wound: {
      cooldown: 11, windup: 27, lockTicks: 7, recovery: 14, firstDelay: 5,
      range: 260, speed: 230, radius: 7, damage: 4,
      duration: 4, blockSeconds: 0.75, reduction: 0.7,
      /** Prefere quem curou pelo menos isto nos últimos segundos (senão, o alvo mais próximo). */
      minRecentHeal: 6,
      /** Não relança em quem ainda tem mais que isto de Ferida (s). */
      skipIfRemaining: 1.5,
      /** Intervalo mínimo entre Marcha e Ferida do mesmo Acólito (s). */
      spacing: 1.2,
    },
    keepMin: 150, keepMax: 250, fleeMelee: 95, coverOffset: 42, repositionSeconds: 1.6, evalTicks: 15,
  },
  /** Caçador de Névoa: flanqueia e salta sobre quem atira à distância. */
  mistStalker: {
    leap: {
      cooldown: 5.5, windup: 16, airTicks: 11, recovery: 30, damage: 20, landRadius: 24, minRange: 70, maxRange: 175,
      /** Antecipação: segundos à frente e deslocamento máximo previsto (px). */
      leadSeconds: 0.45, maxLead: 60,
      /** Só salta com o Caçador dentro da área visível do alvo (meia tela lógica, com folga). */
      viewHalfW: 300, viewHalfH: 165,
      /** Durante a recuperação recebe mais poise (fica exposto). */
      recoverPoiseMul: 2,
      /** Impacto direto (a até `stunRadius` px do centro do pouso): atordoa brevemente. */
      stunRadius: 12, stun: 0.5,
    },
    claw: { windup: 9, active: 2, recovery: 12, damage: 9, range: 22, arc: 100, cooldown: 1.2 },
    /** Fica velado (parcialmente oculto) além desta distância do alvo, fora de ataques. */
    veilDistance: 140,
    /** Desvia da linha de tiro quando o alvo mira nele (rad) dentro deste alcance. */
    dodgeAimAngle: 0.35, dodgeAimRange: 240,
    flankAngle: 0.7, crowdedMelee: 4, retargetTicks: 45,
  },
  /** Portador do Ossário: escudo frontal com vida própria que bloqueia projéteis. */
  ossuaryBearer: {
    shield: {
      hp: 160, arc: 120, turnRate: 2.4,
      /** Frontal: fração do dano que chega ao corpo e ao poise. */
      projBodyMul: 0.1, projPoiseMul: 0.2, meleeBodyMul: 0.4, aoeBodyMul: 0.6,
      /** Dano no escudo por tipo; golpes com poise alto (pesados, investidas) causam mais. */
      projShieldMul: 1, meleeShieldMul: 1.4, aoeShieldMul: 1.5, heavyPoise: 28, heavyShieldMul: 2.5,
    },
    bash: { windup: 18, active: 3, recovery: 16, damage: 16, range: 30, arc: 100, cooldown: 1.8, brokenWindup: 22, brokenStun: 0.5 },
    brokenSpeed: 64, brokenCooldownMul: 0.6,
    /** Não sai da formação atrás de alvos muito distantes; mantém espaço entre Portadores. */
    leashDistance: 380, spacing: 44,
    debrisSeconds: 4,
  },
  funeralCart: { arriveRadius: 70 },
  /** Canalização à distância contra fogueira/altar (ondas avançadas): visível e interrompível. */
  siege: { windup: 48, recovery: 18, cooldown: 7, range: 190 },
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
