import { VAMPIRE } from '../../../shared/config/classes.js';
import { sec } from '../../../shared/constants.js';
import type { Player } from '../types.js';
import type { Kit } from './kit.js';
import { dash, firstActive, inActive } from './kit.js';

const biteRange = (p: Player): number => VAMPIRE.bite.range * (1 + ((p.mods['v_swarm'] ?? 0) > 0 ? 0.35 : 0));

export const vampireKit: Kit = {
  start(w, p, slot) {
    switch (slot) {
      case 'basic': {
        const c = VAMPIRE.claws;
        if (!w.spendStamina(p, c.stamina)) return 'st';
        const second = p.comboStep % 2 === 1;
        const a = w.startAction(p, second ? 'basic2' : 'basic1', c, { moveMul: c.moveMul, speedMul: 1 + p.thirst * 0.04 });
        p.comboStep = second ? 0 : 1;
        p.comboT = a.total + VAMPIRE.chainWindow;
        return null;
      }
      case 'q': {
        const b = VAMPIRE.bite;
        if (!w.spendStamina(p, b.stamina)) return 'st';
        p.biteHealed = 0;
        w.startAction(p, 'q', b, { moveMul: b.moveMul });
        w.setCooldown(p, 'q', b.cooldown);
        w.emit({ k: 'fx', n: 'biteWindup', x: p.x, y: p.y, a: p.aim, o: p.id, r: biteRange(p) });
        return null;
      }
      case 'e': {
        const m = VAMPIRE.mist;
        if (!w.spendStamina(p, m.stamina)) return 'st';
        w.startAction(p, 'e', { windup: 0, active: m.ticks, recovery: 3 }, { moveMul: 1 });
        dash(p, p.aim, m.distance, m.ticks);
        p.iframes = Math.max(p.iframes, m.iframes);
        w.setCooldown(p, 'e', m.cooldown - (p.mods['v_mist'] ? 2 : 0));
        w.emit({ k: 'fx', n: 'mist', x: p.x, y: p.y, a: p.aim, o: p.id, r: 0 });
        w.emit({ k: 'sfx', n: 'mist', x: p.x, y: p.y });
        return null;
      }
      case 'r': {
        const f = VAMPIRE.feast;
        w.startAction(p, 'r', { windup: f.windup, active: 1, recovery: f.recovery }, { moveMul: 0.3 });
        return null;
      }
    }
  },

  tickAction(w, p, a) {
    if ((a.name === 'basic1' || a.name === 'basic2') && inActive(a)) {
      const hits = w.meleeArc(p, a, VAMPIRE.claws);
      if (firstActive(a)) w.emit({ k: 'fx', n: a.name === 'basic1' ? 'claw1' : 'claw2', x: p.x, y: p.y, a: a.dir, o: p.id, r: VAMPIRE.claws.range });
      if (hits.length) {
        const max = VAMPIRE.thirst.maxStacks + (p.mods['v_thirst'] ?? 0) * 2;
        p.thirst = Math.min(max, p.thirst + 1);
        p.thirstT = sec(VAMPIRE.thirst.window);
        w.emit({ k: 'sfx', n: 'clawHit', x: p.x, y: p.y });
      }
    } else if (a.name === 'q' && inActive(a)) {
      // Mordida em cone: cada inimigo atingido cura, com teto por uso e teto por segundo
      const b = VAMPIRE.bite;
      const fangs = p.mods['v_fangs'] ?? 0;
      const noble = (p.mods['v_noble'] ?? 0) > 0;
      const swarm = (p.mods['v_swarm'] ?? 0) > 0;
      const arc = b.arc + (swarm ? 40 : 0);
      if (firstActive(a)) {
        w.emit({ k: 'fx', n: 'bite', x: p.x, y: p.y, a: a.dir, o: p.id, r: biteRange(p) });
        w.emit({ k: 'sfx', n: 'bite', x: p.x, y: p.y });
      }
      const cap = (b.healCapPerUse + fangs * 6) * (noble ? 1.5 : 1);
      const before = new Set(a.hit);
      const hits = w.meleeArc(p, a, { damage: b.damage + fangs * 8, range: biteRange(p), arc, poise: b.poise, knockback: b.knockback }, 1);
      for (const e of hits) {
        if (before.has(e.id)) continue;
        const big = e.def.tier !== 'common';
        // Presa Nobre: +40% contra elites/chefes e cura dobrada
        if (noble && big) w.hitEnemy(p, e, (b.damage + fangs * 8) * 0.4, { poise: 0, kb: 0, fromX: p.x, fromY: p.y, kind: 'melee', noProc: true });
        const dealt = (b.damage + fangs * 8) * (noble && big ? 1.4 : 1);
        const heal = Math.min(dealt * b.healRatio * (noble && big ? 2 : 1), cap - p.biteHealed);
        if (heal > 0) p.biteHealed += w.healPlayer(p, heal, true);
      }
    } else if (a.name === 'r' && firstActive(a)) {
      p.buffs.feast = sec(VAMPIRE.feast.duration + (p.mods['v_feast'] ?? 0) * 3);
      w.emit({ k: 'fx', n: 'feast', x: p.x, y: p.y, a: 0, o: p.id, r: 40 });
      w.emit({ k: 'sfx', n: 'feast', x: p.x, y: p.y });
    }
  },

  onDealt(w, p, _e, dmg, o) {
    if (p.buffs.feast > 0 && o.kind === 'melee' && !o.noProc) w.healPlayer(p, dmg * VAMPIRE.feast.lifesteal, true);
  },
};
