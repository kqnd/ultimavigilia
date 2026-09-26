/**
 * Caixas/barris destrutíveis e itens de cura. O servidor guarda a vida de cada quebrável e
 * altera o tile no clone do mapa quando ele quebra; clientes aplicam a mesma lista de destruídos
 * (snapshot `bk`) ao próprio clone, então colisão, navegação e tiros continuam idênticos.
 */
import { BREAKABLES, PICKUP_KINDS, PICKUPS } from '../../shared/config/loot.js';
import { NECRO } from '../../shared/config/classes.js';
import { sec, TILE } from '../../shared/constants.js';
import { circleFree } from '../../shared/collision.js';
import { dist2 } from '../../shared/math.js';
import { Obst, setBroken } from '../../shared/map.js';
import type { BreakTuple, PickupTuple } from '../../shared/protocol.js';
import type { Pickup, Player } from './types.js';
import type { World } from './world.js';

export const breakMaxHp = (kind: Obst): number => (kind === Obst.Barrel ? BREAKABLES.barrel.hp : BREAKABLES.crate.hp);

export function resetBreakables(w: World): void {
  w.breakHp = new Float32Array(w.map.breakables.length);
  for (const b of w.map.breakables) {
    w.breakHp[b.i] = breakMaxHp(b.kind);
    setBroken(w.map, b.i, false);
  }
}

/** Dano em um quebrável. Retorna true se quebrou agora. */
export function damageBreakable(w: World, i: number, dmg: number, by: Player | null): boolean {
  const b = w.map.breakables[i];
  if (!b) return false;
  const hp = w.breakHp[i] ?? 0;
  if (hp <= 0) return false;
  const left = hp - dmg;
  w.breakHp[i] = Math.max(0, left);
  const x = (b.tx + 0.5) * TILE;
  const y = (b.ty + 0.5) * TILE;
  if (left > 0) {
    w.emit({ k: 'fx', n: 'breakHit', x, y, a: 0, o: b.kind, r: 0 });
    return false;
  }
  setBroken(w.map, i, true);
  const drop = w.rng.chance(BREAKABLES.dropChance);
  if (drop) addPickup(w, 'heal', x, y);
  w.emit({ k: 'break', bi: i, x, y, drop });
  if (by) w.addUlt(by, 1);
  return true;
}

export function addPickup(w: World, kind: Pickup['kind'], x: number, y: number, ttlSeconds?: number): Pickup {
  const p: Pickup = { id: w.newId(), kind, x, y, ttl: sec(ttlSeconds ?? (kind === 'corpse' ? NECRO.corpse.ttl : PICKUPS.heal.lifetime)) };
  if (kind === 'heal') {
    const heals = w.pickups.filter((q) => q.kind === 'heal');
    if (heals.length >= PICKUPS.maxActive) {
      const oldest = heals[0] as Pickup;
      w.pickups = w.pickups.filter((q) => q !== oldest);
    }
  } else {
    const corpses = w.pickups.filter((q) => q.kind === 'corpse');
    if (corpses.length >= NECRO.corpse.maxStored) {
      const oldest = corpses[0] as Pickup;
      w.pickups = w.pickups.filter((q) => q !== oldest);
    }
  }
  w.pickups.push(p);
  return p;
}

/** Coleta (primeiro jogador ferido a passar por cima; cura vida atual, nunca a máxima) e expiração. */
export function stepPickups(w: World): void {
  const R = PICKUPS.heal.radius;
  let changed = false;
  for (const it of w.pickups) {
    if (--it.ttl <= 0) {
      changed = true;
      continue;
    }
    if (it.kind !== 'heal') continue;
    for (const p of w.players.values()) {
      if (p.status !== 0 || p.hp >= p.maxHp) continue;
      if (dist2(p.x, p.y, it.x, it.y) > (R + p.r) ** 2) continue;
      const got = w.healPlayer(p, PICKUPS.heal.amount, false);
      w.emit({ k: 'pickup', pi: p.id, x: it.x, y: it.y, v: Math.round(got) });
      it.ttl = 0;
      changed = true;
      break;
    }
  }
  if (changed) w.pickups = w.pickups.filter((it) => it.ttl > 0);
}

/** No intervalo, parte dos quebráveis destruídos volta (só onde não há ninguém em cima). */
export function respawnSomeBreakables(w: World): void {
  const broken = w.map.breakables.filter((b) => (w.breakHp[b.i] ?? 0) <= 0);
  const n = Math.floor(broken.length * BREAKABLES.respawnFraction);
  for (let k = 0; k < n && broken.length; k++) {
    const idx = Math.floor(w.rng.next() * broken.length);
    const b = broken.splice(idx, 1)[0];
    if (!b) continue;
    const x = (b.tx + 0.5) * TILE;
    const y = (b.ty + 0.5) * TILE;
    let blocked = false;
    for (const p of w.players.values()) if (dist2(p.x, p.y, x, y) < 40 * 40) blocked = true;
    for (const e of w.enemies.values()) if (dist2(e.x, e.y, x, y) < 40 * 40) blocked = true;
    for (const m of w.minions.values()) if (dist2(m.x, m.y, x, y) < 40 * 40) blocked = true;
    if (blocked || !circleFree(w.map, x, y, 12)) continue;
    w.breakHp[b.i] = breakMaxHp(b.kind);
    setBroken(w.map, b.i, false);
  }
}

export function snapPickups(w: World, includeCorpses: boolean): PickupTuple[] {
  const out: PickupTuple[] = [];
  for (const it of w.pickups) {
    if (it.kind === 'corpse' && !includeCorpses) continue;
    out.push([it.id, it.kind === 'heal' ? PICKUP_KINDS.indexOf('heal') : 1, Math.round(it.x), Math.round(it.y)]);
  }
  return out;
}

export function snapBreaks(w: World): BreakTuple[] {
  const out: BreakTuple[] = [];
  for (const b of w.map.breakables) {
    const hp = w.breakHp[b.i] ?? 0;
    const max = breakMaxHp(b.kind);
    if (hp < max) out.push([b.i, Math.max(0, Math.ceil((hp / max) * 100))]);
  }
  return out;
}
