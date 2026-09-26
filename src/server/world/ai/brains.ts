/**
 * Cérebros dos inimigos. Cada `tick` decide o estado/ataque e retorna a velocidade desejada (px/s).
 * Ataques seguem antecipação (windup) → janela ativa → recuperação, com telegraphs no cliente
 * derivados de estado + ataque + alvo (tx,ty) enviados nos snapshots.
 */
import { AFFIX_RULES } from '../../../shared/config/affixes.js';
import { ATK, brainType, type EnemyType, FATHER_LINES } from '../../../shared/config/enemies.js';
import { sec } from '../../../shared/constants.js';
import { circleFree, lineOfSight, sweepFree } from '../../../shared/collision.js';
import { dist } from '../../../shared/math.js';
import { countObjectives } from '../objectives.js';
import type { Enemy, Target } from '../types.js';
import type { World } from '../world.js';

export interface Brain {
  tick(w: World, e: Enemy): [number, number];
}

const STILL: [number, number] = [0, 0];

function chase(w: World, e: Enemy, t: Target, speed: number): [number, number] {
  const [dx, dy] = w.chaseDir(e, t);
  if (dx !== 0 || dy !== 0) e.facing = Math.atan2(dy, dx);
  return [dx * speed, dy * speed];
}

function faceTo(e: Enemy, x: number, y: number): void {
  e.facing = Math.atan2(y - e.y, x - e.x);
}

function ready(e: Enemy, atk: keyof Enemy['cds'] & string): boolean {
  return (e.cds[atk as Enemy['atk']] ?? 0) <= 0;
}

function setCd(e: Enemy, atk: Enemy['atk'], seconds: number): void {
  // afixo Furioso: ataques mais frequentes com pouca vida
  const furious = e.affix === 'furious' && e.hp <= e.maxHp * AFFIX_RULES.furiousThreshold;
  e.cds[atk] = sec(seconds * (furious ? AFFIX_RULES.furiousCooldownMul : 1));
}

/** Rotina genérica de golpe corpo a corpo. Retorna true enquanto o ataque está em curso. */
function meleeRoutine(
  w: World,
  e: Enemy,
  spec: { windup: number; active: number; recovery: number; damage: number; range: number; arc: number },
  heavy: boolean,
): boolean {
  e.stateT++;
  if (e.state === 'windup' && e.stateT >= spec.windup) w.setEnemyState(e, 'active');
  else if (e.state === 'active') {
    w.enemyMelee(e, spec.range, spec.arc, spec.damage, heavy);
    if (e.stateT >= spec.active) w.setEnemyState(e, 'recover');
  } else if (e.state === 'recover' && e.stateT >= spec.recovery) {
    w.setEnemyState(e, 'move');
    e.atk = 'none';
    return false;
  }
  return true;
}

/** Posição de pouso válida (não dentro de paredes), limitada ao alcance. */
function landingPoint(w: World, e: Enemy, tx: number, ty: number, maxRange: number): { x: number; y: number } {
  const d = dist(e.x, e.y, tx, ty);
  let x = tx;
  let y = ty;
  if (d > maxRange) {
    x = e.x + ((tx - e.x) / d) * maxRange;
    y = e.y + ((ty - e.y) / d) * maxRange;
  }
  if (circleFree(w.map, x, y, e.r)) return { x, y };
  // procura ponto livre próximo; se não houver, recua pela linha
  for (let k = 1; k <= 6; k++) {
    for (let a = 0; a < 8; a++) {
      const ang = (a / 8) * Math.PI * 2;
      const nx = x + Math.cos(ang) * k * 12;
      const ny = y + Math.sin(ang) * k * 12;
      if (circleFree(w.map, nx, ny, e.r)) return { x: nx, y: ny };
    }
  }
  return sweepFree(w.map, e.x, e.y, x, y, e.r);
}

/** Estado de salto: desloca linearmente até (tx,ty) em `airTicks`. */
function airVelocity(e: Enemy, remaining: number): [number, number] {
  if (remaining <= 0) return STILL;
  return [((e.tx - e.x) / remaining) * 30, ((e.ty - e.y) / remaining) * 30];
}

// ---------------------------------------------------------------- comuns

const shambler: Brain = {
  tick(w, e) {
    const s = ATK.shambler.swipe;
    if (e.state !== 'move') {
      meleeRoutine(w, e, s, false);
      if (e.state === 'recover' && e.stateT === 1) setCd(e, 'swipe', s.cooldown);
      return STILL;
    }
    const t = w.targetOf(e);
    if (!t) return STILL;
    const d = dist(e.x, e.y, t.x, t.y);
    if (d < s.range + e.r + t.r && ready(e, 'swipe')) {
      w.startEnemyAttack(e, 'swipe', t.x, t.y);
      return STILL;
    }
    // cambaleio: pequena oscilação lateral
    const [vx, vy] = chase(w, e, t, e.def.speed);
    const wob = Math.sin((w.tick + e.id * 17) * 0.12) * 0.35;
    return [vx - vy * wob, vy + vx * wob];
  },
};

const runner: Brain = {
  tick(w, e) {
    const s = ATK.runner.lunge;
    if (e.state === 'windup') {
      e.stateT++;
      if (e.stateT >= s.windup) {
        w.setEnemyState(e, 'active');
        faceTo(e, e.tx, e.ty);
      }
      return STILL;
    }
    if (e.state === 'active') {
      e.stateT++;
      w.enemyCircle(e, e.x, e.y, s.hitRadius, s.damage, false, true);
      if (e.stateT >= s.dashTicks) {
        w.setEnemyState(e, 'recover');
        setCd(e, 'lunge', s.cooldown);
      }
      return [Math.cos(e.facing) * s.dashSpeed, Math.sin(e.facing) * s.dashSpeed];
    }
    if (e.state === 'recover') {
      e.stateT++;
      if (e.stateT >= s.recovery) {
        w.setEnemyState(e, 'move');
        e.atk = 'none';
      }
      return STILL;
    }
    const t = w.targetOf(e);
    if (!t) return STILL;
    const d = dist(e.x, e.y, t.x, t.y);
    if (d < s.triggerRange && ready(e, 'lunge') && lineOfSight(w.map, e.x, e.y, t.x, t.y)) {
      w.startEnemyAttack(e, 'lunge', t.x, t.y);
      return STILL;
    }
    // Corredores abrem ângulos diferentes antes do bote, em vez de formar uma fila única.
    if (d > 65 && d < 190 && lineOfSight(w.map, e.x, e.y, t.x, t.y)) {
      const side = e.id % 2 === 0 ? 1 : -1;
      const dx = (t.x - e.x) / d;
      const dy = (t.y - e.y) / d;
      const fx = dx - dy * side * 0.42;
      const fy = dy + dx * side * 0.42;
      const len = Math.hypot(fx, fy);
      if (circleFree(w.map, e.x + fx * 12, e.y + fy * 12, e.r)) {
        e.facing = Math.atan2(dy, dx);
        return [fx / len * e.def.speed, fy / len * e.def.speed];
      }
    }
    return chase(w, e, t, e.def.speed);
  },
};

const werewolf: Brain = {
  tick(w, e) {
    const P = ATK.werewolf.pounce;
    const C = ATK.werewolf.claw;
    if (e.atk === 'pounce') {
      if (e.state === 'windup') {
        e.stateT++;
        if (e.stateT >= P.windup) {
          w.setEnemyState(e, 'air');
          e.hitBy.clear();
        }
        return STILL;
      }
      if (e.state === 'air') {
        e.stateT++;
        const v = airVelocity(e, P.airTicks - e.stateT + 1);
        if (e.stateT >= P.airTicks) {
          const lr = P.landRadius * (e.r / 11);
          w.enemyCircle(e, e.tx, e.ty, lr, P.damage, true);
          w.emit({ k: 'fx', n: 'land', x: e.tx, y: e.ty, a: 0, o: 0, r: lr });
          w.setEnemyState(e, 'recover');
          setCd(e, 'pounce', P.cooldown);
        }
        return v;
      }
      if (e.state === 'recover') {
        e.stateT++;
        if (e.stateT >= P.recovery) {
          w.setEnemyState(e, 'move');
          e.atk = 'none';
        }
        return STILL;
      }
    }
    if (e.atk === 'claw' && e.state !== 'move') {
      meleeRoutine(w, e, C, false);
      if (e.state === 'recover' && e.stateT === 1) setCd(e, 'claw', C.cooldown);
      return STILL;
    }
    const t = w.targetOf(e);
    if (!t) return STILL;
    const d = dist(e.x, e.y, t.x, t.y);
    if (d < C.range + e.r + t.r && ready(e, 'claw')) {
      w.startEnemyAttack(e, 'claw', t.x, t.y);
      return STILL;
    }
    if (d > P.minRange && d < P.maxRange && ready(e, 'pounce') && lineOfSight(w.map, e.x, e.y, t.x, t.y)) {
      const lp = landingPoint(w, e, t.x, t.y, P.maxRange);
      w.startEnemyAttack(e, 'pounce', lp.x, lp.y);
      return STILL;
    }
    return chase(w, e, t, e.def.speed);
  },
};

const acolyte: Brain = {
  tick(w, e) {
    const O = ATK.acolyte.orb;
    const R = ATK.acolyte.rune;
    if (e.state === 'windup') {
      e.stateT++;
      const need = e.atk === 'orb' ? O.windup : R.windup;
      if (e.atk === 'orb') {
        const t = w.players.get(e.targetId);
        if (t && t.status === 0 && e.stateT < need - 6) {
          e.tx = t.x;
          e.ty = t.y;
          faceTo(e, t.x, t.y);
        }
      }
      if (e.stateT >= need) {
        if (e.atk === 'orb') {
          const a = Math.atan2(e.ty - e.y, e.tx - e.x);
          w.spawnProjectile({
            kind: 'orb', team: 'e', owner: -e.id, x: e.x + Math.cos(a) * 8, y: e.y - 8 + Math.sin(a) * 8,
            vx: Math.cos(a) * O.speed, vy: Math.sin(a) * O.speed, r: O.radius, dmg: O.damage * w.edm(e), range: O.range, destructible: true,
          });
          // Acólito Supremo: leque de três orbes
          if (e.type === 'highAcolyte') {
            for (const off of [-0.28, 0.28]) {
              w.spawnProjectile({
                kind: 'orb', team: 'e', owner: -e.id, x: e.x + Math.cos(a + off) * 8, y: e.y - 8 + Math.sin(a + off) * 8,
                vx: Math.cos(a + off) * O.speed, vy: Math.sin(a + off) * O.speed, r: O.radius, dmg: O.damage * w.edm(e), range: O.range, destructible: true,
              });
            }
          }
          w.emit({ k: 'sfx', n: 'orbCast', x: e.x, y: e.y });
          setCd(e, 'orb', O.cooldown);
        } else setCd(e, 'rune', R.cooldown);
        w.setEnemyState(e, 'recover');
      }
      return STILL;
    }
    if (e.state === 'recover') {
      e.stateT++;
      if (e.stateT >= (e.atk === 'orb' ? O.recovery : R.recovery)) {
        w.setEnemyState(e, 'move');
        e.atk = 'none';
      }
      return STILL;
    }
    const t = w.targetOf(e);
    if (!t) return STILL;
    const d = dist(e.x, e.y, t.x, t.y);
    const los = lineOfSight(w.map, e.x, e.y, t.x, t.y);
    if (los && d < R.maxRange && ready(e, 'rune') && e.counter % 3 === 2) {
      w.startEnemyAttack(e, 'rune', t.x, t.y);
      const z = w.addZone({ kind: 'rune', x: t.x, y: t.y, r: R.radius * (e.type === 'highAcolyte' ? 1.4 : 1), ttl: R.windup, owner: -e.id, b: R.damage * w.edm(e) });
      z.extra = R.windup;
      e.counter++;
      return STILL;
    }
    if (los && d < O.range - 40 && ready(e, 'orb')) {
      w.startEnemyAttack(e, 'orb', t.x, t.y);
      e.counter++;
      return STILL;
    }
    const sp = e.def.speed;
    if (d < ATK.acolyte.keepMin && los) {
      // recua mantendo distância
      const ax = (e.x - t.x) / (d || 1);
      const ay = (e.y - t.y) / (d || 1);
      faceTo(e, t.x, t.y);
      return [ax * sp, ay * sp];
    }
    if (d > ATK.acolyte.keepMax || !los) return chase(w, e, t, sp);
    // circula o alvo
    faceTo(e, t.x, t.y);
    const side = e.id % 2 === 0 ? 1 : -1;
    const px = (-(t.y - e.y) / d) * side;
    const py = ((t.x - e.x) / d) * side;
    return [px * sp * 0.6, py * sp * 0.6];
  },
};

const father: Brain = {
  tick(w, e) {
    const S = ATK.father.slam;
    const L = ATK.father.slipper;
    if (e.atk === 'slam' && e.state !== 'move') {
      meleeRoutine(w, e, S, true);
      if (e.state === 'active' && e.stateT === 1) w.emit({ k: 'fx', n: 'slam', x: e.x + Math.cos(e.facing) * 20, y: e.y + Math.sin(e.facing) * 20, a: e.facing, o: 0, r: S.range });
      if (e.state === 'recover' && e.stateT === 1) setCd(e, 'slam', S.cooldown);
      return STILL;
    }
    if (e.atk === 'slipper' && e.state !== 'move') {
      e.stateT++;
      if (e.state === 'windup' && e.stateT >= L.windup) {
        const a = Math.atan2(e.ty - e.y, e.tx - e.x);
        w.spawnProjectile({
          kind: 'slipper', team: 'e', owner: -e.id, x: e.x, y: e.y - 10, vx: Math.cos(a) * L.speed, vy: Math.sin(a) * L.speed,
          r: L.radius, dmg: L.damage * w.edm(e), range: 9999, destructible: true, returnTo: e.id, tx: e.tx, ty: e.ty,
        });
        w.emit({ k: 'sfx', n: 'slipper', x: e.x, y: e.y });
        setCd(e, 'slipper', L.cooldown);
        w.setEnemyState(e, 'recover');
      } else if (e.state === 'recover' && e.stateT >= L.recovery) {
        w.setEnemyState(e, 'move');
        e.atk = 'none';
      }
      return STILL;
    }
    const t = w.targetOf(e);
    if (!t) return STILL;
    const d = dist(e.x, e.y, t.x, t.y);
    const shout = (): void => {
      if (e.shoutCd <= 0 && w.rng.chance(ATK.father.shoutChance)) {
        let txt = w.rng.pick(FATHER_LINES);
        if (txt === w.lastShout) txt = FATHER_LINES[(FATHER_LINES.indexOf(txt) + 1) % FATHER_LINES.length] ?? txt; // nunca repete a última fala
        w.lastShout = txt;
        w.emit({ k: 'shout', ei: e.id, txt });
        e.shoutCd = sec(ATK.father.shoutCooldown);
      }
    };
    if (d < S.range + e.r + t.r - 4 && ready(e, 'slam')) {
      w.startEnemyAttack(e, 'slam', t.x, t.y);
      shout();
      return STILL;
    }
    if (d > 90 && d < L.maxRange + 40 && ready(e, 'slipper') && lineOfSight(w.map, e.x, e.y, t.x, t.y)) {
      const dd = Math.min(L.maxRange, d + 20);
      const tx = e.x + ((t.x - e.x) / d) * dd;
      const ty = e.y + ((t.y - e.y) / d) * dd;
      w.startEnemyAttack(e, 'slipper', tx, ty);
      shout();
      return STILL;
    }
    return chase(w, e, t, e.def.speed);
  },
};

// ---------------------------------------------------------------- chefes

function pushPlayersAway(w: World, x: number, y: number, radius: number, speed: number): void {
  for (const p of w.players.values()) {
    if (p.status !== 0) continue;
    const d = dist(p.x, p.y, x, y);
    if (d > radius) continue;
    const a = Math.atan2(p.y - y, p.x - x);
    p.move.fvx = Math.cos(a) * speed;
    p.move.fvy = Math.sin(a) * speed;
    p.move.ft = 8;
    p.action = null;
  }
}

const moonDevourer: Brain = {
  tick(w, e) {
    const A = ATK.moonDevourer;
    const phase2 = e.phase >= 2;
    const speed = e.def.speed * (phase2 ? A.phase2Speed : 1);
    // transição de fase
    if (e.phase === 1 && e.hp <= e.maxHp * 0.5 && e.state === 'move') {
      e.phase = 2;
      w.setEnemyState(e, 'roar');
      e.atk = 'howl';
      w.emit({ k: 'boss', et: e.typeIdx, ph: 2 });
      w.emit({ k: 'sfx', n: 'howl', x: e.x, y: e.y });
      return STILL;
    }
    if (e.state === 'roar') {
      e.stateT++;
      if (e.stateT === 20) {
        pushPlayersAway(w, e.x, e.y, A.howl.radius, A.howl.knockback);
        w.emit({ k: 'fx', n: 'howl', x: e.x, y: e.y, a: 0, o: 0, r: A.howl.radius });
      }
      if (e.stateT >= A.howl.windup) {
        w.setEnemyState(e, 'move');
        e.atk = 'none';
      }
      return STILL;
    }
    if (e.atk === 'leap') {
      if (e.state === 'windup') {
        e.stateT++;
        if (e.stateT >= A.leap.windup) {
          w.setEnemyState(e, 'air');
          e.hitBy.clear();
          w.emit({ k: 'sfx', n: 'bossLeap', x: e.x, y: e.y });
        }
        return STILL;
      }
      if (e.state === 'air') {
        e.stateT++;
        const v = airVelocity(e, A.leap.airTicks - e.stateT + 1);
        if (e.stateT >= A.leap.airTicks) {
          for (const z of w.zones) if (z.owner === -e.id && z.kind === 'leapMark') z.dead = true;
          w.enemyCircle(e, e.tx, e.ty, A.leap.radius, A.leap.damage, true);
          w.emit({ k: 'fx', n: 'bossLand', x: e.tx, y: e.ty, a: 0, o: 0, r: A.leap.radius });
          w.emit({ k: 'sfx', n: 'bossLand', x: e.tx, y: e.ty });
          w.setEnemyState(e, 'recover');
          e.counter--;
        }
        return v;
      }
      if (e.state === 'recover') {
        e.stateT++;
        const rec = phase2 && e.counter > 0 ? 6 : A.leap.recovery;
        if (e.stateT >= rec) {
          const t = w.targetOf(e);
          if (phase2 && e.counter > 0 && t) {
            startLeap(w, e, t);
          } else {
            w.setEnemyState(e, 'move');
            e.atk = 'none';
            setCd(e, 'leap', A.leap.cooldown);
          }
        }
        return STILL;
      }
    }
    if (e.atk === 'claws' && e.state !== 'move') {
      e.stateT++;
      const C = A.claws;
      if (e.state === 'windup' && e.stateT >= C.windup) {
        w.setEnemyState(e, 'active');
        e.hitBy.clear();
      } else if (e.state === 'active') {
        if (e.stateT <= C.active) w.enemyMelee(e, C.range, C.arc, C.damage, false);
        if (e.stateT === C.gap) {
          e.hitBy.clear();
          const t = w.players.get(e.targetId);
          if (t) faceTo(e, t.x, t.y);
          e.tx = e.x + Math.cos(e.facing) * 40;
          e.ty = e.y + Math.sin(e.facing) * 40;
        }
        if (e.stateT > C.gap && e.stateT <= C.gap + C.active) w.enemyMelee(e, C.range, C.arc, C.damage, true);
        if (e.stateT === 1 || e.stateT === C.gap + 1) w.emit({ k: 'fx', n: 'bossClaw', x: e.x, y: e.y, a: e.facing, o: 0, r: C.range });
        if (e.stateT >= C.gap + C.active) w.setEnemyState(e, 'recover');
      } else if (e.state === 'recover' && e.stateT >= C.recovery) {
        w.setEnemyState(e, 'move');
        e.atk = 'none';
        setCd(e, 'claws', C.cooldown);
      }
      return STILL;
    }
    if (e.atk === 'crescent' && e.state !== 'move') {
      e.stateT++;
      const C = A.crescent;
      if (e.state === 'windup' && e.stateT >= C.windup) {
        w.setEnemyState(e, 'active');
        w.emit({ k: 'fx', n: 'crescent', x: e.x, y: e.y, a: 0, o: 0, r: C.radius });
      } else if (e.state === 'active') {
        w.enemyCircle(e, e.x, e.y, C.radius, C.damage, true);
        if (e.stateT >= C.active) w.setEnemyState(e, 'recover');
      } else if (e.state === 'recover' && e.stateT >= C.recovery) {
        w.setEnemyState(e, 'move');
        e.atk = 'none';
        setCd(e, 'crescent', C.cooldown);
      }
      return STILL;
    }
    const t = w.targetOf(e);
    if (!t) return STILL;
    const d = dist(e.x, e.y, t.x, t.y);
    if (phase2 && d < A.crescent.radius + 10 && ready(e, 'crescent')) {
      w.startEnemyAttack(e, 'crescent', e.x, e.y);
      return STILL;
    }
    if (d < A.claws.range + 10 && ready(e, 'claws')) {
      w.startEnemyAttack(e, 'claws', t.x, t.y);
      return STILL;
    }
    if ((d > 120 || e.progressT > 60) && ready(e, 'leap')) {
      e.counter = phase2 ? A.phase2Leaps : 1;
      startLeap(w, e, t);
      return STILL;
    }
    return chase(w, e, t, speed);
  },
};

function startLeap(w: World, e: Enemy, t: Target): void {
  const A = ATK.moonDevourer.leap;
  const lp = landingPoint(w, e, t.x, t.y, A.maxRange);
  w.startEnemyAttack(e, 'leap', lp.x, lp.y);
  const z = w.addZone({ kind: 'leapMark', x: lp.x, y: lp.y, r: A.radius, ttl: A.windup + A.airTicks, owner: -e.id });
  z.extra = A.windup + A.airTicks;
}

const patriarch: Brain = {
  tick(w, e) {
    const A = ATK.patriarch;
    const phase2 = e.phase >= 2;
    // fase 2: quando os três totens caem (ou, sem totens no mapa, com metade da vida)
    const totemsDown = w.map.points.totems.length > 0 ? countObjectives(w, 'abyssTotem') === 0 : e.hp <= e.maxHp * ATK.patriarch.phase2HpNoTotems;
    if (e.phase === 1 && e.state === 'move' && (totemsDown || e.hp <= e.maxHp * ATK.patriarch.phase2HpForced)) {
      e.phase = 2;
      e.summonsLeft = A.summon.perPhase;
      w.setEnemyState(e, 'roar');
      e.atk = 'transform';
      w.emit({ k: 'boss', et: e.typeIdx, ph: 2 });
      w.emit({ k: 'sfx', n: 'transform', x: e.x, y: e.y });
      return STILL;
    }
    if (e.state === 'roar') {
      e.stateT++;
      if (e.stateT === 40) {
        pushPlayersAway(w, e.x, e.y, 120, 260);
        w.emit({ k: 'fx', n: 'abyssBurst', x: e.x, y: e.y, a: 0, o: 0, r: 120 });
      }
      if (e.stateT >= A.transform.windup) {
        w.setEnemyState(e, 'move');
        e.atk = 'none';
      }
      return STILL;
    }
    if (e.state !== 'move') {
      e.stateT++;
      switch (e.atk) {
        case 'sweep': {
          const S = A.sweep;
          if (e.state === 'windup' && e.stateT >= S.windup) {
            w.setEnemyState(e, 'active');
            w.emit({ k: 'fx', n: 'sweep', x: e.x, y: e.y, a: e.facing, o: 0, r: S.range });
          } else if (e.state === 'active') {
            w.enemyMelee(e, S.range, S.arc, S.damage, true);
            if (e.stateT >= S.active) w.setEnemyState(e, 'recover');
          } else if (e.state === 'recover' && e.stateT >= S.recovery) {
            w.setEnemyState(e, 'move');
            setCd(e, 'sweep', S.cooldown);
          }
          break;
        }
        case 'eruption': {
          const E = A.eruption;
          const waves = phase2 ? E.phase2Waves : 1;
          if (e.state === 'windup') {
            const k = e.stateT - 1;
            if (k % E.waveGap === 0 && k / E.waveGap < waves) {
              for (const p of w.alivePlayers()) {
                // fases seguintes miram onde o jogador está indo
                const lead = k === 0 ? 0 : 18;
                const tx = p.x + (p.move.fvx !== 0 ? p.move.fvx * 0.1 : (p.last.mx * lead));
                const ty = p.y + (p.move.fvy !== 0 ? p.move.fvy * 0.1 : (p.last.my * lead));
                const z = w.addZone({ kind: 'eruption', x: tx, y: ty, r: E.radius, ttl: E.windup, owner: -e.id, b: E.damage * w.edm(e) });
                z.extra = E.windup;
              }
            }
            if (e.stateT >= E.waveGap * (waves - 1) + 12) {
              w.setEnemyState(e, 'recover');
            }
          } else if (e.state === 'recover' && e.stateT >= 16) {
            w.setEnemyState(e, 'move');
            setCd(e, 'eruption', E.cooldown);
          }
          break;
        }
        case 'summon': {
          const S = A.summon;
          if (e.state === 'windup' && e.stateT >= S.windup) {
            w.director.summonAround(e, S.count, phase2 ? ['acolyte', 'runner', 'shambler'] : ['shambler', 'acolyte']);
            e.summonsLeft--;
            w.setEnemyState(e, 'recover');
          } else if (e.state === 'recover' && e.stateT >= 20) {
            w.setEnemyState(e, 'move');
            setCd(e, 'summon', S.cooldown);
          }
          break;
        }
        case 'burst': {
          const B = A.burst;
          if (e.state === 'windup' && e.stateT >= B.windup) {
            const off = w.rng.next() * Math.PI;
            for (let i = 0; i < B.count; i++) {
              const a = off + (i / B.count) * Math.PI * 2;
              w.spawnProjectile({
                kind: 'abyssOrb', team: 'e', owner: -e.id, x: e.x + Math.cos(a) * 20, y: e.y - 10 + Math.sin(a) * 20,
                vx: Math.cos(a) * B.speed, vy: Math.sin(a) * B.speed, r: B.radius, dmg: B.damage * w.edm(e), range: B.range, destructible: true,
              });
            }
            w.emit({ k: 'sfx', n: 'burst', x: e.x, y: e.y });
            w.setEnemyState(e, 'recover');
          } else if (e.state === 'recover' && e.stateT >= 18) {
            w.setEnemyState(e, 'move');
            setCd(e, 'burst', B.cooldown);
          }
          break;
        }
        case 'dash': {
          const D = A.dash;
          if (e.state === 'windup' && e.stateT >= D.windup) {
            w.setEnemyState(e, 'active');
            e.hitBy.clear();
            w.emit({ k: 'sfx', n: 'bossDash', x: e.x, y: e.y });
          } else if (e.state === 'active') {
            w.enemyCircle(e, e.x, e.y, D.hitRadius, D.damage, true);
            if (e.stateT >= D.dashTicks) w.setEnemyState(e, 'recover');
            const sp = D.distance / (D.dashTicks / 30);
            return [Math.cos(e.facing) * sp, Math.sin(e.facing) * sp];
          } else if (e.state === 'recover' && e.stateT >= 18) {
            w.setEnemyState(e, 'move');
            setCd(e, 'dash', D.cooldown);
          }
          break;
        }
        default:
          w.setEnemyState(e, 'move');
      }
      if ((e.state as string) === 'move') e.atk = 'none';
      return STILL;
    }
    const t = w.targetOf(e);
    if (!t) return STILL;
    const d = dist(e.x, e.y, t.x, t.y);
    const minions = [...w.enemies.values()].filter((o) => o.state !== 'dead' && o.def.tier !== 'boss').length;
    if (d < A.sweep.range && ready(e, 'sweep')) {
      w.startEnemyAttack(e, 'sweep', t.x, t.y);
      return STILL;
    }
    if (phase2 && ready(e, 'dash') && d > 90 && d < 300) {
      w.startEnemyAttack(e, 'dash', t.x, t.y);
      return STILL;
    }
    if (phase2 && ready(e, 'burst')) {
      w.startEnemyAttack(e, 'burst', e.x, e.y);
      return STILL;
    }
    if (ready(e, 'eruption')) {
      w.startEnemyAttack(e, 'eruption', t.x, t.y);
      return STILL;
    }
    if (e.summonsLeft > 0 && minions < A.summon.maxAlive && ready(e, 'summon')) {
      w.startEnemyAttack(e, 'summon', e.x, e.y);
      return STILL;
    }
    return chase(w, e, t, e.def.speed * (phase2 ? 1.2 : 1));
  },
};

// ---------------------------------------------------------------- Noiva do Inverno (capítulo II)

const frostBride: Brain = {
  tick(w, e) {
    const A = ATK.frostBride;
    const phase2 = e.phase >= 2;
    if (e.phase === 1 && e.hp <= e.maxHp * ATK.frostBride.phase2At && e.state === 'move') {
      e.phase = 2;
      w.setEnemyState(e, 'roar');
      e.atk = 'transform';
      w.emit({ k: 'boss', et: e.typeIdx, ph: 2 });
      w.emit({ k: 'sfx', n: 'transform', x: e.x, y: e.y });
      w.storm.active = true;
      w.storm.t = sec(20);
      return STILL;
    }
    if (e.state === 'roar') {
      e.stateT++;
      if (e.stateT === 30) {
        pushPlayersAway(w, e.x, e.y, 110, 240);
        w.emit({ k: 'fx', n: 'frostBlast', x: e.x, y: e.y, a: 0, o: 0, r: 110 });
      }
      if (e.stateT >= 50) {
        w.setEnemyState(e, 'move');
        e.atk = 'none';
      }
      return STILL;
    }
    if (e.state !== 'move') {
      e.stateT++;
      switch (e.atk) {
        case 'shards': {
          const S = A.shards;
          if (e.state === 'windup' && e.stateT >= S.windup) {
            const base = Math.atan2(e.ty - e.y, e.tx - e.x);
            const n = S.count + (phase2 ? 4 : 0);
            for (let i = 0; i < n; i++) {
              const a = base + (i / (n - 1) - 0.5) * S.spread * (phase2 ? 1.5 : 1);
              w.spawnProjectile({
                kind: 'iceShard', team: 'e', owner: -e.id, x: e.x + Math.cos(a) * 14, y: e.y - 14 + Math.sin(a) * 14,
                vx: Math.cos(a) * S.speed, vy: Math.sin(a) * S.speed, r: S.radius, dmg: S.damage * w.edm(e), range: S.range, destructible: true,
              });
            }
            w.emit({ k: 'sfx', n: 'shards', x: e.x, y: e.y });
            w.setEnemyState(e, 'recover');
          } else if (e.state === 'recover' && e.stateT >= 14) {
            w.setEnemyState(e, 'move');
            setCd(e, 'shards', S.cooldown);
          }
          break;
        }
        case 'nova': {
          const N = A.nova;
          if (e.state === 'windup' && e.stateT >= N.windup) {
            w.setEnemyState(e, 'recover');
          } else if (e.state === 'recover' && e.stateT >= 16) {
            w.setEnemyState(e, 'move');
            setCd(e, 'nova', N.cooldown);
          }
          break;
        }
        case 'spikes': {
          const P = A.spikes;
          if (e.state === 'windup' && e.stateT >= P.windup) {
            w.setEnemyState(e, 'recover');
          } else if (e.state === 'recover' && e.stateT >= 14) {
            w.setEnemyState(e, 'move');
            setCd(e, 'spikes', P.cooldown);
          }
          break;
        }
        case 'frostSummon': {
          const F = A.summon;
          if (e.state === 'windup' && e.stateT >= F.windup) {
            w.director.summonAround(e, F.count, ['shambler', 'runner']);
            w.setEnemyState(e, 'recover');
          } else if (e.state === 'recover' && e.stateT >= 18) {
            w.setEnemyState(e, 'move');
            setCd(e, 'frostSummon', F.cooldown);
          }
          break;
        }
        default:
          w.setEnemyState(e, 'move');
      }
      if ((e.state as string) === 'move') e.atk = 'none';
      return STILL;
    }
    const t = w.targetOf(e);
    if (!t) return STILL;
    const d = dist(e.x, e.y, t.x, t.y);
    const minions = [...w.enemies.values()].filter((o) => o.state !== 'dead' && o.def.tier !== 'boss' && !o.def.objective).length;
    if (d < A.nova.radius && ready(e, 'nova')) {
      w.startEnemyAttack(e, 'nova', e.x, e.y);
      const z = w.addZone({ kind: 'nova', x: e.x, y: e.y, r: A.nova.radius, ttl: A.nova.windup, owner: -e.id, b: A.nova.damage * w.edm(e) });
      z.extra = A.nova.windup;
      return STILL;
    }
    if (ready(e, 'spikes') && d < A.spikes.length) {
      // linha de espinhos: segmentos telegrafados até o alvo (e além)
      w.startEnemyAttack(e, 'spikes', t.x, t.y);
      const a = Math.atan2(t.y - e.y, t.x - e.x);
      const P = A.spikes;
      for (let i = 1; i <= P.segments; i++) {
        const k = (i / P.segments) * P.length;
        const x = e.x + Math.cos(a) * k;
        const y = e.y + Math.sin(a) * k;
        const z = w.addZone({ kind: 'iceSpike', x, y, r: P.width / 2, ttl: P.windup + i * 2, owner: -e.id, b: P.damage * w.edm(e) });
        z.extra = P.windup + i * 2;
      }
      return STILL;
    }
    if (phase2 && ready(e, 'frostSummon') && minions < A.summon.maxAlive) {
      w.startEnemyAttack(e, 'frostSummon', e.x, e.y);
      return STILL;
    }
    if (ready(e, 'shards') && d < A.shards.range && lineOfSight(w.map, e.x, e.y, t.x, t.y)) {
      w.startEnemyAttack(e, 'shards', t.x, t.y);
      return STILL;
    }
    // flutua mantendo distância média
    if (d < 90) {
      const ax = (e.x - t.x) / (d || 1);
      const ay = (e.y - t.y) / (d || 1);
      faceTo(e, t.x, t.y);
      return [ax * e.def.speed, ay * e.def.speed];
    }
    return chase(w, e, t, e.def.speed * (phase2 ? A.phase2Speed : 1));
  },
};

// ---------------------------------------------------------------- objetivos

/** Lua falsa: pulso telegrafado periódico ao redor dela. */
const falseMoon: Brain = {
  tick(w, e) {
    const P = ATK.falseMoon.pulse;
    if (--e.objT <= 0) {
      e.objT = sec(P.interval);
      const z = w.addZone({ kind: 'moonPulse', x: e.x, y: e.y, r: P.radius, ttl: sec(P.windup), owner: -e.id, b: P.damage * w.edm(e) });
      z.extra = sec(P.windup);
    }
    return STILL;
  },
};

/** Totem do abismo: dispara orbes no jogador mais próximo com visão. */
const abyssTotem: Brain = {
  tick(w, e) {
    const O = ATK.abyssTotem.orb;
    if (--e.objT > 0) return STILL;
    e.objT = sec(O.interval);
    let best: Target | null = null;
    let bd: number = O.range;
    for (const p of w.alivePlayers()) {
      const d = dist(e.x, e.y, p.x, p.y);
      if (d < bd && lineOfSight(w.map, e.x, e.y, p.x, p.y)) {
        bd = d;
        best = p;
      }
    }
    if (!best) return STILL;
    const a = Math.atan2(best.y - e.y, best.x - e.x);
    w.spawnProjectile({
      kind: 'abyssOrb', team: 'e', owner: -e.id, x: e.x, y: e.y - 16, vx: Math.cos(a) * O.speed, vy: Math.sin(a) * O.speed,
      r: O.radius, dmg: O.damage * w.edm(e), range: O.range, destructible: true,
    });
    w.emit({ k: 'sfx', n: 'orbCast', x: e.x, y: e.y });
    e.facing = a;
    return STILL;
  },
};

/** Carrinho funerário: segue o caminho até a fogueira. */
const funeralCart: Brain = {
  tick(w, e) {
    let dir = w.fireField?.direction(e.x, e.y) ?? null;
    e.atk = 'roll';
    if (!dir) {
      const dx = w.map.campfire.x - e.x;
      const dy = w.map.campfire.y + 48 - e.y;
      const l = Math.hypot(dx, dy) || 1;
      dir = [dx / l, dy / l];
    }
    if (dir[0] === 0 && dir[1] === 0) return STILL;
    e.facing = Math.atan2(dir[1], dir[0]);
    return [dir[0] * e.def.speed, dir[1] * e.def.speed];
  },
};

/** Acólito Ritualista: parado, canalizando (o evento controla o tempo). */
const ritualist: Brain = {
  tick(_w, e) {
    e.state = 'windup';
    e.atk = 'channel';
    e.stateT++;
    return STILL;
  },
};

const BRAINS: Record<string, Brain> = { shambler, runner, werewolf, acolyte, father, moonDevourer, patriarch, frostBride, falseMoon, abyssTotem, funeralCart, ritualist };
/** Minichefes usam o cérebro do inimigo de base. */
export const brainFor = (t: EnemyType): Brain => BRAINS[brainType(t)] ?? shambler;
