/**
 * Configuração tipada e centralizada das seis classes.
 * Tempos de golpes em TICKS (30 Hz); cooldowns e durações de efeitos em SEGUNDOS;
 * distâncias em pixels; ângulos de arco em graus.
 */

export type ClassId = 'hunter' | 'mage' | 'tank' | 'vampire' | 'berserker' | 'dog' | 'necromancer';
export const CLASS_IDS: readonly ClassId[] = ['hunter', 'mage', 'tank', 'vampire', 'berserker', 'dog', 'necromancer'];

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
  mace: { windup: 8, active: 3, recovery: 12, damage: 20, range: 36, arc: 110, poise: 34, knockback: 110, stamina: 10, moveMul: 0.45 },
  guard: { arc: 360, moveMul: 0.65, staminaPerDamage: 0.8, minStaminaCost: 5, breakStun: 1.0, perfectTicks: 7, counterBonus: 16, counterRadius: 48, counterKnockback: 170 },
  charge: { cooldown: 9, stamina: 20, distance: 92, ticks: 11, recovery: 8, damage: 18, radius: 23, tauntRadius: 65, duration: 3, bossDuration: 0.8 },
  bastion: { duration: 4, radius: 104, reduction: 0.12, baseDamage: 60, damageRatio: 0.6, bonusCap: 120, bossDamageCap: 95, knockback: 230 },
  wall: { ultPerBlock: 2, blockUltIntervalTicks: 12 },
} as const;

// ---------------------------------------------------------------- VAMPIRO
export const VAMPIRE = {
  claws: { windup: 3, active: 2, recovery: 5, damage: 10, range: 28, arc: 95, poise: 5, knockback: 20, stamina: 6, moveMul: 0.8 },
  chainWindow: 10,
  /** Mordida em cone curto: cada inimigo atingido cura, com teto por uso e teto por segundo. */
  bite: { cooldown: 5.5, windup: 6, active: 2, recovery: 8, damage: 30, range: 42, arc: 110, poise: 14, knockback: 20, stamina: 12, moveMul: 0.55, healRatio: 0.35, healCapPerUse: 32 },
  mist: { cooldown: 7, stamina: 18, distance: 104, ticks: 7, iframes: 7 },
  feast: { windup: 6, recovery: 6, duration: 8, damageBonus: 0.35, lifesteal: 0.15 },
  thirst: { maxStacks: 5, window: 2.0, damagePerStack: 0.06, speedPerStack: 0.03 },
  /** Teto de cura por segundo do Vampiro (mordida + Banquete). */
  healPerSecondCap: 36,
} as const;

// ---------------------------------------------------------------- BERSERKER
export const BERSERKER = {
  /** Combo de machado: dois golpes rápidos e um terceiro brutal, amplo e lento. */
  combo: [
    { windup: 5, active: 2, recovery: 7, damage: 18, range: 38, arc: 120, poise: 14, knockback: 50, stamina: 9, moveMul: 0.6 },
    { windup: 5, active: 2, recovery: 7, damage: 20, range: 38, arc: 120, poise: 16, knockback: 50, stamina: 9, moveMul: 0.6 },
    { windup: 11, active: 3, recovery: 17, damage: 40, range: 44, arc: 190, poise: 46, knockback: 150, stamina: 16, moveMul: 0.25 },
  ],
  comboWindow: 9,
  /** Q — Rasgo Frenético: 4 cortes seguidos em cone curto. */
  frenzy: { cooldown: 6, stamina: 16, windup: 3, hits: 4, gap: 4, recovery: 10, damage: 11, range: 40, arc: 120, swingOffset: 0.25, poise: 8, knockback: 25, moveMul: 0.6 },
  /** E — Salto Brutal: salta até o ponto mirado e esmaga ao pousar. */
  leap: { cooldown: 7, stamina: 18, maxRange: 150, ticks: 12, iframes: 8, radius: 46, damage: 28, poise: 42, knockback: 160, recovery: 10 },
  /** R — Loucura: força máxima com custo claro (dano recebido e exaustão ao final). */
  madness: { windup: 8, recovery: 6, castMoveMul: 0.2, duration: 8, damageBonus: 0.35, attackSpeed: 0.3, damageTaken: 0.2, exhaustion: 3, exhaustSpeedMul: 0.6 },
  /** Passiva — Fúria (0–100): sobe ao causar e ao receber dano; alta Fúria = mais dano e velocidade, mas mais dano recebido. */
  fury: { max: 100, perDamageDealt: 0.35, perDamageTaken: 0.9, decayDelay: 2.5, decayPerSecond: 8, high: 60, maxDamageBonus: 0.35, maxAttackSpeed: 0.2, maxDamageTaken: 0.25, staminaCostMul: 1.25 },
} as const;

// ---------------------------------------------------------------- DOG
export const DOG = {
  shout: { windup: 4, active: 1, recovery: 10, damage: 9, range: 74, arc: 62, poise: 10, knockback: 90, stamina: 3, moveMul: 0.55 },
  /** Pulso Magnético: preparação e recuperação curtas; permite andar a 70% durante o grito. Não aplica lentidão. */
  pulse: { cooldown: 8, windup: 3, recovery: 5, moveMul: 0.7, radius: 100, damage: 14, knockback: 230, poise: 40 },
  polarity: { cooldown: 12, windup: 6, recovery: 8, maxRange: 210, radius: 104, duration: 2.5, pullCommon: 105, pullElite: 35 },
  endScream: { windup: 10, pulses: 3, interval: 15, radius: 150, damage: 40, knockback: 280, poise: 80, recovery: 14 },
  resonance: { max: 20, rangeMul: 1.6, damageMul: 2.0, knockbackMul: 2.0 },
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
  army: { windup: 16, recovery: 10, base: 2, perEssence: 1, maxUnits: 9, hp: 40, duration: 9, speed: 120, damage: 9, explodeRadius: 38, explodeDamage: 30, bossDamageMul: 0.35, bossDamageCapPerCast: 360 },
  /** Limites de entidades: por necromante e globais. */
  maxMinions: 12,
  /** Senhor dos Mortos: segundos extras de duração por acúmulo (a vida extra vem do valor da melhoria). */
  lordExtraSeconds: 2,
  /** Velocidade de movimento durante cada conjuração. */
  moveMul: { bone: 0.65, raise: 0.4, hand: 0.4, army: 0.2 },
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
      basic: { name: 'Golpe de Maça', desc: `Golpe curto e pesado: ${TANK.mace.damage} de dano, grande stagger.` },
      q: { name: 'Égide dos Mortos', desc: `Segure para bloquear em 360° gastando stamina. Bloqueio perfeito prepara um contra-ataque; guarda quebrada atordoa por ${TANK.guard.breakStun}s.` },
      e: { name: 'Investida de Escudo', desc: `Avança ${TANK.charge.distance}px, interrompe e provoca inimigos atingidos. Recarga ${TANK.charge.cooldown}s.` },
      r: { name: 'Última Vigília', desc: `Fica imóvel por ${TANK.bastion.duration}s. Aliados e sobrevivente na área recebem -12% de dano. Detona: ${TANK.bastion.baseDamage} + 60% do dano real sofrido (até ${TANK.bastion.baseDamage + TANK.bastion.bonusCap}). Aperte R novamente para detonar cedo.` },
      passive: { name: 'Almas Presas', desc: `Bloqueios relevantes carregam a suprema; bloqueio perfeito fortalece a próxima maçada.` },
    },
  },
  vampire: {
    id: 'vampire',
    tag: 'Sustento',
    name: 'Vampiro',
    role: 'Agressividade, mobilidade e sustentação',
    difficulty: 2,
    blurb: 'Capa escura, olhos vermelhos e garras. Vive do sangue que arranca da horda.',
    weakness: 'Não regenera sozinho: precisa se expor para curar. Cura limitada por segundo.',
    hp: 110,
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
      q: { name: 'Mordida', desc: `Mordida em cone (${VAMPIRE.bite.arc}°, ${VAMPIRE.bite.range}px): ${VAMPIRE.bite.damage} de dano em cada inimigo; cura ${Math.round(VAMPIRE.bite.healRatio * 100)}% do dano (máx. ${VAMPIRE.bite.healCapPerUse} por uso e ${VAMPIRE.healPerSecondCap}/s). Recarga ${VAMPIRE.bite.cooldown}s.` },
      e: { name: 'Névoa Rubra', desc: `Avanço de ${VAMPIRE.mist.distance}px invulnerável por ${(VAMPIRE.mist.iframes / 30).toFixed(2)}s. Recarga ${VAMPIRE.mist.cooldown}s.` },
      r: { name: 'Banquete', desc: `Por ${VAMPIRE.feast.duration}s: +${VAMPIRE.feast.damageBonus * 100}% de dano e ${VAMPIRE.feast.lifesteal * 100}% de roubo de vida.` },
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
    weakness: `Pouca defesa: com Fúria alta recebe até +${BERSERKER.fury.maxDamageTaken * 100}% de dano; a Loucura cobra exaustão ao terminar.`,
    hp: 135,
    stamina: 110,
    staminaRegen: 34,
    staminaDelay: 0.5,
    speed: 108,
    radius: 7,
    dodge: DODGE_STD,
    ultPerDamage: 0.17,
    color: 0xd9512c,
    texts: {
      basic: { name: 'Machado Brutal', desc: `Três golpes: ${BERSERKER.combo[0].damage} / ${BERSERKER.combo[1].damage} / ${BERSERKER.combo[2].damage}. O terceiro varre ${BERSERKER.combo[2].arc}° e recupera devagar.` },
      q: { name: 'Rasgo Frenético', desc: `${BERSERKER.frenzy.hits} cortes rápidos à frente (${BERSERKER.frenzy.damage} cada), andando enquanto corta. Recarga ${BERSERKER.frenzy.cooldown}s.` },
      e: { name: 'Salto Brutal', desc: `Salta até ${BERSERKER.leap.maxRange}px e esmaga ao pousar: ${BERSERKER.leap.damage} de dano em ${BERSERKER.leap.radius}px e grande stagger. Recarga ${BERSERKER.leap.cooldown}s.` },
      r: { name: 'Loucura', desc: `Por ${BERSERKER.madness.duration}s: Fúria no máximo, +${BERSERKER.madness.damageBonus * 100}% de dano, +${BERSERKER.madness.attackSpeed * 100}% de velocidade de ataque e imune a stagger, mas recebe +${BERSERKER.madness.damageTaken * 100}% de dano. Depois: ${BERSERKER.madness.exhaustion}s de exaustão.` },
      passive: { name: 'Fúria', desc: `Causar e receber dano enche a Fúria. Acima de ${BERSERKER.fury.high}: até +${BERSERKER.fury.maxDamageBonus * 100}% de dano e +${BERSERKER.fury.maxAttackSpeed * 100}% de velocidade, mas até +${BERSERKER.fury.maxDamageTaken * 100}% de dano recebido e golpes mais caros.` },
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
