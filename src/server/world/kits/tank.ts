import { TANK } from '../../../shared/config/classes.js';
import { sec } from '../../../shared/constants.js';
import { BTN } from '../../../shared/movement.js';
import { addShield } from '../healing.js';
import type { Player } from '../types.js';
import type { World } from '../world.js';
import type { Kit } from './kit.js';
import { dash, firstActive, inActive } from './kit.js';

export function detonateGuardian(w: World, p: Player): void {
  if (p.action?.name !== 'r') return;
  const b = TANK.bastion;
  const bonus = Math.min(b.bonusCap, p.guardianCharge * b.damageRatio);
  const damage = b.baseDamage + bonus;
  for (const e of w.enemiesInCircle(p.x, p.y, b.radius)) {
    w.hitEnemy(p, e, Math.min(damage, e.def.tier === 'boss' ? b.bossDamageCap : damage), {
      poise: 45, kb: b.knockback, fromX: p.x, fromY: p.y, kind: 'aoe', raw: true, noUlt: true,
    });
  }
  w.breakInCircle(p.x, p.y, b.radius, damage, p);
  w.healPlayer(p, p.maxHp * b.healOnBurst, 'bastion');
  w.emit({ k: 'fx', n: 'guardianBurst', x: p.x, y: p.y, a: bonus / b.bonusCap, o: p.id, r: b.radius });
  w.emit({ k: 'sfx', n: 'guardianBurst', x: p.x, y: p.y });
  p.action = null;
  p.guardianCharge = 0;
  p.buffered = null;
}

export const tankKit: Kit = {
  start(w, p, slot) {
    switch (slot) {
      case 'basic': {
        // Juramento: bate, bate, ESTRONDO — o 3º golpe seguido vira o Martelo Sísmico
        const quake = p.comboStep % 3 === 2;
        const spec = quake ? TANK.quake : TANK.mace;
        if (!w.spendStamina(p, spec.stamina)) return 'st';
        p.blocking = false;
        const a = w.startAction(p, quake ? 'basic2' : 'basic1', spec, { moveMul: spec.moveMul });
        p.comboStep = (p.comboStep + 1) % 3;
        p.comboT = a.total + TANK.comboWindow;
        if (quake) w.emit({ k: 'fx', n: 'quakeWindup', x: p.x, y: p.y, a: 0, o: p.id, r: TANK.quake.range });
        return null;
      }
      case 'q':
        if (p.move.stamina < 1) return 'st';
        p.blocking = true;
        p.blockDir = p.aim;
        p.guardianGuardStart = w.tick;
        w.emit({ k: 'fx', n: 'guardianGuard', x: p.x, y: p.y, a: 0, o: p.id, r: 22 });
        w.emit({ k: 'sfx', n: 'guardianGuard', x: p.x, y: p.y });
        return null;
      case 'e': {
        const c = TANK.charge;
        if (!w.spendStamina(p, c.stamina)) return 'st';
        const a = w.startAction(p, 'e', { windup: 0, active: c.ticks, recovery: c.recovery }, { moveMul: 0, dir: p.aim });
        a.cancelFrom = 999;
        dash(p, a.dir, c.distance, c.ticks);
        w.setCooldown(p, 'e', c.cooldown);
        w.emit({ k: 'fx', n: 'guardianDash', x: p.x, y: p.y, a: a.dir, o: p.id, r: c.distance });
        w.emit({ k: 'sfx', n: 'guardianDash', x: p.x, y: p.y });
        return null;
      }
      case 'r': {
        p.blocking = false;
        p.guardianCharge = 0;
        const a = w.startAction(p, 'r', { windup: 0, active: sec(TANK.bastion.duration), recovery: 0 }, { moveMul: TANK.bastion.moveMul });
        a.cancelFrom = 999;
        addShield(p, TANK.bastion.shield, TANK.bastion.duration);
        w.emit({ k: 'fx', n: 'guardianPlant', x: p.x, y: p.y, a: 0, o: p.id, r: TANK.bastion.radius });
        w.emit({ k: 'sfx', n: 'guardianPlant', x: p.x, y: p.y });
        return null;
      }
    }
  },
  tickAction(w, p, a) {
    if (a.name === 'basic1' && inActive(a)) {
      const mul = 1 + w.mod(p, 't_mace');
      const hits = w.meleeArc(p, a, { ...TANK.mace, poise: TANK.mace.poise * mul }, mul);
      if (firstActive(a)) w.emit({ k: 'fx', n: 'mace', x: p.x, y: p.y, a: a.dir, o: p.id, r: TANK.mace.range });
      if (hits.length) w.emit({ k: 'sfx', n: 'maceHit', x: p.x, y: p.y });
      if (hits.length && p.guardianCounter && w.tick <= p.guardianCounterUntil) {
        p.guardianCounter = false;
        for (const e of w.enemiesInCircle(p.x, p.y, TANK.guard.counterRadius)) {
          if (a.hit.has(e.id)) continue;
          w.hitEnemy(p, e, TANK.guard.counterBonus * (1 + w.mod(p, 't_vanguard')), {
            poise: 35, kb: TANK.guard.counterKnockback, fromX: p.x, fromY: p.y, kind: 'aoe',
          });
        }
        w.emit({ k: 'fx', n: 'guardianCounter', x: p.x, y: p.y, a: a.dir, o: p.id, r: TANK.guard.counterRadius });
        w.emit({ k: 'sfx', n: 'guardianCounter', x: p.x, y: p.y });
      }
    } else if (a.name === 'basic2' && inActive(a)) {
      // Martelo Sísmico: pancada no chão em 360°, atordoa comuns
      const Q = TANK.quake;
      if (firstActive(a)) {
        const mul = 1 + w.mod(p, 't_mace');
        for (const e of w.enemiesInCircle(p.x, p.y, Q.range)) {
          w.hitEnemy(p, e, Q.damage * mul, { poise: Q.poise * mul, kb: Q.knockback, fromX: p.x, fromY: p.y, kind: 'aoe' });
          if (e.def.tier !== 'boss') w.applyCC(e, 'stun', e.def.tier === 'common' ? Q.stunCommon : Q.stunElite, 1, p);
        }
        w.breakInCircle(p.x, p.y, Q.range, Q.damage, p);
        w.emit({ k: 'fx', n: 'maceQuake', x: p.x, y: p.y, a: a.dir, o: p.id, r: Q.range });
        w.emit({ k: 'sfx', n: 'maceQuake', x: p.x, y: p.y });
      }
    } else if (a.name === 'e' && inActive(a)) {
      const c = TANK.charge;
      if (a.t % 2 === 0) w.emit({ k: 'fx', n: 'guardianTrail', x: p.x, y: p.y, a: a.dir, o: p.id, r: 0 });
      for (const e of w.enemiesInCircle(p.x, p.y, c.radius + 8)) {
        if (a.hit.has(e.id)) continue;
        a.hit.add(e.id);
        w.hitEnemy(p, e, c.damage * (1 + w.mod(p, 't_vanguard')), { poise: 42, kb: 135, fromX: p.x, fromY: p.y, kind: 'melee' });
        if (a.n < 6) { w.addUlt(p, 1.5); a.n += 1.5; }
        w.interrupt(e);
        w.applyCC(e, 'stun', e.def.tier === 'boss' ? 0.18 : 0.6, 1, p);
        for (const near of w.enemiesInCircle(p.x, p.y, c.tauntRadius + w.mod(p, 't_taunt'))) {
          near.tauntBy = p.id;
          near.tauntT = sec(near.def.tier === 'boss' ? c.bossDuration : c.duration + (p.mods['t_protector'] ? 1 : 0));
          near.targetId = p.id;
        }
        w.emit({ k: 'fx', n: 'guardianImpact', x: e.x, y: e.y, a: a.dir, o: p.id, r: c.tauntRadius });
        w.emit({ k: 'sfx', n: 'guardianImpact', x: e.x, y: e.y });
      }
    } else if (a.name === 'r') {
      // muralha: provoca tudo em volta a cada segundo (chefes por pouco tempo)
      const B = TANK.bastion;
      if (a.t % B.tauntEvery === 1) {
        for (const e of w.enemiesInCircle(p.x, p.y, B.radius)) {
          if (e.def.stationary || e.def.objective) continue;
          e.tauntBy = p.id;
          e.tauntT = Math.max(e.tauntT, sec(e.def.tier === 'boss' ? B.tauntBoss : B.tauntCommon));
          e.targetId = p.id;
        }
        w.emit({ k: 'fx', n: 'bulwarkTaunt', x: p.x, y: p.y, a: 0, o: p.id, r: B.radius });
      }
      if (a.t % 10 === 0) w.emit({ k: 'fx', n: 'guardianCharge', x: p.x, y: p.y, a: Math.min(1, p.guardianCharge * TANK.bastion.damageRatio / TANK.bastion.bonusCap), o: p.id, r: TANK.bastion.radius });
      if (p.mods['t_bastion'] && a.t % 30 === 0) for (const ally of w.alivePlayers()) {
        if ((ally.x - p.x) ** 2 + (ally.y - p.y) ** 2 <= TANK.bastion.radius ** 2) w.healPlayer(ally, w.mod(p, 't_bastion'), 'bastion');
      }
      if (a.t >= a.total) detonateGuardian(w, p);
    }
  },
  tickPassive(_w, p) {
    if (p.guardianCounter && _w.tick > p.guardianCounterUntil) p.guardianCounter = false;
    if (p.blocking && (!(p.held & BTN.q) || p.status !== 0 || p.buffs.guardBroken > 0 || p.action)) p.blocking = false;
  },
  onIncoming(w, p, h) {
    if (!p.blocking) return null;
    const g = TANK.guard;
    const cost = Math.max(g.minStaminaCost, h.dmg * g.staminaPerDamage * (1 - w.mod(p, 't_guard')));
    if (p.move.stamina >= cost) {
      p.move.stamina -= cost;
      p.staminaDelay = sec(0.5);
      if (w.tick - p.guardianLastUltBlock >= TANK.wall.blockUltIntervalTicks) {
        w.addUlt(p, TANK.wall.ultPerBlock);
        p.guardianLastUltBlock = w.tick;
      }
      const perfect = w.tick - p.guardianGuardStart <= g.perfectTicks;
      if (perfect) {
        p.guardianCounter = true;
        p.guardianCounterUntil = w.tick + sec(2.5);
        // bloqueio perfeito devolve o projétil para quem atirou
        if (h.proj) {
          const R = TANK.reflect;
          const src = h.proj.owner < 0 ? w.enemies.get(-h.proj.owner) : undefined;
          const ang = src && src.state !== 'dead' ? Math.atan2(src.y - p.y, src.x - p.x) : Math.atan2(h.fromY - p.y, h.fromX - p.x);
          const kind = h.proj.kind === 'slipper' || h.proj.kind === 'woundBolt' ? 'orb' : h.proj.kind;
          w.spawnProjectile({ kind, team: 'p', owner: p.id, x: p.x + Math.cos(ang) * 12, y: p.y + Math.sin(ang) * 12, vx: Math.cos(ang) * R.speed, vy: Math.sin(ang) * R.speed, r: 5, dmg: h.dmg * R.damageMul, range: 320, poise: 20, kb: 60 });
          w.emit({ k: 'fx', n: 'guardianReflect', x: p.x, y: p.y - 8, a: ang, o: p.id, r: 0 });
        }
      }
      w.emit({ k: 'dmg', tg: 'p', ti: p.id, v: 0, x: p.x, y: p.y - 18, c: 'blk', s: 0 });
      w.emit({ k: 'fx', n: h.proj ? 'guardianBlockProjectile' : 'guardianBlockPhysical', x: p.x, y: p.y - 8, a: Math.atan2(h.fromY - p.y, h.fromX - p.x), o: p.id, r: p.move.stamina / p.maxStamina });
      w.emit({ k: 'sfx', n: h.proj ? 'guardianBlockProjectile' : 'guardianBlockPhysical', x: p.x, y: p.y });
      if (h.enemy && h.enemy.def.tier !== 'boss') w.knockback(h.enemy, p.x, p.y, perfect ? 170 : 90);
      return 'blocked';
    }
    p.move.stamina = 0;
    p.blocking = false;
    p.guardianCounter = false;
    p.buffs.guardBroken = sec(g.breakStun);
    const a = w.startAction(p, 'guardBreak', { windup: 0, active: 0, recovery: sec(g.breakStun) }, { moveMul: 0 });
    a.cancelFrom = 999;
    p.staminaDelay = sec(1.2);
    w.emit({ k: 'fx', n: 'guardianBreak', x: p.x, y: p.y - 10, a: 0, o: p.id, r: 28 });
    w.emit({ k: 'sfx', n: 'guardianBreak', x: p.x, y: p.y });
    w.damagePlayerRaw(p, h.dmg * 0.5, false);
    return 'hit';
  },
};
