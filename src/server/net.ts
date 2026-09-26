/** Inicialização do servidor WebSocket (sem DOM/Phaser; roda em utilityProcess ou Node puro). */
import { WebSocketServer } from 'ws';
import { MAX_PLAYERS } from '../shared/constants.js';
import { Room, type RoomOptions } from './room.js';

export interface ServerOptions {
  host: string;
  port: number;
  password: string;
  maxPlayers: number;
  hostKey: string;
  solo: boolean;
  seed?: number;
  log?: (msg: string) => void;
  rate?: RoomOptions['rate'];
}

export interface RunningServer {
  host: string;
  port: number;
  room: Room;
  close(reason: string): Promise<void>;
}

export class ServerStartError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export function startServer(o: ServerOptions): Promise<RunningServer> {
  return new Promise((resolve, reject) => {
    const maxPlayers = Math.max(1, Math.min(MAX_PLAYERS, Math.floor(o.maxPlayers)));
    const room = new Room({
      maxPlayers: o.solo ? 1 : maxPlayers,
      password: o.password,
      hostKey: o.hostKey,
      solo: o.solo,
      ...(o.seed !== undefined ? { seed: o.seed } : {}),
      ...(o.log ? { log: o.log } : {}),
      ...(o.rate ? { rate: o.rate } : {}),
    });
    const wss = new WebSocketServer({ host: o.host, port: o.port, maxPayload: 16 * 1024, perMessageDeflate: false, clientTracking: true });
    let started = false;
    wss.once('error', (err: NodeJS.ErrnoException) => {
      if (started) return;
      const code = err.code ?? 'UNKNOWN';
      const msg =
        code === 'EADDRINUSE'
          ? `A porta ${o.port} já está em uso. Feche o outro programa ou escolha outra porta.`
          : code === 'EADDRNOTAVAIL'
            ? `O endereço ${o.host} não está disponível neste computador. Verifique se a rede (LAN/Radmin VPN) está conectada.`
            : code === 'EACCES'
              ? `Sem permissão para usar a porta ${o.port}. Tente uma porta acima de 1024.`
              : `Não foi possível abrir o servidor: ${err.message}`;
      reject(new ServerStartError(code, msg));
    });
    wss.on('listening', () => {
      started = true;
      const addr = wss.address();
      const port = typeof addr === 'object' && addr ? addr.port : o.port;
      room.start();
      o.log?.(`servidor ouvindo em ${o.host}:${port}${o.solo ? ' (solo)' : ''}`);
      resolve({
        host: o.host,
        port,
        room,
        close: (reason: string) =>
          new Promise<void>((res) => {
            room.close(reason);
            setTimeout(() => {
              for (const c of wss.clients) c.terminate();
              wss.close(() => res());
            }, 150);
          }),
      });
    });
    wss.on('connection', (ws) => room.onConnection(ws));
  });
}
