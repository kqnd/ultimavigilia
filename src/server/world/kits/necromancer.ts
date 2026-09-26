/**
 * Necromante: invocador. A Essência (Restos Mortais) vem de mortes próximas; o Q gasta Essência
 * para erguer um servo num cadáver perto da mira; o E prende/desacelera numa área e pune alvos
 * marcados pela Rajada Óssea; o R consome toda a Essência para soltar um exército que explode.
 */
import { NECRO } from '../../../shared/config/classes.js';
import { sec } from '../../../shared/constants.js';
import { circleFree, sweepFree } from '../../../shared/collision.js';
import { dist2 } from '../../../shared/math.js';
import { GLOBAL_MINION_CAP, killMinion, minionsOf, spawnMinion } from '../minions.js';
import type { Pickup, Player } from '../types.js';
import type { World } from '../world.js';
import type { Kit } from './kit.js';
import { clampTarget, firstActive, projectileAim } from './kit.js';

/** Cadáver mais próximo do ponto mirado (dentro do raio de busca). */
function corpseNear(w: World, x: number, y: number): Pickup | null {
  let best: Pickup | null = null;
  let bd = NECRO.corpse.searchRadius ** 2;
  for (const it of w.pickups) {
    if (it.kind !== 'corpse') continue;
    const d = dist2(it.x, it.y, x, y);
    if (d < bd && circleFree(w.map, it.x, it.y, NECRO.thrall.radius)) {
      bd = d;
      best = it;
    }
  }
  return best;
}

const lordHp = (w: World, p: Player): number => 1 + w.mod(p, 'n_lord');
const lordTime = (p: Player): number => (p.mods['n_lord'] ?? 0) * NECRO.lordExtraSeconds;

export const necromancerKit: Kit = {
  start(w, p, slot) {
    switch (slot) {
      case 'basic': {
        const b = NECRO.bone;
        if (!w.spendStamina(p, b.stamina)) return 'st';
        w.startAction(p, 'basic1', b, { moveMul: NECRO.moveMul.bone });
        return null;
      }
      case 'q': {
        const R = NECRO.raise;
        if (p.essence < R.cost) return 'essence';
        const c = corpseNear(w, p.aimX, p.aimY) ?? corpseNear(w, p.x, p.y);
        if (!c) return 'corpse';
        const replacing = minionsOf(w, p.id, 'thrall').length >= R.maxActive ? 1 : 0;
        if (minionsOf(w, p.id).length - replacing >= NECRO.maxMinions || w.minions.size - replacing >= GLOBAL_MINION_CAP) return 'busy';
        // reserva o cadáver agora (evita dois servos no mesmo corpo)
        w.pickups = w.pickups.filter((it) => it !== c);
        p.essence -= R.cost;
        w.startAction(p, 'q', { windup: R.windup, active: 1, recovery: R.recovery }, { moveMul: NECRO.moveMul.raise, tx: c.x, ty: c.y });
        w.setCooldown(p, 'q', R.cooldown);
        w.emit({ k: 'fx', n: 'raiseCast', x: c.x, y: c.y, a: 0, o: p.id, r: 12 });
        return null;
      }
      case 'e': {
        const H = NECRO.hand;
        const t = clampTarget(p, H.maxRange);
        // destino no chão alcançável (não atrás de paredes)
        const dest = sweepFree(w.map, p.x, p.y, t.x, t.y, 6);
        let r = H.radius;
        let cursed = 0;
        if ((p.mods['n_ritual'] ?? 0) > 0 && p.essence >= 3) {
          p.essence -= 1;
          r *= 1.25;
          cursed = 1;
        }
        w.startAction(p, 'e', { windup: H.castWindup, active: 1, recovery: H.recovery }, { moveMul: NECRO.moveMul.hand, tx: dest.x, ty: dest.y });
        const z = w.addZone({ kind: 'graveHand', x: dest.x, y: dest.y, r, ttl: H.windup + sec(H.duration), owner: p.id, a: H.windup, b: cursed });
        z.extra = H.windup;
        z.hit = new Set();
        w.setCooldown(p, 'e', H.cooldown);
        w.emit({ k: 'sfx', n: 'graveHand', x: dest.x, y: dest.y });
        return null;
      }
      case 'r':
        w.startAction(p, 'r', { windup: NECRO.army.windup, active: 1, recovery: NECRO.army.recovery }, { moveMul: NECRO.moveMul.army });
        w.emit({ k: 'fx', n: 'armyCall', x: p.x, y: p.y, a: 0, o: p.id, r: 40 });
        return null;
    }
  },

  tickAction(w, p, a) {
    if (!firstActive(a)) return;
    if (a.name === 'basic1') {
      const b = NECRO.bone;
      const bones = p.mods['n_bones'] ?? 0;
      const shot = projectileAim(p);
      a.dir = shot.dir;
      w.spawnProjectile({
        kind: 'bone', team: 'p', owner: p.id,
        x: shot.x, y: shot.y,
        vx: Math.cos(shot.dir) * b.speed, vy: Math.sin(shot.dir) * b.speed,
        r: b.radius, dmg: b.damage + bones * 2, range: b.range, pierce: b.pierce + bones, poise: b.poise, kb: b.knockback,
        pierceFalloff: bones > 0 ? 0.75 : 1,
      });
      w.emit({ k: 'sfx', n: 'bone', x: p.x, y: p.y });
    } else if (a.name === 'q') {
      const T = NECRO.thrall;
      const mine = minionsOf(w, p.id, 'thrall');
      const replacing = mine.length >= NECRO.raise.maxActive ? 1 : 0;
      // Outro jogador pode ter preenchido o teto durante a animação; não sacrifique um servo à toa.
      if (minionsOf(w, p.id).length - replacing >= NECRO.maxMinions || w.minions.size - replacing >= GLOBAL_MINION_CAP) {
        p.essence = Math.min(NECRO.essence.max, p.essence + NECRO.raise.cost);
        return;
      }
      // no limite, o servo mais antigo cede lugar (sacrifício)
      while (mine.length >= NECRO.raise.maxActive) {
        const old = mine.shift();
        if (old) killMinion(w, old, 'sacrifice');
      }
      const total = minionsOf(w, p.id).length;
      if (total >= NECRO.maxMinions) return;
      spawnMinion(w, p.id, 'thrall', a.tx, a.ty, { hp: Math.round(T.hp * lordHp(w, p)), ttl: sec(T.duration + lordTime(p)), speed: T.speed, damage: T.damage });
      w.emit({ k: 'sfx', n: 'raise', x: a.tx, y: a.ty });
    } else if (a.name === 'r') {
      const A = NECRO.army;
      const room = Math.max(0, NECRO.maxMinions - minionsOf(w, p.id).length);
      const n = Math.min(A.maxUnits, room, A.base + p.essence * A.perEssence);
      p.essence = 0;
      p.ultLockT = sec(A.ultLockSeconds);
      const group = w.newId();
      w.armyBossDamage.set(group, 0);
      for (let i = 0; i < n; i++) {
        const ang = (i / Math.max(1, n)) * Math.PI * 2;
        spawnMinion(w, p.id, 'horde', p.x + Math.cos(ang) * 22, p.y + Math.sin(ang) * 18, {
          hp: Math.round(A.hp * lordHp(w, p)), ttl: sec(A.duration + lordTime(p)), speed: A.speed, damage: A.damage, group, explode: true,
        });
      }
      w.emit({ k: 'fx', n: 'army', x: p.x, y: p.y, a: 0, o: p.id, r: 60 });
      w.emit({ k: 'sfx', n: 'army', x: p.x, y: p.y });
    }
  },

  onDealt(w, p, e, _dmg, o) {
    // Rajada Óssea marca o alvo
    if (o.kind === 'proj' && !o.noProc) {
      e.boneBy = p.id;
      e.boneT = sec(NECRO.bone.markTime);
    }
    void w;
  },

  zoneTick(w, z, owner) {
    if (z.kind !== 'graveHand' || !owner) return;
    const H = NECRO.hand;
    if (z.age < z.a) return; // telegraph
    const hit = z.hit ?? (z.hit = new Set());
    const pulse = (z.age - z.a) % sec(H.tickInterval) === 0;
    for (const e of w.enemiesInCircle(z.x, z.y, z.r)) {
      if (e.def.stationary) continue;
      if (!hit.has(e.id)) {
        hit.add(e.id);
        if (e.def.tier === 'common') w.applyCC(e, 'root', H.rootCommon, 0, owner);
      }
      if (e.def.tier !== 'common') {
        const slow = e.def.tier === 'boss' ? H.slowBoss : H.slowElite;
        e.cc.slow = Math.max(e.cc.slow, 3);
        e.cc.slowMul = Math.min(e.cc.slowMul === 0 ? 1 : e.cc.slowMul, 1 - slow);
      }
      if (z.b > 0) e.cursedT = Math.max(e.cursedT, 10);
      if (pulse) {
        const marked = e.boneT > 0;
        w.hitEnemy(owner, e, marked ? H.markedTickDamage : H.tickDamage, { poise: 2, kb: 0, fromX: z.x, fromY: z.y, kind: 'aoe', noProc: true });
      }
    }
  },
};
