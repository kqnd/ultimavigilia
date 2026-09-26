import { DOG } from '../../../shared/config/classes.js';
import { sec } from '../../../shared/constants.js';
import type { Player } from '../types.js';
import type { Kit } from './kit.js';
import { clampTarget, firstActive } from './kit.js';

const resonanceMax = (p: Player): number => DOG.resonance.max - (p.mods['d_resonance'] ?? 0) * 3;

export const dogKit: Kit = {
  start(w, p, slot) {
    switch (slot) {
      case 'basic':
        if (!w.spendStamina(p, DOG.shout.stamina)) return 'st';
        w.startAction(p, 'basic1', DOG.shout, { moveMul: DOG.shout.moveMul });
        return null;
      case 'q':
        // grito curto: preparação/recuperação menores e dá para andar durante a conjuração
        w.startAction(p, 'q', { windup: DOG.pulse.windup, active: 1, recovery: DOG.pulse.recovery }, { moveMul: DOG.pulse.moveMul });
        w.setCooldown(p, 'q', DOG.pulse.cooldown);
        return null;
      case 'e': {
        const t = clampTarget(p, DOG.polarity.maxRange);
        w.startAction(p, 'e', { windup: DOG.polarity.windup, active: 1, recovery: DOG.polarity.recovery }, { moveMul: 0.4, tx: t.x, ty: t.y });
        w.setCooldown(p, 'e', DOG.polarity.cooldown);
        return null;
      }
      case 'r': {
        const s = DOG.endScream;
        const pulses = s.pulses + (p.mods['d_pulse'] ?? 0);
        const a = w.startAction(p, 'r', { windup: s.windup, active: (pulses - 1) * s.interval + 1, recovery: s.recovery }, { moveMul: 0.25, n: pulses });
        void a;
        w.emit({ k: 'sfx', n: 'inhale', x: p.x, y: p.y });
        return null;
      }
    }
  },

  tickAction(w, p, a) {
    if (a.name === 'basic1' && firstActive(a)) {
      const s = DOG.shout;
      const resonant = p.resonance >= resonanceMax(p);
      const throat = 1 + (p.mods['d_throat'] ?? 0) * 0.2;
      const range = s.range * throat * (resonant ? DOG.resonance.rangeMul : 1);
      const dmgMul = resonant ? DOG.resonance.damageMul : 1;
      const kb = s.knockback * (resonant ? DOG.resonance.knockbackMul : 1);
      if (resonant) p.resonance = 0;
      const hits = w.meleeArc(p, a, { damage: s.damage, range, arc: s.arc, poise: s.poise * dmgMul, knockback: kb }, dmgMul);
      if (!resonant) p.resonance = Math.min(resonanceMax(p), p.resonance + hits.length);
      w.emit({ k: 'fx', n: resonant ? 'shoutBig' : 'shout', x: p.x, y: p.y - 8, a: a.dir, o: p.id, r: range });
      w.emit({ k: 'sfx', n: resonant ? 'shoutBig' : 'shout', x: p.x, y: p.y });
    } else if (a.name === 'q' && firstActive(a)) {
      const s = DOG.pulse;
      let n = 0;
      for (const e of w.enemiesInCircle(p.x, p.y, s.radius)) {
        w.hitEnemy(p, e, s.damage, { poise: s.poise, kb: s.knockback, fromX: p.x, fromY: p.y, kind: 'aoe' });
        if (w.interrupt(e)) w.addUlt(p, 3);
        n++;
      }
      w.addUlt(p, n);
      w.breakInCircle(p.x, p.y, s.radius, s.damage, p);
      w.emit({ k: 'fx', n: 'pulse', x: p.x, y: p.y - 6, a: 0, o: p.id, r: s.radius });
      w.emit({ k: 'sfx', n: 'pulse', x: p.x, y: p.y });
    } else if (a.name === 'e' && firstActive(a)) {
      const s = DOG.polarity;
      const mag = p.mods['d_magnet'] ?? 0;
      w.addZone({ kind: 'polarity', x: a.tx, y: a.ty, r: s.radius + mag * 20, ttl: sec(s.duration), owner: p.id, a: s.pullCommon * (1 + mag * 0.4), b: s.pullElite * (1 + mag * 0.4) });
      w.addUlt(p, 4);
      w.emit({ k: 'sfx', n: 'polarity', x: a.tx, y: a.ty });
    } else if (a.name === 'r') {
      const s = DOG.endScream;
      const k = a.t - (a.wu + 1);
      if (k >= 0 && k % s.interval === 0 && k / s.interval < a.n) {
        for (const e of w.enemiesInCircle(p.x, p.y, s.radius)) {
          w.hitEnemy(p, e, s.damage, { poise: s.poise, kb: s.knockback, fromX: p.x, fromY: p.y, kind: 'aoe' });
          w.interrupt(e);
        }
        w.destroyEnemyProjectiles(p.x, p.y, s.radius);
        w.breakInCircle(p.x, p.y, s.radius, s.damage, p);
        w.emit({ k: 'fx', n: 'endScream', x: p.x, y: p.y - 8, a: k / s.interval, o: p.id, r: s.radius });
        w.emit({ k: 'sfx', n: 'endScream', x: p.x, y: p.y });
      }
    }
  },
};
