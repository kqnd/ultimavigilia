/**
 * Berserker: corpo a corpo de alto risco. A Fúria (0–100) sobe ao causar e receber dano e
 * aumenta dano/velocidade de ataque, mas também o dano recebido e o custo de stamina.
 * A Loucura (R) trava a Fúria no máximo por alguns segundos e cobra exaustão ao terminar.
 */
import { BERSERKER } from '../../../shared/config/classes.js';
import { sec } from '../../../shared/constants.js';
import { sweepFree } from '../../../shared/collision.js';
import type { Player } from '../types.js';
import type { World } from '../world.js';
import type { Kit } from './kit.js';
import { firstActive, inActive } from './kit.js';

const COMBO = ['basic1', 'basic2', 'basic3'] as const;

/** Velocidade de ataque atual (Fúria + Loucura). */
function attackSpeed(p: Player): number {
  const F = BERSERKER.fury;
  let m = 1 + F.maxAttackSpeed * (p.rage / F.max);
  if (p.buffs.madness > 0) m += BERSERKER.madness.attackSpeed;
  return m;
}

const reach = (w: World, p: Player): number => 1 + w.mod(p, 'b_cleave');

export const berserkerKit: Kit = {
  start(w, p, slot) {
    switch (slot) {
      case 'basic': {
        const step = p.comboStep % 3;
        const spec = BERSERKER.combo[step] as (typeof BERSERKER.combo)[number];
        if (!w.spendStamina(p, spec.stamina)) return 'st';
        const a = w.startAction(p, COMBO[step] as (typeof COMBO)[number], spec, { moveMul: spec.moveMul, speedMul: attackSpeed(p) });
        p.comboStep = (step + 1) % 3;
        p.comboT = a.total + BERSERKER.comboWindow;
        return null;
      }
      case 'q': {
        const f = BERSERKER.frenzy;
        if (!w.spendStamina(p, f.stamina)) return 'st';
        const active = (f.hits - 1) * f.gap + 1;
        w.startAction(p, 'q', { windup: f.windup, active, recovery: f.recovery }, { moveMul: f.moveMul, speedMul: attackSpeed(p) });
        w.setCooldown(p, 'q', f.cooldown);
        w.emit({ k: 'sfx', n: 'frenzy', x: p.x, y: p.y });
        return null;
      }
      case 'e': {
        const L = BERSERKER.leap;
        if (!w.spendStamina(p, L.stamina)) return 'st';
        // destino validado: não atravessa paredes (para no último ponto livre da linha)
        const dx = p.aimX - p.x;
        const dy = p.aimY - p.y;
        const d = Math.min(L.maxRange, Math.max(30, Math.hypot(dx, dy)));
        const a = Math.atan2(dy, dx);
        const dest = sweepFree(w.map, p.x, p.y, p.x + Math.cos(a) * d, p.y + Math.sin(a) * d, p.r);
        const dist = Math.hypot(dest.x - p.x, dest.y - p.y);
        const speed = dist / (L.ticks / 30);
        p.move.fvx = Math.cos(a) * speed;
        p.move.fvy = Math.sin(a) * speed;
        p.move.ft = L.ticks;
        p.iframes = Math.max(p.iframes, L.iframes);
        w.startAction(p, 'e', { windup: 0, active: L.ticks + 1, recovery: L.recovery }, { moveMul: 1, tx: dest.x, ty: dest.y });
        w.setCooldown(p, 'e', L.cooldown - (p.mods['b_quake'] ?? 0));
        w.addZone({ kind: 'leapLand', x: dest.x, y: dest.y, r: L.radius * (1 + w.mod(p, 'b_quake')), ttl: L.ticks, owner: p.id, extra: L.ticks });
        w.emit({ k: 'sfx', n: 'leap', x: p.x, y: p.y });
        return null;
      }
      case 'r':
        w.startAction(p, 'r', { windup: BERSERKER.madness.windup, active: 1, recovery: BERSERKER.madness.recovery }, { moveMul: BERSERKER.madness.castMoveMul });
        return null;
    }
  },

  tickAction(w, p, a) {
    const idx = COMBO.indexOf(a.name as (typeof COMBO)[number]);
    if (idx >= 0 && inActive(a)) {
      const spec = BERSERKER.combo[idx] as (typeof BERSERKER.combo)[number];
      if (firstActive(a)) w.emit({ k: 'fx', n: `axe${idx + 1}`, x: p.x, y: p.y, a: a.dir, o: p.id, r: spec.range * reach(w, p) });
      const hits = w.meleeArc(p, a, spec, 1, reach(w, p));
      if (hits.length) w.emit({ k: 'sfx', n: idx === 2 ? 'axeHeavy' : 'axeHit', x: p.x, y: p.y });
    } else if (a.name === 'q') {
      const f = BERSERKER.frenzy;
      const k = a.t - (a.wu + 1);
      if (k >= 0 && k % Math.max(1, Math.round(f.gap / attackSpeed(p))) === 0 && a.n < f.hits) {
        a.n++;
        a.hit.clear();
        // alterna o lado do corte a cada golpe
        const dir = p.aim + (a.n % 2 ? -1 : 1) * BERSERKER.frenzy.swingOffset;
        a.dir = dir;
        w.emit({ k: 'fx', n: 'frenzySlash', x: p.x, y: p.y, a: dir, o: p.id, r: f.range * reach(w, p) });
        const hits = w.meleeArc(p, a, f, 1, reach(w, p));
        if (hits.length) w.emit({ k: 'sfx', n: 'axeHit', x: p.x, y: p.y });
      }
    } else if (a.name === 'e') {
      const L = BERSERKER.leap;
      if (a.t === L.ticks) {
        const radius = L.radius * (1 + w.mod(p, 'b_quake'));
        for (const e of w.enemiesInCircle(p.x, p.y, radius)) {
          w.hitEnemy(p, e, L.damage, { poise: L.poise, kb: L.knockback, fromX: p.x, fromY: p.y, kind: 'aoe' });
        }
        w.breakInCircle(p.x, p.y, radius, L.damage, p);
        w.emit({ k: 'fx', n: 'leapLand', x: p.x, y: p.y, a: 0, o: p.id, r: radius });
        w.emit({ k: 'sfx', n: 'bossLand', x: p.x, y: p.y });
      }
    } else if (a.name === 'r' && firstActive(a)) {
      p.buffs.madness = sec(BERSERKER.madness.duration);
      p.buffs.exhausted = 0;
      p.rage = BERSERKER.fury.max;
      w.emit({ k: 'fx', n: 'madness', x: p.x, y: p.y, a: 0, o: p.id, r: 40 });
      w.emit({ k: 'sfx', n: 'madness', x: p.x, y: p.y });
    }
  },
};
