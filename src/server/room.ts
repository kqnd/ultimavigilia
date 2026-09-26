/**
 * Sala única do servidor: lobby, sessões (tokens), reconexão, validação e envio de estado.
 */
import { randomBytes } from 'node:crypto';
import type { WebSocket } from 'ws';
import { CLASSES } from '../shared/config/classes.js';
import { UPGRADE_BY_ID } from '../shared/config/upgrades.js';
import {
  GAME_VERSION, HEARTBEAT_MS, HEARTBEAT_TIMEOUT_MS, PROTOCOL_VERSION, RECONNECT_GRACE_MS, SNAPSHOT_EVERY, TICK_MS, sec,
} from '../shared/constants.js';
import type { InputFrame } from '../shared/movement.js';
import {
  type ClientMessage, type GameEvent, type LobbyPlayer, MAX_MESSAGE_BYTES, parseClientMessage, REJECT_TEXT, type RejectCode,
  sanitizeName, type ServerMessage,
} from '../shared/protocol.js';
import type { ClassId } from '../shared/config/classes.js';
import { mapIndex } from '../shared/map.js';
import { snapBreaks, snapPickups } from './world/loot.js';
import { snapMinions } from './world/minions.js';
import { World } from './world/world.js';

export interface RoomOptions {
  maxPlayers: number;
  password: string;
  hostKey: string;
  solo: boolean;
  seed?: number;
  log?: (msg: string) => void;
  /** Limites de tráfego (ajustáveis em testes). */
  rate?: { capacity: number; perSecond: number; kickAfter: number };
}

interface Slot {
  id: number;
  name: string;
  token: string;
  cls: ClassId | null;
  ready: boolean;
  host: boolean;
  conn: Conn | null;
  disconnectedAt: number;
}

interface Conn {
  ws: WebSocket;
  slot: Slot | null;
  tokens: number;
  lastRefill: number;
  violations: number;
  invalid: number;
  events: GameEvent[];
  lastPong: number;
  needFull: boolean;
  skipped: number;
  closed: boolean;
}

/** Acima disto (bytes) o cliente é considerado lento e deixa de receber snapshots até drenar. */
const SLOW_CLIENT_BYTES = 256 * 1024;
const DROP_CLIENT_BYTES = 8 * 1024 * 1024;

export class Room {
  readonly world: World;
  private slots = new Map<number, Slot>();
  private conns = new Set<Conn>();
  private nextSlotId = 1;
  private loopHandle: NodeJS.Timeout | null = null;
  private hbHandle: NodeJS.Timeout | null = null;
  private startTime = 0;
  private ticks = 0;
  private closing = false;
  readonly opts: RoomOptions;
  /** Métricas simples de desempenho do tick. */
  readonly perf = { tickMsAvg: 0, tickMsMax: 0, samples: 0, snapshotBytes: 0 };

  constructor(opts: RoomOptions) {
    this.opts = opts;
    this.world = new World({ seed: opts.seed ?? (Date.now() & 0x7fffffff), solo: opts.solo });
    this.world.onPhaseChange = () => this.broadcastPhase();
    this.world.onOffersChange = () => this.sendOffers();
    this.world.onModsChange = () => this.sendMods();
    this.world.onRouteChange = () => this.sendRoute();
  }

  private log(m: string): void {
    this.opts.log?.(m);
  }

  // ------------------------------------------------------------------ ciclo

  start(): void {
    this.startTime = performance.now();
    this.ticks = 0;
    const loop = (): void => {
      if (this.closing) return;
      const now = performance.now();
      let n = 0;
      // recupera atrasos (até 5 ticks) mantendo o passo fixo
      while (this.startTime + (this.ticks + 1) * TICK_MS <= now && n < 5) {
        this.ticks++;
        n++;
        this.tick();
      }
      if (n === 5) this.startTime = now - this.ticks * TICK_MS;
      const next = this.startTime + (this.ticks + 1) * TICK_MS - performance.now();
      this.loopHandle = setTimeout(loop, Math.max(0, next));
    };
    this.loopHandle = setTimeout(loop, TICK_MS);
    this.hbHandle = setInterval(() => this.heartbeat(), HEARTBEAT_MS);
  }

  stop(): void {
    this.closing = true;
    if (this.loopHandle) clearTimeout(this.loopHandle);
    if (this.hbHandle) clearInterval(this.hbHandle);
  }

  /** Encerra a sala avisando todos os clientes (anfitrião saiu/fechou o jogo). */
  close(reason: string): void {
    if (this.closing) return;
    for (const c of this.conns) this.send(c, { t: 'closing', reason });
    this.stop();
    for (const c of this.conns) {
      try {
        c.ws.close(1001, 'host closing');
      } catch {
        /* ignorado */
      }
    }
  }

  private tick(): void {
    const t0 = performance.now();
    this.world.step();
    const events = this.world.drainEvents();
    if (events.length) {
      for (const c of this.conns) {
        if (!c.slot) continue;
        for (const ev of events) {
          if (ev.k === 'deny' && ev.to !== c.slot.id) continue;
          c.events.push(ev);
        }
        // proteção de memória: cliente que não drena há muito tempo
        if (c.events.length > 4000) c.events.splice(0, c.events.length - 4000);
      }
    }
    if (this.world.tick % SNAPSHOT_EVERY === 0 && this.world.phase !== 'lobby') this.sendSnapshots();
    this.checkReconnectGrace();
    const dt = performance.now() - t0;
    const p = this.perf;
    p.samples++;
    p.tickMsAvg += (dt - p.tickMsAvg) / Math.min(p.samples, 300);
    if (dt > p.tickMsMax) p.tickMsMax = dt;
  }

  // ------------------------------------------------------------------ conexões

  onConnection(ws: WebSocket): void {
    const conn: Conn = {
      ws,
      slot: null,
      tokens: this.opts.rate?.capacity ?? 150,
      lastRefill: performance.now(),
      violations: 0,
      invalid: 0,
      events: [],
      lastPong: performance.now(),
      needFull: true,
      skipped: 0,
      closed: false,
    };
    this.conns.add(conn);
    ws.on('pong', () => {
      conn.lastPong = performance.now();
    });
    ws.on('message', (data, isBinary) => this.onRaw(conn, data as Buffer, isBinary));
    ws.on('close', () => this.onClose(conn));
    ws.on('error', (err) => this.log(`erro de socket: ${err.message}`));
    // cliente que não se apresenta em 10s é desconectado
    setTimeout(() => {
      if (!conn.slot && !conn.closed) this.kick(conn, 'badMessage');
    }, 10_000);
  }

  private heartbeat(): void {
    const now = performance.now();
    for (const c of this.conns) {
      if (now - c.lastPong > HEARTBEAT_TIMEOUT_MS) {
        this.log(`timeout de heartbeat: ${c.slot?.name ?? '?'}`);
        c.ws.terminate();
        continue;
      }
      if (c.ws.bufferedAmount > DROP_CLIENT_BYTES) {
        this.log(`cliente lento demais, desconectando: ${c.slot?.name ?? '?'}`);
        c.ws.terminate();
        continue;
      }
      try {
        c.ws.ping();
      } catch {
        /* ignorado */
      }
    }
  }

  private send(c: Conn, m: ServerMessage): void {
    if (c.closed || c.ws.readyState !== 1) return;
    c.ws.send(JSON.stringify(m));
  }

  private broadcast(m: ServerMessage): void {
    const s = JSON.stringify(m);
    for (const c of this.conns) if (c.slot && !c.closed && c.ws.readyState === 1) c.ws.send(s);
  }

  private reject(c: Conn, code: RejectCode): void {
    this.send(c, { t: 'reject', code, msg: REJECT_TEXT[code] });
    setTimeout(() => c.ws.close(4000, code), 50);
  }

  private kick(c: Conn, code: RejectCode): void {
    this.reject(c, code);
  }

  private onClose(c: Conn): void {
    c.closed = true;
    this.conns.delete(c);
    const s = c.slot;
    if (!s || s.conn !== c) return;
    s.conn = null;
    if (this.world.phase === 'lobby') {
      this.slots.delete(s.id);
      this.log(`${s.name} saiu do lobby`);
      this.broadcastLobby();
      return;
    }
    s.disconnectedAt = performance.now();
    this.world.setConnected(s.id, false);
    this.log(`${s.name} desconectou; aguardando reconexão`);
    this.broadcast({ t: 'notice', text: `${s.name} desconectou. Aguardando reconexão por até 60s.`, kind: 'warn' });
    this.broadcastLobby();
    if (this.opts.solo && this.world.phase === 'wave') this.world.paused = true;
  }

  private checkReconnectGrace(): void {
    if (this.world.tick % 15 !== 0) return;
    const now = performance.now();
    for (const s of [...this.slots.values()]) {
      if (s.conn || this.world.phase === 'lobby') continue;
      if (now - s.disconnectedAt > RECONNECT_GRACE_MS) {
        this.slots.delete(s.id);
        this.world.removePlayer(s.id);
        this.broadcast({ t: 'notice', text: `${s.name} não voltou a tempo e saiu da partida.`, kind: 'warn' });
        this.broadcastLobby();
        if (this.slots.size === 0) this.world.resetToLobby();
      }
    }
  }

  private allowMessage(c: Conn): boolean {
    const rate = this.opts.rate ?? { capacity: 150, perSecond: 100, kickAfter: 300 };
    const now = performance.now();
    c.tokens = Math.min(rate.capacity, c.tokens + ((now - c.lastRefill) / 1000) * rate.perSecond);
    c.lastRefill = now;
    if (c.tokens < 1) {
      c.violations++;
      if (c.violations > rate.kickAfter) this.kick(c, 'rateLimit');
      return false;
    }
    c.tokens -= 1;
    return true;
  }

  private onRaw(c: Conn, data: Buffer, isBinary: boolean): void {
    if (c.closed) return;
    if (!this.allowMessage(c)) return;
    if (isBinary || data.length > MAX_MESSAGE_BYTES) {
      this.onInvalid(c);
      return;
    }
    let raw: unknown;
    try {
      raw = JSON.parse(data.toString('utf8'));
    } catch {
      this.onInvalid(c);
      return;
    }
    const m = parseClientMessage(raw);
    if (!m) {
      this.onInvalid(c);
      return;
    }
    this.onMessage(c, m);
  }

  private onInvalid(c: Conn): void {
    c.invalid++;
    if (c.invalid > 20) this.kick(c, 'badMessage');
  }

  // ------------------------------------------------------------------ mensagens

  private onMessage(c: Conn, m: ClientMessage): void {
    if (m.t === 'hello') {
      this.onHello(c, m);
      return;
    }
    const s = c.slot;
    if (!s) {
      this.onInvalid(c);
      return;
    }
    const w = this.world;
    switch (m.t) {
      case 'hb':
        this.send(c, { t: 'hb', ts: m.ts });
        break;
      case 'cls':
        this.onClass(c, s, m.cls);
        break;
      case 'ready':
        if (w.phase !== 'lobby') break;
        s.ready = m.r && s.cls !== null;
        this.broadcastLobby();
        break;
      case 'start':
        this.onStart(c, s);
        break;
      case 'in': {
        if (w.phase === 'lobby') break;
        const frames: InputFrame[] = m.i.map(([seq, mx, my, ax, ay, held, pressed]) => ({ seq, mx, my, ax, ay, held, pressed }));
        w.pushInputs(s.id, frames);
        break;
      }
      case 'upg':
        if (w.pickUpgrade(s.id, m.id)) this.log(`${s.name} confirmou ${m.id}`);
        else this.sendOffers();
        break;
      case 'vote':
        if (w.vote(s.id, m.r)) this.log(`${s.name} votou ${m.r}`);
        break;
      case 'ping': {
        const p = w.players.get(s.id);
        if (!p || w.tick - p.lastPing < sec(1.5)) break;
        p.lastPing = w.tick;
        this.broadcast({ t: 'ping', from: s.id, x: m.x, y: m.y });
        break;
      }
      case 'pause':
        if (this.opts.solo && s.host && (w.phase === 'wave' || w.phase === 'intermission')) {
          w.paused = m.p;
          this.broadcast({ t: 'paused', p: w.paused });
        }
        break;
      case 'again':
        if (s.host && (w.phase === 'victory' || w.phase === 'defeat')) this.backToLobby();
        break;
      case 'bye':
        c.ws.close(1000, 'bye');
        break;
      case 'dbg':
        if (process.env.UV_DEBUG === '1' && s.host && w.phase !== 'lobby') w.debug(m.c, m.n, m.s);
        break;
    }
  }

  private onHello(c: Conn, m: Extract<ClientMessage, { t: 'hello' }>): void {
    if (c.slot) return;
    if (m.v !== PROTOCOL_VERSION || m.gv !== GAME_VERSION) {
      this.reject(c, 'version');
      return;
    }
    // reconexão por token de sessão
    if (m.token) {
      const s = [...this.slots.values()].find((x) => x.token === m.token);
      if (s) {
        if (s.conn && !s.conn.closed) {
          // sessão antiga ainda aberta (ex.: queda não detectada): substitui
          const old = s.conn;
          old.slot = null;
          try {
            old.ws.close(4001, 'replaced');
          } catch {
            /* ignorado */
          }
        }
        s.conn = c;
        c.slot = s;
        c.needFull = true;
        this.world.setConnected(s.id, true);
        if (this.opts.solo) this.world.paused = false;
        this.send(c, { t: 'welcome', id: s.id, token: s.token, v: PROTOCOL_VERSION, max: this.opts.maxPlayers, pw: this.opts.password !== '', reconnect: true });
        this.sendLobbyTo(c);
        this.sendPhaseTo(c);
        this.sendOffers();
        this.sendRoute();
        this.sendMods(c);
        if (this.world.phase !== 'lobby') this.broadcast({ t: 'notice', text: `${s.name} reconectou.`, kind: 'info' });
        this.broadcastLobby();
        this.log(`${s.name} reconectou`);
        return;
      }
    }
    if (this.world.phase !== 'lobby') {
      this.reject(c, 'inProgress');
      return;
    }
    const isHost = m.hostKey !== null && m.hostKey === this.opts.hostKey;
    if (!isHost && this.opts.password !== '' && m.pw !== this.opts.password) {
      this.reject(c, 'password');
      return;
    }
    if (this.slots.size >= this.opts.maxPlayers) {
      this.reject(c, 'full');
      return;
    }
    let name = sanitizeName(m.name);
    if (name.length === 0) {
      this.reject(c, 'badName');
      return;
    }
    // apelidos repetidos recebem sufixo
    const names = new Set([...this.slots.values()].map((s) => s.name.toLowerCase()));
    if (names.has(name.toLowerCase())) {
      let k = 2;
      while (names.has(`${name.slice(0, 13)} ${k}`.toLowerCase())) k++;
      name = `${name.slice(0, 13)} ${k}`;
    }
    const slot: Slot = {
      id: this.nextSlotId++,
      name,
      token: randomBytes(18).toString('base64url'),
      cls: null,
      ready: false,
      host: isHost && ![...this.slots.values()].some((s) => s.host),
      conn: c,
      disconnectedAt: 0,
    };
    this.slots.set(slot.id, slot);
    c.slot = slot;
    this.send(c, { t: 'welcome', id: slot.id, token: slot.token, v: PROTOCOL_VERSION, max: this.opts.maxPlayers, pw: this.opts.password !== '', reconnect: false });
    this.sendPhaseTo(c);
    this.broadcastLobby();
    this.log(`${name} entrou${slot.host ? ' (anfitrião)' : ''}`);
  }

  private onClass(c: Conn, s: Slot, cls: ClassId | null): void {
    if (this.world.phase !== 'lobby') return;
    if (cls !== null) {
      const owner = [...this.slots.values()].find((o) => o !== s && o.cls === cls);
      if (owner) {
        this.send(c, { t: 'clsDenied', cls, by: owner.name });
        return;
      }
    }
    s.cls = cls;
    s.ready = false;
    this.broadcastLobby();
  }

  private onStart(c: Conn, s: Slot): void {
    if (!s.host || this.world.phase !== 'lobby') return;
    const all = [...this.slots.values()];
    if (all.length === 0 || !all.every((x) => x.cls && x.ready && x.conn)) {
      this.send(c, { t: 'notice', text: 'Todos precisam escolher uma classe e marcar “Pronto”.', kind: 'warn' });
      return;
    }
    for (const x of all) this.world.addPlayer(x.id, x.name, x.cls as ClassId);
    for (const x of this.conns) x.needFull = true;
    this.world.startMatch();
    this.sendMods();
    this.log(`partida iniciada com ${all.length} jogador(es)`);
  }

  private backToLobby(): void {
    for (const s of [...this.slots.values()]) {
      if (!s.conn) this.slots.delete(s.id);
      else s.ready = false;
    }
    this.world.resetToLobby();
    this.broadcastLobby();
  }

  // ------------------------------------------------------------------ estado para clientes

  private lobbyPlayers(): LobbyPlayer[] {
    return [...this.slots.values()].map((s) => ({ id: s.id, name: s.name, cls: s.cls, ready: s.ready, host: s.host, conn: s.conn !== null }));
  }

  private broadcastLobby(): void {
    this.broadcast({ t: 'lobby', players: this.lobbyPlayers(), max: this.opts.maxPlayers, phase: this.world.phase });
  }

  private sendLobbyTo(c: Conn): void {
    this.send(c, { t: 'lobby', players: this.lobbyPlayers(), max: this.opts.maxPlayers, phase: this.world.phase });
  }

  private phaseMessage(): ServerMessage {
    const w = this.world;
    const end = w.phase === 'victory' || w.phase === 'defeat';
    return {
      t: 'phase', phase: w.phase, wave: w.wave, title: w.waveTitle, tm: w.phaseTimer, stats: end ? w.matchStats() : null,
      time: Math.round((w.tick - w.matchStartTick) / 30), ch: w.chapter.n, map: mapIndex(w.map.id), route: w.route === 'risk' ? 1 : w.route === 'safe' ? 2 : 0,
    };
  }

  private broadcastPhase(): void {
    this.broadcast(this.phaseMessage());
    this.broadcastLobby();
  }

  private sendPhaseTo(c: Conn): void {
    this.send(c, this.phaseMessage());
  }

  private sendOffers(): void {
    const w = this.world;
    if (w.phase !== 'intermission') return;
    const connected = [...this.slots.values()].filter((s) => s.conn);
    const readyCount = connected.filter((s) => w.picks.has(s.id)).length;
    for (const s of this.slots.values()) {
      if (!s.conn) continue;
      const p = w.players.get(s.id);
      this.send(s.conn, {
        t: 'upgOffer',
        options: (w.offers.get(s.id) ?? []).filter((id) => UPGRADE_BY_ID.has(id)),
        picked: w.picks.get(s.id) ?? null,
        mine: p ? { ...p.mods } : {},
        readyCount,
        total: connected.length,
        bonus: w.offerBonus.get(s.id) ?? '',
      });
    }
  }

  private sendRoute(): void {
    const w = this.world;
    if (w.phase !== 'route' && !w.routeResult) return;
    const { risk, safe } = w.voteCounts();
    const total = [...this.slots.values()].filter((s) => s.conn).length;
    for (const s of this.slots.values()) {
      if (!s.conn) continue;
      this.send(s.conn, { t: 'route', risk, safe, total, mine: w.votes.get(s.id) ?? null, tm: w.phaseTimer, result: w.routeResult });
    }
  }

  private sendMods(only?: Conn): void {
    for (const s of this.slots.values()) {
      if (!s.conn || (only && s.conn !== only)) continue;
      const p = this.world.players.get(s.id);
      this.send(s.conn, { t: 'mods', mods: p ? { ...p.mods } : {} });
    }
  }

  private sendSnapshots(): void {
    const w = this.world;
    const shared =
      `,"p":${JSON.stringify(w.snapPlayers())}` +
      `,"e":${JSON.stringify(w.snapEnemies())}` +
      `,"m":${JSON.stringify(snapMinions(w))}` +
      `,"it":${JSON.stringify(snapPickups(w, w.hasNecro()))}` +
      `,"bk":${JSON.stringify(snapBreaks(w))}` +
      `,"pr":${JSON.stringify(w.snapProjectiles())}` +
      `,"z":${JSON.stringify(w.snapZones())}` +
      `,"w":${JSON.stringify(w.waveInfo())}`;
    this.perf.snapshotBytes = shared.length;
    for (const c of this.conns) {
      const s = c.slot;
      if (!s || c.closed || c.ws.readyState !== 1) continue;
      if (c.ws.bufferedAmount > SLOW_CLIENT_BYTES) {
        // cliente lento: descarta este snapshot (obsoleto); eventos ficam na fila
        c.skipped++;
        continue;
      }
      const you = JSON.stringify(w.snapYou(s.id));
      const ev = JSON.stringify(c.events);
      c.events = [];
      const full = c.needFull;
      c.needFull = false;
      c.ws.send(`{"t":"snap","tick":${w.tick},"full":${full},"you":${you}${shared},"ev":${ev}}`);
    }
  }

  /** Informações para diagnóstico/testes. */
  info(): { players: number; phase: string; classes: (ClassId | null)[] } {
    return { players: this.slots.size, phase: this.world.phase, classes: [...this.slots.values()].map((s) => s.cls) };
  }
}

export const classExists = (c: string): boolean => c in CLASSES;
