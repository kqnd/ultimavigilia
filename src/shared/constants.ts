/** Constantes globais compartilhadas entre servidor e cliente. */
export const GAME_VERSION = '1.7.0';
/** Incrementar sempre que o formato das mensagens mudar. */
export const PROTOCOL_VERSION = 7;

export const TICK_RATE = 30;
export const TICK_MS = 1000 / TICK_RATE;
export const DT = 1 / TICK_RATE;
/** Snapshot a cada 2 ticks → 15 Hz. */
export const SNAPSHOT_EVERY = 2;

export const TILE = 32;
export const VIEW_W = 640;
export const VIEW_H = 360;

export const MAX_PLAYERS = 6;
export const DEFAULT_PORT = 7777;
export const RECONNECT_GRACE_MS = 60_000;
export const HEARTBEAT_MS = 2_000;
export const HEARTBEAT_TIMEOUT_MS = 10_000;

/** Converte segundos em ticks inteiros. */
export const sec = (s: number): number => Math.round(s * TICK_RATE);

export const NAME_MAX = 16;
export const PASSWORD_MAX = 32;

/**
 * Projéteis: simulados no plano do chão e desenhados esta altura acima (peito/arma).
 * O cursor mira nessa altura; ver `projectileAim` (servidor) e `drawProjectile` (cliente).
 */
export const SHOT_HEIGHT = 8;
/** Distância da origem do disparo ao centro do personagem, no plano do chão. */
export const SHOT_MUZZLE = 10;
