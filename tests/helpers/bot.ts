/** Cliente de teste que fala o protocolo real sobre WebSocket. */
import WebSocket from 'ws';
import { GAME_VERSION, PROTOCOL_VERSION } from '../../src/shared/constants.js';
import type { InputTuple, ServerMessage } from '../../src/shared/protocol.js';

export class Bot {
  ws: WebSocket;
  msgs: ServerMessage[] = [];
  id = 0;
  token = '';
  seq = 0;
  closed = false;
  closeCode = 0;
  private waiters: { pred: (m: ServerMessage) => boolean; res: (m: ServerMessage) => void }[] = [];

  constructor(
    readonly url: string,
    readonly name: string,
    readonly opts: { pw?: string; token?: string | null; hostKey?: string | null; v?: number; gv?: string } = {},
  ) {
    this.ws = new WebSocket(url);
    this.ws.on('message', (d) => {
      const m = JSON.parse(d.toString()) as ServerMessage;
      if (m.t === 'welcome') {
        this.id = m.id;
        this.token = m.token;
      }
      this.msgs.push(m);
      if (this.msgs.length > 3000) this.msgs.splice(0, 1000);
      this.waiters = this.waiters.filter((w) => {
        if (w.pred(m)) {
          w.res(m);
          return false;
        }
        return true;
      });
    });
    this.ws.on('close', (code) => {
      this.closed = true;
      this.closeCode = code;
    });
  }

  open(): Promise<void> {
    return new Promise((res, rej) => {
      if (this.ws.readyState === 1) return res();
      this.ws.once('open', () => res());
      this.ws.once('error', rej);
    });
  }

  async join(): Promise<ServerMessage> {
    await this.open();
    this.send({
      t: 'hello',
      v: this.opts.v ?? PROTOCOL_VERSION,
      gv: this.opts.gv ?? GAME_VERSION,
      name: this.name,
      pw: this.opts.pw ?? '',
      token: this.opts.token ?? null,
      hostKey: this.opts.hostKey ?? null,
    });
    return this.wait((m) => m.t === 'welcome' || m.t === 'reject');
  }

  send(m: unknown): void {
    if (this.ws.readyState === 1) this.ws.send(typeof m === 'string' ? m : JSON.stringify(m));
  }

  input(mx: number, my: number, ax: number, ay: number, held = 0, pressed = 0): number {
    this.seq++;
    const t: InputTuple = [this.seq, mx, my, ax, ay, held, pressed];
    this.send({ t: 'in', i: [t] });
    return this.seq;
  }

  wait<T extends ServerMessage>(pred: (m: ServerMessage) => boolean, timeout = 4000): Promise<T> {
    const found = this.msgs.find(pred);
    if (found) {
      this.msgs = this.msgs.filter((m) => m !== found);
      return Promise.resolve(found as T);
    }
    return new Promise((res, rej) => {
      const t = setTimeout(() => rej(new Error(`timeout esperando mensagem (${this.name})`)), timeout);
      this.waiters.push({
        pred,
        res: (m) => {
          clearTimeout(t);
          this.msgs = this.msgs.filter((x) => x !== m);
          res(m as T);
        },
      });
    });
  }

  lastSnap(): Extract<ServerMessage, { t: 'snap' }> | undefined {
    for (let i = this.msgs.length - 1; i >= 0; i--) {
      const m = this.msgs[i];
      if (m && m.t === 'snap') return m;
    }
    return undefined;
  }

  close(): void {
    this.ws.close();
  }
}

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
