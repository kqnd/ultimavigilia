/**
 * Maycon — controle de área do alto de um tapete voador. Garrafas que respingam e desaceleram,
 * Bomba de Fumaça (atordoa na entrada, sufoca e apaga projéteis), Voo Rasante que joga a horda
 * para os lados e a Rodada da Casa (anel de cachaça em chamas que puxa tudo para o centro).
 * A passiva Visão Sombria é aplicada em `World.applyCC`: tudo que ele controla fica marcado.
 */
import { MAYCON } from '../../../shared/config/classes.js';
import { UPGRADE_CAPS } from '../../../shared/config/upgrades.js';
import { sec } from '../../../shared/constants.js';
import { circleFree, resolveCircle, sweepFree } from '../../../shared/collision.js';
import { dist, dist2 } from '../../../shared/math.js';
import { addShield, healPlayer } from '../healing.js';
import type { Enemy, Player, Projectile, Zone } from '../types.js';
import type { World } from '../world.js';
import type { Kit } from './kit.js';
import { clampTarget, dash, firstActive, inActive, projectileAim } from './kit.js';

const M = MAYCON;

/** Marca de Visão Sombria sem passar pelo `applyCC` (controle contínuo de zonas não rende suprema por tick). */
function mark(w: World, e: Enemy, owner: Player | null): void {
  if (!owner || e.state === 'dead') return;
  const sharp = (owner.mods['y_sight'] ?? 0) > 0;
  e.dsT = Math.max(e.dsT, sec(M.darkSight.seconds + (sharp ? 1 : 0)));
  e.dsMul = Math.max(e.dsMul, M.darkSight.damageMul + w.mod(owner, 'y_sight'));
}

/** Lentidão contínua de zona (mesmo formato do Selo Glacial): sem retorno decrescente nem suprema. */
function zoneSlow(e: Enemy, mul: number): void {
  const m = e.def.tier === 'boss' ? 1 - (1 - mul) * 0.5 : mul;
  e.cc.slow = Math.max(e.cc.slow, 3);
  e.cc.slowMul = Math.min(e.cc.slowMul === 0 ? 1 : e.cc.slowMul, m);
}

/** Estouro da garrafa: respingo em área, lentidão e marca. */
function bottleBurst(w: World, owner: Player | null, pr: Projectile, direct: Enemy | null): void {
  const B = M.bottle;
  const mul = pr.a || 1;
  for (const e of w.enemiesInCircle(pr.x, pr.y, B.splash)) {
    if (e !== direct) w.hitEnemy(owner, e, B.splashDamage * mul, { poise: 4, kb: 30, fromX: pr.x, fromY: pr.y, kind: 'aoe' });
    // só o alvo direto rende suprema pelo controle; o respingo só desacelera e marca
    w.applyCC(e, 'slow', B.slowSeconds, B.slow, e === direct ? owner : null, 'c:maycon');
    mark(w, e, owner);
  }
  w.breakInCircle(pr.x, pr.y, B.splash, B.splashDamage * mul, owner);
  w.emit({ k: 'fx', n: 'bottleBurst', x: pr.x, y: pr.y, a: Math.atan2(pr.vy, pr.vx), o: owner?.id ?? 0, r: B.splash });
  w.emit({ k: 'sfx', n: 'bottleBreak', x: pr.x, y: pr.y });
}

/** A bomba caiu: abre a nuvem de fumaça no ponto. */
function openChoke(w: World, owner: Player, x: number, y: number): void {
  const C = M.choke;
  const pos = { x, y };
  if (!circleFree(w.map, pos.x, pos.y, 4)) resolveCircle(w.map, pos, 4);
  const hell = (owner.mods['y_hellfire'] ?? 0) > 0;
  const radius = C.radius * (1 + Math.min(UPGRADE_CAPS.area, w.mod(owner, 'y_smoke')));
  w.addZone({
    kind: 'choke', x: pos.x, y: pos.y, r: radius, ttl: sec(C.duration + (hell ? 1 : 0)), owner: owner.id,
    a: sec(C.tickInterval), b: C.tickDamage + w.mod(owner, 'y_hellfire'), extra: hell ? 1 : 0, hit: new Set(),
  });
  w.emit({ k: 'fx', n: 'chokeBurst', x: pos.x, y: pos.y, a: hell ? 1 : 0, o: owner.id, r: radius });
  w.emit({ k: 'sfx', n: 'chokeBurst', x: pos.x, y: pos.y });
}

export const mayconKit: Kit = {
  start(w, p, slot) {
    switch (slot) {
      case 'basic': {
        const B = M.bottle;
        if (!w.spendStamina(p, B.stamina)) return 'st';
        w.startAction(p, 'basic1', B, { moveMul: B.moveMul });
        return null;
      }
      case 'q': {
        const C = M.choke;
        const t = clampTarget(p, C.maxRange * (1 + Math.min(UPGRADE_CAPS.projectileRange, w.mod(p, 'g_reach'))));
        w.startAction(p, 'q', { windup: C.windup, active: 1, recovery: C.recovery }, { moveMul: C.moveMul, tx: t.x, ty: t.y });
        w.setCooldown(p, 'q', C.cooldown);
        return null;
      }
      case 'e': {
        const F = M.flight;
        if (!w.spendStamina(p, F.stamina)) return 'st';
        const dir = p.aim;
        const want = F.distance + w.mod(p, 'y_carpet');
        const dest = sweepFree(w.map, p.x, p.y, p.x + Math.cos(dir) * want, p.y + Math.sin(dir) * want, p.r);
        const d = Math.max(12, dist(p.x, p.y, dest.x, dest.y));
        const a = w.startAction(p, 'e', { windup: 0, active: F.ticks, recovery: F.recovery }, { moveMul: 0, dir, tx: p.x, ty: p.y });
        a.cancelFrom = F.ticks + 2;
        dash(p, dir, d, F.ticks);
        p.iframes = Math.max(p.iframes, F.iframes);
        w.setCooldown(p, 'e', F.cooldown - (p.mods['y_carpet'] ?? 0) * 0.5);
        w.emit({ k: 'fx', n: 'carpetDash', x: p.x, y: p.y, a: dir, o: p.id, r: d });
        w.emit({ k: 'sfx', n: 'carpetDash', x: p.x, y: p.y });
        return null;
      }
      case 'r': {
        const R = M.brew;
        w.startAction(p, 'r', { windup: R.windup, active: 1, recovery: R.recovery }, { moveMul: R.castMoveMul });
        w.emit({ k: 'fx', n: 'drinkStart', x: p.x, y: p.y, a: 0, o: p.id, r: 0 });
        w.emit({ k: 'sfx', n: 'gulp', x: p.x, y: p.y });
        return null;
      }
    }
  },

  tickAction(w, p, a) {
    if (a.name === 'basic1' && firstActive(a)) {
      const B = M.bottle;
      const shot = projectileAim(p);
      a.dir = shot.dir;
      const mul = 1 + w.mod(p, 'y_bottle');
      const range = B.range * (1 + Math.min(UPGRADE_CAPS.projectileRange, w.mod(p, 'g_reach')));
      w.spawnProjectile({
        kind: 'bottle', team: 'p', owner: p.id, x: shot.x, y: shot.y,
        vx: Math.cos(shot.dir) * B.speed, vy: Math.sin(shot.dir) * B.speed,
        r: B.radius, dmg: B.damage * mul, range, poise: B.poise, kb: B.knockback, a: mul,
      });
      w.emit({ k: 'sfx', n: 'bottleThrow', x: p.x, y: p.y });
    } else if (a.name === 'q' && firstActive(a)) {
      const C = M.choke;
      // a bomba sobe em arco alto e cai onde foi mirada (passa por cima de paredes e da horda)
      const d = Math.max(10, dist(p.x, p.y, a.tx, a.ty));
      const dir = Math.atan2(a.ty - p.y, a.tx - p.x);
      a.dir = dir;
      w.spawnProjectile({
        kind: 'chokeBomb', team: 'p', owner: p.id, x: p.x, y: p.y,
        vx: Math.cos(dir) * C.speed, vy: Math.sin(dir) * C.speed, r: 4, dmg: 0, range: d, lob: d, poise: 0, kb: 0,
      });
      w.emit({ k: 'sfx', n: 'bottleThrow', x: p.x, y: p.y });
    } else if (a.name === 'e' && inActive(a)) {
      // Voo Rasante: quem o tapete toca é jogado para o LADO (perpendicular à rota) e fica lento
      const F = M.flight;
      const nx = -Math.sin(a.dir);
      const ny = Math.cos(a.dir);
      if (a.t % 2 === 0) w.emit({ k: 'fx', n: 'carpetTrail', x: p.x, y: p.y, a: a.dir, o: p.id, r: 0 });
      for (const e of w.enemiesInCircle(p.x, p.y, F.width)) {
        if (a.hit.has(e.id)) continue;
        a.hit.add(e.id);
        const side = (e.x - p.x) * nx + (e.y - p.y) * ny >= 0 ? 1 : -1;
        w.hitEnemy(p, e, F.damage, { poise: F.poise, kb: F.knockback, fromX: e.x - nx * side * 12, fromY: e.y - ny * side * 12, kind: 'aoe' });
        w.applyCC(e, 'slow', F.slowSeconds, F.slow, p);
        w.interrupt(e);
        w.emit({ k: 'fx', n: 'carpetHit', x: e.x, y: e.y - 6, a: Math.atan2(ny * side, nx * side), o: p.id, r: 0 });
      }
    } else if (a.name === 'r' && firstActive(a)) {
      const R = M.brew;
      const duration = R.duration + w.mod(p, 'y_round');
      w.addZone({ kind: 'brew', x: p.x, y: p.y, r: R.radius, ttl: sec(duration), owner: p.id, a: R.pullCommon, b: R.pullElite, extra: sec(duration) });
      if ((p.mods['y_vitality'] ?? 0) > 0) {
        for (const ally of w.alivePlayers()) if (dist2(ally.x, ally.y, p.x, p.y) <= R.radius ** 2) addShield(ally, 15, 5);
      }
      w.emit({ k: 'fx', n: 'brewBurst', x: p.x, y: p.y, a: 0, o: p.id, r: R.radius });
      w.emit({ k: 'sfx', n: 'brewBurst', x: p.x, y: p.y });
    }
  },

  zoneTick(w, z, owner) {
    if (z.kind === 'choke') {
      const C = M.choke;
      // a fumaça engole projéteis inimigos que entram nela
      w.destroyEnemyProjectiles(z.x, z.y, z.r);
      z.hit ??= new Set();
      for (const e of w.enemiesInCircle(z.x, z.y, z.r)) {
        if (e.def.stationary) continue;
        if (!z.hit.has(e.id)) {
          // sufoco na entrada: interrompe e atordoa (chefes só desaceleram)
          z.hit.add(e.id);
          w.interrupt(e);
          if (e.def.tier !== 'boss') w.applyCC(e, 'stun', e.def.tier === 'common' ? C.stunCommon : C.stunElite, 1, owner);
          w.hitEnemy(owner, e, 1, { poise: C.poise, kb: 0, fromX: z.x, fromY: z.y, kind: 'aoe', noUlt: true, noProc: true });
        }
        zoneSlow(e, C.slow);
        mark(w, e, owner);
        if (z.age % z.a === 0) w.hitEnemy(owner, e, z.b, { poise: 2, kb: 0, fromX: z.x, fromY: z.y, kind: 'aoe', noProc: true });
      }
      if (z.extra > 0 && z.age % 6 === 0) w.emit({ k: 'fx', n: 'chokeFire', x: z.x, y: z.y, a: 0, o: z.owner, r: z.r });
    } else if (z.kind === 'brew') {
      const R = M.brew;
      for (const e of w.enemiesInCircle(z.x, z.y, z.r)) {
        if (e.def.stationary) continue;
        const str = e.def.tier === 'common' ? z.a : e.def.tier === 'elite' ? z.b : 0;
        if (str > 0) {
          e.cc.pullX = z.x;
          e.cc.pullY = z.y;
          e.cc.pullStr = str;
          e.cc.pullT = 2;
        }
        zoneSlow(e, R.slow);
        mark(w, e, owner);
        if (z.age % R.tickEvery === 0) {
          const dmg = R.tickDamage * (e.def.tier === 'boss' ? R.bossDamageMul : 1);
          w.hitEnemy(owner, e, dmg, { poise: 4, kb: 0, fromX: z.x, fromY: z.y, kind: 'aoe', noProc: true });
        }
      }
      if (z.age % 30 === 0 && owner) {
        const heal = R.allyHealPerSecond * ((owner.mods['y_vitality'] ?? 0) > 0 ? 2 : 1);
        for (const ally of w.alivePlayers()) if (dist2(ally.x, ally.y, z.x, z.y) <= z.r * z.r) healPlayer(w, ally, heal, 'brew');
      }
      if (z.age % 8 === 0) w.emit({ k: 'fx', n: 'brewPulse', x: z.x, y: z.y, a: z.ttl / Math.max(1, z.extra), o: z.owner, r: z.r });
    }
  },

  zoneExpire(w, z) {
    if (z.kind === 'brew') w.emit({ k: 'fx', n: 'brewEnd', x: z.x, y: z.y, a: 0, o: z.owner, r: z.r });
    else if (z.kind === 'choke') w.emit({ k: 'fx', n: 'chokeEnd', x: z.x, y: z.y, a: 0, o: z.owner, r: z.r });
  },

  projectileHit(w, pr, e) {
    if (pr.kind === 'chokeBomb') return true; // voa por cima da horda até o ponto mirado
    if (pr.kind !== 'bottle') return false;
    const owner = w.players.get(pr.owner) ?? null;
    w.hitEnemy(owner, e, pr.dmg, { poise: pr.poise, kb: pr.kb, fromX: pr.x - pr.vx * 0.05, fromY: pr.y - pr.vy * 0.05, kind: 'proj' });
    bottleBurst(w, owner, pr, e);
    pr.dead = true;
    return true;
  },

  projectileEnd(w, pr) {
    const owner = w.players.get(pr.owner) ?? null;
    if (pr.kind === 'chokeBomb') {
      if (owner) openChoke(w, owner, pr.x, pr.y);
      return true;
    }
    if (pr.kind === 'bottle') {
      bottleBurst(w, owner, pr, null);
      return true;
    }
    return false;
  },
};

/** Zonas do Maycon (exportado para testes). */
export const isMayconZone = (z: Zone): boolean => z.kind === 'choke' || z.kind === 'brew';
