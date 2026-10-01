/**
 * Locomoção (v1.6): decide o MODO (aproximar, flanquear, manter distância, recuar, reagrupar)
 * por utilidade com histerese e executa por steering: separação/coesão leves entre aliados,
 * desvio de zonas perigosas dos jogadores, sondagem de paredes e detecção de travamento.
 * A decisão de atacar continua nos cérebros (brains.ts); aqui só se decide para onde ir.
 */
import { aiSkill, type AIMode, type Archetype, STEER } from '../../../shared/config/enemyAI.js';
import { circleFree, lineOfSight } from '../../../shared/collision.js';
import { sec } from '../../../shared/constants.js';
import { dist } from '../../../shared/math.js';
import { DT } from '../../../shared/constants.js';
import type { Enemy, Target } from '../types.js';
import type { World } from '../world.js';
import { aiCache, archetypeOf } from './context.js';
import { ramp, window4 } from './utility.js';

export type Vec = [number, number];
const STILL: Vec = [0, 0];

const rot = (x: number, y: number, a: number): Vec => {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [x * c - y * s, x * s + y * c];
};

const isPlayerTarget = (t: Target): boolean => !t.isMinion && !t.isPoint;

/** Direção de aproximação: campo de fluxo/linha reta + desvio lateral de cerco (varia por inimigo). */
export function approachDir(w: World, e: Enemy, t: Target, surround = true): Vec {
  let [dx, dy] = w.chaseDir(e, t);
  const arch = archetypeOf(e);
  if (!surround || arch.flank <= 0 || !isPlayerTarget(t)) return [dx, dy];
  const d = dist(e.x, e.y, t.x, t.y);
  if (d <= STEER.surroundNear || d >= STEER.surroundFar) return [dx, dy];
  if (!lineOfSight(w.map, e.x, e.y, t.x, t.y)) return [dx, dy];
  const f = 0.55 + 0.45 * aiSkill(w.wave);
  const bell = window4(d, STEER.surroundNear, STEER.surroundNear + 50, STEER.surroundFar - 90, STEER.surroundFar);
  const vary = 0.7 + 0.3 * ((e.id * 7) % 10) / 10;
  [dx, dy] = rot(dx, dy, e.aiSide * STEER.surroundAngle * arch.flank * f * bell * vary);
  return [dx, dy];
}

/** Compara deslocamento real e esperado; se travado, gira o rumo por um tempo e troca o lado. */
function trackStuck(w: World, e: Enemy, speed: number, close: boolean): void {
  if (e.aiUnstickT > 0) e.aiUnstickT--;
  if ((w.tick + e.id) % STEER.stuckWindow !== 0) return;
  const moved = Math.hypot(e.x - e.aiLastX, e.y - e.aiLastY);
  const expected = speed * DT * STEER.stuckWindow;
  e.aiLastX = e.x;
  e.aiLastY = e.y;
  if (close || e.cc.root > 0 || e.cc.stun > 0 || e.kvx !== 0 || e.kvy !== 0) return;
  if (moved < expected * STEER.stuckMinFrac) {
    e.aiUnstickT = STEER.unstickTicks;
    e.aiSide = (e.aiSide === 1 ? -1 : 1) as 1 | -1;
  }
}

export interface SteerOpts {
  /** 'keep' mantém o `facing` atual (quem encara o alvo ao se mover). */
  face?: 'move' | 'keep';
  sep?: boolean;
  /** Alvo colado: aceita zonas perigosas (bruto indo ao corpo a corpo). */
  closeToTarget?: boolean;
}

/** Converte uma direção desejada em velocidade final aplicando separação, coesão, perigo e paredes. */
export function steer(w: World, e: Enemy, dirIn: Vec, speed: number, o: SteerOpts = {}): Vec {
  trackStuck(w, e, speed, !!o.closeToTarget);
  const arch = archetypeOf(e);
  let dx = dirIn[0];
  let dy = dirIn[1];
  if (o.sep !== false) {
    let sx = 0;
    let sy = 0;
    const reachMax = e.r * STEER.sepRange;
    for (const other of w.enemiesInCircle(e.x, e.y, reachMax)) {
      if (other.id === e.id || other.state === 'air' || other.def.stationary) continue;
      const ox = e.x - other.x;
      const oy = e.y - other.y;
      const od = Math.hypot(ox, oy) || 0.01;
      const reach = e.r + other.r + 10;
      if (od < reach) {
        const push = (reach - od) / reach;
        sx += (ox / od) * push;
        sy += (oy / od) * push;
      }
    }
    dx += sx * STEER.sepWeight;
    dy += sy * STEER.sepWeight;
  }
  // zonas perigosas dos jogadores (armadilhas, gelo, chuva...): contorna quando faz sentido
  if (arch.danger > 0) {
    const dangers = aiCache(w).dangers;
    if (dangers.length) {
      const len0 = Math.hypot(dx, dy) || 1;
      const nx = e.x + (dx / len0) * (e.r + 18);
      const ny = e.y + (dy / len0) * (e.r + 18);
      const weight = arch.danger * STEER.dangerWeight * (o.closeToTarget ? 0.3 : 1);
      for (const z of dangers) {
        const lim = z.r + e.r + STEER.dangerPad;
        const dz = dist(nx, ny, z.x, z.y);
        if (dz >= lim) continue;
        const ex = nx - z.x;
        const ey = ny - z.y;
        const el = Math.hypot(ex, ey) || 1;
        const k = (1 - dz / lim) * weight * 1.5;
        const rx = ex / el;
        const ry = ey / el;
        // contorna: empurra para fora e, se vai de frente para o centro, desvia pelo lado (tangente)
        const into = Math.max(0, -(dx * rx + dy * ry) / len0);
        const tx = -ry;
        const ty = rx;
        const dot = (dx * tx + dy * ty) / len0;
        const sgn = Math.abs(dot) < 0.05 ? e.aiSide : dot >= 0 ? 1 : -1;
        dx += rx * k * 0.6 + tx * sgn * k * (0.4 + into);
        dy += ry * k * 0.6 + ty * sgn * k * (0.4 + into);
      }
    }
  }
  const len = Math.hypot(dx, dy);
  if (len < 0.001) return STILL;
  dx /= len;
  dy /= len;
  if (e.aiUnstickT > 0) [dx, dy] = rot(dx, dy, e.aiSide * 1.1);
  // sonda de parede: contorna pelo lado preferido (e.aiSide) antes do oposto
  const look = e.r + STEER.probe;
  if (!circleFree(w.map, e.x + dx * look, e.y + dy * look, e.r)) {
    let found = false;
    for (const a of STEER.probeAngles) {
      for (const sgn of [e.aiSide, -e.aiSide]) {
        const [rx, ry] = rot(dx, dy, a * sgn);
        if (circleFree(w.map, e.x + rx * look, e.y + ry * look, e.r)) {
          dx = rx;
          dy = ry;
          found = true;
          break;
        }
      }
      if (found) break;
    }
  }
  if (o.face !== 'keep') e.facing = Math.atan2(dy, dx);
  return [dx * speed, dy * speed];
}

// ---------------------------------------------------------------- modo (utilidade com histerese)

interface ModeCtx {
  d: number;
  los: boolean;
  hpFrac: number;
  alliesNear: number;
  alliesIsolation: number;
}

function alliesAround(w: World, e: Enemy, radius: number): { count: number; cx: number; cy: number } {
  let count = 0;
  let cx = 0;
  let cy = 0;
  for (const o of w.enemiesInCircle(e.x, e.y, radius)) {
    if (o.id === e.id || o.state === 'dead' || o.def.objective || o.def.stationary || o.def.tier === 'boss') continue;
    count++;
    cx += o.x;
    cy += o.y;
  }
  if (count) {
    cx /= count;
    cy /= count;
  }
  return { count, cx, cy };
}

/** Pontua cada modo (0..~1.2) e escolhe com histerese; o modo escolhido fica por `modeHold` ticks. */
export function chooseMode(w: World, e: Enemy, t: Target, arch: Archetype, c: ModeCtx): AIMode {
  if (e.retreatT > 0) {
    e.retreatT--;
    e.aiMode = 'retreat';
    return 'retreat';
  }
  if (e.aiModeT > 0) {
    e.aiModeT--;
    return e.aiMode;
  }
  const skill = aiSkill(w.wave);
  const s: Record<AIMode, number> = { approach: 0.5, flank: 0, kite: 0, retreat: 0, regroup: 0 };
  if (arch.flank > 0 && isPlayerTarget(t)) s.flank = arch.flank * (0.5 + 0.5 * skill) * window4(c.d, 80, 130, 240, 330) * (c.los ? 1 : 0.15) * 0.95;
  if (arch.keep && arch.kite > 0) s.kite = arch.kite * (0.7 + 0.3 * ramp(c.d, arch.keep[1] + 120, arch.keep[0]));
  if (!e.retreated && arch.retreatHp > 0 && c.hpFrac < arch.retreatHp && (c.alliesNear >= 1 || (arch.keep && c.d < arch.keep[0]))) s.retreat = 1.1;
  if (arch.regroup > 0 && isPlayerTarget(t)) s.regroup = arch.regroup * c.alliesIsolation * ramp(c.d, STEER.cohFarTarget * 0.8, STEER.cohFarTarget * 1.4) * 1.1;
  s[e.aiMode] += STEER.modeSticky;
  let best: AIMode = 'approach';
  let bv = -1;
  for (const m of ['approach', 'flank', 'kite', 'retreat', 'regroup'] as const) {
    if (s[m] > bv) {
      bv = s[m];
      best = m;
    }
  }
  e.aiMode = best;
  e.aiModeT = STEER.modeHold + (e.id % 8);
  if (best === 'retreat') {
    e.retreated = true;
    e.retreatT = sec(STEER.retreatSeconds);
  }
  return best;
}

function awayFromPlayers(w: World, e: Enemy, within: number): Vec {
  let ax = 0;
  let ay = 0;
  for (const p of w.alivePlayers()) {
    const pd = dist(e.x, e.y, p.x, p.y);
    if (pd >= within) continue;
    const k = (within - pd) / within + 0.15;
    ax += ((e.x - p.x) / (pd || 1)) * k;
    ay += ((e.y - p.y) / (pd || 1)) * k;
  }
  const l = Math.hypot(ax, ay);
  return l < 0.001 ? STILL : [ax / l, ay / l];
}

/** Manter distância: recua se perto demais, aproxima se longe/sem visão, circula na faixa ideal. */
function kiteMove(w: World, e: Enemy, t: Target, speed: number, d: number, los: boolean, keep: readonly [number, number]): Vec {
  const [kmin, kmax] = keep;
  if (d < kmin && los) {
    const [ax, ay] = awayFromPlayers(w, e, kmin + 40);
    const tx = -(t.y - e.y) / (d || 1);
    const ty = (t.x - e.x) / (d || 1);
    const v = steer(w, e, [ax + tx * e.aiSide * 0.35, ay + ty * e.aiSide * 0.35], speed, { face: 'keep' });
    e.facing = Math.atan2(t.y - e.y, t.x - e.x);
    return v;
  }
  if (d > kmax || !los) return steer(w, e, approachDir(w, e, t, false), speed);
  // circula na faixa ideal
  const tx = (-(t.y - e.y) / (d || 1)) * e.aiSide;
  const ty = ((t.x - e.x) / (d || 1)) * e.aiSide;
  const v = steer(w, e, [tx, ty], speed * 0.6, { face: 'keep' });
  e.facing = Math.atan2(t.y - e.y, t.x - e.x);
  return v;
}

/** Flanco: arco em volta do alvo (do lado preferido), fechando só perto do raio de ataque. */
function flankMove(w: World, e: Enemy, t: Target, speed: number, d: number): Vec {
  const R = Math.max(62, Math.min(120, d * 0.55));
  const ang0 = Math.atan2(e.y - t.y, e.x - t.x);
  const a = ang0 + e.aiSide * 0.85;
  const px = t.x + Math.cos(a) * R;
  const py = t.y + Math.sin(a) * R;
  const pd = dist(e.x, e.y, px, py) || 1;
  const nx = e.x + ((px - e.x) / pd) * 18;
  const ny = e.y + ((py - e.y) / pd) * 18;
  if (circleFree(w.map, nx, ny, e.r)) return steer(w, e, [(px - e.x) / pd, (py - e.y) / pd], speed);
  return steer(w, e, approachDir(w, e, t), speed);
}

function retreatMove(w: World, e: Enemy, speed: number): Vec {
  const [ax, ay] = awayFromPlayers(w, e, 320);
  const al = alliesAround(w, e, 460);
  let dx = ax;
  let dy = ay;
  if (al.count > 0) {
    const gd = dist(e.x, e.y, al.cx, al.cy) || 1;
    dx += ((al.cx - e.x) / gd) * 0.6;
    dy += ((al.cy - e.y) / gd) * 0.6;
  }
  return steer(w, e, [dx, dy], speed);
}

function regroupMove(w: World, e: Enemy, t: Target, speed: number): Vec {
  const al = alliesAround(w, e, 520);
  if (al.count === 0) return steer(w, e, approachDir(w, e, t), speed);
  const gd = dist(e.x, e.y, al.cx, al.cy) || 1;
  // a coesão é leve: caminha até o bando e segue para o alvo junto
  const [tx, ty] = approachDir(w, e, t);
  return steer(w, e, [((al.cx - e.x) / gd) * STEER.cohWeight * 2 + tx, ((al.cy - e.y) / gd) * STEER.cohWeight * 2 + ty], speed);
}

/**
 * Locomoção por arquétipo: escolhe o modo e o executa. Retorna a velocidade desejada (px/s).
 * Chefes sem faixa de distância só aproximam (com desvio de paredes e separação).
 */
export function locomote(w: World, e: Enemy, t: Target, speed: number): Vec {
  const arch = archetypeOf(e);
  const d = dist(e.x, e.y, t.x, t.y);
  if (!isPlayerTarget(t) && !(arch.keep && arch.kite > 0)) return steer(w, e, approachDir(w, e, t), speed, { closeToTarget: d < 70 });
  const los = lineOfSight(w.map, e.x, e.y, t.x, t.y);
  let near = 0;
  let iso = 1;
  if (arch.regroup > 0 || arch.retreatHp > 0) {
    const al = alliesAround(w, e, STEER.cohIsolated);
    near = al.count;
    iso = near === 0 ? 1 : 0;
  }
  const mode = chooseMode(w, e, t, arch, { d, los, hpFrac: e.hp / Math.max(1, e.maxHp), alliesNear: near, alliesIsolation: iso });
  switch (mode) {
    case 'kite':
      return arch.keep ? kiteMove(w, e, t, speed, d, los, arch.keep) : steer(w, e, approachDir(w, e, t), speed);
    case 'flank':
      return flankMove(w, e, t, speed, d);
    case 'retreat':
      return retreatMove(w, e, speed);
    case 'regroup':
      return regroupMove(w, e, t, speed);
    default:
      return steer(w, e, approachDir(w, e, t), speed, { closeToTarget: d < 70 });
  }
}
