import { afterEach, describe, expect, it } from 'vitest';
import { type RunningServer, startServer } from '../src/server/net.js';
import type { ServerMessage } from '../src/shared/protocol.js';
import { BTN } from '../src/shared/movement.js';
import { Bot, sleep } from './helpers/bot.js';
import { spawnMinion } from '../src/server/world/minions.js';

const HOSTKEY = 'chave-teste';
let srv: RunningServer | null = null;
const bots: Bot[] = [];

async function server(opts: Partial<{ password: string; maxPlayers: number; solo: boolean }> = {}): Promise<string> {
  srv = await startServer({ host: '127.0.0.1', port: 0, password: opts.password ?? '', maxPlayers: opts.maxPlayers ?? 6, hostKey: HOSTKEY, solo: opts.solo ?? false, seed: 5 });
  return `ws://127.0.0.1:${srv.port}`;
}
function bot(url: string, name: string, o: ConstructorParameters<typeof Bot>[2] = {}): Bot {
  const b = new Bot(url, name, o);
  bots.push(b);
  return b;
}
afterEach(async () => {
  for (const b of bots.splice(0)) b.close();
  if (srv) await srv.close('fim do teste');
  srv = null;
});

async function lobbyWith(url: string, n: number, classes: string[]): Promise<Bot[]> {
  const out: Bot[] = [];
  for (let i = 0; i < n; i++) {
    const b = bot(url, `J${i + 1}`, i === 0 ? { hostKey: HOSTKEY } : {});
    const w = await b.join();
    expect(w.t).toBe('welcome');
    out.push(b);
  }
  for (let i = 0; i < n; i++) {
    out[i]?.send({ t: 'cls', cls: classes[i] });
    out[i]?.send({ t: 'ready', r: true });
  }
  await sleep(80);
  return out;
}

describe('rede: lobby e sessões', () => {
  it('dois clientes disputando a mesma classe: servidor escolhe um e avisa o outro', async () => {
    const url = await server();
    const a = bot(url, 'Ana', { hostKey: HOSTKEY });
    const b = bot(url, 'Beto');
    await a.join();
    await b.join();
    // envio "simultâneo"
    a.send({ t: 'cls', cls: 'dog' });
    b.send({ t: 'cls', cls: 'dog' });
    const denied = await Promise.race([
      a.wait((m) => m.t === 'clsDenied', 1500).then((m) => ({ who: 'a', m })),
      b.wait((m) => m.t === 'clsDenied', 1500).then((m) => ({ who: 'b', m })),
    ]);
    expect(denied.m).toMatchObject({ t: 'clsDenied', cls: 'dog' });
    await sleep(50);
    expect(srv?.room.info().classes.filter((c) => c === 'dog').length).toBe(1);
  });

  it('versão incompatível, senha errada e sala cheia são recusadas com motivo', async () => {
    const url = await server({ password: 'lua', maxPlayers: 2 });
    const v = await bot(url, 'Velho', { v: 999 }).join();
    expect(v).toMatchObject({ t: 'reject', code: 'version' });
    const pw = await bot(url, 'Xereta', { pw: 'sol' }).join();
    expect(pw).toMatchObject({ t: 'reject', code: 'password' });
    expect((await bot(url, 'Host', { hostKey: HOSTKEY }).join()).t).toBe('welcome');
    expect((await bot(url, 'Amigo', { pw: 'lua' }).join()).t).toBe('welcome');
    const full = await bot(url, 'Terceiro', { pw: 'lua' }).join();
    expect(full).toMatchObject({ t: 'reject', code: 'full' });
  });

  it('só o anfitrião inicia; exige todos prontos', async () => {
    const url = await server();
    const [h, g] = await lobbyWith(url, 2, ['tank', 'mage']);
    g?.send({ t: 'start' });
    await sleep(100);
    expect(srv?.room.world.phase).toBe('lobby');
    g?.send({ t: 'ready', r: false });
    await sleep(50);
    h?.send({ t: 'start' });
    const n = await h?.wait((m) => m.t === 'notice');
    expect(n).toBeTruthy();
    g?.send({ t: 'ready', r: true });
    await sleep(50);
    h?.send({ t: 'start' });
    await h?.wait((m) => m.t === 'phase' && m.phase === 'wave');
    expect(srv?.room.world.phase).toBe('wave');
  });

  it('payloads inválidos são ignorados e o cliente abusivo é desconectado', async () => {
    const url = await server();
    const a = bot(url, 'Ruim', { hostKey: HOSTKEY });
    await a.join();
    a.send('{isso não é json');
    a.send({ t: 'in', i: [[1, 99, 0, 0, 0, 0, 0]] });
    a.send({ t: 'cls', cls: 'dragao' });
    await sleep(50);
    expect(a.closed).toBe(false);
    for (let i = 0; i < 30; i++) a.send({ t: 'nada' });
    const r = await a.wait((m) => m.t === 'reject');
    expect(r).toMatchObject({ code: 'badMessage' });
  });
});

describe('rede: partida sincronizada', () => {
  it('duas conexões compartilham o mesmo estado; servidor valida movimento e ignora inputs repetidos', async () => {
    const url = await server();
    const [a, b] = await lobbyWith(url, 2, ['berserker', 'hunter']);
    a?.send({ t: 'start' });
    await a?.wait((m) => m.t === 'phase' && m.phase === 'wave');
    await sleep(300);
    const sa = a?.lastSnap();
    const sb = b?.lastSnap();
    expect(sa && sb).toBeTruthy();
    // ambos veem os dois jogadores
    expect(sa?.p.length).toBe(2);
    expect(sb?.p.length).toBe(2);
    const world = srv?.room.world;
    const pa = world?.players.get(a?.id ?? 0);
    const x0 = pa?.x ?? 0;
    // anda para a direita por ~1s
    for (let i = 0; i < 30; i++) {
      a?.input(1, 0, x0 + 100, pa?.y ?? 0);
      await sleep(33);
    }
    await sleep(150);
    const moved = (pa?.x ?? 0) - x0;
    expect(moved).toBeGreaterThan(60);
    expect(moved).toBeLessThan(130); // velocidade limitada pelo servidor (104 px/s)
    // inputs repetidos (mesmo seq) não movem de novo
    const x1 = pa?.x ?? 0;
    const dup = JSON.stringify({ t: 'in', i: [[a?.seq ?? 0, 1, 0, 0, 0, 0, 0]] });
    for (let i = 0; i < 20; i++) a?.send(dup);
    await sleep(200);
    expect(Math.abs((pa?.x ?? 0) - x1)).toBeLessThan(0.01);
    // o outro cliente enxerga a posição autoritativa
    await sleep(120);
    const snapB = b?.lastSnap();
    const seen = snapB?.p.find((p) => p.id === a?.id);
    expect(Math.abs((seen?.x ?? 0) - (pa?.x ?? 0))).toBeLessThan(1);
    // ack reflete o último input processado
    expect(a?.lastSnap()?.you?.ack).toBe(a?.seq);
  });

  it('cooldown e esquiva confirmados pelo servidor', async () => {
    const url = await server();
    const [a] = await lobbyWith(url, 1, ['vampire']);
    a?.send({ t: 'start' });
    await a?.wait((m) => m.t === 'phase' && m.phase === 'wave');
    const p = srv?.room.world.players.get(a?.id ?? 0);
    a?.input(1, 0, 0, 0, 0, BTN.e);
    await sleep(120);
    expect(p?.cd.e).toBeGreaterThan(0);
    a?.input(0, 0, 0, 0, 0, BTN.e);
    const deny = await a?.wait((m) => m.t === 'snap' && m.ev.some((e) => e.k === 'deny' && e.r === 'cd'));
    expect(deny).toBeTruthy();
    // cliente real envia inputs a 30 Hz; o deslocamento forçado avança por input
    for (let i = 0; i < 12; i++) {
      a?.input(0, 0, 0, 0);
      await sleep(33);
    }
    a?.input(1, 0, 0, 0, 0, BTN.dodge);
    await sleep(70);
    expect(p?.lastDodgeTick).toBeGreaterThan(0);
  });

  it('desconexão e reconexão preservam classe e estado; estado completo ao voltar', async () => {
    const url = await server();
    const [a, b] = await lobbyWith(url, 2, ['tank', 'dog']);
    a?.send({ t: 'start' });
    await a?.wait((m) => m.t === 'phase' && m.phase === 'wave');
    const bid = b?.id ?? 0;
    const token = b?.token ?? '';
    const pb = srv?.room.world.players.get(bid);
    pb!.hp = 33;
    b?.ws.terminate();
    await a?.wait((m) => m.t === 'notice' && m.text.includes('desconectou'));
    expect(srv?.room.world.players.get(bid)?.connected).toBe(false);
    // novo jogador sem token não entra no meio da partida
    const intruso = await bot(url, 'Intruso').join();
    expect(intruso).toMatchObject({ t: 'reject', code: 'inProgress' });
    const b2 = bot(url, 'Dog', { token });
    const w = (await b2.join()) as Extract<ServerMessage, { t: 'welcome' }>;
    expect(w).toMatchObject({ t: 'welcome', id: bid, reconnect: true });
    const snap = await b2.wait<Extract<ServerMessage, { t: 'snap' }>>((m) => m.t === 'snap');
    expect(snap.full).toBe(true);
    const me = snap.p.find((p) => p.id === bid);
    expect(me?.c).toBe('dog');
    expect(me?.hp).toBe(33);
    expect(srv?.room.world.players.get(bid)?.connected).toBe(true);
  });

  it('anfitrião encerrando avisa os demais com mensagem clara', async () => {
    const url = await server();
    const [, g] = await lobbyWith(url, 2, ['tank', 'dog']);
    const closing = g?.wait((m) => m.t === 'closing');
    await srv?.close('O anfitrião encerrou a partida.');
    srv = null;
    expect(await closing).toMatchObject({ t: 'closing', reason: 'O anfitrião encerrou a partida.' });
    await sleep(100);
    expect(g?.closed).toBe(true);
  });

  it('vitória/derrota → jogar novamente sem estado residual', async () => {
    const url = await server();
    const [a, b] = await lobbyWith(url, 2, ['mage', 'berserker']);
    a?.send({ t: 'start' });
    await a?.wait((m) => m.t === 'phase' && m.phase === 'wave');
    const w = srv?.room.world;
    for (const p of w?.players.values() ?? []) w?.damagePlayerRaw(p, 9999, false);
    const end = await b?.wait<Extract<ServerMessage, { t: 'phase' }>>((m) => m.t === 'phase' && m.phase === 'defeat');
    expect(end?.stats).toBeTruthy();
    b?.send({ t: 'again' }); // não-anfitrião não pode
    await sleep(100);
    expect(w?.phase).toBe('defeat');
    if (a) a.msgs = [];
    a?.send({ t: 'again' });
    await a?.wait((m) => m.t === 'phase' && m.phase === 'lobby');
    const lobby = await a?.wait<Extract<ServerMessage, { t: 'lobby' }>>((m) => m.t === 'lobby' && m.phase === 'lobby');
    expect(lobby?.players.every((p) => !p.ready && p.cls !== null)).toBe(true);
    a?.send({ t: 'ready', r: true });
    b?.send({ t: 'ready', r: true });
    await sleep(60);
    a?.send({ t: 'start' });
    await a?.wait((m) => m.t === 'phase' && m.phase === 'wave');
    expect(w?.wave).toBe(1);
    for (const p of w?.players.values() ?? []) {
      expect(p.hp).toBe(p.maxHp);
      expect(p.status).toBe(0);
    }
  });

  it('modo solo: pausa só no solo', async () => {
    const url = await server({ solo: true });
    const a = bot(url, 'Solo', { hostKey: HOSTKEY });
    await a.join();
    a.send({ t: 'cls', cls: 'hunter' });
    a.send({ t: 'ready', r: true });
    await sleep(50);
    a.send({ t: 'start' });
    await a.wait((m) => m.t === 'phase' && m.phase === 'wave');
    a.send({ t: 'pause', p: true });
    await a.wait((m) => m.t === 'paused' && m.p);
    const t0 = srv?.room.world.tick ?? 0;
    await sleep(200);
    expect(srv?.room.world.tick).toBe(t0);
    a.send({ t: 'pause', p: false });
    await sleep(200);
    expect(srv?.room.world.tick).toBeGreaterThan(t0);
  });

  it('v0.2 em rede: confirmação de carta, votação de rota, viagem com troca de mapa e servos no snapshot', async () => {
    const url = await server();
    const [a, b] = await lobbyWith(url, 2, ['necromancer', 'tank']);
    a?.send({ t: 'start' });
    await a?.wait((m) => m.t === 'phase' && m.phase === 'wave');
    const w = srv?.room.world;
    if (!w || !a || !b) throw new Error('sem mundo');
    // servos do Necromante aparecem para os dois clientes
    const pa = w.players.get(a.id) as NonNullable<ReturnType<typeof w.players.get>>;
    spawnMinion(w, a.id, 'thrall', pa.x + 30, pa.y, { hp: 50, ttl: 900, speed: 90, damage: 5 });
    const snapB = await b.wait<Extract<ServerMessage, { t: 'snap' }>>((m) => m.t === 'snap' && m.m.length > 0);
    expect(snapB.m[0]?.[8]).toBe(a.id);
    // fim do capítulo I
    w.debug('wave', 10, '');
    w.director.debugClear();
    for (const e of w.enemies.values()) w.killEnemy(e, null);
    const offer = await a.wait<Extract<ServerMessage, { t: 'upgOffer' }>>((m) => m.t === 'upgOffer');
    expect(offer.picked).toBeNull();
    const pick = offer.options[0] as string;
    a.send({ t: 'upg', id: pick });
    a.send({ t: 'upg', id: offer.options[1] as string }); // segunda confirmação é ignorada
    const locked = await a.wait<Extract<ServerMessage, { t: 'upgOffer' }>>((m) => m.t === 'upgOffer' && m.picked !== null);
    expect(locked.picked).toBe(pick);
    const offerB = await b.wait<Extract<ServerMessage, { t: 'upgOffer' }>>((m) => m.t === 'upgOffer');
    b.send({ t: 'upg', id: offerB.options[0] as string });
    // votação: empate vira rota segura
    await a.wait((m) => m.t === 'phase' && m.phase === 'route');
    a.send({ t: 'vote', r: 'risk' });
    b.send({ t: 'vote', r: 'safe' });
    const res = await a.wait<Extract<ServerMessage, { t: 'route' }>>((m) => m.t === 'route' && m.result !== null);
    expect(res.result).toBe('safe');
    const travel = await b.wait<Extract<ServerMessage, { t: 'phase' }>>((m) => m.t === 'phase' && m.phase === 'travel');
    expect(travel.ch).toBe(2);
    expect(travel.map).toBe(1);
    const snap = await b.wait<Extract<ServerMessage, { t: 'snap' }>>((m) => m.t === 'snap' && m.w.ph === 'travel');
    expect(snap.w.mp).toBe(1);
    expect(snap.m.length).toBe(0); // servos limpos na troca de mapa
    expect(w.players.get(a.id)?.mods[pick]).toBe(1);
  }, 20000);
});
