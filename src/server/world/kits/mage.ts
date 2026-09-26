import { MAGE } from '../../../shared/config/classes.js';
import { sec } from '../../../shared/constants.js';
import { sweepFree } from '../../../shared/collision.js';
import { dist } from '../../../shared/math.js';
import type { Player } from '../types.js';
import type { World } from '../world.js';
import type { Kit } from './kit.js';
import { clampTarget, firstActive, projectileAim } from './kit.js';

function converge(p: Player, used: 'q' | 'e'): void {
  if (p.lastAbility && p.lastAbility !== used) p.convergence = MAGE.convergence.maxCharges;
  p.lastAbility = used;
}

function fire(w: World, p: Player, dir: number, x: number, y: number): void {
  const m = MAGE.missile;
  const emp = p.convergence > 0;
  if (emp) p.convergence = 0;
  const dmg = emp ? m.damage * (MAGE.empowered.damageMul + (p.mods['m_converge'] ?? 0) * 0.5) : m.damage;
  w.spawnProjectile({
    kind: emp ? 'empMissile' : 'missile', team: 'p', owner: p.id,
    x, y,
    vx: Math.cos(dir) * m.speed, vy: Math.sin(dir) * m.speed,
    r: emp ? 7 : m.radius, dmg, range: m.range, pierce: 0, poise: emp ? 30 : m.poise, kb: emp ? 120 : m.knockback,
    splash: emp ? MAGE.empowered.splashRadius : 0,
  });
  w.emit({ k: 'sfx', n: emp ? 'arcaneBig' : 'arcane', x: p.x, y: p.y });
}

export const mageKit: Kit = {
  start(w, p, slot) {
    switch (slot) {
      case 'basic':
        if (!w.spendStamina(p, MAGE.missile.stamina)) return 'st';
        w.startAction(p, 'basic1', MAGE.missile, { moveMul: 0.6 });
        return null;
      case 'q': {
        const g = MAGE.glacial;
        const t = clampTarget(p, g.maxRange);
        w.startAction(p, 'q', { windup: g.windup, active: 1, recovery: g.recovery }, { moveMul: 0.3, tx: t.x, ty: t.y });
        w.setCooldown(p, 'q', g.cooldown);
        converge(p, 'q');
        return null;
      }
      case 'e': {
        const b = MAGE.blink;
        if (!w.spendStamina(p, b.stamina)) return 'st';
        const range = b.distance + (p.mods['m_blink'] ? 40 : 0);
        const d = Math.min(range, Math.max(24, dist(p.x, p.y, p.aimX, p.aimY)));
        const tx = p.x + Math.cos(p.aim) * d;
        const ty = p.y + Math.sin(p.aim) * d;
        const dest = sweepFree(w.map, p.x, p.y, tx, ty, p.r);
        w.emit({ k: 'fx', n: 'blinkOut', x: p.x, y: p.y, a: p.aim, o: p.id, r: 0 });
        p.move.x = dest.x;
        p.move.y = dest.y;
        p.move.ft = 0;
        p.iframes = Math.max(p.iframes, b.iframes);
        w.startAction(p, 'e', { windup: 0, active: 1, recovery: b.recovery }, { moveMul: 1 });
        w.setCooldown(p, 'e', b.cooldown);
        w.emit({ k: 'fx', n: 'blinkIn', x: p.x, y: p.y, a: p.aim, o: p.id, r: 0 });
        converge(p, 'e');
        return null;
      }
      case 'r': {
        const r = MAGE.rupture;
        const t = clampTarget(p, r.maxRange);
        const windup = Math.round(r.windup * (1 - (p.mods['m_rupture'] ? 0.35 : 0)));
        w.startAction(p, 'r', { windup, active: 1, recovery: r.recovery }, { moveMul: 0, tx: t.x, ty: t.y });
        const z = w.addZone({ kind: 'rupture', x: t.x, y: t.y, r: r.radius, ttl: windup + 1, owner: p.id });
        z.extra = windup;
        w.emit({ k: 'sfx', n: 'ruptureCharge', x: t.x, y: t.y });
        return null;
      }
    }
  },

  tickAction(w, p, a) {
    if (!firstActive(a)) return;
    if (a.name === 'basic1') {
      const shot = projectileAim(p, 8);
      a.dir = shot.dir;
      fire(w, p, shot.dir, shot.x, shot.y);
    }
    else if (a.name === 'q') {
      const g = MAGE.glacial;
      const area = 1 + (p.mods['m_area'] ?? 0) * 0.25;
      const dur = g.duration + (p.mods['m_duration'] ?? 0) * 1.5;
      w.addZone({ kind: 'glacial', x: a.tx, y: a.ty, r: g.radius * area, ttl: sec(dur), owner: p.id, a: sec(g.tickInterval), b: g.tickDamage });
      w.emit({ k: 'sfx', n: 'ice', x: a.tx, y: a.ty });
    } else if (a.name === 'r') {
      const r = MAGE.rupture;
      for (const z of w.zones) if (z.kind === 'rupture' && z.owner === p.id) z.dead = true;
      for (const e of w.enemiesInCircle(a.tx, a.ty, r.radius)) {
        const d = dist(e.x, e.y, a.tx, a.ty);
        const k = Math.min(1, d / r.radius);
        const dmg = r.damageCenter + (r.damageEdge - r.damageCenter) * k;
        w.hitEnemy(p, e, dmg, { poise: r.poise, kb: r.knockback, fromX: a.tx, fromY: a.ty, kind: 'aoe' });
      }
      w.breakInCircle(a.tx, a.ty, r.radius, r.damageEdge, p);
      w.emit({ k: 'fx', n: 'rupture', x: a.tx, y: a.ty, a: 0, o: p.id, r: r.radius });
    }
  },
};
