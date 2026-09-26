/**
 * Simulação headless de balanceamento: um bot "competente" joga sozinho uma classe até a onda N
 * e mede cura, dano recebido, tempo com vida baixa e quedas por onda.
 *
 * As métricas vêm só de deltas de vida observados de fora (funciona em qualquer versão do
 * servidor), então o mesmo script compara a versão anterior e a atual.
 *
 * Uso: node --import tsx tools/sim.ts <classe> <ondaFinal> <seed> [--god] [--json]
 */
import type { ClassId } from '../src/shared/config/classes.js';
import { BTN, type InputFrame } from '../src/shared/movement.js';
import { dist } from '../src/shared/math.js';
import { World } from '../src/server/world/world.js';
import type { Enemy, Player } from '../src/server/world/types.js';

const cls = (process.argv[2] ?? 'vampire') as ClassId;
const lastWave = Number(process.argv[3] ?? 20);
const seed = Number(process.argv[4] ?? 1);
const god = process.argv.includes('--god');
/** Imortal: golpe letal conta uma "queda virtual" e volta com 50% (mede o perigo sem encerrar a corrida). */
const immortal = process.argv.includes('--immortal');
let virtualDowns = 0;
const asJson = process.argv.includes('--json');

interface WaveStats {
  wave: number;
  healed: number;
  taken: number;
  lowTicks: number;
  ticks: number;
  downs: number;
  minHpPct: number;
}

const w = new World({ seed, solo: true });
w.addPlayer(1, 'Bot', cls);
w.startMatch();
w.god = god;
const p = w.players.get(1) as Player;
const srcDmg = new Map<string, number>();
const origRaw = w.damagePlayerRaw.bind(w);
w.damagePlayerRaw = (pl, raw, heavy, dot) => {
  const dmg = Math.max(1, Math.round(raw));
  if (immortal && pl.hp - dmg <= 0) {
    virtualDowns++;
    if (stats) stats.downs++;
    pl.hp = Math.round(pl.maxHp * 0.5) + dmg;
    lastHp = pl.hp - dmg;
  }
  origRaw(pl, raw, heavy, dot);
};
const origHit = w.hitPlayer.bind(w);
w.hitPlayer = (pl, h) => {
  const before = pl.hp;
  const r = origHit(pl, h);
  const k = h.enemy ? h.enemy.type + ':' + h.enemy.atk : h.proj ? 'proj:' + h.proj.kind : 'zone';
  srcDmg.set(k, (srcDmg.get(k) ?? 0) + Math.max(0, before - pl.hp));
  return r;
};
let seq = 0;
const reacted = new Set<string>();
let dodgeCd = 0;
let lastHp = p.hp;
let stats: WaveStats | null = null;
const out: WaveStats[] = [];
let curWave = 0;
const MAX_TICKS = 30 * 60 * 90;

function nearestEnemies(): Enemy[] {
  return [...w.enemies.values()].filter((e) => e.state !== 'dead' && e.state !== 'spawn' && !e.def.objective).sort((a, b) => dist(a.x, a.y, p.x, p.y) - dist(b.x, b.y, p.x, p.y));
}

function threat(): { x: number; y: number } | null {
  for (const e of w.enemies.values()) {
    if (e.state !== 'windup' && e.state !== 'air') continue;
    // cada ataque é avaliado uma vez (id + tick em que começou)
    const key = `${e.id}:${e.atk}:${w.tick - e.stateT}`;
    if (reacted.has(key)) continue;
    const toMe = dist(e.x, e.y, p.x, p.y);
    const toTarget = dist(e.tx, e.ty, p.x, p.y);
    const reach = e.def.tier === 'boss' ? 130 : e.def.miniboss ? 80 : 55;
    const danger = (toMe < reach && e.state === 'windup') || toTarget < 45;
    if (!danger) continue;
    // só reage depois de "ver" o telegraph por alguns ticks
    if (e.stateT < 4) continue;
    reacted.add(key);
    // bot competente, não perfeito: reage a ~75% das ameaças
    if (w.rng.next() < 0.75) return { x: e.x, y: e.y };
  }
  for (const pr of w.projectiles) {
    if (pr.team !== 'e' || pr.dead) continue;
    const d = dist(pr.x, pr.y, p.x, p.y);
    if (d > 70) continue;
    const key = `pr${pr.id}`;
    if (reacted.has(key)) continue;
    reacted.add(key);
    if (w.rng.next() < 0.55) return { x: pr.x, y: pr.y };
  }
  return null;
}

let lastAlive = -1;
let lastProgress = 0;
let unstickT = 0;
function input(): Partial<InputFrame> {
  const es = nearestEnemies();
  const t = es[0];
  let mx = 0;
  let my = 0;
  let pressed = 0;
  let held = 0;
  let ax = p.x + 20;
  let ay = p.y;
  if (dodgeCd > 0) dodgeCd--;
  if (p.status !== 0) return { mx: 0, my: 0, ax, ay, held: 0, pressed: 0 };
  const hpFrac = p.hp / p.maxHp;
  const th = threat();
  if (th && dodgeCd <= 0 && p.move.stamina > 25) {
    const a = Math.atan2(p.y - th.y, p.x - th.x) + 0.6;
    mx = Math.cos(a);
    my = Math.sin(a);
    dodgeCd = 20;
    return { mx, my, ax: p.x + mx * 20, ay: p.y + my * 20, held: 0, pressed: BTN.dodge };
  }
  // objetivo: fica perto do sobrevivente da escolta
  const survivor = [...w.minions.values()].find((m) => m.kind === 'survivor');
  if (!t) {
    const goal = survivor ?? w.map.campfire;
    const d = dist(goal.x, goal.y, p.x, p.y);
    if (d > 40) {
      mx = (goal.x - p.x) / d;
      my = (goal.y - p.y) / d;
    }
    return { mx, my, ax, ay, held, pressed };
  }
  const d = dist(t.x, t.y, p.x, p.y);
  ax = t.x;
  ay = t.y;
  // bot sem pathfinding: se ficar muito tempo sem abater ninguém, volta ao centro (fogueira) por alguns segundos
  const alive = w.enemies.size;
  if (alive !== lastAlive) {
    lastAlive = alive;
    lastProgress = w.tick;
  }
  if (w.tick - lastProgress > 15 * 30) unstickT = 90;
  if (unstickT > 0) {
    unstickT--;
    if (unstickT === 0) lastProgress = w.tick;
    const g = w.map.campfire;
    const gd = dist(g.x, g.y, p.x, p.y) || 1;
    return { mx: (g.x - p.x) / gd, my: (g.y - p.y) / gd, ax, ay, held: 0, pressed: d < 250 && w.tick % 4 === 0 ? BTN.attack : 0 };
  }
  const around = es.filter((e) => dist(e.x, e.y, p.x, p.y) < 75).length;
  const melee = cls === 'vampire' || cls === 'berserker' || cls === 'tank';
  const want = melee ? 20 : cls === 'lapanha' ? 150 : 190;
  const qReady = p.cd.q <= 0;
  const eReady = p.cd.e <= 0;
  // recua com pouca vida se nada cura agora
  const retreat = hpFrac < 0.3 && !(cls === 'vampire' && (qReady || eReady)) && !(p.ult >= 100);
  if (retreat || (!melee && d < want - 40)) {
    let cx = 0;
    let cy = 0;
    for (const e of es.slice(0, 6)) {
      cx += e.x - p.x;
      cy += e.y - p.y;
    }
    const l = Math.hypot(cx, cy) || 1;
    mx = -cx / l;
    my = -cy / l;
  } else if (d > want) {
    mx = (t.x - p.x) / d;
    my = (t.y - p.y) / d;
  } else if (melee) {
    // circula levemente
    const a = Math.atan2(t.y - p.y, t.x - p.x) + Math.PI / 2;
    mx = Math.cos(a) * 0.4;
    my = Math.sin(a) * 0.4;
  }
  if (survivor && dist(survivor.x, survivor.y, p.x, p.y) > 90) {
    const sd = dist(survivor.x, survivor.y, p.x, p.y);
    mx = (survivor.x - p.x) / sd;
    my = (survivor.y - p.y) / sd;
  }
  const range = melee ? 36 : cls === 'lapanha' ? 250 : 300;
  if (d < range && w.tick % 4 === 0) pressed |= BTN.attack;
  if (cls === 'vampire') {
    if (qReady && d < 44) pressed |= BTN.q;
    else if (eReady && (around >= 3 || (hpFrac < 0.6 && around >= 1))) pressed |= BTN.e;
    if (p.ult >= 100 && around >= 4) pressed |= BTN.r;
  } else if (cls === 'lapanha') {
    // carrega a Melancia Madura por ~0,8 s quando há grupo à frente
    if (p.action?.name === 'charge') {
      held |= BTN.q;
      if (p.action.t >= 24) held &= ~BTN.q;
    } else if (qReady && d < 220 && around + es.filter((e) => dist(e.x, e.y, t.x, t.y) < 50).length >= 3 && hpFrac > 0.35) {
      pressed |= BTN.q;
      held |= BTN.q;
    }
    if (eReady && d < 110) pressed |= BTN.e;
    if (p.ult >= 100 && (hpFrac < 0.5 || around >= 5)) pressed |= BTN.r;
  } else {
    if (qReady && d < 200) pressed |= BTN.q;
    if (eReady && around >= 3) pressed |= BTN.e;
    if (p.ult >= 100) pressed |= BTN.r;
  }
  return { mx, my, ax, ay, held, pressed };
}

for (let tick = 0; tick < MAX_TICKS; tick++) {
  if (w.phase === 'defeat' || w.phase === 'victory') break;
  if (w.phase === 'intermission' || w.phase === 'route') w.phaseTimer = Math.min(w.phaseTimer, 2);
  if (w.phase === 'travel') w.phaseTimer = Math.min(w.phaseTimer, 2);
  if (w.phase === 'wave' && w.wave !== curWave) {
    if (stats) out.push(stats);
    curWave = w.wave;
    if (curWave > lastWave) break;
    stats = { wave: curWave, healed: 0, taken: 0, lowTicks: 0, ticks: 0, downs: 0, minHpPct: 100 };
    lastHp = p.hp;
  }
  if (w.intro) {
    w.step();
    continue;
  }
  if (process.env.SIMDBG && w.phase === 'wave' && stats && stats.ticks % 900 === 899) {
    console.log('dbg', w.wave, Math.round(stats.ticks / 30), 'p', Math.round(p.x), Math.round(p.y), p.hp, p.status, p.action?.name ?? '-', 'left', w.director.remaining(), [...w.enemies.values()].filter((e) => e.state !== 'dead').map((e) => `${e.type}@${Math.round(e.x)},${Math.round(e.y)}:${e.state}/${e.atk}:${e.role}`).join(' '));
  }
  const f = input();
  seq++;
  w.pushInputs(1, [{ seq, mx: 0, my: 0, ax: p.x + 10, ay: p.y, held: 0, pressed: 0, ...f }]);
  w.step();
  if (w.phase === 'wave' && stats) {
    const dh = p.hp - lastHp;
    if (p.status === 0) {
      if (dh > 0) stats.healed += dh;
      else if (dh < 0) stats.taken -= dh;
    } else if (lastHp > 0 && p.hp <= 0) {
      stats.taken += lastHp;
      stats.downs++;
    }
    stats.ticks++;
    if (p.status === 0 && p.hp / p.maxHp < 0.3) stats.lowTicks++;
    stats.minHpPct = Math.min(stats.minHpPct, Math.round((p.hp / p.maxHp) * 100));
  }
  lastHp = p.hp;
}
if (stats && !out.includes(stats)) out.push(stats);

const reached = w.phase === 'defeat' ? w.wave : Math.min(lastWave, w.wave);
const total = out.reduce(
  (s, x) => ({ healed: s.healed + x.healed, taken: s.taken + x.taken, low: s.low + x.lowTicks, ticks: s.ticks + x.ticks, downs: s.downs + x.downs }),
  { healed: 0, taken: 0, low: 0, ticks: 0, downs: 0 },
);
const res = {
  cls,
  seed,
  reached,
  virtualDowns,
  defeated: w.phase === 'defeat',
  healPerMin: Math.round((total.healed / Math.max(1, total.ticks)) * 1800),
  takenPerMin: Math.round((total.taken / Math.max(1, total.ticks)) * 1800),
  healToTaken: Number((total.healed / Math.max(1, total.taken)).toFixed(2)),
  lowPct: Number(((total.low / Math.max(1, total.ticks)) * 100).toFixed(1)),
  waves: out.map((x) => ({ w: x.wave, heal: Math.round(x.healed), taken: Math.round(x.taken), low: Number((x.lowTicks / 30).toFixed(1)), s: Math.round(x.ticks / 30), min: x.minHpPct, d: x.downs })),
};
if (process.argv.includes('--src')) console.log([...srcDmg.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12));
if (asJson) console.log(JSON.stringify(res));
else {
  console.log(`${cls} seed ${seed}: chegou à onda ${reached}${res.defeated ? ' (derrota)' : ''} — cura ${res.healPerMin}/min, dano ${res.takenPerMin}/min, cura/dano ${res.healToTaken}, tempo <30%: ${res.lowPct}%, quedas ${total.downs}`);
  for (const x of res.waves) console.log(`  onda ${x.w}: cura ${x.heal}, dano ${x.taken}, <30% ${x.low}s, dur ${x.s}s, vida mín ${x.min}%, quedas ${x.d}`);
}
if (process.argv.includes('--tele')) console.log('telemetria:', JSON.stringify(p.tele));
