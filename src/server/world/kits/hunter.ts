import { HUNTER } from '../../../shared/config/classes.js';
import { sec } from '../../../shared/constants.js';
import type { Kit } from './kit.js';
import { clampTarget, dash, firstActive, projectileAim } from './kit.js';

export const hunterKit: Kit = {
  start(w, p, slot) {
    switch (slot) {
      case 'basic': {
        if (!w.spendStamina(p, HUNTER.bolt.stamina)) return 'st';
        w.startAction(p, 'basic1', HUNTER.bolt, { moveMul: 0.7 });
        return null;
      }
      case 'q': {
        const max = HUNTER.trap.maxActive + (p.mods['h_traps'] ?? 0);
        const mine = w.zones.filter((z) => z.kind === 'trap' && z.owner === p.id && !z.dead);
        if (mine.length >= max) (mine[0] as { dead: boolean }).dead = true; // substitui a mais antiga
        w.startAction(p, 'q', { windup: HUNTER.trap.windup, active: 1, recovery: HUNTER.trap.recovery }, { moveMul: 0.3 });
        w.setCooldown(p, 'q', HUNTER.trap.cooldown - (p.mods['h_traps'] ?? 0));
        return null;
      }
      case 'e': {
        if (!w.spendStamina(p, HUNTER.recoil.stamina)) return 'st';
        w.startAction(p, 'e', { windup: 0, active: HUNTER.recoil.ticks, recovery: 6 }, { moveMul: 1 });
        dash(p, p.aim + Math.PI, HUNTER.recoil.distance, HUNTER.recoil.ticks);
        p.iframes = Math.max(p.iframes, HUNTER.recoil.iframes);
        w.setCooldown(p, 'e', HUNTER.recoil.cooldown);
        w.emit({ k: 'fx', n: 'recoil', x: p.x, y: p.y, a: p.aim, o: p.id, r: 0 });
        return null;
      }
      case 'r': {
        const t = clampTarget(p, HUNTER.rain.maxRange);
        w.startAction(p, 'r', { windup: HUNTER.rain.windup, active: 1, recovery: HUNTER.rain.recovery }, { moveMul: 0.3, tx: t.x, ty: t.y });
        return null;
      }
    }
  },

  tickAction(w, p, a) {
    if (a.name === 'basic1' && firstActive(a)) {
      const b = HUNTER.bolt;
      const shot = projectileAim(p, 6);
      a.dir = shot.dir;
      w.spawnProjectile({
        kind: 'bolt', team: 'p', owner: p.id,
        x: shot.x, y: shot.y,
        vx: Math.cos(shot.dir) * b.speed, vy: Math.sin(shot.dir) * b.speed,
        r: b.radius, dmg: b.damage, range: b.range, pierce: b.pierce + (p.mods['h_pierce'] ?? 0), poise: b.poise, kb: b.knockback,
        ricochet: (p.mods['h_ricochet'] ?? 0) > 0 ? 1 : 0,
      });
      w.emit({ k: 'sfx', n: 'crossbow', x: p.x, y: p.y });
    } else if (a.name === 'q' && firstActive(a)) {
      const t = HUNTER.trap;
      w.addZone({ kind: 'trap', x: p.x + Math.cos(a.dir) * 16, y: p.y + Math.sin(a.dir) * 16, r: t.radius, ttl: sec(t.lifetime), owner: p.id, a: sec(t.armTime) });
      w.emit({ k: 'sfx', n: 'trapSet', x: p.x, y: p.y });
    } else if (a.name === 'e' && a.t === 3) {
      const b = HUNTER.recoil.bolt;
      const shot = projectileAim(p, 6);
      const fan = p.mods['h_fan'] ? [-0.2, 0, 0.2] : [0];
      for (const off of fan) {
        const d = shot.dir + off;
        w.spawnProjectile({
          kind: 'pierceBolt', team: 'p', owner: p.id,
          x: p.x + Math.cos(d) * 10, y: p.y - 6 + Math.sin(d) * 10,
          vx: Math.cos(d) * b.speed, vy: Math.sin(d) * b.speed,
          r: b.radius, dmg: b.damage, range: b.range, pierce: b.pierce, poise: b.poise, kb: b.knockback,
        });
      }
      w.emit({ k: 'sfx', n: 'crossbowHeavy', x: p.x, y: p.y });
    } else if (a.name === 'r' && firstActive(a)) {
      const r = HUNTER.rain;
      const pulses = r.pulses + Math.round((p.mods['h_rain'] ?? 0) * 3);
      w.addZone({ kind: 'rain', x: a.tx, y: a.ty, r: r.radius, ttl: pulses * r.interval + 2, owner: p.id, a: pulses, b: r.interval });
      w.emit({ k: 'sfx', n: 'rainCall', x: p.x, y: p.y });
    }
  },

  onDealt(w, p, e, _dmg, o) {
    if (o.noProc || o.kind !== 'proj') return;
    const m = HUNTER.mark;
    if (e.markBy === p.id && e.markT > 0) e.marks = Math.min(m.maxStacks, e.marks + 1);
    else {
      e.markBy = p.id;
      e.marks = 1;
    }
    e.markT = sec(m.window);
    void w;
  },

  zoneTrigger(w, z, e, owner) {
    const t = HUNTER.trap;
    if (e.def.tier === 'common') w.applyCC(e, 'root', t.rootCommon, 0, owner);
    else if (e.def.tier === 'elite') w.applyCC(e, 'slow', t.slowEliteTime, 1 - t.slowElite, owner);
    else w.applyCC(e, 'slow', 1, 0.75, owner);
    w.hitEnemy(owner, e, t.damage, { poise: 10, kb: 0, fromX: z.x, fromY: z.y, kind: 'aoe' });
    w.emit({ k: 'fx', n: 'trapSnap', x: z.x, y: z.y, a: 0, o: z.owner, r: z.r });
    // Armadilha Explosiva (bifurcação): explosão ao redor
    if (owner && (owner.mods['h_blast'] ?? 0) > 0) {
      const dmg = w.mod(owner, 'h_blast');
      for (const o of w.enemiesInCircle(z.x, z.y, 48)) if (o !== e) w.hitEnemy(owner, o, dmg, { poise: 20, kb: 140, fromX: z.x, fromY: z.y, kind: 'aoe' });
      w.breakInCircle(z.x, z.y, 48, dmg, owner);
      w.emit({ k: 'fx', n: 'trapBlast', x: z.x, y: z.y, a: 0, o: z.owner, r: 48 });
    }
  },

  zoneTick(w, z, owner) {
    if (z.kind !== 'rain') return;
    if (z.age % z.b !== 0 || z.extra >= z.a) return;
    z.extra++;
    const r = HUNTER.rain;
    for (const e of w.enemiesInCircle(z.x, z.y, z.r)) {
      w.hitEnemy(owner, e, r.damage, { poise: r.poise, kb: 20, fromX: z.x, fromY: z.y, kind: 'aoe', noProc: true });
    }
    w.breakInCircle(z.x, z.y, z.r, r.damage, owner);
    w.emit({ k: 'fx', n: 'rainVolley', x: z.x, y: z.y, a: z.extra, o: z.owner, r: z.r });
  },
};
