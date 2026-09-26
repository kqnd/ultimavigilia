/** Inicia/encerra o servidor autoritativo em um utilityProcess separado. */
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { app, utilityProcess, type UtilityProcess } from 'electron';
import type { HostStartOptions, HostStartResult } from '../shared/bridge.js';
import { MAX_PLAYERS } from '../shared/constants.js';
import { isIPv4 } from './interfaces.js';

let child: UtilityProcess | null = null;

function serverPath(): string {
  // o servidor fica fora do asar (asarUnpack) para rodar como processo próprio
  const p = path.join(__dirname, '..', 'server', 'server.cjs');
  return app.isPackaged ? p.replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`) : p;
}

export function hostRunning(): boolean {
  return child !== null;
}

export async function startHost(o: HostStartOptions): Promise<HostStartResult> {
  await stopHost('Reiniciando sala.');
  const bind = o.solo ? '127.0.0.1' : o.bind;
  if (!isIPv4(bind)) return { ok: false, code: 'BADBIND', message: 'Interface de rede inválida.' };
  const port = o.solo ? 0 : Math.round(o.port);
  if (!o.solo && (port < 1024 || port > 65535)) return { ok: false, code: 'BADPORT', message: 'Porta inválida: use um número entre 1024 e 65535.' };
  const hostKey = randomBytes(16).toString('hex');
  const proc = utilityProcess.fork(serverPath(), [], { serviceName: 'Ultima Vigilia - Servidor', stdio: 'pipe' });
  child = proc;
  proc.stdout?.on('data', (d: Buffer) => process.stdout.write(d));
  proc.stderr?.on('data', (d: Buffer) => process.stderr.write(d));
  proc.once('exit', () => {
    if (child === proc) child = null;
  });
  return new Promise<HostStartResult>((resolve) => {
    const timer = setTimeout(() => {
      resolve({ ok: false, code: 'TIMEOUT', message: 'O servidor não respondeu a tempo.' });
      void stopHost('');
    }, 8000);
    proc.on('message', (m: unknown) => {
      const msg = m as { type?: string; port?: number; code?: string; message?: string };
      if (msg.type === 'ready') {
        proc.postMessage({
          type: 'start',
          host: bind,
          port,
          password: o.password.slice(0, 32),
          maxPlayers: o.solo ? 1 : Math.max(1, Math.min(MAX_PLAYERS, Math.round(o.maxPlayers))),
          hostKey,
          solo: o.solo,
        });
      } else if (msg.type === 'listening') {
        clearTimeout(timer);
        // o próprio anfitrião conecta pela interface escolhida (ou loopback se "todas")
        const connectHost = bind === '0.0.0.0' ? '127.0.0.1' : bind;
        resolve({ ok: true, port: msg.port ?? port, bind, hostKey, connectHost });
      } else if (msg.type === 'error') {
        clearTimeout(timer);
        resolve({ ok: false, code: msg.code ?? 'UNKNOWN', message: msg.message ?? 'Falha ao iniciar o servidor.' });
        void stopHost('');
      }
    });
  });
}

export function stopHost(reason: string): Promise<void> {
  const proc = child;
  if (!proc) return Promise.resolve();
  child = null;
  return new Promise((resolve) => {
    const kill = setTimeout(() => {
      try {
        proc.kill();
      } catch {
        /* ignorado */
      }
      resolve();
    }, 1500);
    proc.once('exit', () => {
      clearTimeout(kill);
      resolve();
    });
    try {
      proc.postMessage({ type: 'stop', reason: reason || 'O anfitrião encerrou a partida.' });
    } catch {
      clearTimeout(kill);
      proc.kill();
      resolve();
    }
  });
}
