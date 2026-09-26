/**
 * Cliente WebSocket no processo principal (o renderer nunca abre sockets).
 * Encaminha mensagens do servidor ao renderer, mede RTT, detecta perda de conexão e
 * tenta reconectar com o token de sessão por até 60 s.
 */
import WebSocket from 'ws';
import type { ConnectOptions, NetStatus } from '../shared/bridge.js';
import { GAME_VERSION, PROTOCOL_VERSION, RECONNECT_GRACE_MS } from '../shared/constants.js';
import type { ServerMessage } from '../shared/protocol.js';

type Emit = { msg: (m: ServerMessage) => void; status: (s: NetStatus) => void };

/** Latência artificial (ms) para testes: --lag=120 ou UV_FAKE_LAG_MS. */
const argLag = process.argv.find((a) => a.startsWith('--lag='));
const FAKE_LAG = Number(argLag ? argLag.slice(6) : (process.env.UV_FAKE_LAG_MS ?? 0)) || 0;

export class NetClient {
  private ws: WebSocket | null = null;
  private opts: ConnectOptions | null = null;
  private token: string | null = null;
  private welcomed = false;
  private inMatch = false;
  private closedByUser = false;
  private lastRx = 0;
  private hbTimer: NodeJS.Timeout | null = null;
  private reconnectUntil = 0;
  private attempt = 0;
  private hostClosing = false;
  private rejected = false;

  constructor(private readonly emit: Emit) {}

  connect(o: ConnectOptions): void {
    this.disconnect();
    this.opts = o;
    this.token = o.token;
    this.closedByUser = false;
    this.welcomed = false;
    this.inMatch = false;
    this.attempt = 0;
    this.hostClosing = false;
    this.rejected = false;
    this.open();
  }

  private open(): void {
    const o = this.opts;
    if (!o) return;
    this.attempt++;
    this.emit.status({ state: 'connecting', attempt: this.attempt });
    const ws = new WebSocket(`ws://${o.host}:${o.port}`, { handshakeTimeout: 5000, perMessageDeflate: false, maxPayload: 8 * 1024 * 1024 });
    this.ws = ws;
    ws.on('open', () => {
      this.lastRx = Date.now();
      this.emit.status({ state: 'open' });
      this.sendNow({ t: 'hello', v: PROTOCOL_VERSION, gv: GAME_VERSION, name: o.name, pw: o.password, token: this.token, hostKey: o.hostKey });
      this.startHeartbeat();
    });
    ws.on('message', (data) => {
      this.lastRx = Date.now();
      let m: ServerMessage;
      try {
        m = JSON.parse(data.toString()) as ServerMessage;
      } catch {
        return;
      }
      if (typeof m !== 'object' || m === null || typeof (m as { t?: unknown }).t !== 'string') return;
      if (m.t === 'welcome') {
        this.welcomed = true;
        this.token = m.token;
        this.reconnectUntil = 0;
        this.attempt = 0;
      } else if (m.t === 'phase') this.inMatch = m.phase !== 'lobby';
      else if (m.t === 'closing') this.hostClosing = true;
      else if (m.t === 'reject') this.rejected = true;
      else if (m.t === 'hb') {
        this.emit.status({ state: 'rtt', ms: Date.now() - m.ts });
        return;
      }
      if (FAKE_LAG > 0) setTimeout(() => this.emit.msg(m), FAKE_LAG / 2);
      else this.emit.msg(m);
    });
    ws.on('error', () => {
      /* tratado em close */
    });
    ws.on('close', (code) => this.onClose(ws, code));
  }

  private onClose(ws: WebSocket, code: number): void {
    if (ws !== this.ws) return;
    this.stopHeartbeat();
    this.ws = null;
    if (this.closedByUser) return;
    if (this.hostClosing) {
      this.emit.status({ state: 'closed', code: 'host', reason: 'O anfitrião encerrou a partida.' });
      return;
    }
    if (this.rejected || code === 4000) {
      this.emit.status({ state: 'closed', code: 'rejected', reason: 'Conexão recusada pelo anfitrião.' });
      return;
    }
    if (!this.welcomed) {
      // nunca conectou: erro de rota/firewall/porta
      if (this.reconnectUntil && Date.now() < this.reconnectUntil) {
        this.scheduleReconnect();
        return;
      }
      this.emit.status({
        state: 'closed',
        code: 'refused',
        reason:
          'Não foi possível conectar. Confira o IP e a porta, se o anfitrião já criou a partida, se vocês estão na mesma rede Radmin VPN (ambos “online”) e se o Firewall do Windows do anfitrião permite o Última Vigília (inclusive em rede Pública, que é como a Radmin VPN costuma aparecer) na porta TCP escolhida.',
      });
      return;
    }
    // caiu depois de entrar: tenta voltar com o mesmo token
    if (this.token) {
      this.welcomed = false;
      this.reconnectUntil = Date.now() + RECONNECT_GRACE_MS;
      this.scheduleReconnect();
      return;
    }
    this.emit.status({ state: 'closed', code: 'lost', reason: 'Conexão perdida com o anfitrião.' });
  }

  private scheduleReconnect(): void {
    const left = Math.max(0, Math.ceil((this.reconnectUntil - Date.now()) / 1000));
    if (left <= 0) {
      this.emit.status({ state: 'closed', code: 'lost', reason: 'Conexão perdida: não foi possível reconectar em 60 segundos.' });
      return;
    }
    this.emit.status({ state: 'reconnecting', attempt: this.attempt, secondsLeft: left });
    setTimeout(() => {
      if (!this.closedByUser && !this.ws) this.open();
    }, 2000);
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.hbTimer = setInterval(() => {
      this.sendNow({ t: 'hb', ts: Date.now() });
      if (Date.now() - this.lastRx > 8000 && this.ws) {
        // servidor silencioso: força fechamento para acionar a reconexão
        this.ws.terminate();
      }
    }, 1000);
  }

  private stopHeartbeat(): void {
    if (this.hbTimer) clearInterval(this.hbTimer);
    this.hbTimer = null;
  }

  private sendNow(m: unknown): void {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const s = JSON.stringify(m);
    if (s.length > 4096) return;
    if (FAKE_LAG > 0) setTimeout(() => ws.readyState === WebSocket.OPEN && ws.send(s), FAKE_LAG / 2);
    else ws.send(s);
  }

  send(m: unknown): void {
    this.sendNow(m);
  }

  disconnect(): void {
    this.closedByUser = true;
    this.stopHeartbeat();
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      try {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ t: 'bye' }));
        ws.close(1000);
      } catch {
        ws.terminate();
      }
    }
  }

  get matchActive(): boolean {
    return this.inMatch;
  }
}
