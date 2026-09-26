/**
 * Protocolo de rede (JSON sobre WebSocket). Todas as mensagens do cliente passam por
 * `parseClientMessage`, que valida tipos, faixas e tamanhos em tempo de execução.
 */
import { CLASS_IDS, type ClassId } from './config/classes.js';
import { NAME_MAX, PASSWORD_MAX } from './constants.js';
import { isFiniteNum } from './math.js';

// ------------------------------------------------------------------ Ações e estados

/** Códigos de ação de jogadores (animação + lógica). */
export const ACTIONS = [
  'idle', 'basic1', 'basic2', 'basic3', 'basic4', 'q', 'e', 'r', 'block', 'guardBreak', 'hurt', 'cast', 'revive',
] as const;
export type ActionName = (typeof ACTIONS)[number];
export const actionCode = (a: ActionName): number => ACTIONS.indexOf(a);

export const PLAYER_FLAGS = {
  invuln: 1,
  blocking: 2,
  /** Berserker em Loucura. */
  madness: 4,
  feast: 8,
  bastion: 16,
  empowered: 32,
  resonant: 64,
  surrounded: 128,
  /** Berserker exausto após a Loucura. */
  exhausted: 256,
  taunting: 512,
  /** Berserker com Fúria alta. */
  rage: 1024,
  /** Frio do capítulo II (lentidão). */
  chill: 2048,
  reviving: 4096,
  /** Queimadura do capítulo III (dano contínuo). */
  burn: 8192,
  /** No ar (Salto Brutal). */
  airborne: 16384,
} as const;

export const ENEMY_STATES = ['spawn', 'move', 'windup', 'active', 'recover', 'stagger', 'air', 'dead', 'roar'] as const;
export type EnemyStateName = (typeof ENEMY_STATES)[number];
export const enemyStateCode = (s: EnemyStateName): number => ENEMY_STATES.indexOf(s);

export const ENEMY_ATTACKS = [
  'none', 'swipe', 'lunge', 'pounce', 'claw', 'orb', 'rune', 'slam', 'slipper', 'leap', 'claws', 'howl', 'crescent', 'eruption', 'sweep', 'summon', 'burst', 'dash', 'transform',
  'shards', 'nova', 'spikes', 'frostSummon', 'channel', 'roll',
] as const;
export type EnemyAttackName = (typeof ENEMY_ATTACKS)[number];
export const enemyAttackCode = (s: EnemyAttackName): number => ENEMY_ATTACKS.indexOf(s);

export const ENEMY_FLAGS = {
  stagger: 1,
  rooted: 2,
  slowed: 4,
  taunted: 8,
  phase2: 16,
  pulled: 32,
  invuln: 64,
  enraged: 128,
  /** Chefe protegido por luas falsas/totens. */
  shielded: 256,
  /** Chefe exposto (luas apagadas). */
  exposed: 512,
  /** Alvo prioritário de desafio. */
  priority: 1024,
  /** Afetado por maldição (Ritualista). */
  cursed: 2048,
} as const;

export const PROJECTILE_KINDS = ['bolt', 'pierceBolt', 'missile', 'empMissile', 'orb', 'slipper', 'abyssOrb', 'bone', 'iceShard'] as const;
export type ProjectileKind = (typeof PROJECTILE_KINDS)[number];

export const ZONE_KINDS = [
  'trap', 'glacial', 'bastion', 'polarity', 'rupture', 'rain', 'rune', 'eruption', 'leapMark', 'spawnWarn', 'screamPulse',
  'graveHand', 'moonPulse', 'nova', 'iceSpike', 'leapLand',
] as const;
export type ZoneKind = (typeof ZONE_KINDS)[number];

export type Phase = 'lobby' | 'wave' | 'intermission' | 'route' | 'travel' | 'victory' | 'defeat';

// ------------------------------------------------------------------ Cliente → Servidor

/** [seq, mx, my, ax, ay, held, pressed] */
export type InputTuple = [number, number, number, number, number, number, number];

export type ClientMessage =
  | { t: 'hello'; v: number; gv: string; name: string; pw: string; token: string | null; hostKey: string | null }
  | { t: 'cls'; cls: ClassId | null }
  | { t: 'ready'; r: boolean }
  | { t: 'start' }
  | { t: 'in'; i: InputTuple[] }
  /** Confirma a melhoria escolhida (a seleção acontece só na interface). */
  | { t: 'upg'; id: string }
  /** Voto de rota entre capítulos. */
  | { t: 'vote'; r: 'risk' | 'safe' }
  | { t: 'ping'; x: number; y: number }
  | { t: 'hb'; ts: number }
  | { t: 'pause'; p: boolean }
  | { t: 'again' }
  | { t: 'bye' }
  /** Somente com UV_DEBUG=1 no servidor (ferramenta de desenvolvimento/testes visuais). */
  | { t: 'dbg'; c: 'wave' | 'ult' | 'god' | 'kill' | 'spawn' | 'phase'; n: number; s: string };

const isStr = (v: unknown, max: number): v is string => typeof v === 'string' && v.length <= max;
const isBool = (v: unknown): v is boolean => typeof v === 'boolean';
const inRange = (v: unknown, lo: number, hi: number): v is number => isFiniteNum(v) && v >= lo && v <= hi;

export const MAX_INPUTS_PER_MESSAGE = 8;
export const MAX_MESSAGE_BYTES = 4096;

/** Remove caracteres de controle e espaços extras de apelidos. */
export function sanitizeName(raw: string): string {
  // eslint-disable-next-line no-control-regex
  return raw.replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX);
}

/** Valida uma mensagem bruta do cliente. Retorna null se inválida. */
export function parseClientMessage(raw: unknown): ClientMessage | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const m = raw as Record<string, unknown>;
  switch (m.t) {
    case 'hello':
      if (!inRange(m.v, 0, 1e6) || !isStr(m.gv, 32) || !isStr(m.name, 64) || !isStr(m.pw, PASSWORD_MAX)) return null;
      if (!(m.token === null || isStr(m.token, 64))) return null;
      if (!(m.hostKey === null || isStr(m.hostKey, 64))) return null;
      return { t: 'hello', v: m.v, gv: m.gv, name: m.name, pw: m.pw, token: m.token as string | null, hostKey: m.hostKey as string | null };
    case 'cls':
      if (m.cls !== null && !(typeof m.cls === 'string' && (CLASS_IDS as readonly string[]).includes(m.cls))) return null;
      return { t: 'cls', cls: m.cls as ClassId | null };
    case 'ready':
      return isBool(m.r) ? { t: 'ready', r: m.r } : null;
    case 'start':
      return { t: 'start' };
    case 'in': {
      if (!Array.isArray(m.i) || m.i.length === 0 || m.i.length > MAX_INPUTS_PER_MESSAGE) return null;
      const out: InputTuple[] = [];
      for (const it of m.i as unknown[]) {
        if (!Array.isArray(it) || it.length !== 7) return null;
        const [seq, mx, my, ax, ay, held, pressed] = it as unknown[];
        if (!inRange(seq, 0, 2 ** 31) || !Number.isInteger(seq)) return null;
        if (!inRange(mx, -1, 1) || !inRange(my, -1, 1)) return null;
        if (!inRange(ax, -5000, 10000) || !inRange(ay, -5000, 10000)) return null;
        if (!inRange(held, 0, 63) || !Number.isInteger(held)) return null;
        if (!inRange(pressed, 0, 63) || !Number.isInteger(pressed)) return null;
        out.push([seq, mx, my, ax, ay, held, pressed]);
      }
      return { t: 'in', i: out };
    }
    case 'upg':
      return isStr(m.id, 32) ? { t: 'upg', id: m.id } : null;
    case 'vote':
      return m.r === 'risk' || m.r === 'safe' ? { t: 'vote', r: m.r } : null;
    case 'ping':
      return inRange(m.x, 0, 10000) && inRange(m.y, 0, 10000) ? { t: 'ping', x: m.x, y: m.y } : null;
    case 'hb':
      return isFiniteNum(m.ts) ? { t: 'hb', ts: m.ts } : null;
    case 'pause':
      return isBool(m.p) ? { t: 'pause', p: m.p } : null;
    case 'again':
      return { t: 'again' };
    case 'bye':
      return { t: 'bye' };
    case 'dbg':
      if (!(m.c === 'wave' || m.c === 'ult' || m.c === 'god' || m.c === 'kill' || m.c === 'spawn' || m.c === 'phase') || !inRange(m.n, 0, 200) || !isStr(m.s, 24)) return null;
      return { t: 'dbg', c: m.c, n: Math.floor(m.n), s: m.s };
    default:
      return null;
  }
}

// ------------------------------------------------------------------ Servidor → Cliente

export type RejectCode = 'version' | 'full' | 'password' | 'inProgress' | 'badName' | 'badMessage' | 'rateLimit' | 'duplicate';

export interface LobbyPlayer {
  id: number;
  name: string;
  cls: ClassId | null;
  ready: boolean;
  host: boolean;
  conn: boolean;
}

export interface SnapPlayer {
  id: number;
  c: ClassId;
  x: number;
  y: number;
  /** Ângulo de mira × 1000. */
  a: number;
  hp: number;
  mhp: number;
  st: number;
  mst: number;
  act: number;
  /** Ticks desde o início da ação. */
  at: number;
  /** Direção fixada da ação (× 1000). */
  ad: number;
  /** 0 vivo, 1 caído, 2 morto (espera próxima onda). */
  s: number;
  bl: number;
  rv: number;
  f: number;
  cd: [number, number];
  cm: [number, number];
  u: number;
  k: number;
  cn: number;
  /** Tick da última esquiva (animação). */
  dg: number;
}

export interface SnapYou {
  ack: number;
  x: number;
  y: number;
  fvx: number;
  fvy: number;
  ft: number;
  st: number;
  dcd: number;
  mm: number;
  cdg: number;
  /** Velocidade base atual (px/s) para a predição. */
  sp: number;
}

/** [id, tipo, x, y, hp, mhp, estado, ataque, ticksNoEstado, facing×100, tx, ty, flags, afixo, marcas, marcadoPor] */
export type EnemyTuple = [number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number];
/** Servos e aliados não jogadores: [id, tipo, x, y, hp, mhp, estado, facing×100, dono, vidaRestante%] */
export type MinionTuple = [number, number, number, number, number, number, number, number, number, number];
export const MINION_KINDS = ['thrall', 'horde', 'survivor'] as const;
export type MinionKind = (typeof MINION_KINDS)[number];
export const MINION_STATES = ['rise', 'move', 'windup', 'attack', 'dead'] as const;
export type MinionState = (typeof MINION_STATES)[number];
/** Itens no chão: [id, tipo, x, y] */
export type PickupTuple = [number, number, number, number];
/** Quebráveis danificados ou destruídos: [índice, vida%] (0 = destruído). */
export type BreakTuple = [number, number];
/** [id, tipo, x, y, vx, vy, dono] */
export type ProjTuple = [number, number, number, number, number, number, number];
/** [id, tipo, x, y, raio, ticksRestantes, dono, extra] */
export type ZoneTuple = [number, number, number, number, number, number, number, number];

export type DenyReason = 'cd' | 'st' | 'range' | 'ult' | 'busy' | 'essence' | 'corpse' | 'blocked';

export type GameEvent =
  | { id: number; k: 'dmg'; tg: 'e' | 'p'; ti: number; v: number; x: number; y: number; c: 'n' | 'crit' | 'blk' | 'par' | 'heal'; s: number }
  | { id: number; k: 'die'; ei: number; et: number; x: number; y: number }
  | { id: number; k: 'fx'; n: string; x: number; y: number; a: number; o: number; r: number }
  | { id: number; k: 'sfx'; n: string; x: number; y: number }
  | { id: number; k: 'down'; pi: number }
  | { id: number; k: 'revived'; pi: number; by: number }
  | { id: number; k: 'respawn'; pi: number }
  | { id: number; k: 'deny'; r: DenyReason; to: number }
  | { id: number; k: 'shout'; ei: number; txt: string }
  | { id: number; k: 'boss'; et: number; ph: number }
  | { id: number; k: 'ult'; pi: number }
  /** Mensagem de jogo para todos (objetivos, eventos, desafios). */
  | { id: number; k: 'msg'; txt: string; c: 'good' | 'bad' | 'info' | 'boss' }
  /** Objeto do mapa quebrado (índice) e se deixou item. */
  | { id: number; k: 'break'; bi: number; x: number; y: number; drop: boolean }
  /** Item coletado. */
  | { id: number; k: 'pickup'; pi: number; x: number; y: number; v: number };

export type GameEventBody = GameEvent extends infer E ? (E extends GameEvent ? Omit<E, 'id'> : never) : never;

export interface ObjectiveInfo {
  /** Tipo (evento ou desafio). */
  k: string;
  /** 0 em andamento, 1 sucesso, 2 falha. */
  s: number;
  /** Progresso/vida 0–100 (-1 se não se aplica). */
  p: number;
  /** Ticks restantes (-1 se não se aplica). */
  t: number;
  /** Posição (px) quando o objetivo tem um lugar no mapa (altar). */
  x?: number;
  y?: number;
}

export interface WaveInfo {
  n: number;
  left: number;
  ph: Phase;
  /** Ticks restantes do intervalo (0 se não aplicável). */
  tm: number;
  title: string;
  boss: number;
  /** Apresentação sincronizada de chefe/minichefe; a simulação fica congelada enquanto t > 0. */
  intro: { id: number; et: number; x: number; y: number; t: number; d: number; reveal: number } | null;
  /** Capítulo (1–3) e mapa ativo (índice em MAP_IDS). */
  ch: number;
  mp: number;
  /** Tempestade do clima ativa. */
  st: number;
  /** Rota do capítulo: 0 nenhuma, 1 risco, 2 segura. */
  rt: number;
  ev: ObjectiveInfo | null;
  cg: ObjectiveInfo | null;
  /** Objetivo de chefe: luas/totens ativos e total. */
    bo: { k: 'moon' | 'totem'; n: number; tot: number; x: number } | null;
    /** Posição autoritativa do bardo nesta onda. */
    bd: [number, number] | null;
}

export interface MatchStats {
  kills: number;
  damage: number;
  downs: number;
  revives: number;
}

export type ServerMessage =
  | { t: 'welcome'; id: number; token: string; v: number; max: number; pw: boolean; reconnect: boolean }
  | { t: 'reject'; code: RejectCode; msg: string }
  | { t: 'lobby'; players: LobbyPlayer[]; max: number; phase: Phase }
  | { t: 'clsDenied'; cls: ClassId; by: string }
  | { t: 'phase'; phase: Phase; wave: number; title: string; tm: number; stats: Record<number, MatchStats> | null; time: number; ch: number; map: number; route: number }
  | { t: 'route'; risk: number; safe: number; total: number; mine: 'risk' | 'safe' | null; tm: number; result: 'risk' | 'safe' | null }
  | {
      t: 'snap';
      tick: number;
      you: SnapYou | null;
      p: SnapPlayer[];
      e: EnemyTuple[];
      m: MinionTuple[];
      it: PickupTuple[];
      bk: BreakTuple[];
      pr: ProjTuple[];
      z: ZoneTuple[];
      ev: GameEvent[];
      w: WaveInfo;
      full: boolean;
    }
  | { t: 'upgOffer'; options: string[]; picked: string | null; mine: Record<string, number>; readyCount: number; total: number; bonus: string }
  | { t: 'hb'; ts: number }
  | { t: 'closing'; reason: string }
  | { t: 'notice'; text: string; kind: 'info' | 'warn' }
  | { t: 'ping'; from: number; x: number; y: number }
  | { t: 'paused'; p: boolean }
  | { t: 'mods'; mods: Record<string, number> };

export const REJECT_TEXT: Record<RejectCode, string> = {
  version: 'Versão incompatível: você e o anfitrião precisam da mesma versão do jogo.',
  full: 'Sala cheia.',
  password: 'Senha incorreta.',
  inProgress: 'A partida já começou. Apenas participantes podem reconectar.',
  badName: 'Apelido inválido.',
  badMessage: 'Mensagem inválida recebida.',
  rateLimit: 'Mensagens demais em pouco tempo.',
  duplicate: 'Esta sessão já está conectada em outra janela.',
};
