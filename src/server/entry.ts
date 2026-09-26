/**
 * Ponto de entrada do processo servidor.
 * - Dentro do Electron: executado via utilityProcess; recebe comandos por process.parentPort.
 * - Fora do Electron: `node dist/server/server.cjs --port 7777 --host 0.0.0.0` (servidor dedicado/testes).
 */
import { randomBytes } from 'node:crypto';
import { DEFAULT_PORT } from '../shared/constants.js';
import { type RunningServer, ServerStartError, startServer } from './net.js';

interface StartCmd {
  type: 'start';
  host: string;
  port: number;
  password: string;
  maxPlayers: number;
  hostKey: string;
  solo: boolean;
}
type ParentMsg = StartCmd | { type: 'stop'; reason: string };

interface ParentPort {
  on(ev: 'message', fn: (e: { data: unknown }) => void): void;
  postMessage(m: unknown): void;
}

const log = (m: string): void => {
  console.log(`[servidor ${new Date().toISOString().slice(11, 19)}] ${m}`);
};

function isStart(m: unknown): m is StartCmd {
  if (typeof m !== 'object' || m === null) return false;
  const o = m as Record<string, unknown>;
  return (
    o.type === 'start' && typeof o.host === 'string' && typeof o.port === 'number' && Number.isInteger(o.port) && o.port >= 0 &&
    o.port <= 65535 && typeof o.password === 'string' && typeof o.maxPlayers === 'number' && typeof o.hostKey === 'string' && typeof o.solo === 'boolean'
  );
}

const parentPort = (process as unknown as { parentPort?: ParentPort }).parentPort;

if (parentPort) {
  let running: RunningServer | null = null;
  parentPort.on('message', (e) => {
    const m = e.data as ParentMsg;
    if (isStart(m)) {
      if (running) return;
      startServer({ ...m, log })
        .then((s) => {
          running = s;
          parentPort.postMessage({ type: 'listening', host: s.host, port: s.port });
        })
        .catch((err: unknown) => {
          const code = err instanceof ServerStartError ? err.code : 'UNKNOWN';
          const message = err instanceof Error ? err.message : String(err);
          parentPort.postMessage({ type: 'error', code, message });
        });
    } else if (typeof m === 'object' && m !== null && (m as { type?: unknown }).type === 'stop') {
      const reason = typeof (m as { reason?: unknown }).reason === 'string' ? (m as { reason: string }).reason : 'O anfitrião encerrou a partida.';
      const done = (): void => {
        parentPort.postMessage({ type: 'stopped' });
        setTimeout(() => process.exit(0), 50);
      };
      if (running) void running.close(reason).then(done);
      else done();
    }
  });
  parentPort.postMessage({ type: 'ready' });
} else {
  // modo linha de comando (servidor dedicado para testes)
  const arg = (k: string, d: string): string => {
    const i = process.argv.indexOf(`--${k}`);
    return i >= 0 && process.argv[i + 1] ? (process.argv[i + 1] as string) : d;
  };
  const hostKey = arg('hostkey', randomBytes(12).toString('hex'));
  startServer({
    host: arg('host', '127.0.0.1'),
    port: Number(arg('port', String(DEFAULT_PORT))),
    password: arg('password', ''),
    maxPlayers: Number(arg('max', '6')),
    hostKey,
    solo: process.argv.includes('--solo'),
    log,
  })
    .then((s) => {
      log(`chave do anfitrião: ${hostKey}`);
      const shutdown = (): void => {
        void s.close('Servidor encerrado.').then(() => process.exit(0));
      };
      process.on('SIGINT', shutdown);
      process.on('SIGTERM', shutdown);
    })
    .catch((err: unknown) => {
      log(err instanceof Error ? err.message : String(err));
      process.exit(1);
    });
}
