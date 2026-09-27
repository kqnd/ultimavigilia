import type { ClassBase, ClassId, HealSource } from '../../shared/config/classes.js';
import type { AffixId } from '../../shared/config/affixes.js';
import type { EnemyDef, EnemyType } from '../../shared/config/enemies.js';
import type { InputFrame, MoveState } from '../../shared/movement.js';
import type { ActionName, EnemyAttackName, EnemyStateName, MatchStats, MinionKind, MinionState, ProjectileKind, ZoneKind } from '../../shared/protocol.js';

export type Slot = 'basic' | 'q' | 'e' | 'r';

export interface Action {
  name: ActionName;
  /** Ticks decorridos. */
  t: number;
  total: number;
  /** Duração (ticks) da antecipação e da janela ativa, já escaladas. */
  wu: number;
  ac: number;
  /** Direção da ação (rad); disparos à distância a atualizam quando o projétil sai. */
  dir: number;
  tx: number;
  ty: number;
  hit: Set<number>;
  /** A partir deste tick o jogador pode encadear básico/esquivar. */
  cancelFrom: number;
  moveMul: number;
  /** Dados específicos da ação. */
  n: number;
  /** Redemoinho do Berserker: a Fúria do giro já foi creditada neste uso. */
  spun?: boolean;
}

export interface Player {
  id: number;
  name: string;
  cls: ClassId;
  base: ClassBase;
  r: number;
  move: MoveState;
  get x(): number;
  get y(): number;
  aim: number;
  aimX: number;
  aimY: number;
  /** Último tick em que disparou um projétil (ameaças anti-kite preferem quem atira). */
  lastShotTick: number;
  /** Suprema bloqueada (Necromante após o Exército) por estes ticks. */
  ultLockT: number;
  hp: number;
  maxHp: number;
  maxStamina: number;
  staminaDelay: number;
  /** 0 vivo, 1 caído, 2 morto (volta na próxima onda). */
  status: 0 | 1 | 2;
  bleed: number;
  reviveProgress: number;
  revivingId: number;
  action: Action | null;
  cd: { q: number; e: number };
  cdMax: { q: number; e: number };
  ult: number;
  iframes: number;
  buffs: {
    /** Berserker: Loucura. */
    madness: number;
    /** Berserker: exaustão após a Loucura. */
    exhausted: number;
    feast: number;
    tauntDr: number;
    guardBroken: number;
    /** Clima: frio (lentidão) e queimadura (dano contínuo). */
    chill: number;
    burn: number;
    /** Resistência a atordoamento (ticks) depois de um atordoamento. */
    stunRes: number;
    /** Lentidão genérica (resistência convertida, detonações). Multiplicador em `slowMul`. */
    slowed: number;
    /** Retirada Tática: bônus de velocidade após esquivar de um ataque. */
    retreat: number;
    /** Lapanha: Safra Abençoada. */
    harvest: number;
  };
  slowMul: number;
  blocking: boolean;
  blockDir: number;
  guardianCharge: number;
  guardianCounter: boolean;
  guardianCounterUntil: number;
  guardianGuardStart: number;
  guardianLastUltBlock: number;
  // passivas
  thirst: number;
  thirstT: number;
  resonance: number;
  convergence: number;
  lastAbility: 'q' | 'e' | null;
  comboStep: number;
  comboT: number;
  /** Berserker: Fúria (0–100) e ticks desde o último combate. */
  rage: number;
  rageIdle: number;
  /** Necromante: Essência. */
  essence: number;
  /** Cartas extras no próximo intervalo (desafios). */
  bonusCards: number;
  /** Cura já aplicada pela mordida em curso (teto por uso). */
  biteHealed: number;
  surrounded: boolean;
  healBudget: number;
  // entrada
  queue: InputFrame[];
  last: InputFrame;
  ack: number;
  held: number;
  buffered: { slot: Slot | 'dodge'; t: number } | null;
  mods: Record<string, number>;
  connected: boolean;
  lastPing: number;
  lastDodgeTick: number;
  stats: MatchStats;
  inBastion: boolean;
  bastionHeal: number;
  /** Ferida Profana: ticks restantes, ticks de bloqueio total e Acólito de origem. */
  woundT: number;
  woundBlockT: number;
  woundBy: number;
  /** Cura recente (decai em ~3 s): alvo preferido da Ferida Profana. */
  recentHeal: number;
  /** Escudo temporário (cartas). */
  shieldHp: number;
  shieldT: number;
  /** Recarga interna de cartas condicionais (Defesa Improvisada, Coração da Melancia). */
  guardCdT: number;
  heartCdT: number;
  /** Pressão Constante: último alvo e acertos seguidos nele. */
  pressureId: number;
  pressureN: number;
  /** Ticks parado (Caçador de Névoa pressiona quem fica parado junto a objetivos). */
  stillT: number;
  /** Lapanha: taxa de regeneração da Safra (fração/s), Melancia Sem Fim disponível, alternância da Feira. */
  harvestRate: number;
  harvestFreeQ: boolean;
  lastPieceOn: boolean;
  fairToggle: boolean;
  /** Orçamento de cura por acerto central na Safra (por segundo). */
  harvestHitBudget: number;
  /** Última fala (limita frequência dos balões). */
  lastSayTick: number;
  /** Lapanha: ticks de carga da Melancia Madura em curso (-1 = sem carga). */
  charge: number;
  /** Telemetria de balanceamento (não vai para os clientes). */
  tele: PlayerTelemetry;
}

export interface PlayerTelemetry {
  heal: Partial<Record<HealSource, number>>;
  /** Cura perdida por vida cheia. */
  wasted: number;
  /** Cura cortada pela Ferida Profana. */
  woundCut: number;
  taken: number;
  lowTicks: number;
  woundsApplied: number;
  woundsAvoided: number;
  woundsInterrupted: number;
  sacrificed: number;
  stuns: number;
  stunsResisted: number;
}

export interface EnemyCC {
  root: number;
  slow: number;
  slowMul: number;
  stun: number;
  pullX: number;
  pullY: number;
  pullStr: number;
  pullT: number;
  drCount: number;
  drUntil: number;
  /** Combo Gélido: rótulo da fonte da lentidão atual ('' = nenhuma) e cooldown do combo (ticks). */
  slowSrc: string;
  freezeCd: number;
}

export interface Enemy {
  id: number;
  type: EnemyType;
  typeIdx: number;
  def: EnemyDef;
  x: number;
  y: number;
  r: number;
  kvx: number;
  kvy: number;
  hp: number;
  maxHp: number;
  dmgMul: number;
  state: EnemyStateName;
  stateT: number;
  atk: EnemyAttackName;
  facing: number;
  tx: number;
  ty: number;
  targetId: number;
  targetT: number;
  cds: Partial<Record<EnemyAttackName, number>>;
  poise: number;
  staggerImmune: number;
  cc: EnemyCC;
  tauntBy: number;
  tauntT: number;
  markBy: number;
  marks: number;
  markT: number;
  phase: number;
  counter: number;
  progressBest: number;
  progressT: number;
  progressTarget: number;
  enraged: boolean;
  shoutCd: number;
  summonsLeft: number;
  hitBy: Set<number>;
  bastionSlow: boolean;
  lastHitTick: number;
  /** Afixo de elite (um por inimigo). */
  affix: AffixId | null;
  /** Necromante: marca de Ossos (quem marcou e ticks restantes). */
  boneBy: number;
  boneT: number;
  /** Maldição do Ritualista: causa menos dano enquanto > 0. */
  cursedT: number;
  /** Servo que o inimigo está atacando (0 = nenhum). */
  minionTarget: number;
  /** Alvo prioritário de desafio. */
  priority: boolean;
  /** Chefe exposto (luas apagadas) e tempo para reacender. */
  exposedT: number;
  relightT: number;
  /** Temporizador genérico de objetivo (pulso da lua, tiro do totem, canal do ritual). */
  objT: number;
  /** Marcha Sombria: bônus de velocidade ativo (não acumula) e ticks restantes. */
  hasteMul: number;
  hasteT: number;
  /** Portador do Ossário: vida e direção do escudo frontal (0 = sem escudo). */
  shieldHp: number;
  shieldMax: number;
  shieldDir: number;
  /** Caçador de Névoa: velado pela névoa (parcialmente oculto). */
  veiled: boolean;
  /** IA: próxima reavaliação de posição, deslocamento pós-conjuração e ponto de cobertura. */
  aiT: number;
  repositionT: number;
  coverX: number;
  coverY: number;
  /** Chefes: travado no alvo até provocação/queda; ticks longe do alvo (perseguição). */
  lockedId: number;
  farT: number;
  /** Chefes/minichefes: tick em que o alvo atual foi travado (para reavaliação periódica de ameaça). */
  lockedSince: number;
  /** Chefes/minichefes: ameaça acumulada por jogador (dano recente, com decaimento). */
  threat: Map<number, number>;
  /** Função tática em missões: ocupar objetivo (fogueira/altar) ou caçar o sobrevivente. */
  role: 'none' | 'siege' | 'raider';
  /** Ticks contínuos dentro da área do objetivo (rampa de pressão). */
  zoneT: number;
  /** Casca Traiçoeira: escorregão (ticks e velocidade) e vulnerabilidade depois. */
  slideT: number;
  slideVx: number;
  slideVy: number;
  vulnT: number;
  /** Jogador alvo do telegraph atual (Ferida Profana). */
  aimPid: number;
  /** Tick da última Marcha/Ferida (espaçamento entre as duas). */
  lastCastTick: number;
  /** Combo Marca de Ossos: cooldown (ticks) antes de gerar Essência de novo por atordoar este alvo. */
  markStaggerCd: number;
}

/** Servos do Necromante e aliados não jogadores (sobrevivente). */
export interface Minion {
  readonly isMinion: true;
  id: number;
  kind: MinionKind;
  kindIdx: number;
  owner: number;
  x: number;
  y: number;
  r: number;
  hp: number;
  maxHp: number;
  ttl: number;
  maxTtl: number;
  speed: number;
  damage: number;
  state: MinionState;
  stateT: number;
  facing: number;
  targetId: number;
  retarget: number;
  atkCd: number;
  /** Grupo do Exército (teto de dano contra chefes compartilhado). */
  group: number;
  explode: boolean;
  stuckT: number;
  lastX: number;
  lastY: number;
  /** 0 = de pé (compatível com Target). */
  status: 0 | 2;
}

/** Algo que inimigos podem perseguir e atacar: jogador ou servo. */
export interface Target {
  id: number;
  x: number;
  y: number;
  r: number;
  status: number;
  isMinion?: true;
  /** Ponto de objetivo (vaga ao redor da fogueira/altar): usa o campo de fluxo do objetivo. */
  isPoint?: true;
}

export interface Pickup {
  id: number;
  kind: 'heal' | 'corpse';
  x: number;
  y: number;
  ttl: number;
}

export interface Projectile {
  id: number;
  kind: ProjectileKind;
  kindIdx: number;
  team: 'p' | 'e';
  owner: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  dmg: number;
  range: number;
  pierce: number;
  /** Multiplicador aplicado ao dano depois de cada alvo atravessado. */
  pierceFalloff: number;
  poise: number;
  kb: number;
  hit: Set<number>;
  destructible: boolean;
  /** Chinelo: volta para o dono após chegar ao destino. */
  returnTo: number;
  returning: boolean;
  /** Ricochetes restantes (Virote Ricocheteante). */
  ricochet: number;
  tx: number;
  ty: number;
  splash: number;
  dead: boolean;
  /** Arremessos em arco: distância total prevista (progresso visual = percorrido/total). */
  lob: number;
  /** Dados livres por tipo (Lapanha: carga/sacrifício; Ferida: Acólito de origem). */
  a: number;
  b: number;
}

export interface Zone {
  id: number;
  kind: ZoneKind;
  kindIdx: number;
  x: number;
  y: number;
  r: number;
  ttl: number;
  age: number;
  owner: number;
  extra: number;
  /** Dados livres por tipo. */
  a: number;
  b: number;
  dead: boolean;
  /** Inimigos já afetados (controle aplicado uma vez por zona). */
  hit?: Set<number>;
}
