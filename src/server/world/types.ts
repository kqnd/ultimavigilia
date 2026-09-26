import type { ClassBase, ClassId } from '../../shared/config/classes.js';
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
  };
  blocking: boolean;
  blockDir: number;
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
