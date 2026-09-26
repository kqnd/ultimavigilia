/**
 * Medição: 6 clientes WebSocket reais + ~100 inimigos ativos por 30 s.
 * Registra tempo de tick do servidor, tamanho dos snapshots e tráfego por cliente.
 * Uso: npm run bench [-- segundos inimigos]
 */
import os from 'node:os';
import { startServer } from '../src/server/net.js';
import { CLASS_IDS } from '../src/shared/config/classes.js';
import { BTN } from '../src/shared/movement.js';
import { Bot, sleep } from '../tests/helpers/bot.js';

const SECONDS = Number(process.argv[2] ?? 30);
const TARGET = Number(process.argv[3] ?? 100);

const srv = await startServer({ host: '127.0.0.1', port: 0, password: '', maxPlayers: 6, hostKey: 'bench', solo: false, seed: 1 });
const url = `ws://127.0.0.1:${srv.port}`;
const bots: Bot[] = [];
for (let i = 0; i < 6; i++) {
  const b = new Bot(url, `Bot${i + 1}`, i === 0 ? { hostKey: 'bench' } : {});
  await b.join();
  b.send({ t: 'cls', cls: CLASS_IDS[i] });
  b.send({ t: 'ready', r: true });
  bots.push(b);
}
await sleep(200);
bots[0]?.send({ t: 'start' });
await sleep(300);
const w = srv.room.world;
w.god = true;
w.phaseTimer = 0;

// contabiliza tráfego recebido por cliente
const rx = bots.map(() => 0);
const snaps = bots.map(() => 0);
bots.forEach((b, i) => b.ws.on('message', (d: Buffer) => {
  rx[i] = (rx[i] ?? 0) + d.length;
  if (d[6] === 115) snaps[i] = (snaps[i] ?? 0) + 1; // {"t":"s...
}));

// inputs a 30 Hz por bot, com movimento circular e ataques
let running = true;
const inputLoop = async (b: Bot, i: number): Promise<void> => {
  let t = 0;
  while (running) {
    t++;
    const a = t / 40 + i;
    const p = w.players.get(b.id);
    const ax = (p?.x ?? 1000) + Math.cos(a * 3) * 80;
    const ay = (p?.y ?? 600) + Math.sin(a * 3) * 80;
    const pressed = t % 8 === 0 ? BTN.attack : t % 97 === 0 ? BTN.q : t % 131 === 0 ? BTN.e : t % 71 === 0 ? BTN.dodge : 0;
    b.input(Math.cos(a) * 0.8, Math.sin(a) * 0.8, ax, ay, pressed & BTN.attack ? BTN.attack : 0, pressed);
    await sleep(33);
  }
};
bots.forEach((b, i) => void inputLoop(b, i));

// mantém ~TARGET inimigos vivos
const types = ['shambler', 'shambler', 'runner', 'acolyte', 'werewolf', 'father'];
const topUp = setInterval(() => {
  const alive = [...w.enemies.values()].filter((e) => e.state !== 'dead').length;
  const need = TARGET - alive;
  for (let k = 0; k < need; k++) {
    const g = w.map.spawns[k % w.map.spawns.length];
    if (!g) continue;
    const e = w.spawnEnemy(types[k % types.length] as 'shambler', g.x + (k % 5) * 6, g.y + (k % 3) * 6, 6);
    e.state = 'move';
    e.hp = e.maxHp = e.maxHp * 4;
  }
}, 500);

// amostras
const samples: { alive: number; tickAvg: number; tickMax: number; bytes: number }[] = [];
let lagMax = 0;
let last = performance.now();
const lagT = setInterval(() => {
  const now = performance.now();
  lagMax = Math.max(lagMax, now - last - 50);
  last = now;
}, 50);
for (let s = 0; s < SECONDS; s++) {
  await sleep(1000);
  const alive = [...w.enemies.values()].filter((e) => e.state !== 'dead').length;
  samples.push({ alive, tickAvg: srv.room.perf.tickMsAvg, tickMax: srv.room.perf.tickMsMax, bytes: srv.room.perf.snapshotBytes });
  srv.room.perf.tickMsMax = 0;
}
running = false;
clearInterval(topUp);
clearInterval(lagT);

const avg = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
const cpu = os.cpus();
const report = {
  data: new Date().toISOString(),
  hardware: { cpu: cpu[0]?.model ?? '?', nucleos: cpu.length, memoriaGB: Math.round(os.totalmem() / 1e9), plataforma: `${os.platform()} ${os.release()}`, node: process.version },
  condicoes: `${SECONDS}s, 6 clientes WebSocket locais (loopback), alvo de ${TARGET} inimigos ativos, jogadores invulneráveis, inputs a 30 Hz`,
  inimigosAtivosMedia: Math.round(avg(samples.map((s) => s.alive))),
  tickMsMedio: Number(avg(samples.map((s) => s.tickAvg)).toFixed(3)),
  tickMsPiorPorSegundo: Number(Math.max(...samples.map((s) => s.tickMax)).toFixed(3)),
  orcamentoTickMs: 33.33,
  snapshotBytesMedio: Math.round(avg(samples.map((s) => s.bytes))),
  kbPorSegundoPorCliente: Math.round(avg(rx) / SECONDS / 1024),
  snapshotsPorSegundoPorCliente: Number((avg(snaps) / SECONDS).toFixed(1)),
  atrasoMaxLoopEventosMs: Number(lagMax.toFixed(1)),
  tickMsPiorPorSegundoSerie: samples.map((s) => Number(s.tickMax.toFixed(1))),
  tickMsP95: Number([...samples.map((s) => s.tickMax)].sort((a, b) => a - b)[Math.floor(samples.length * 0.95)]?.toFixed(2) ?? 0),
};
console.log(JSON.stringify(report, null, 2));
for (const b of bots) b.close();
await srv.close('fim');
process.exit(0);
