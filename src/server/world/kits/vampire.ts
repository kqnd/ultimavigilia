import { VAMPIRE } from '../../../shared/config/classes.js';
import { UPGRADE_CAPS } from '../../../shared/config/upgrades.js';
import { sec } from '../../../shared/constants.js';
import { healBasis, type HealUse, multiTargetMul } from '../healing.js';
import type { Player } from '../types.js';
import type { Kit } from './kit.js';
import { firstActive, inActive } from './kit.js';
import type { World } from '../world.js';

const vortexRadius = (w: World, p: Player): number => VAMPIRE.vortex.radius * (1 + Math.min(UPGRADE_CAPS.area, w.mod(p, 'v_vortex')));

/** Ganha um acúmulo de Sede (golpes, mordida e pulsos do redemoinho). */
function gainThirst(w: World, p: Player): void {
  const max = VAMPIRE.thirst.maxStacks + w.mod(p, 'v_thirst');
  p.thirst = Math.min(max, p.thirst + 1);
  p.thirstT = sec(VAMPIRE.thirst.window);
}

const biteRange = (p: Player): number => VAMPIRE.bite.range * (1 + ((p.mods['v_swarm'] ?? 0) > 0 ? 0.35 : 0));

/** Roubo de vida do Banquete: retorno decrescente para vários alvos no mesmo tick. */
const feastHits = new WeakMap<Player, { tick: number; n: number }>();

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
        const v = VAMPIRE.vortex;
        if (!w.spendStamina(p, v.stamina)) return 'st';
        const a = w.startAction(p, 'e', { windup: v.windup, active: v.pulses * v.pulseEvery, recovery: v.recovery }, { moveMul: v.moveMul });
        a.n = 0; // cura acumulada neste giro (teto por giro)
        w.setCooldown(p, 'e', v.cooldown - (p.mods['v_vortex'] ?? 0) * 0.5);
        w.emit({ k: 'fx', n: 'vortexStart', x: p.x, y: p.y, a: 0, o: p.id, r: vortexRadius(w, p) });
        w.emit({ k: 'sfx', n: 'vortex', x: p.x, y: p.y });
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
        gainThirst(w, p);
        w.emit({ k: 'sfx', n: 'clawHit', x: p.x, y: p.y });
      }
    } else if (a.name === 'q' && inActive(a)) {
      // Mordida em cone: cura sobre dano VÁLIDO, 1º alvo integral e os demais decrescentes; teto por uso e por segundo
      const b = VAMPIRE.bite;
      const fangs = p.mods['v_fangs'] ?? 0;
      const noble = (p.mods['v_noble'] ?? 0) > 0;
      const swarm = (p.mods['v_swarm'] ?? 0) > 0;
      const arc = b.arc + (swarm ? 40 : 0);
      if (firstActive(a)) {
        w.emit({ k: 'fx', n: 'bite', x: p.x, y: p.y, a: a.dir, o: p.id, r: biteRange(p) });
        w.emit({ k: 'sfx', n: 'bite', x: p.x, y: p.y });
      }
      const base = b.damage + w.mod(p, 'v_fangs');
      const use: HealUse = { used: p.biteHealed, cap: b.healCapPerUse + fangs * 3 + (noble ? 4 : 0) };
      const before = new Set(a.hit);
      const hits = w.meleeArc(p, a, { damage: base, range: biteRange(p), arc, poise: b.poise, knockback: b.knockback }, 1);
      // ordem: alvos mais próximos primeiro (o 1º cura integral)
      const fresh = hits.filter((e) => !before.has(e.id)).sort((x, y) => Math.hypot(x.x - p.x, x.y - p.y) - Math.hypot(y.x - p.x, y.y - p.y));
      let idx = a.n;
      for (const e of fresh) {
        const big = e.def.tier !== 'common';
        let valid = w.arcValid.get(e.id) ?? 0;
        // Presa Nobre: +40% contra elites/chefes (golpe extra) e cura +50% (somado, não multiplicado)
        if (noble && big && e.state !== 'dead') valid += w.hitEnemy(p, e, base * 0.4, { poise: 0, kb: 0, fromX: p.x, fromY: p.y, kind: 'melee', noProc: true });
        const ratio = b.healRatio * (1 + (noble && big ? w.mod(p, 'v_noble') : 0));
        const heal = healBasis(valid, base * (noble && big ? 1.4 : 1)) * ratio * multiTargetMul(idx);
        if (valid > 0) idx++;
        if (heal > 0) w.healPlayer(p, heal, 'bite', use);
      }
      a.n = idx;
      p.biteHealed = use.used;
      if (hits.length && firstActive(a)) gainThirst(w, p);
    } else if (a.name === 'e' && inActive(a)) {
      // Redemoinho Rubro: pulsos em 360° que puxam, ferem e alimentam a Sede; cura pouca e decrescente
      const v = VAMPIRE.vortex;
      const k = a.t - a.wu - 1;
      if (k % v.pulseEvery === 0) {
        const r = vortexRadius(w, p);
        let hitAny = false;
        const use: HealUse = { used: a.n, cap: v.healCapPerCast };
        let idx = 0;
        for (const e of w.enemiesInCircle(p.x, p.y, r)) {
          // puxa em direção ao vampiro (o "empurrão" parte do lado oposto)
          const valid = w.hitEnemy(p, e, v.damage, { poise: v.poise, kb: 0, fromX: p.x, fromY: p.y, kind: 'melee' });
          if (e.state !== 'dead' && !e.def.stationary) w.knockback(e, e.x * 2 - p.x, e.y * 2 - p.y, v.pull);
          hitAny = true;
          if (valid <= 0) continue;
          const heal = healBasis(valid, v.damage) * v.healRatio * multiTargetMul(idx++);
          if (heal > 0) w.healPlayer(p, heal, 'vortex', use);
        }
        a.n = use.used;
        w.breakInCircle(p.x, p.y, r, v.damage, p);
        if (hitAny) gainThirst(w, p);
        w.emit({ k: 'fx', n: 'vortex', x: p.x, y: p.y, a: k / v.pulseEvery, o: p.id, r });
      }
    } else if (a.name === 'r' && firstActive(a)) {
      const f = VAMPIRE.feast;
      // explosão de sangue em 360° ao conjurar: cura por inimigo válido, decrescente e com teto
      const use: HealUse = { used: 0, cap: f.burstHealCap };
      let idx = 0;
      for (const e of w.enemiesInCircle(p.x, p.y, f.burstRadius)) {
        const valid = w.hitEnemy(p, e, f.burstDamage, { poise: 30, kb: 120, fromX: p.x, fromY: p.y, kind: 'aoe', noUlt: true });
        if (valid > 0) w.healPlayer(p, f.burstHealPerHit * multiTargetMul(idx++), 'feastBurst', use);
      }
      w.breakInCircle(p.x, p.y, f.burstRadius, f.burstDamage, p);
      w.emit({ k: 'fx', n: 'feastBurst', x: p.x, y: p.y, a: 0, o: p.id, r: f.burstRadius });
      p.buffs.feast = sec(VAMPIRE.feast.duration + w.mod(p, 'v_feast'));
      w.emit({ k: 'fx', n: 'feast', x: p.x, y: p.y, a: 0, o: p.id, r: 40 });
      w.emit({ k: 'sfx', n: 'feast', x: p.x, y: p.y });
    }
  },

  onDealt(w, p, e, _dmg, o) {
    // Banquete: roubo de vida corpo a corpo sobre dano VÁLIDO, decrescente por alvo no mesmo tick, com o teto por segundo
    if (p.buffs.feast <= 0 || o.kind !== 'melee' || o.noProc || e.def.objective || e.def.stationary) return;
    const valid = w.lastValid;
    if (valid <= 0) return;
    let st = feastHits.get(p);
    if (!st || st.tick !== w.tick) {
      st = { tick: w.tick, n: 0 };
      feastHits.set(p, st);
    }
    w.healPlayer(p, valid * VAMPIRE.feast.lifesteal * multiTargetMul(st.n++), 'feast');
  },
};
