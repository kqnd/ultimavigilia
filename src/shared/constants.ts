/** Constantes globais compartilhadas entre servidor e cliente. */
export const GAME_VERSION = '0.2.0';
/** Incrementar sempre que o formato das mensagens mudar. */
export const PROTOCOL_VERSION = 3;

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
