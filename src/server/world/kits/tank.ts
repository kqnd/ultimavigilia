import { TANK } from '../../../shared/config/classes.js';
import { sec } from '../../../shared/constants.js';
import { angleDiff } from '../../../shared/math.js';
import { BTN } from '../../../shared/movement.js';
import type { Kit } from './kit.js';
import { firstActive, inActive } from './kit.js';

export const tankKit: Kit = {
  start(w, p, slot) {
    switch (slot) {
      case 'basic':
        if (!w.spendStamina(p, TANK.mace.stamina)) return 'st';
        p.blocking = false;
        w.startAction(p, 'basic1', TANK.mace, { moveMul: TANK.mace.moveMul });
        return null;
      case 'q':
        if (p.move.stamina < 1) return 'st';
        p.blocking = true;
        p.blockDir = p.aim;
        return null;
      case 'e':
        w.startAction(p, 'e', { windup: TANK.taunt.windup, active: 1, recovery: TANK.taunt.recovery }, { moveMul: 0.4 });
        w.setCooldown(p, 'e', TANK.taunt.cooldown);
        return null;
      case 'r':
        p.blocking = false;
        w.startAction(p, 'r', { windup: TANK.bastion.windup, active: 1, recovery: TANK.bastion.recovery }, { moveMul: 0.2 });
        return null;
    }
  },

  tickAction(w, p, a) {
    if (a.name === 'basic1' && inActive(a)) {
      const mul = 1 + (p.mods['t_mace'] ?? 0) * 0.25;
      const spec = { ...TANK.mace, poise: TANK.mace.poise * mul };
      const hits = w.meleeArc(p, a, spec, mul);
      if (firstActive(a)) w.emit({ k: 'fx', n: 'mace', x: p.x, y: p.y, a: a.dir, o: p.id, r: TANK.mace.range });
      if (hits.length) w.emit({ k: 'sfx', n: 'maceHit', x: p.x, y: p.y });
    } else if (a.name === 'e' && firstActive(a)) {
      const t = TANK.taunt;
      const radius = t.radius + (p.mods['t_taunt'] ?? 0) * 50;
      let n = 0;
      for (const e of w.enemiesInCircle(p.x, p.y, radius)) {
        e.tauntBy = p.id;
        e.tauntT = sec(e.def.tier === 'boss' ? t.bossDuration : t.duration * (e.def.tier === 'elite' ? 0.8 : 1));
        e.targetId = p.id;
        n++;
      }
      p.buffs.tauntDr = sec(t.duration);
      w.addUlt(p, n * 1.5);
      w.emit({ k: 'fx', n: 'taunt', x: p.x, y: p.y, a: 0, o: p.id, r: radius });
      w.emit({ k: 'sfx', n: 'taunt', x: p.x, y: p.y });
    } else if (a.name === 'r' && firstActive(a)) {
      const b = TANK.bastion;
      w.addZone({ kind: 'bastion', x: p.x, y: p.y, r: b.radius, ttl: sec(b.duration), owner: p.id, b: p.mods['t_bastion'] ? 4 : 0 });
      w.emit({ k: 'sfx', n: 'bastion', x: p.x, y: p.y });
    }
  },

  tickPassive(w, p) {
    const holding = (p.held & BTN.q) !== 0;
    if (p.blocking) {
      if (!holding || p.status !== 0 || p.buffs.guardBroken > 0 || (p.action && p.action.name !== 'block')) p.blocking = false;
      else p.blockDir = p.aim;
    }
    void w;
  },

  onIncoming(w, p, h) {
    if (!p.blocking) return null;
    const g = TANK.guard;
    const incoming = Math.atan2(h.fromY - p.y, h.fromX - p.x);
    if (Math.abs(angleDiff(incoming, p.blockDir)) > (g.arc * Math.PI) / 360) return null;
    const cost = Math.max(g.minStaminaCost, h.dmg * g.staminaPerDamage * (1 - (p.mods['t_guard'] ?? 0) * 0.25));
    if (p.move.stamina >= cost) {
      p.move.stamina -= cost;
      p.staminaDelay = sec(0.5);
      w.addUlt(p, TANK.wall.ultPerBlock);
      w.emit({ k: 'dmg', tg: 'p', ti: p.id, v: 0, x: p.x, y: p.y - 18, c: 'blk', s: 0 });
      w.emit({ k: 'fx', n: 'block', x: p.x + Math.cos(p.blockDir) * 10, y: p.y - 6 + Math.sin(p.blockDir) * 10, a: p.blockDir, o: p.id, r: 0 });
      w.emit({ k: 'sfx', n: 'block', x: p.x, y: p.y });
      if (h.enemy && h.enemy.def.tier !== 'boss') w.knockback(h.enemy, p.x, p.y, 120);
      return 'blocked';
    }
    // quebra de guarda
    p.move.stamina = 0;
    p.blocking = false;
    p.buffs.guardBroken = sec(g.breakStun);
    const a = w.startAction(p, 'guardBreak', { windup: 0, active: 0, recovery: sec(g.breakStun) }, { moveMul: 0 });
    a.cancelFrom = 999;
    p.staminaDelay = sec(1.2);
    w.emit({ k: 'fx', n: 'guardBreak', x: p.x, y: p.y - 10, a: 0, o: p.id, r: 0 });
    w.emit({ k: 'sfx', n: 'guardBreak', x: p.x, y: p.y });
    w.damagePlayerRaw(p, h.dmg * 0.5, false);
    return 'hit';
  },
};
