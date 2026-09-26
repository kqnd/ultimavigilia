/**
 * Servos do Necromante e o sobrevivente do evento de escolta. Autoritativos no servidor,
 * com IA propositalmente simples: surgem, procuram o inimigo mais próximo, andam em linha reta
 * (deslizando nas paredes), atacam devagar e expiram. Não bloqueiam jogadores nem a navegação
 * dos inimigos (não participam da colisão), e há teto por dono e teto global.
 */
import { NECRO } from '../../shared/config/classes.js';
import { EVENT_RULES } from '../../shared/config/objectives.js';
import { sec } from '../../shared/constants.js';
import { circleFree, lineOfSight, moveCircle } from '../../shared/collision.js';
import { dist, dist2 } from '../../shared/math.js';
import { MINION_KINDS, MINION_STATES, type MinionKind } from '../../shared/protocol.js';
import type { Enemy, Minion, Player } from './types.js';
import type { World } from './world.js';

/** Teto global de servos (todos os donos somados). */
export const GLOBAL_MINION_CAP = 16;

export interface MinionOpts {
  hp: number;
  ttl: number;
  speed: number;
  damage: number;
  r?: number;
  group?: number;
  explode?: boolean;
}

export function spawnMinion(w: World, owner: number, kind: MinionKind, x: number, y: number, o: MinionOpts): Minion | null {
  if (kind !== 'survivor' && w.minions.size >= GLOBAL_MINION_CAP) return null;
  const pos = freeSpot(w, x, y, o.r ?? NECRO.thrall.radius);
  const m: Minion = {
    isMinion: true,
    id: w.newId(),
    kind,
    kindIdx: MINION_KINDS.indexOf(kind),
    owner,
    x: pos.x,
    y: pos.y,
    r: o.r ?? NECRO.thrall.radius,
    hp: o.hp,
    maxHp: o.hp,
    ttl: o.ttl,
    maxTtl: o.ttl,
    speed: o.speed,
    damage: o.damage,
    state: 'rise',
    stateT: 0,
    facing: Math.PI / 2,
    targetId: 0,
    retarget: 0,
    atkCd: 0,
    group: o.group ?? 0,
    explode: o.explode ?? false,
    stuckT: 0,
    lastX: pos.x,
    lastY: pos.y,
    status: 0,
  };
  w.minions.set(m.id, m);
  w.emit({ k: 'fx', n: kind === 'survivor' ? 'survivor' : 'raise', x: m.x, y: m.y, a: 0, o: owner, r: m.r });
  return m;
}

function freeSpot(w: World, x: number, y: number, r: number, ignoreId = 0): { x: number; y: number } {
  const open = (nx: number, ny: number): boolean => {
    if (!circleFree(w.map, nx, ny, r)) return false;
    for (const m of w.minions.values())
      if (m.id !== ignoreId && m.state !== 'dead' && m.kind !== 'survivor' && dist2(nx, ny, m.x, m.y) < (r + m.r + 3) ** 2) return false;
    return true;
  };
  if (open(x, y)) return { x, y };
  for (let k = 1; k <= 12; k++)
    for (let a = 0; a < 12; a++) {
      const nx = x + Math.cos((a / 12) * Math.PI * 2) * k * 10;
      const ny = y + Math.sin((a / 12) * Math.PI * 2) * k * 10;
      if (open(nx, ny)) return { x: nx, y: ny };
    }
  return { x, y };
}

export function minionsOf(w: World, owner: number, kind?: MinionKind): Minion[] {
  const out: Minion[] = [];
  for (const m of w.minions.values()) if (m.owner === owner && m.state !== 'dead' && (!kind || m.kind === kind)) out.push(m);
  return out;
}

/** Dano recebido por um servo/sobrevivente. */
export function hitMinion(w: World, m: Minion, dmg: number, attacker?: Enemy): void {
  if (m.state === 'dead' || m.state === 'rise') return;
  // Golpes telegráficos de chefes e minibosses limpam lacaios com rapidez.
  const eliteMul = attacker?.def.tier === 'boss' ? 1.8 : attacker?.def.miniboss ? 1.5 : 1;
  const d = Math.max(1, Math.round(dmg * eliteMul * (m.kind === 'survivor' ? w.guardianReductionAt(m.x, m.y) : 1)));
  const before = m.hp;
  m.hp -= d;
  if (m.kind === 'survivor') {
    w.recordGuardianDamage(m.x, m.y, Math.min(before, d));
    w.objectives.onSurvivorHit(m, Math.min(before, d));
  }
  w.emit({ k: 'fx', n: 'minionHit', x: m.x, y: m.y - 10, a: 0, o: m.kindIdx, r: d });
  if (m.hp <= 0) killMinion(w, m, 'killed');
}

/** Remove um servo. Explode se for do Exército ou se o dono tiver Ceifador de Almas. */
export function killMinion(w: World, m: Minion, reason: 'killed' | 'expired' | 'sacrifice' | 'cleanup'): void {
  if (m.state === 'dead') return;
  m.state = 'dead';
  m.hp = 0;
  const owner = w.players.get(m.owner) ?? null;
  if (m.kind === 'survivor') {
    w.minions.delete(m.id);
    return;
  }
  const reaper = owner ? (owner.mods['n_reaper'] ?? 0) > 0 : false;
  if (reason !== 'cleanup' && (m.explode || reaper)) {
    const A = NECRO.army;
    const radius = A.explodeRadius;
    const base = m.explode ? A.explodeDamage : 30;
    for (const e of w.enemiesInCircle(m.x, m.y, radius)) {
      const mul = !m.explode && e.def.tier === 'elite' ? 2 : 1;
      minionDamage(w, owner, m, e, base * mul, { poise: 20, kb: 120, kind: 'aoe' });
    }
    w.breakInCircle(m.x, m.y, radius, base, owner);
    if (reaper && owner && owner.status === 0) w.healPlayer(owner, 5, 'reaper');
    w.emit({ k: 'fx', n: 'boneBlast', x: m.x, y: m.y - 6, a: 0, o: m.owner, r: radius });
  } else {
    w.emit({ k: 'fx', n: 'minionFade', x: m.x, y: m.y - 6, a: 0, o: m.kindIdx, r: m.r });
  }
  w.minions.delete(m.id);
}

/** Dano de servo em inimigo, com redução e teto contra chefes (a suprema não trivializa a luta). */
export function minionDamage(w: World, owner: Player | null, m: Minion, e: Enemy, dmg: number, o: { poise: number; kb: number; kind: 'melee' | 'aoe' }): void {
  let amount = dmg;
  if (e.def.tier === 'boss' || e.def.miniboss) {
    amount *= NECRO.army.bossDamageMul;
    if (m.group) {
      const used = w.armyBossDamage.get(m.group) ?? 0;
      const left = NECRO.army.bossDamageCapPerCast - used;
      if (left <= 0) return;
      amount = Math.min(amount, left);
      w.armyBossDamage.set(m.group, used + amount);
    }
  }
  w.hitEnemy(owner, e, amount, { poise: o.poise, kb: o.kb, fromX: m.x, fromY: m.y, kind: o.kind, noProc: true, fromMinion: true });
}

function nearestEnemy(w: World, m: Minion, radius: number): Enemy | null {
  let best: Enemy | null = null;
  let score = Infinity;
  for (const e of w.enemies.values()) {
    if (e.state === 'dead' || e.state === 'spawn' || e.state === 'air') continue;
    const d = dist(m.x, m.y, e.x, e.y);
    if (d >= radius) continue;
    // Distribui servos entre alvos próximos, sem perder a prioridade por distância.
    let assigned = 0;
    for (const other of w.minions.values())
      if (other.id !== m.id && other.owner === m.owner && other.targetId === e.id && other.state !== 'dead') assigned++;
    const candidate = d + assigned * 45;
    if (candidate < score) {
      score = candidate;
      best = e;
    }
  }
  return best;
}

export function stepMinions(w: World): void {
  const T = NECRO.thrall;
  for (const m of w.minions.values()) {
    if (m.state === 'dead') continue;
    m.stateT++;
    if (m.atkCd > 0) m.atkCd--;
    if (m.kind === 'survivor') {
      stepSurvivor(w, m);
      continue;
    }
    if (--m.ttl <= 0) {
      killMinion(w, m, 'expired');
      continue;
    }
    const owner = w.players.get(m.owner);
    if (!owner || owner.status !== 0) {
      // dono caiu/morreu/saiu: os mortos voltam ao chão
      killMinion(w, m, owner ? 'expired' : 'cleanup');
      continue;
    }
    if (m.state === 'rise') {
      if (m.stateT >= 12) {
        m.state = 'move';
        m.stateT = 0;
      }
      continue;
    }
    // escolha de alvo (a cada 10 ticks)
    let target = m.targetId ? (w.enemies.get(m.targetId) ?? null) : null;
    if (target && (target.state === 'dead' || target.state === 'air')) target = null;
    if (!target || --m.retarget <= 0) {
      const seek = m.kind === 'horde' ? 420 : T.seekRadius;
      target = nearestEnemy(w, m, seek);
      // servos comuns não se afastam demais do dono
      if (target && m.kind === 'thrall' && dist(owner.x, owner.y, target.x, target.y) > T.leash) target = null;
      m.targetId = target?.id ?? 0;
      m.retarget = 10;
    }
    if (m.state === 'windup') {
      if (target) m.facing = Math.atan2(target.y - m.y, target.x - m.x);
      if (m.stateT >= T.attackWindup) {
        if (target && dist(m.x, m.y, target.x, target.y) <= T.range + m.r + target.r + 4) {
          minionDamage(w, owner, m, target, m.damage, { poise: 6, kb: 30, kind: 'melee' });
          w.emit({ k: 'fx', n: 'minionAttack', x: m.x, y: m.y - 8, a: m.facing, o: m.kindIdx, r: T.range });
        }
        m.state = 'move';
        m.stateT = 0;
        m.atkCd = sec(T.attackCooldown);
      }
      continue;
    }
    let tx: number;
    let ty: number;
    if (target) {
      tx = target.x;
      ty = target.y;
      const d = dist(m.x, m.y, tx, ty);
      if (d <= T.range + m.r + target.r && m.atkCd <= 0) {
        m.state = 'windup';
        m.stateT = 0;
        continue;
      }
      if (d <= T.range + m.r + target.r - 2) continue;
    } else {
      // segue o dono de perto
      const d = dist(m.x, m.y, owner.x, owner.y);
      if (d < 40) continue;
      tx = owner.x;
      ty = owner.y;
    }
    moveToward(w, m, tx, ty);
  }
  separateMinions(w);
}

/** Servos não bloqueiam o combate, mas nunca devem ocupar o mesmo pixel. */
function separateMinions(w: World): void {
  const units = [...w.minions.values()].filter((m) => m.kind !== 'survivor' && m.state !== 'dead');
  for (let i = 0; i < units.length; i++) for (let j = i + 1; j < units.length; j++) {
    const a = units[i]!;
    const b = units[j]!;
    const min = a.r + b.r + 3;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const d = Math.hypot(dx, dy);
    if (d >= min) continue;
    const ux = d > 0.001 ? dx / d : 1;
    const uy = d > 0.001 ? dy / d : 0;
    const push = (min - d) / 2;
    const pa = { x: a.x, y: a.y };
    const pb = { x: b.x, y: b.y };
    moveCircle(w.map, pa, a.r, -ux * push, -uy * push);
    moveCircle(w.map, pb, b.r, ux * push, uy * push);
    a.x = pa.x; a.y = pa.y;
    b.x = pb.x; b.y = pb.y;
  }
}

function moveToward(w: World, m: Minion, tx: number, ty: number): void {
  const dx = tx - m.x;
  const dy = ty - m.y;
  const l = Math.hypot(dx, dy) || 1;
  let vx = dx / l;
  let vy = dy / l;
  // sem linha de visão: tenta usar o campo de fluxo do dono (quando existe) para contornar
  if (!lineOfSight(w.map, m.x, m.y, tx, ty)) {
    const f = w.fields.get(m.owner);
    const dir = f?.direction(m.x, m.y);
    if (dir && (dir[0] !== 0 || dir[1] !== 0) && m.targetId === 0) {
      vx = dir[0];
      vy = dir[1];
    }
    // Com alvo atrás de um obstáculo, tenta contorná-lo em vez de pressionar a parede.
    if (m.targetId !== 0 && !circleFree(w.map, m.x + vx * 12, m.y + vy * 12, m.r)) {
      const base = Math.atan2(vy, vx);
      const side = m.id % 2 === 0 ? 1 : -1;
      for (const turn of [0.45, 0.9, 1.35, 1.8, 2.3]) {
        let found = false;
        for (const sign of [side, -side]) {
          const a = base + turn * sign;
          const cx = Math.cos(a);
          const cy = Math.sin(a);
          if (!circleFree(w.map, m.x + cx * 12, m.y + cy * 12, m.r)) continue;
          vx = cx; vy = cy;
          found = true;
          break;
        }
        if (found) break;
      }
    }
  }
  m.facing = Math.atan2(vy, vx);
  const step = (m.speed / 30) * w.stormMinionMul();
  const pos = { x: m.x, y: m.y };
  moveCircle(w.map, pos, m.r, vx * step, vy * step);
  m.x = pos.x;
  m.y = pos.y;
  // preso? tenta de novo mais tarde; servos comuns reaparecem perto do dono
  if (dist2(m.x, m.y, m.lastX, m.lastY) < 0.25) m.stuckT++;
  else m.stuckT = 0;
  m.lastX = m.x;
  m.lastY = m.y;
  if (m.stuckT > sec(3)) {
    const owner = w.players.get(m.owner);
    if (m.kind === 'thrall' && owner) {
      const p = freeSpot(w, owner.x + 14, owner.y + 8, m.r, m.id);
      m.x = p.x;
      m.y = p.y;
    } else if (m.kind === 'horde') killMinion(w, m, 'expired');
    m.stuckT = 0;
  }
}

/** Sobrevivente: anda até a fogueira pelo campo de fluxo; mais rápido com um jogador por perto. */
function stepSurvivor(w: World, m: Minion): void {
  const E = EVENT_RULES.escort;
  if (m.state === 'rise') {
    if (m.stateT >= 20) {
      m.state = 'move';
      m.stateT = 0;
    }
    return;
  }
  let near = false;
  for (const p of w.players.values()) if (p.status === 0 && dist2(p.x, p.y, m.x, m.y) <= E.followRadius * E.followRadius) near = true;
  const speed = near ? E.speed : E.speed * E.aloneSpeedMul;
  let dir = w.fireField?.direction(m.x, m.y) ?? null;
  if (!dir) {
    // fora do campo (ex.: tile recém-liberado): segue reto até a fogueira
    const dx = w.map.campfire.x - m.x;
    const dy = w.map.campfire.y + 48 - m.y;
    const l = Math.hypot(dx, dy) || 1;
    dir = [dx / l, dy / l];
  }
  if (dir[0] === 0 && dir[1] === 0) return;
  m.facing = Math.atan2(dir[1], dir[0]);
  const pos = { x: m.x, y: m.y };
  moveCircle(w.map, pos, m.r, (dir[0] * speed) / 30, (dir[1] * speed) / 30);
  m.x = pos.x;
  m.y = pos.y;
  m.stateT = near ? 1 : 0;
}

export function snapMinions(w: World): [number, number, number, number, number, number, number, number, number, number][] {
  const out: [number, number, number, number, number, number, number, number, number, number][] = [];
  for (const m of w.minions.values()) {
    out.push([
      m.id,
      m.kindIdx,
      Math.round(m.x * 10) / 10,
      Math.round(m.y * 10) / 10,
      Math.ceil(m.hp),
      m.maxHp,
      MINION_STATES.indexOf(m.state),
      Math.round(m.facing * 100),
      m.owner,
      m.kind === 'survivor' ? (m.stateT > 0 ? 100 : 0) : Math.round((m.ttl / Math.max(1, m.maxTtl)) * 100),
    ]);
  }
  return out;
}

export function clearMinions(w: World, owner?: number): void {
  for (const m of [...w.minions.values()]) if (owner === undefined || m.owner === owner) killMinion(w, m, 'cleanup');
  if (owner === undefined) w.minions.clear();
}

/** Servo mais próximo que um inimigo comum/elite pode escolher atacar (aggro). */
export function minionAggro(w: World, e: Enemy, playerDist: number): Minion | null {
  if (e.def.tier === 'boss' || e.def.miniboss || e.def.objective || w.minions.size === 0) return null;
  // A escolta usa funções táticas (caçadores do sobrevivente), definidas em objectives.ts.
  let best: Minion | null = null;
  let bd = Math.min(NECRO.thrall.aggroRadius, playerDist * 0.8);
  for (const m of w.minions.values()) {
    if (m.state === 'dead' || m.state === 'rise' || m.kind === 'survivor') continue;
    const reach = bd;
    const d = dist(e.x, e.y, m.x, m.y);
    if (d < reach && (!best || d < bd)) {
      best = m;
      bd = d;
    }
  }
  return best;
}
