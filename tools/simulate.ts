/**
 * Simulação sem interface de uma partida completa com bots simples (sem rede), para medir
 * a duração das ondas. Os bots são piores que humanos em posicionamento, então os tempos
 * servem como limite superior aproximado. Uso: npx tsx tools/simulate.ts [classes...]
 */
import { CLASS_IDS, type ClassId } from '../src/shared/config/classes.js';
import { TICK_RATE } from '../src/shared/constants.js';
import { BTN } from '../src/shared/movement.js';
import type { Player } from '../src/server/world/types.js';
import { World } from '../src/server/world/world.js';

const classes = (process.argv.slice(2).length ? process.argv.slice(2) : ['berserker']) as ClassId[];
for (const c of classes) if (!CLASS_IDS.includes(c)) throw new Error(`classe inválida: ${c}`);
const w = new World({ seed: 7, solo: classes.length === 1 });
classes.forEach((c, i) => w.addPlayer(i + 1, `Bot${i + 1}`, c));
w.startMatch();
w.god = true;
const startWave = Number(process.env.SIM_WAVE ?? 1);
if (startWave > 1) w.debug('wave', startWave, '');
const seq = new Map<number, number>();
const brain = (p: Player): { mx: number; my: number; ax: number; ay: number; pressed: number; held: number } => {
  let best: { x: number; y: number } | null = null;
  let bd = Infinity;
  for (const e of w.enemies.values()) {
    if (e.state === 'dead' || e.state === 'spawn') continue;
    const d = Math.hypot(e.x - p.x, e.y - p.y);
    if (d < bd) {
      bd = d;
      best = e;
    }
  }
  if (!best) return { mx: (w.map.campfire.x - p.x) / 300, my: (w.map.campfire.y + 60 - p.y) / 300, ax: p.x + 10, ay: p.y, pressed: 0, held: 0 };
  const ranged = p.cls === 'hunter' || p.cls === 'mage';
  const want = ranged ? 140 : p.cls === 'dog' ? 50 : 24;
  const dx = best.x - p.x;
  const dy = best.y - p.y;
  const l = Math.hypot(dx, dy) || 1;
  const dir = bd > want ? 1 : bd < want * 0.6 ? -1 : 0;
  const t = w.tick;
  let pressed = BTN.attack;
  if (t % 45 === p.id * 3) pressed |= BTN.q;
  if (t % 70 === p.id * 5) pressed |= BTN.e;
  if (p.ult >= 100) pressed |= BTN.r;
  return { mx: (dx / l) * dir, my: (dy / l) * dir, ax: best.x, ay: best.y, pressed, held: 0 };
};
const waveStart = new Map<number, number>();
let lastPhase = '';
const limit = TICK_RATE * 60 * Number(process.env.SIM_MINUTES ?? 60);
while (w.phase !== 'victory' && w.phase !== 'defeat' && w.tick < limit) {
  for (const p of w.players.values()) {
    const s = (seq.get(p.id) ?? 0) + 1;
    seq.set(p.id, s);
    const b = brain(p);
    w.pushInputs(p.id, [{ seq: s, ...b }]);
  }
  w.step();
  w.drainEvents();
  if (process.env.SIM_DEBUG && w.tick % 300 === 0 && w.phase === 'wave') {
    const alive = [...w.enemies.values()].filter((e) => e.state !== 'dead').map((e) => `${e.type}@${e.x | 0},${e.y | 0}:${e.state}`);
    const sv = [...w.minions.values()].find((m) => m.kind === 'survivor');
    console.log(`surv=${sv ? `${sv.x | 0},${sv.y | 0} f=${w.fireField?.at(sv.x, sv.y)}` : '-'} t=${(w.tick / 30) | 0}s onda ${w.wave} restantes=${w.director.remaining()} ev=${JSON.stringify(w.objectives.info().ev)} bloq=${w.objectives.blocking()} vivos=${alive.slice(0, 6).join(' ')}`);
  }
  if (w.phase === 'intermission' && w.phaseTimer > 60) w.phaseTimer = 60; // escolha rápida de melhoria (~2 s)
  if (w.phase === 'route' && w.phaseTimer > 30) {
    for (const p of w.players.values()) w.vote(p.id, p.id % 2 ? 'risk' : 'safe');
  }
  const key = `${w.phase}:${w.wave}`;
  if (key !== lastPhase) {
    if (w.phase === 'wave') waveStart.set(w.wave, w.tick);
    if (w.phase === 'travel') console.log(`— viagem para o capítulo ${w.chapter.n}: ${w.chapter.name} (rota: ${w.route})`);
    if (w.phase === 'intermission' || (w.phase as string) === 'victory') {
      const t0 = waveStart.get(w.wave) ?? 0;
      console.log(`onda ${String(w.wave).padStart(2)}: ${((w.tick - t0) / TICK_RATE).toFixed(0)}s`);
    }
    lastPhase = key;
  }
}
const ev = { minions: w.minions.size, pickups: w.pickups.length };
console.log('estado final', JSON.stringify(ev));
console.log(`resultado: ${w.phase} em ${(w.tick / TICK_RATE / 60).toFixed(1)} min de simulação (classes: ${classes.join(', ')})`);
