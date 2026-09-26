/**
 * Estado de rede do cliente: conexão, lobby, fases, snapshots e eventos (deduplicados por id).
 * Não decide nada de jogo: apenas guarda o que o servidor autoritativo envia.
 */
import type { ConnectOptions, NetStatus } from '../shared/bridge.js';
import type { ClassId } from '../shared/config/classes.js';
import { TICK_MS } from '../shared/constants.js';
import type { GameEvent, LobbyPlayer, MatchStats, Phase, ServerMessage } from '../shared/protocol.js';
import { getBridge } from './bridge.js';

export type Snapshot = Extract<ServerMessage, { t: 'snap' }>;

type Listener<T> = (v: T) => void;
class Emitter<T> {
  private fns = new Set<Listener<T>>();
  on(fn: Listener<T>): () => void {
    this.fns.add(fn);
    return () => this.fns.delete(fn);
  }
  emit(v: T): void {
    for (const f of [...this.fns]) f(v);
  }
}

export interface PhaseInfo {
  phase: Phase;
  wave: number;
  title: string;
  tm: number;
  stats: Record<number, MatchStats> | null;
  time: number;
  /** Capítulo (1–3), índice do mapa ativo e rota do capítulo (0 nenhuma, 1 risco, 2 segura). */
  ch: number;
  map: number;
  route: number;
}

export interface Offer {
  options: string[];
  picked: string | null;
  mine: Record<string, number>;
  readyCount: number;
  total: number;
  /** Por que há cartas extras neste intervalo (texto do servidor; vazio se nenhuma). */
  bonus: string;
}

/** Votação de rota entre capítulos (espelho do servidor). */
export interface RouteVote {
  risk: number;
  safe: number;
  total: number;
  mine: 'risk' | 'safe' | null;
  tm: number;
  result: 'risk' | 'safe' | null;
  /** Momento local em que chegou (para o contador regressivo). */
  at: number;
}

export class Session {
  readonly bridge = getBridge();
  myId = 0;
  token: string | null = null;
  hostKey: string | null = null;
  /** Endereço exibido para amigos (anfitrião). */
  shareAddress = '';
  isHostProcess = false;
  solo = false;
  connected = false;
  lastConnect: ConnectOptions | null = null;
  lobby: LobbyPlayer[] = [];
  maxPlayers = 6;
  hasPassword = false;
  phase: PhaseInfo = { phase: 'lobby', wave: 0, title: '', tm: 0, stats: null, time: 0, ch: 1, map: 0, route: 0 };
  offer: Offer | null = null;
  route: RouteVote | null = null;
  /** Acúmulos de melhorias do jogador local (confirmados pelo servidor). */
  mods: Record<string, number> = {};
  rtt = 0;
  paused = false;
  snaps: Snapshot[] = [];
  lastSnapTick = 0;
  lastSnapAt = 0;
  private tickOffset = 0;
  private lastEventId = 0;

  readonly onLobby = new Emitter<LobbyPlayer[]>();
  readonly onPhase = new Emitter<PhaseInfo>();
  readonly onSnap = new Emitter<Snapshot>();
  readonly onEvents = new Emitter<GameEvent[]>();
  readonly onStatus = new Emitter<NetStatus>();
  readonly onNotice = new Emitter<{ text: string; kind: 'info' | 'warn' }>();
  readonly onOffer = new Emitter<Offer>();
  readonly onRoute = new Emitter<RouteVote>();
  readonly onPing = new Emitter<{ from: number; x: number; y: number }>();
  readonly onPaused = new Emitter<boolean>();
  readonly onClassDenied = new Emitter<{ cls: ClassId; by: string }>();
  readonly onReject = new Emitter<string>();
  readonly onClosing = new Emitter<string>();
  readonly onWelcome = new Emitter<boolean>();

  constructor() {
    this.bridge.net.onMessage((m) => this.handle(m));
    this.bridge.net.onStatus((s) => {
      if (s.state === 'rtt') this.rtt = s.ms;
      if (s.state === 'closed') this.connected = false;
      this.onStatus.emit(s);
    });
  }

  async connect(o: ConnectOptions): Promise<void> {
    this.lastConnect = o;
    this.token = o.token;
    this.resetMatchState();
    await this.bridge.net.connect(o);
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    await this.bridge.net.disconnect();
    if (this.isHostProcess) {
      await this.bridge.host.stop();
      this.isHostProcess = false;
    }
    this.myId = 0;
    this.token = null;
    this.lobby = [];
    this.resetMatchState();
  }

  resetMatchState(): void {
    this.snaps = [];
    this.lastEventId = 0;
    this.offer = null;
    this.route = null;
    this.mods = {};
    this.paused = false;
    this.phase = { phase: 'lobby', wave: 0, title: '', tm: 0, stats: null, time: 0, ch: 1, map: 0, route: 0 };
  }

  send(m: unknown): void {
    this.bridge.net.send(m);
  }

  me(): LobbyPlayer | undefined {
    return this.lobby.find((p) => p.id === this.myId);
  }

  isHost(): boolean {
    return this.me()?.host === true;
  }

  nameOf(id: number): string {
    return this.lobby.find((p) => p.id === id)?.name ?? `Jogador ${id}`;
  }

  /** Tick do servidor estimado agora (fracionário). */
  serverTickNow(): number {
    if (!this.lastSnapAt) return 0;
    return this.lastSnapTick + (performance.now() - this.lastSnapAt) / TICK_MS + this.tickOffset;
  }

  private handle(m: ServerMessage): void {
    switch (m.t) {
      case 'welcome':
        this.myId = m.id;
        this.token = m.token;
        this.maxPlayers = m.max;
        this.hasPassword = m.pw;
        this.connected = true;
        if (this.lastConnect) this.lastConnect.token = m.token;
        this.onWelcome.emit(m.reconnect);
        break;
      case 'reject':
        this.onReject.emit(m.msg);
        break;
      case 'lobby':
        this.lobby = m.players;
        this.maxPlayers = m.max;
        this.onLobby.emit(m.players);
        break;
      case 'clsDenied':
        this.onClassDenied.emit({ cls: m.cls, by: m.by });
        break;
      case 'phase': {
        const prev = this.phase.phase;
        this.phase = { phase: m.phase, wave: m.wave, title: m.title, tm: m.tm, stats: m.stats, time: m.time, ch: m.ch, map: m.map, route: m.route };
        if (m.phase !== 'intermission') this.offer = null;
        if (m.phase !== 'route' && m.phase !== 'travel') this.route = null;
        if (m.phase === 'lobby' && prev !== 'lobby') this.snaps = [];
        this.onPhase.emit(this.phase);
        break;
      }
      case 'snap': {
        if (m.full) this.lastEventId = 0;
        const now = performance.now();
        // estimativa suave do relógio do servidor
        if (this.lastSnapAt) {
          const predicted = this.lastSnapTick + (now - this.lastSnapAt) / TICK_MS + this.tickOffset;
          const err = m.tick - predicted;
          this.tickOffset += Math.abs(err) > 15 ? err : err * 0.1;
        }
        this.lastSnapTick = m.tick;
        this.lastSnapAt = now;
        this.snaps.push(m);
        if (this.snaps.length > 40) this.snaps.splice(0, this.snaps.length - 40);
        const fresh = m.ev.filter((e) => e.id > this.lastEventId);
        if (fresh.length) this.lastEventId = fresh[fresh.length - 1]?.id ?? this.lastEventId;
        this.phase.tm = m.w.tm;
        this.onSnap.emit(m);
        if (fresh.length) this.onEvents.emit(fresh);
        break;
      }
      case 'upgOffer':
        this.offer = { options: m.options, picked: m.picked, mine: m.mine, readyCount: m.readyCount, total: m.total, bonus: m.bonus };
        this.onOffer.emit(this.offer);
        break;
      case 'route':
        this.route = { risk: m.risk, safe: m.safe, total: m.total, mine: m.mine, tm: m.tm, result: m.result, at: performance.now() };
        this.onRoute.emit(this.route);
        break;
      case 'notice':
        this.onNotice.emit({ text: m.text, kind: m.kind });
        break;
      case 'ping':
        this.onPing.emit({ from: m.from, x: m.x, y: m.y });
        break;
      case 'mods':
        this.mods = m.mods;
        break;
      case 'paused':
        this.paused = m.p;
        this.onPaused.emit(m.p);
        break;
      case 'closing':
        this.onClosing.emit(m.reason);
        break;
      default:
        break;
    }
  }

  latest(): Snapshot | undefined {
    return this.snaps[this.snaps.length - 1];
  }
}
