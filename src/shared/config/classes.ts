/**
 * Configuração tipada e centralizada das seis classes.
 * Tempos de golpes em TICKS (30 Hz); cooldowns e durações de efeitos em SEGUNDOS;
 * distâncias em pixels; ângulos de arco em graus.
 */

export type ClassId = 'hunter' | 'mage' | 'tank' | 'vampire' | 'berserker' | 'dog' | 'necromancer' | 'lapanha' | 'maycon';
export const CLASS_IDS: readonly ClassId[] = ['hunter', 'mage', 'tank', 'vampire', 'berserker', 'dog', 'necromancer', 'lapanha', 'maycon'];

export interface Timing {
  windup: number;
  active: number;
  recovery: number;
}

export interface MeleeSpec extends Timing {
  damage: number;
  range: number;
  arc: number;
  poise: number;
  knockback: number;
  stamina: number;
  /** Multiplicador de velocidade durante o golpe. */
  moveMul: number;
}

export interface ProjectileSpec {
  speed: number;
  damage: number;
  range: number;
  radius: number;
  pierce: number;
  poise: number;
  knockback: number;
}

export interface DodgeSpec {
  cost: number;
  speed: number;
  ticks: number;
  iframes: number;
  cooldown: number;
}

export interface AbilityText {
  name: string;
  desc: string;
}

export interface ClassBase {
  id: ClassId;
  name: string;
  role: string;
  /** Rótulo curto (cartas do lobby). */
  tag: string;
  difficulty: 1 | 2 | 3;
  /** Barra de suprema com nome próprio (ex.: Polpa do Lapanha). */
  ultName?: string;
  blurb: string;
  weakness: string;
  hp: number;
  stamina: number;
  staminaRegen: number;
  staminaDelay: number;
  speed: number;
  radius: number;
  dodge: DodgeSpec;
  /** Carga de suprema por ponto de dano causado. */
  ultPerDamage: number;
  texts: { basic: AbilityText; q: AbilityText; e: AbilityText; r: AbilityText; passive: AbilityText };
  /** Cor de destaque (HUD, indicadores). */
  color: number;
}

/** Alcance de combate de cada classe (prioridade dos chefes e das ameaças anti-kite). */
export type CombatRange = 'melee' | 'mid' | 'ranged';
export const CLASS_RANGE: Record<ClassId, CombatRange> = {
  hunter: 'ranged', mage: 'ranged', necromancer: 'ranged', dog: 'mid', lapanha: 'mid', maycon: 'mid', tank: 'melee', vampire: 'melee', berserker: 'melee',
};
/** Classes corpo a corpo recebem menos dano: compensa ter de ficar dentro do alcance da horda. */
export const MELEE_RULES = { damageTakenMul: 0.88 } as const;

const DODGE_STD: DodgeSpec = { cost: 22, speed: 270, ticks: 9, iframes: 7, cooldown: 4 };

// ---------------------------------------------------------------- CAÇADOR
export const HUNTER = {
  bolt: { windup: 5, active: 1, recovery: 8, stamina: 3, speed: 440, damage: 14, range: 340, radius: 4, pierce: 0, poise: 6, knockback: 30 },
  upgrades: { pierceDamageRetention: 0.75, ricochetDamage: 0.4, ricochetRange: 95, fanSideDamage: 0.5 },
  trap: { cooldown: 8, windup: 6, recovery: 6, maxActive: 3, armTime: 0.5, radius: 18, damage: 20, rootCommon: 2.6, slowElite: 0.5, slowEliteTime: 2.2, lifetime: 30 },
  recoil: { cooldown: 6, stamina: 14, distance: 92, ticks: 8, iframes: 5, bolt: { speed: 520, damage: 32, range: 380, radius: 5, pierce: 6, poise: 25, knockback: 80 } },
  rain: { windup: 10, recovery: 8, maxRange: 270, radius: 66, pulses: 9, interval: 6, damage: 16, poise: 10 },
  mark: { window: 2.2, maxStacks: 5, bonusPerStack: 0.08 },
  surrounded: { radius: 52, count: 4, damageTakenMul: 1.25 },
} as const;

// ---------------------------------------------------------------- MAGO
export const MAGE = {
  missile: { windup: 6, active: 1, recovery: 10, stamina: 3, speed: 320, damage: 16, range: 320, radius: 5, pierce: 0, poise: 8, knockback: 30 },
  empowered: { damageMul: 2.2, splashRadius: 42, splashDamageMul: 0.6 },
  glacial: { cooldown: 10, windup: 8, recovery: 12, maxRange: 230, radius: 58, duration: 4, slow: 0.45, tickDamage: 6, tickInterval: 0.5 },
  blink: { cooldown: 5, stamina: 10, distance: 118, iframes: 5, recovery: 4 },
  rupture: { windup: 36, recovery: 22, maxRange: 250, radius: 98, damageCenter: 130, damageEdge: 60, poise: 120, knockback: 260 },
  convergence: { maxCharges: 1 },
} as const;

// ---------------------------------------------------------------- TANK
export const TANK = {
  mace: { windup: 8, active: 3, recovery: 12, damage: 22, range: 36, arc: 110, poise: 34, knockback: 110, stamina: 10, moveMul: 0.45 },
  /**
   * Juramento: o 3º golpe de maça seguido (dentro da janela) vira o Martelo Sísmico — pancada no
   * chão em 360° que atordoa comuns. Dá ritmo ao básico do Guardião (bate, bate, ESTRONDO).
   */
  quake: { windup: 12, active: 2, recovery: 14, damage: 30, range: 54, arc: 360, poise: 55, knockback: 150, stamina: 14, moveMul: 0.25, stunCommon: 0.7, stunElite: 0.25 },
  comboWindow: 14,
  guard: { arc: 360, moveMul: 0.65, staminaPerDamage: 0.8, minStaminaCost: 5, breakStun: 1.0, perfectTicks: 7, counterBonus: 16, counterRadius: 48, counterKnockback: 170 },
  charge: { cooldown: 9, stamina: 20, distance: 92, ticks: 11, recovery: 8, damage: 18, radius: 23, tauntRadius: 65, duration: 3, bossDuration: 0.8 },
  /**
   * R — Última Vigília (v1.5): o Guardião vira a muralha. Anda devagar levando a área, recebe -50%
   * de dano, ganha escudo ao erguer, provoca tudo em volta a cada segundo e protege aliados em -25%.
   * Ao fim (ou R de novo) detona com o dano que a área absorveu e se cura um pouco.
   */
  bastion: {
    duration: 5, radius: 104, reduction: 0.25, selfReduction: 0.5, moveMul: 0.4, shield: 30,
    tauntEvery: 30, tauntCommon: 1.4, tauntBoss: 0.6,
    baseDamage: 60, damageRatio: 0.6, bonusCap: 140, bossDamageCap: 110, knockback: 230, healOnBurst: 0.1,
  },
  /** Bloqueio perfeito devolve o projétil inimigo com este multiplicador de dano. */
  reflect: { damageMul: 1.6, speed: 340 },
  wall: { ultPerBlock: 2, blockUltIntervalTicks: 12 },
} as const;

// ---------------------------------------------------------------- VAMPIRO
/**
 * v1.3: a cura passa pela função central (HEAL_RULES): usa só dano válido (sem excesso sobre
 * alvos quase mortos, sem objetivos/invulneráveis), com retorno decrescente por alvo extra na
 * mesma ação, teto por uso e teto por segundo. O dano continua generoso; a cura é que ficou
 * dependente de acertar bem e de esquivar.
 */
export const VAMPIRE = {
  claws: { windup: 3, active: 2, recovery: 5, damage: 13, range: 30, arc: 115, poise: 6, knockback: 20, stamina: 6, moveMul: 0.8 },
  chainWindow: 10,
  /** Mordida em cone curto: cura 28% do dano válido (1º alvo integral, extras decrescentes), teto por uso. */
  bite: { cooldown: 5.5, windup: 6, active: 2, recovery: 8, damage: 34, range: 44, arc: 120, poise: 16, knockback: 20, stamina: 12, moveMul: 0.55, healRatio: 0.28, healCapPerUse: 24 },
  /**
   * E — Redemoinho Rubro: gira no lugar liberando pulsos de sangue em 360°.
   * Anda devagar durante o giro, recebe menos dano e cada pulso que acerta gera Sede e cura pouco.
   */
  vortex: {
    cooldown: 8, stamina: 16, windup: 4, pulses: 5, pulseEvery: 6, recovery: 6, radius: 72, damage: 12,
    poise: 6, pull: 45, moveMul: 0.6, damageTaken: 0.75, healRatio: 0.12, healCapPerCast: 16,
  },
  /** R — Banquete: explode em sangue ao conjurar (360°) e depois dá bônus de dano e roubo de vida. */
  feast: { windup: 6, recovery: 6, duration: 8, damageBonus: 0.35, lifesteal: 0.11, burstRadius: 96, burstDamage: 42, burstHealPerHit: 6, burstHealCap: 24 },
  thirst: { maxStacks: 5, window: 2.4, damagePerStack: 0.06, speedPerStack: 0.03 },
  /** Teto de cura por segundo do Vampiro (mordida + redemoinho + Banquete + explosão). */
  healPerSecondCap: 28,
} as const;

// ---------------------------------------------------------------- CURA (função central)
/** Fontes de cura de jogador (telemetria e regras de teto). */
export type HealSource = 'bite' | 'vortex' | 'feast' | 'feastBurst' | 'pickup' | 'reward' | 'bastion' | 'reaper' | 'harvest' | 'harvestHit' | 'perk' | 'bloodlust' | 'madness' | 'brew';
/** Fontes "de combate" (roubo de vida/cura por acerto): consomem o teto por segundo da classe. */
export const COMBAT_HEAL: ReadonlySet<HealSource> = new Set<HealSource>(['bite', 'vortex', 'feast', 'feastBurst', 'harvestHit', 'reaper', 'bloodlust', 'madness']);
export const HEAL_RULES = {
  /** Retorno decrescente por alvo na mesma ação: 1º, 2º, 3º e cada um dos demais. */
  multiTarget: [1, 0.6, 0.35, 0.15] as readonly number[],
  /** Bônus de dano acima de +25% (Sede, Banquete, cartas) não aumentam a cura. */
  basisCapMul: 1.25,
  /** Teto de cura "de combate" por segundo, por classe. */
  combatPerSecond: { hunter: 12, mage: 12, tank: 12, vampire: VAMPIRE.healPerSecondCap, berserker: 16, dog: 12, necromancer: 10, lapanha: 8, maycon: 10 } as Record<ClassId, number>,
  /** Janela usada para medir "cura recente" (alvo preferido da Ferida Profana), em segundos. */
  recentWindow: 3,
} as const;

/** Controle sofrido pelo jogador: atordoamentos raros, anunciados e com resistência temporária. */
export const PLAYER_CC = {
  /** Duração máxima de qualquer atordoamento em jogador (s). */
  maxStun: 0.75,
  /** Depois de um atordoamento: resistência forte por este tempo (s). */
  resist: 2.5,
  /** Durante a resistência, novos atordoamentos viram lentidão curta. */
  resistSlowMul: 0.6,
  resistSlowSeconds: 0.8,
  /** Lentidão genérica recebida (golpes de área/detonações inimigas). */
  slowFloor: 0.4,
} as const;

/** Escudos temporários de jogador (cartas): absorvem dano de inimigos, nunca o custo de vida. */
export const PLAYER_SHIELD = { max: 40 } as const;

// ---------------------------------------------------------------- BERSERKER
export const BERSERKER = {
  /** Combo de machado: dois golpes rápidos e um terceiro brutal, amplo e lento. */
  combo: [
    { windup: 5, active: 2, recovery: 7, damage: 23, range: 40, arc: 120, poise: 14, knockback: 50, stamina: 8, moveMul: 0.65 },
    { windup: 5, active: 2, recovery: 7, damage: 25, range: 40, arc: 120, poise: 16, knockback: 50, stamina: 8, moveMul: 0.65 },
    { windup: 10, active: 3, recovery: 15, damage: 50, range: 48, arc: 200, poise: 50, knockback: 160, stamina: 14, moveMul: 0.3 },
  ],
  comboWindow: 9,
  /**
   * Q — Redemoinho de Fúria: gira o machado em volta de si. Cada pulso gira `spinStep` rad, então
   * os `pulses` cobrem o círculo inteiro (atinge quem está atrás, não só à frente) e o Berserker
   * anda enquanto gira. Acertar qualquer inimigo rende `furyGain` de Fúria na hora: é o Q que
   * acende a passiva, e por isso custa pouca stamina.
   */
  frenzy: { cooldown: 5.5, stamina: 12, windup: 4, pulses: 4, pulseEvery: 5, recovery: 9, damage: 18, range: 50, arc: 170, spinStep: Math.PI / 2, poise: 12, knockback: 35, moveMul: 0.55, furyGain: 15 },
  /** E — Salto Brutal: salta até o ponto mirado e esmaga ao pousar. */
  leap: { cooldown: 6, stamina: 18, maxRange: 160, ticks: 12, iframes: 8, radius: 54, damage: 40, poise: 48, knockback: 170, recovery: 9 },
  /** R — Loucura: força máxima com custo claro (dano recebido e exaustão ao final). */
  madness: { windup: 8, recovery: 6, castMoveMul: 0.2, duration: 9, damageBonus: 0.45, attackSpeed: 0.35, damageTaken: 0.1, ironDamageTaken: 0, exhaustion: 2.5, exhaustSpeedMul: 0.65, lifesteal: 0.1 },
  /**
   * Passiva — Fúria (0–100): sobe ao causar e ao receber dano. Acima de `high` a Fúria é VANTAGEM
   * (mais dano, mais velocidade, golpes mais baratos, stamina volta mais rápido e um pouco mais
   * resistente). O preço não é mais o dano recebido: é ter de continuar no meio da horda, porque
   * fora de combate a Fúria escorre rápido (`decayDelay`/`decayPerSecond`). A Loucura (R) segue
   * sendo o momento de risco de verdade.
   */
  fury: {
    max: 100, perDamageDealt: 0.35, perDamageTaken: 0.9, decayDelay: 2, decayPerSecond: 11, high: 60,
    maxDamageBonus: 0.45, maxAttackSpeed: 0.25,
    staminaCostMulHigh: 0.85, staminaDelayMulHigh: 0.6, damageTakenMulHigh: 0.85,
  },
  /** Sede de Sangue: cada abate do Berserker devolve um pouco de vida (respeita o teto por segundo). */
  bloodlust: { healPerKill: 4, healPerEliteKill: 10 },
} as const;

// ---------------------------------------------------------------- DOG
export const DOG = {
  shout: { windup: 4, active: 1, recovery: 10, damage: 9, range: 74, arc: 62, poise: 10, knockback: 90, stamina: 3, moveMul: 0.55 },
  /** Pulso Magnético: preparação e recuperação curtas; permite andar a 70% durante o grito. Não aplica lentidão. */
  pulse: { cooldown: 8, windup: 3, recovery: 5, moveMul: 0.7, radius: 100, damage: 14, knockback: 230, poise: 40 },
  polarity: { cooldown: 12, windup: 6, recovery: 8, maxRange: 210, radius: 104, duration: 2.5, pullCommon: 105, pullElite: 35 },
  endScream: { windup: 10, pulses: 3, interval: 15, radius: 150, damage: 40, knockback: 280, poise: 80, recovery: 14 },
  resonance: { max: 20, rangeMul: 1.6, damageMul: 2.0, knockbackMul: 2.0 },
  /** Ímã Forte: raio extra por acúmulo (px). */
  magnetRadiusPerStack: 15,
} as const;

// ---------------------------------------------------------------- NECROMANTE
export const NECRO = {
  /** Rajada Óssea: projétil moderado que atravessa 1 inimigo e marca com Ossos. */
  bone: { windup: 6, active: 1, recovery: 10, stamina: 3, speed: 300, damage: 12, range: 300, radius: 5, pierce: 1, poise: 10, knockback: 60, markTime: 5 },
  /** Restos Mortais: Essência gerada por mortes próximas. */
  essence: { max: 7, radius: 170, perCommon: 1, perElite: 2, perBoss: 3, markedBonus: 1 },
  /** Cadáveres recentes (pontos onde é possível erguer servos). */
  corpse: { ttl: 12, maxStored: 16, searchRadius: 150 },
  /** Q — Erguer Morto. */
  raise: { cooldown: 2.5, cost: 2, windup: 8, recovery: 8, maxActive: 3 },
  thrall: { hp: 60, duration: 16, speed: 92, radius: 7, damage: 11, range: 20, attackWindup: 9, attackCooldown: 1.2, aggroRadius: 80, seekRadius: 230, leash: 260 },
  /** E — Mão da Sepultura. */
  hand: { cooldown: 10, castWindup: 6, windup: 12, recovery: 8, maxRange: 220, radius: 54, duration: 3, rootCommon: 1.6, slowElite: 0.4, slowBoss: 0.2, tickInterval: 0.5, tickDamage: 4, markedTickDamage: 10 },
  /** R — Exército dos Sem Nome: consome toda a Essência. */
  army: { windup: 16, recovery: 10, base: 1, perEssence: 1, maxUnits: 6, hp: 30, duration: 6, speed: 120, damage: 7, explodeRadius: 34, explodeDamage: 20, bossDamageMul: 0.3, bossDamageCapPerCast: 220,
    /** Tempo limite: depois de conjurar, a suprema do Necromante não recarrega por este tempo (s). */
    ultLockSeconds: 22 },
  /** Dano causado por servos gera só esta fração de suprema (evita suprema em cadeia). */
  minionUltMul: 0.35,
  /** Limites de entidades: por necromante e globais. */
  maxMinions: 12,
  /** Senhor dos Mortos: segundos extras de duração por acúmulo (a vida extra vem do valor da melhoria). */
  lordExtraSeconds: 2,
  /** Velocidade de movimento durante cada conjuração. */
  moveMul: { bone: 0.65, raise: 0.4, hand: 0.4, army: 0.2 },
} as const;

// ---------------------------------------------------------------- LAPANHA
/**
 * Artilharia de sacrifício: melancias em arco (dano em área com centro e borda), custo de vida
 * voluntário que fortalece as habilidades (retorno decrescente) e uma suprema de regeneração.
 * Tempos em ticks; custos de vida em fração da vida máxima.
 */
export const LAPANHA = {
  /** Ataque básico: melancia pequena em arco (colisão 2D; a altura é só visual). */
  melon: {
    windup: 7, active: 1, recovery: 12, stamina: 9, moveMul: 0.7,
    speed: 290, range: 260, radius: 5, arcHeight: 22,
    centerDamage: 18, edgeDamage: 10, blastRadius: 30, centerRadius: 11,
    poise: 8, edgePoise: 4, knockback: 25,
  },
  /** Q — Melancia Madura: segure para carregar e escolher quanto da vida sacrificar. */
  ripe: {
    cooldown: 6.5, interruptedCooldown: 2,
    chargeMinTicks: 9, chargeMaxTicks: 36, autoThrowTicks: 15,
    minCost: 0.03, maxCost: 0.12, cancelCostFrac: 0.4,
    minDamage: 28, maxDamage: 70, minRadius: 36, maxRadius: 58, centerRadius: 14, edgeMul: 0.55,
    minPoise: 22, maxPoise: 60, minKnockback: 40, maxKnockback: 110,
    /** Curva do bônus (fração da carga)^curve: pequeno sacrifício rende mais por ponto de vida. */
    curve: 0.7,
    maxRange: 240, speed: 230, arcHeight: 40, moveMul: 0.45, throwWindup: 3, throwRecovery: 12,
    /** Chefes/minichefes: só metade do bônus da carga e teto por lançamento. */
    bossBonusMul: 0.5, bossDamageCap: 55,
  },
  /** E — Casca Traiçoeira: armadilha de escorregão; E de novo esmaga a casca com vida. */
  peel: {
    cooldown: 8, windup: 5, recovery: 6, duration: 7, maxActive: 2, triggerRadius: 15, throwRange: 110, armSeconds: 0.3,
    slideSpeed: 200, slideTicks: 16, eliteSlideMul: 0.5, bumpDamage: 4, bumpPoise: 10,
    vulnerableSeconds: 0.6, vulnerableMul: 1.15, staggerPoise: 12,
    eliteSlow: 0.75, eliteSlowSeconds: 1.5, minibossSlow: 0.7, minibossSlowSeconds: 1.2, minibossPoise: 25,
    bossSlow: 0.8, bossSlowSeconds: 1, bossPoise: 20,
    crush: { costFrac: 0.05, damage: 22, radius: 38, slow: 0.7, slowSeconds: 1.2, poise: 14 },
    /** Cascata de Cascas: casca secundária menor, curta e não detonável. */
    cascade: { duration: 3, triggerRadius: 11 },
  },
  /** R — Safra Abençoada: come um pedaço e regenera ao longo do tempo (mais forte com pouca vida). */
  harvest: {
    windup: 20, recovery: 6, moveMul: 0.35, duration: 8,
    baseRegen: 0.04, lowHpBonus: 0.02, maxRegen: 0.06, tickEvery: 6,
    attackSpeed: 0.15, costMul: 0.75, centerHeal: 2, hitHealPerSecond: 8,
    /** Último Pedaço: abaixo de 20% a regeneração sobe até passar de 35%. */
    lastPiece: { below: 0.2, until: 0.35 },
  },
  /** Polpa (0–100): carrega a suprema. Não vem de cura, de dano sofrido nem do próprio sacrifício além do teto. */
  pulp: { max: 100, center: 3, edge: 1, bigMul: 1.5, perActionCap: 8, perHpSacrificed: 0.5, sacrificeCapPerAction: 6 },
  /** Cartas específicas. */
  cards: {
    frozenSlow: 0.8, frozenSeconds: 1,
    seeds: { count: 3, damage: 4, range: 60, speed: 200 },
    heartMin: 4, heartShield: 12, heartSeconds: 4, heartCooldown: 10,
    precise: { center: 0.2, edge: -0.2 },
    wetFloor: { radius: 22, seconds: 2.5, slow: 0.7, maxActive: 3 },
    lastPieceBonus: 0.015,
    fair: { wideRadius: 1.35, wideDamage: 0.8, denseRadius: 0.75, denseCenter: 1.25 },
  },
} as const;

/** Custo de vida (fração da vida máxima) da Melancia Madura para uma carga 0–1. */
export const ripeCostFrac = (charge: number): number => LAPANHA.ripe.minCost + (LAPANHA.ripe.maxCost - LAPANHA.ripe.minCost) * Math.max(0, Math.min(1, charge));
/** Força (0–1) da Melancia Madura com retorno decrescente. */
export const ripePower = (charge: number): number => Math.pow(Math.max(0, Math.min(1, charge)), LAPANHA.ripe.curve);

// ---------------------------------------------------------------- MAYCON
/**
 * Controle de área do alto de um tapete voador. Garrafas que respingam e desaceleram, fumaça que
 * sufoca a horda (e engole projéteis), voo rasante que abre corredores e uma rodada de cachaça em
 * chamas que puxa tudo para o centro. A passiva (Visão Sombria) marca quem ele controla: marcados
 * recebem mais dano de toda a equipe — é assim que o Maycon "causa" dano.
 */
export const MAYCON = {
  /** Básico: garrafa arremessada que estoura no primeiro inimigo (respingo e lentidão). */
  bottle: {
    windup: 6, active: 1, recovery: 11, stamina: 4, moveMul: 0.75,
    speed: 310, damage: 11, range: 250, radius: 5, poise: 8, knockback: 25,
    splash: 30, splashDamage: 7, slow: 0.7, slowSeconds: 1.2,
  },
  /** Q — Bomba de Fumaça: arremessada no ponto mirado; nuvem que sufoca, atordoa na entrada e apaga projéteis. */
  choke: {
    cooldown: 9, windup: 7, recovery: 8, moveMul: 0.5, maxRange: 220, speed: 260,
    radius: 72, duration: 3.5, slow: 0.5, tickInterval: 0.5, tickDamage: 4,
    stunCommon: 0.7, stunElite: 0.3, poise: 18,
  },
  /** E — Voo Rasante: o tapete corta a horda e joga os inimigos para os lados. */
  flight: {
    cooldown: 8, stamina: 14, distance: 128, ticks: 10, iframes: 6, recovery: 6,
    width: 26, damage: 14, knockback: 150, poise: 26, slow: 0.6, slowSeconds: 1.6,
  },
  /** R — Rodada da Casa: vira a garrafa e cospe um anel de cachaça em chamas que puxa a horda para o centro. */
  brew: {
    windup: 20, recovery: 8, castMoveMul: 0.15, duration: 6, radius: 124,
    pullCommon: 80, pullElite: 28, slow: 0.55, tickEvery: 15, tickDamage: 10, bossDamageMul: 0.6,
    allyHealPerSecond: 3,
  },
  /** Passiva — Visão Sombria: controlados por ele ficam marcados (+dano recebido de todos). */
  darkSight: { seconds: 3, damageMul: 1.12 },
} as const;

export const CLASSES: Record<ClassId, ClassBase> = {
  hunter: {
    id: 'hunter',
    tag: 'À distância',
    name: 'Caçador',
    role: 'Dano à distância e preparação',
    difficulty: 2,
    blurb: 'Capuz, sobretudo e besta. Prepara o terreno com armadilhas e pune alvos marcados.',
    weakness: `Cercado por ${HUNTER.surrounded.count}+ inimigos, recebe +${Math.round((HUNTER.surrounded.damageTakenMul - 1) * 100)}% de dano.`,
    hp: 85,
    stamina: 100,
    staminaRegen: 34,
    staminaDelay: 0.5,
    speed: 108,
    radius: 7,
    dodge: DODGE_STD,
    ultPerDamage: 0.2,
    color: 0x6fae5b,
    texts: {
      basic: { name: 'Virote', desc: `Disparo de besta na direção do mouse: ${HUNTER.bolt.damage} de dano.` },
      q: { name: 'Armadilha de Prata', desc: `Até ${HUNTER.trap.maxActive} armadilhas. Prende comuns por ${HUNTER.trap.rootCommon}s e desacelera elites em ${HUNTER.trap.slowElite * 100}%. Recarga ${HUNTER.trap.cooldown}s.` },
      e: { name: 'Recuo Preciso', desc: `Salta ${HUNTER.recoil.distance}px para trás e dispara um virote perfurante de ${HUNTER.recoil.bolt.damage}. Recarga ${HUNTER.recoil.cooldown}s.` },
      r: { name: 'Chuva de Prata', desc: `${HUNTER.rain.pulses} saraivadas de ${HUNTER.rain.damage} de dano na área indicada.` },
      passive: { name: 'Presa Marcada', desc: `Acertos seguidos no mesmo alvo acumulam marcas (máx. ${HUNTER.mark.maxStacks}): +${HUNTER.mark.bonusPerStack * 100}% de dano por marca.` },
    },
  },
  mage: {
    id: 'mage',
    tag: 'Área',
    name: 'Mago',
    role: 'Dano em área e controle do campo',
    difficulty: 3,
    blurb: 'Manto gasto, cajado e runas. Transforma grupos agrupados em cinzas.',
    weakness: 'Pouca vida e recuperação longa após os feitiços fortes.',
    hp: 74,
    stamina: 90,
    staminaRegen: 30,
    staminaDelay: 0.6,
    speed: 98,
    radius: 7,
    dodge: DODGE_STD,
    ultPerDamage: 0.14,
    color: 0x8a6cf0,
    texts: {
      basic: { name: 'Projétil Arcano', desc: `Orbe arcano: ${MAGE.missile.damage} de dano.` },
      q: { name: 'Selo Glacial', desc: `Área de ${MAGE.glacial.radius}px por ${MAGE.glacial.duration}s: -${MAGE.glacial.slow * 100}% de velocidade e ${MAGE.glacial.tickDamage} de dano a cada ${MAGE.glacial.tickInterval}s. Recarga ${MAGE.glacial.cooldown}s.` },
      e: { name: 'Passo Etéreo', desc: `Teleporte curto de até ${MAGE.blink.distance}px (não atravessa paredes). Recarga ${MAGE.blink.cooldown}s.` },
      r: { name: 'Ruptura Arcana', desc: `Após ${(MAGE.rupture.windup / 30).toFixed(1)}s de preparação, explosão de ${MAGE.rupture.damageCenter} (centro) a ${MAGE.rupture.damageEdge} (borda).` },
      passive: { name: 'Convergência', desc: `Alternar entre Q e E fortalece o próximo básico: ×${MAGE.empowered.damageMul} de dano e explosão.` },
    },
  },
  tank: {
    id: 'tank',
    tag: 'Proteção',
    name: 'Guardião',
    role: 'Proteção, bloqueio e controle',
    difficulty: 1,
    blurb: 'Armadura pesada e escudo enorme. Segura a linha para os outros brilharem.',
    weakness: 'Pouca mobilidade e dano sustentado baixo.',
    hp: 175,
    stamina: 120,
    staminaRegen: 30,
    staminaDelay: 0.7,
    speed: 84,
    radius: 8,
    dodge: { cost: 28, speed: 210, ticks: 9, iframes: 6, cooldown: 6 },
    ultPerDamage: 0.09,
    color: 0x7f93b0,
    texts: {
      basic: { name: 'Golpe de Maça', desc: `Golpe curto e pesado: ${TANK.mace.damage} de dano, grande stagger. O 3º golpe seguido vira o Martelo Sísmico: ${TANK.quake.damage} de dano em 360° (${TANK.quake.range}px) e atordoa comuns por ${TANK.quake.stunCommon}s.` },
      q: { name: 'Égide dos Mortos', desc: `Segure para bloquear em 360° gastando stamina. Bloqueio perfeito prepara um contra-ataque e DEVOLVE projéteis (×${TANK.reflect.damageMul} de dano); guarda quebrada atordoa por ${TANK.guard.breakStun}s.` },
      e: { name: 'Investida de Escudo', desc: `Avança ${TANK.charge.distance}px, interrompe e provoca inimigos atingidos. Recarga ${TANK.charge.cooldown}s.` },
      r: { name: 'Última Vigília', desc: `Por ${TANK.bastion.duration}s vira a muralha: anda devagar levando a área, recebe -${TANK.bastion.selfReduction * 100}% de dano, ganha escudo de ${TANK.bastion.shield}, não é atordoado e provoca tudo em volta a cada segundo. Aliados na área recebem -${TANK.bastion.reduction * 100}% de dano. Detona: ${TANK.bastion.baseDamage} + 60% do dano absorvido (até ${TANK.bastion.baseDamage + TANK.bastion.bonusCap}) e cura ${TANK.bastion.healOnBurst * 100}% da vida. R de novo detona cedo.` },
      passive: { name: 'Almas Presas', desc: `Bloqueios relevantes carregam a suprema; bloqueio perfeito fortalece a próxima maçada e rebate projéteis.` },
    },
  },
  vampire: {
    id: 'vampire',
    tag: 'Sustento',
    name: 'Vampiro',
    role: 'Brigador corpo a corpo: dano em área e sustentação',
    difficulty: 2,
    blurb: 'Capa escura, olhos vermelhos e garras. Vive do sangue que arranca da horda.',
    weakness: `Não regenera sozinho: precisa acertar para curar. Vários alvos curam cada vez menos e o total é limitado a ${VAMPIRE.healPerSecondCap} por segundo.`,
    hp: 125,
    stamina: 100,
    staminaRegen: 36,
    staminaDelay: 0.45,
    speed: 116,
    radius: 7,
    dodge: DODGE_STD,
    ultPerDamage: 0.2,
    color: 0xc0283c,
    texts: {
      basic: { name: 'Garras', desc: `Sequência rápida de garras: ${VAMPIRE.claws.damage} de dano por golpe.` },
      q: { name: 'Mordida', desc: `Mordida em cone (${VAMPIRE.bite.arc}°, ${VAMPIRE.bite.range}px): ${VAMPIRE.bite.damage} de dano em cada inimigo. Cura ${Math.round(VAMPIRE.bite.healRatio * 100)}% do dano válido no 1º alvo; os seguintes curam ${HEAL_RULES.multiTarget.slice(1).map((m) => `${Math.round(m * 100)}%`).join(', ')} disso (máx. ${VAMPIRE.bite.healCapPerUse} por uso). Recarga ${VAMPIRE.bite.cooldown}s.` },
      e: { name: 'Redemoinho Rubro', desc: `Gira liberando ${VAMPIRE.vortex.pulses} pulsos de sangue em 360° (${VAMPIRE.vortex.radius}px): ${VAMPIRE.vortex.damage} de dano cada (${VAMPIRE.vortex.pulses * VAMPIRE.vortex.damage} no total), puxa os inimigos, gera Sede e cura ${Math.round(VAMPIRE.vortex.healRatio * 100)}% do dano válido (máx. ${VAMPIRE.vortex.healCapPerCast} por giro). Recebe -${Math.round((1 - VAMPIRE.vortex.damageTaken) * 100)}% de dano durante o giro. Recarga ${VAMPIRE.vortex.cooldown}s.` },
      r: { name: 'Banquete', desc: `Explode em sangue (${VAMPIRE.feast.burstRadius}px, ${VAMPIRE.feast.burstDamage} de dano, cura até ${VAMPIRE.feast.burstHealCap}). Depois, por ${VAMPIRE.feast.duration}s: +${VAMPIRE.feast.damageBonus * 100}% de dano e ${Math.round(VAMPIRE.feast.lifesteal * 100)}% de roubo de vida corpo a corpo. Toda cura do Vampiro respeita ${VAMPIRE.healPerSecondCap} por segundo.` },
      passive: { name: 'Sede', desc: `Golpes seguidos acumulam Sede (máx. ${VAMPIRE.thirst.maxStacks}): +${VAMPIRE.thirst.damagePerStack * 100}% de dano e +${VAMPIRE.thirst.speedPerStack * 100}% de velocidade cada.` },
    },
  },
  berserker: {
    id: 'berserker',
    tag: 'Fúria',
    name: 'Berserker',
    role: 'Corpo a corpo agressivo, alto risco e alto dano',
    difficulty: 2,
    blurb: 'Machado, peles e cicatrizes. Quanto mais sangra e faz sangrar, mais forte e mais imprudente fica.',
    weakness: 'Pouca defesa e nenhum alcance: só existe dentro da horda. Sem bater, a Fúria escorre em segundos; a Loucura cobra exaustão ao terminar.',
    hp: 150,
    stamina: 130,
    staminaRegen: 40,
    staminaDelay: 0.4,
    speed: 108,
    radius: 7,
    dodge: DODGE_STD,
    ultPerDamage: 0.17,
    color: 0xd9512c,
    texts: {
      basic: { name: 'Machado Brutal', desc: `Três golpes: ${BERSERKER.combo[0].damage} / ${BERSERKER.combo[1].damage} / ${BERSERKER.combo[2].damage}. O terceiro varre ${BERSERKER.combo[2].arc}° e recupera devagar.` },
      q: { name: 'Redemoinho de Fúria', desc: `Gira o machado em volta de si: ${BERSERKER.frenzy.pulses} pulsos de ${BERSERKER.frenzy.damage} de dano (${BERSERKER.frenzy.pulses * BERSERKER.frenzy.damage} no total) em ${BERSERKER.frenzy.range}px ao redor, andando enquanto gira. Acertar rende +${BERSERKER.frenzy.furyGain} de Fúria na hora. Custa só ${BERSERKER.frenzy.stamina} de stamina. Recarga ${BERSERKER.frenzy.cooldown}s.` },
      e: { name: 'Salto Brutal', desc: `Salta até ${BERSERKER.leap.maxRange}px e esmaga ao pousar: ${BERSERKER.leap.damage} de dano em ${BERSERKER.leap.radius}px e grande stagger. Recarga ${BERSERKER.leap.cooldown}s.` },
      r: { name: 'Loucura', desc: `Por ${BERSERKER.madness.duration}s: Fúria no máximo, +${BERSERKER.madness.damageBonus * 100}% de dano, +${BERSERKER.madness.attackSpeed * 100}% de velocidade de ataque, ${BERSERKER.madness.lifesteal * 100}% de roubo de vida e imune a stagger, mas recebe +${BERSERKER.madness.damageTaken * 100}% de dano. Depois: ${BERSERKER.madness.exhaustion}s de exaustão.` },
      passive: { name: 'Fúria', desc: `Causar e receber dano enche a Fúria: até +${BERSERKER.fury.maxDamageBonus * 100}% de dano e +${BERSERKER.fury.maxAttackSpeed * 100}% de velocidade de ataque. Acima de ${BERSERKER.fury.high} ela vira vantagem: golpes custam ${Math.round((1 - BERSERKER.fury.staminaCostMulHigh) * 100)}% menos stamina, a stamina volta mais rápido e você recebe ${Math.round((1 - BERSERKER.fury.damageTakenMulHigh) * 100)}% menos dano. Cada abate cura ${BERSERKER.bloodlust.healPerKill} (elites ${BERSERKER.bloodlust.healPerEliteKill}). Parado, a Fúria escorre ${BERSERKER.fury.decayPerSecond} por segundo.` },
    },
  },
  dog: {
    id: 'dog',
    tag: 'Controle',
    name: 'Dog',
    role: 'Controle de grupo com ondas magnéticas',
    difficulty: 2,
    blurb: 'Uma criança de pulmões impossíveis. Cada grito dobra o ar em anéis magnéticos.',
    weakness: 'Pouca vida; entre os gritos depende da proteção da equipe.',
    hp: 72,
    stamina: 90,
    staminaRegen: 34,
    staminaDelay: 0.5,
    speed: 104,
    radius: 6,
    dodge: DODGE_STD,
    ultPerDamage: 0.2,
    color: 0x4fc3d9,
    texts: {
      basic: { name: 'Grito', desc: `Cone de ondas: ${DOG.shout.damage} de dano e empurrão.` },
      q: { name: 'Pulso Magnético', desc: `Grito rápido: onda de ${DOG.pulse.radius}px com ${DOG.pulse.damage} de dano que empurra e interrompe habilidades vulneráveis. Dá para andar durante o grito. Recarga ${DOG.pulse.cooldown}s.` },
      e: { name: 'Polaridade', desc: `Campo de ${DOG.polarity.radius}px que puxa inimigos comuns ao centro por ${DOG.polarity.duration}s. Recarga ${DOG.polarity.cooldown}s.` },
      r: { name: 'GRITO DO FIM', desc: `${DOG.endScream.pulses} pulsos gigantes de ${DOG.endScream.damage} de dano que empurram e destroem projéteis inimigos.` },
      passive: { name: 'Ressonância', desc: `Cada acerto acumula ressonância. Com ${DOG.resonance.max}, o próximo grito tem ×${DOG.resonance.rangeMul} de alcance e ×${DOG.resonance.damageMul} de dano.` },
    },
  },
  necromancer: {
    id: 'necromancer',
    tag: 'Invocação',
    name: 'Necromante',
    role: 'Invocador: controle indireto e gestão de Essência',
    difficulty: 3,
    blurb: 'Capuz puído, livro de pele e um cajado de osso. Transforma os mortos da horda em uma guarda que apodrece.',
    weakness: 'Sem Essência e sem servos, tem pouca pressão e pouca vida.',
    hp: 84,
    stamina: 95,
    staminaRegen: 32,
    staminaDelay: 0.55,
    speed: 100,
    radius: 7,
    dodge: DODGE_STD,
    ultPerDamage: 0.2,
    color: 0xa8d05a,
    texts: {
      basic: { name: 'Rajada Óssea', desc: `Projétil de ${NECRO.bone.damage} de dano que atravessa ${NECRO.bone.pierce} inimigo, empurra e aplica marca de Ossos por ${NECRO.bone.markTime}s.` },
      q: { name: 'Erguer Morto', desc: `Gasta ${NECRO.raise.cost} de Essência para erguer um servo num cadáver próximo à mira (até ${NECRO.raise.maxActive}; o mais antigo cede lugar). Servos duram ${NECRO.thrall.duration}s e atraem inimigos.` },
      e: { name: 'Mão da Sepultura', desc: `Após ${(NECRO.hand.windup / 30).toFixed(1)}s, mãos prendem comuns por ${NECRO.hand.rootCommon}s e desaceleram elites (${NECRO.hand.slowElite * 100}%) por ${NECRO.hand.duration}s. Marcados sofrem ${NECRO.hand.markedTickDamage} por pulso e rendem +${NECRO.essence.markedBonus} de Essência. Recarga ${NECRO.hand.cooldown}s.` },
      r: { name: 'Exército dos Sem Nome', desc: `Consome toda a Essência: ${NECRO.army.base} + 1 por Essência (máx. ${NECRO.army.maxUnits}) mortos avançam por ${NECRO.army.duration}s e explodem (${NECRO.army.explodeDamage}). Contra chefes o dano é limitado.` },
      passive: { name: 'Restos Mortais', desc: `Mortes a até ${NECRO.essence.radius}px geram Essência (comum +${NECRO.essence.perCommon}, elite +${NECRO.essence.perElite}; máx. ${NECRO.essence.max}). Mortes de aliados não contam.` },
    },
  },
  lapanha: {
    id: 'lapanha',
    tag: 'Artilharia',
    name: 'Lapanha',
    role: 'Artilharia de sacrifício e dano em área',
    difficulty: 3,
    ultName: 'Polpa',
    blurb: 'Jovem de Salvador, sorriso aberto e um cesto de melancias. Troca um pouco da própria vida por arremessos que abrem a horda — e ri no meio do caos.',
    weakness: `Sustentação baixa fora da suprema. Cada Melancia Madura custa de ${Math.round(LAPANHA.ripe.minCost * 100)}% a ${Math.round(LAPANHA.ripe.maxCost * 100)}% da vida máxima; mediano contra chefes (bônus da carga pela metade, máx. ${LAPANHA.ripe.bossDamageCap} por lançamento).`,
    hp: 105,
    stamina: 100,
    staminaRegen: 32,
    staminaDelay: 0.5,
    speed: 105,
    radius: 7,
    dodge: DODGE_STD,
    ultPerDamage: 0,
    color: 0x5fae4a,
    texts: {
      basic: { name: 'Arremesso de Melancia', desc: `Melancia em arco até ${LAPANHA.melon.range}px que estoura no primeiro inimigo, parede ou no fim do alcance: ${LAPANHA.melon.centerDamage} de dano no centro e ${LAPANHA.melon.edgeDamage} na borda (${LAPANHA.melon.blastRadius}px). Custa ${LAPANHA.melon.stamina} de stamina; quebra caixas e barris.` },
      q: { name: 'Melancia Madura', desc: `Segure para carregar (até ${(LAPANHA.ripe.chargeMaxTicks / 30).toFixed(1)}s) e solte para lançar no ponto mirado (até ${LAPANHA.ripe.maxRange}px). Custa de ${Math.round(LAPANHA.ripe.minCost * 100)}% a ${Math.round(LAPANHA.ripe.maxCost * 100)}% da vida máxima e causa de ${LAPANHA.ripe.minDamage} a ${LAPANHA.ripe.maxDamage} no centro, raio de ${LAPANHA.ripe.minRadius} a ${LAPANHA.ripe.maxRadius}px. Nunca deixa você abaixo de 1 de vida. Recarga ${LAPANHA.ripe.cooldown}s.` },
      e: { name: 'Casca Traiçoeira', desc: `Joga uma casca (até ${LAPANHA.peel.throwRange}px, dura ${LAPANHA.peel.duration}s, máx. ${LAPANHA.peel.maxActive}): o primeiro inimigo que pisa escorrega na direção em que andava e fica vulnerável (+${Math.round((LAPANHA.peel.vulnerableMul - 1) * 100)}% de dano) por ${LAPANHA.peel.vulnerableSeconds}s. Elites deslizam menos; chefes só ficam lentos. Aperte E de novo para esmagar a casca: ${Math.round(LAPANHA.peel.crush.costFrac * 100)}% da vida, ${LAPANHA.peel.crush.damage} de dano em ${LAPANHA.peel.crush.radius}px e lentidão. Recarga ${LAPANHA.peel.cooldown}s.` },
      r: { name: 'Safra Abençoada', desc: `Precisa de Polpa cheia. Come um pedaço e regenera por ${LAPANHA.harvest.duration}s: ${Math.round(LAPANHA.harvest.baseRegen * 100)}% da vida máxima por segundo, até ${Math.round(LAPANHA.harvest.maxRegen * 100)}% se ativada com pouca vida. Arremessos +${Math.round(LAPANHA.harvest.attackSpeed * 100)}% mais rápidos, custos de vida -${Math.round((1 - LAPANHA.harvest.costMul) * 100)}% e acertos no centro curam ${LAPANHA.harvest.centerHeal} (máx. ${LAPANHA.harvest.hitHealPerSecond}/s). Sem invulnerabilidade; a Polpa não enche durante a Safra.` },
      passive: { name: 'Coração Maduro', desc: `Sacrificar vida fortalece a habilidade com retorno decrescente e nunca derruba você (mínimo 1 de vida). O sacrifício não conta como dano recebido. Acertos no centro geram ${LAPANHA.pulp.center} de Polpa, na borda ${LAPANHA.pulp.edge} (elites e chefes ×${LAPANHA.pulp.bigMul}).` },
    },
  },
  maycon: {
    id: 'maycon',
    tag: 'Controle',
    name: 'Maycon',
    role: 'Controle de área do alto de um tapete voador',
    difficulty: 2,
    ultName: 'Rodada',
    blurb: 'Grandão de bochecha rosada que flutua num tapete persa remendado. Só fala de Hunt: Showdown, sufoca a horda com fumaça e paga a rodada — de cachaça em chamas.',
    weakness: 'Dano próprio baixo: depende de marcar e segurar a horda para a equipe bater. Grande e lento para desviar.',
    hp: 112,
    stamina: 95,
    staminaRegen: 33,
    staminaDelay: 0.5,
    speed: 100,
    radius: 8,
    dodge: DODGE_STD,
    ultPerDamage: 0.22,
    color: 0xe0a83a,
    texts: {
      basic: { name: 'Garrafada', desc: `Arremessa uma garrafa que estoura no primeiro inimigo: ${MAYCON.bottle.damage} de dano, respingo de ${MAYCON.bottle.splashDamage} em ${MAYCON.bottle.splash}px e -${Math.round((1 - MAYCON.bottle.slow) * 100)}% de velocidade por ${MAYCON.bottle.slowSeconds}s.` },
      q: { name: 'Bomba de Fumaça', desc: `Joga uma bomba no ponto mirado (até ${MAYCON.choke.maxRange}px): nuvem de ${MAYCON.choke.radius}px por ${MAYCON.choke.duration}s que atordoa quem entra (comuns ${MAYCON.choke.stunCommon}s), deixa ${Math.round((1 - MAYCON.choke.slow) * 100)}% mais lento, causa ${MAYCON.choke.tickDamage} a cada ${MAYCON.choke.tickInterval}s e APAGA projéteis inimigos. Recarga ${MAYCON.choke.cooldown}s.` },
      e: { name: 'Voo Rasante', desc: `O tapete corta ${MAYCON.flight.distance}px na direção mirada (invulnerável no início): ${MAYCON.flight.damage} de dano, joga os inimigos para os lados e os deixa lentos por ${MAYCON.flight.slowSeconds}s. Recarga ${MAYCON.flight.cooldown}s.` },
      r: { name: 'Rodada da Casa', desc: `Vira a garrafa e cospe um anel de cachaça em chamas (${MAYCON.brew.radius}px, ${MAYCON.brew.duration}s): puxa a horda para o centro, deixa ${Math.round((1 - MAYCON.brew.slow) * 100)}% mais lenta e queima ${MAYCON.brew.tickDamage} a cada ${(MAYCON.brew.tickEvery / 30).toFixed(1)}s. Aliados dentro recuperam ${MAYCON.brew.allyHealPerSecond} de vida por segundo.` },
      passive: { name: 'Visão Sombria', desc: `Todo inimigo que o Maycon desacelera, atordoa ou puxa fica marcado por ${MAYCON.darkSight.seconds}s e recebe +${Math.round((MAYCON.darkSight.damageMul - 1) * 100)}% de dano de toda a equipe.` },
    },
  },
};

/** Parâmetros gerais de combate dos jogadores. */
export const PLAYER_RULES = {
  ultMax: 100,
  ultPerCc: 1.5,
  ultPerRevive: 15,
  ultPerDamageTaken: 0.1,
  downedTime: 22,
  reviveTime: 3,
  reviveRange: 44,
  reviveHpRatio: 0.4,
  respawnHpRatio: 0.6,
  heavyHitStagger: 10,
  inputBufferTicks: 7,
  hurtFlashTicks: 6,
  pingCooldown: 1.5,
} as const;
