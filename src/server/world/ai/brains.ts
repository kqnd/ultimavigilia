/**
 * Cérebros dos inimigos. Cada `tick` decide o estado/ataque e retorna a velocidade desejada (px/s).
 * Ataques seguem antecipação (windup) → janela ativa → recuperação, com telegraphs no cliente
 * derivados de estado + ataque + alvo (tx,ty) enviados nos snapshots.
 */
import { AFFIX_RULES } from '../../../shared/config/affixes.js';
import { ATK, BOSS_AI, brainType, type EnemyType, FATHER_LINES } from '../../../shared/config/enemies.js';
import { CLASS_RANGE } from '../../../shared/config/classes.js';
import { DT, sec } from '../../../shared/constants.js';
import { circleFree, lineOfSight, sweepFree } from '../../../shared/collision.js';
import { angleDiff, dist } from '../../../shared/math.js';
import { countObjectives } from '../objectives.js';
import type { Enemy, Player, Target } from '../types.js';
import type { World } from '../world.js';
import { aiSkill } from '../../../shared/config/enemyAI.js';
import { claimAttack } from './context.js';
import { approachDir, locomote, steer } from './steer.js';
import { type AttackOption, kiteHeat, pickOption, ramp, window4 } from './utility.js';

export interface Brain {
  tick(w: World, e: Enemy): [number, number];
}

const STILL: [number, number] = [0, 0];

/** Aproximação com separação, desvio de paredes/zonas e cerco (ai/steer.ts). */
function chase(w: World, e: Enemy, t: Target, speed: number): [number, number] {
  const d = dist(e.x, e.y, t.x, t.y);
  return steer(w, e, approachDir(w, e, t), speed, { closeToTarget: d < 70 });
}

/** Locomoção por arquétipo (aproximar, flanquear, manter distância, recuar, reagrupar). */
const move = locomote;

/** Respiro de chefe/minichefe entre ataques: enquanto > 0 só se posiciona. */
function thinking(e: Enemy): boolean {
  if (e.thinkT > 0) {
    e.thinkT--;
    return true;
  }
  return false;
}

const isPlayer = (t: Target): boolean => !t.isMinion && !t.isPoint;
/** Ficha de ataque: no máximo `FAIR.maxAttackers` golpeadores simultâneos por jogador. */
const mayStrike = (w: World, e: Enemy, t: Target): boolean => claimAttack(w, e, t.id, isPlayer(t));
const targetClass = (t: Target, w: World): 'ranged' | 'mid' | 'melee' => {
  const p = isPlayer(t) ? w.players.get(t.id) : undefined;
  return p ? CLASS_RANGE[p.cls] : 'melee';
};
const playersWithin = (w: World, x: number, y: number, r: number): number => {
  let n = 0;
  for (const p of w.alivePlayers()) if (dist(p.x, p.y, x, y) <= r) n++;
  return n;
};


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
  stun = 0,
): boolean {
  e.stateT++;
  if (e.state === 'windup' && e.stateT >= spec.windup) w.setEnemyState(e, 'active');
  else if (e.state === 'active') {
    w.enemyMelee(e, spec.range, spec.arc, spec.damage, heavy, stun);
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
    if (d < s.range + e.r + t.r && ready(e, 'swipe') && mayStrike(w, e, t)) {
      w.startEnemyAttack(e, 'swipe', t.x, t.y);
      return STILL;
    }
    // cambaleio: pequena oscilação lateral
    const [vx, vy] = move(w, e, t, e.def.speed);
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
    if (d < s.triggerRange && ready(e, 'lunge') && lineOfSight(w.map, e.x, e.y, t.x, t.y) && mayStrike(w, e, t)) {
      w.startEnemyAttack(e, 'lunge', t.x, t.y);
      return STILL;
    }
    // Corredores flanqueiam em arco (lado próprio) antes do bote, em vez de formar uma fila única.
    return move(w, e, t, e.def.speed);
  },
};

const werewolf: Brain = {
  tick(w, e) {
    const P = ATK.werewolf.pounce;
    const C = ATK.werewolf.claw;
    if (e.atk === 'pounce') {
      if (e.state === 'windup') {
        e.stateT++;
        if (e.stateT >= (e.def.miniboss ? P.minibossWindup : P.windup)) {
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
          // minichefe: telegraph mais longo e atordoamento breve no impacto
          w.enemyCircle(e, e.tx, e.ty, lr, P.damage, true, false, e.def.miniboss ? P.minibossStun : 0);
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
    if (thinking(e)) return move(w, e, t, e.def.speed);
    if (d < C.range + e.r + t.r && ready(e, 'claw') && mayStrike(w, e, t)) {
      w.startEnemyAttack(e, 'claw', t.x, t.y);
      return STILL;
    }
    if (d > P.minRange && d < P.maxRange && ready(e, 'pounce') && lineOfSight(w.map, e.x, e.y, t.x, t.y)) {
      // utilidade: o bote é para quem foge/atira de longe; contra corpo a corpo prefere a garra
      const rc = targetClass(t, w);
      const heat = kiteHeat(e, BOSS_AI.pursuitDistance, d);
      const u = window4(d, P.minRange, P.minRange + 35, P.maxRange - 50, P.maxRange) * (0.26 + (rc === 'ranged' ? 0.3 : rc === 'mid' ? 0.15 : 0) + 0.4 * heat + 0.2 * aiSkill(w.wave));
      const pick = pickOption(w, e, [{ atk: 'pounce', ready: true, score: u }]);
      if (pick && mayStrike(w, e, t)) {
        const lp = landingPoint(w, e, t.x, t.y, P.maxRange);
        w.startEnemyAttack(e, 'pounce', lp.x, lp.y);
        return STILL;
      }
    }
    return move(w, e, t, e.def.speed);
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
            kind: 'orb', team: 'e', owner: -e.id, x: e.x + Math.cos(a) * 8, y: e.y + Math.sin(a) * 8,
            vx: Math.cos(a) * O.speed, vy: Math.sin(a) * O.speed, r: O.radius, dmg: O.damage * w.edm(e), range: O.range, destructible: true,
          });
          // Acólito Supremo: leque de três orbes
          if (e.type === 'highAcolyte') {
            for (const off of [-0.28, 0.28]) {
              w.spawnProjectile({
                kind: 'orb', team: 'e', owner: -e.id, x: e.x + Math.cos(a + off) * 8, y: e.y + Math.sin(a + off) * 8,
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
    // função de cerco (ondas avançadas): canaliza contra fogueira/altar à distância
    if (w.objectives.trySiege(e)) return STILL;
    const t = w.targetOf(e);
    if (!t) return STILL;
    const d = dist(e.x, e.y, t.x, t.y);
    const los = lineOfSight(w.map, e.x, e.y, t.x, t.y);
    const sp = e.def.speed;
    if (!thinking(e) && los) {
      const tp = isPlayer(t) ? w.players.get(t.id) : undefined;
      // utilidade: runa pune quem está parado/curando/rezando ou agrupado; orbe é o tiro padrão
      const stay = tp ? ramp(tp.stillT, 0, sec(1)) : 0.5;
      const busy = tp && (tp.revivingId || tp.recentHeal > 8) ? 1 : 0;
      const grouped = playersWithin(w, t.x, t.y, R.radius * 1.6) >= 2 ? 1 : 0;
      const opts: AttackOption[] = [
        { atk: 'rune', ready: d < R.maxRange && ready(e, 'rune'), score: 0.18 + 0.3 * stay + 0.25 * busy + 0.2 * grouped + (e.counter % 3 === 2 ? 0.2 : 0) },
        { atk: 'orb', ready: d < O.range - 40 && ready(e, 'orb'), score: 0.5 },
      ];
      const pick = pickOption(w, e, opts);
      if (pick?.atk === 'rune') {
        w.startEnemyAttack(e, 'rune', t.x, t.y);
        const z = w.addZone({ kind: 'rune', x: t.x, y: t.y, r: R.radius * (e.type === 'highAcolyte' ? 1.4 : 1), ttl: R.windup, owner: -e.id, b: R.damage * w.edm(e) });
        z.extra = R.windup;
        e.counter++;
        return STILL;
      }
      if (pick?.atk === 'orb') {
        w.startEnemyAttack(e, 'orb', t.x, t.y);
        e.counter++;
        return STILL;
      }
    }
    // mantém distância (faixa do arquétipo), recua ferido, reagrupa com o bando
    return move(w, e, t, sp);
  },
};

const father: Brain = {
  tick(w, e) {
    const S = ATK.father.slam;
    const L = ATK.father.slipper;
    if (e.atk === 'slam' && e.state !== 'move') {
      // Pai Ancestral: telegraph mais longo e atordoamento breve
      meleeRoutine(w, e, e.def.miniboss ? { ...S, windup: S.minibossWindup } : S, true, e.def.miniboss ? S.minibossStun : 0);
      if (e.state === 'active' && e.stateT === 1) w.emit({ k: 'fx', n: 'slam', x: e.x + Math.cos(e.facing) * 20, y: e.y + Math.sin(e.facing) * 20, a: e.facing, o: 0, r: S.range });
      if (e.state === 'recover' && e.stateT === 1) setCd(e, 'slam', S.cooldown);
      return STILL;
    }
    if (e.atk === 'slipper' && e.state !== 'move') {
      e.stateT++;
      if (e.state === 'windup' && e.stateT >= L.windup) {
        const a = Math.atan2(e.ty - e.y, e.tx - e.x);
        w.spawnProjectile({
          kind: 'slipper', team: 'e', owner: -e.id, x: e.x, y: e.y, vx: Math.cos(a) * L.speed, vy: Math.sin(a) * L.speed,
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
    if (thinking(e)) return move(w, e, t, e.def.speed);
    if (d < S.range + e.r + t.r - 4 && ready(e, 'slam') && mayStrike(w, e, t)) {
      w.startEnemyAttack(e, 'slam', t.x, t.y);
      shout();
      return STILL;
    }
    if (d > 90 && d < L.maxRange + 40 && ready(e, 'slipper') && lineOfSight(w.map, e.x, e.y, t.x, t.y)) {
      // utilidade: chinelada para quem mantém distância/foge; de perto prefere fechar e socar
      const rc = targetClass(t, w);
      const heat = kiteHeat(e, BOSS_AI.pursuitDistance, d);
      const u = window4(d, 90, 130, L.maxRange - 20, L.maxRange + 40) * (0.22 + (rc === 'ranged' ? 0.3 : rc === 'mid' ? 0.15 : 0) + 0.4 * heat + 0.15 * aiSkill(w.wave));
      if (pickOption(w, e, [{ atk: 'slipper', ready: true, score: u }])) {
        const dd = Math.min(L.maxRange, d + 20);
        const tx = e.x + ((t.x - e.x) / d) * dd;
        const ty = e.y + ((t.y - e.y) / d) * dd;
        w.startEnemyAttack(e, 'slipper', tx, ty);
        shout();
        return STILL;
      }
    }
    return move(w, e, t, e.def.speed);
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
    if (thinking(e)) return move(w, e, t, speed);
    // utilidade por distância, quantos jogadores no alcance, reação ao kite e variedade (recência)
    const heat = kiteHeat(e, BOSS_AI.pursuitDistance, d);
    const nearC = playersWithin(w, e.x, e.y, A.crescent.radius + 10);
    const closeness = ramp(A.claws.range + 10 - d, -30, 30);
    const opts: AttackOption[] = [
      { atk: 'crescent', ready: phase2 && ready(e, 'crescent'), score: d < A.crescent.radius + 10 ? 0.62 + 0.12 * Math.min(3, nearC) : 0 },
      { atk: 'claws', ready: ready(e, 'claws'), score: d < A.claws.range + 10 ? 0.7 + 0.2 * closeness : 0 },
      { atk: 'leap', ready: ready(e, 'leap'), score: Math.min(1, Math.max(ramp(d, 100, 260) * 0.72, e.progressT > 60 ? 0.7 : 0) + 0.3 * heat + (e.desperate ? 0.1 : 0)) },
    ];
    const pick = pickOption(w, e, opts);
    if (pick?.atk === 'crescent') {
      w.startEnemyAttack(e, 'crescent', e.x, e.y);
      return STILL;
    }
    if (pick?.atk === 'claws') {
      w.startEnemyAttack(e, 'claws', t.x, t.y);
      return STILL;
    }
    if (pick?.atk === 'leap') {
      e.counter = phase2 ? A.phase2Leaps : 1;
      startLeap(w, e, t);
      return STILL;
    }
    return move(w, e, t, speed);
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
                kind: 'abyssOrb', team: 'e', owner: -e.id, x: e.x + Math.cos(a) * 20, y: e.y + Math.sin(a) * 20,
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
    const spd = e.def.speed * (phase2 ? 1.2 : 1);
    if (thinking(e)) return move(w, e, t, spd);
    const minions = [...w.enemies.values()].filter((o) => o.state !== 'dead' && o.def.tier !== 'boss').length;
    const heat = kiteHeat(e, BOSS_AI.pursuitDistance, d);
    const others = Math.min(3, w.alivePlayers().length - 1);
    const opts: AttackOption[] = [
      { atk: 'sweep', ready: ready(e, 'sweep'), score: d < A.sweep.range ? 0.8 + 0.15 * ramp(A.sweep.range - d, 0, 40) : 0 },
      // gap-closer: cresce quando o alvo foge ou fustiga de longe
      { atk: 'dash', ready: phase2 && ready(e, 'dash'), score: window4(d, 90, 150, 230, 300) * (0.5 + 0.45 * heat) },
      // anel de orbes: melhor com jogadores espalhados à média distância
      { atk: 'burst', ready: phase2 && ready(e, 'burst'), score: 0.3 + 0.35 * window4(d, 80, 140, 300, 420) + 0.1 * others },
      { atk: 'eruption', ready: ready(e, 'eruption'), score: 0.5 + 0.2 * ramp(d, 60, 200) + 0.08 * others + 0.12 * heat },
      { atk: 'summon', ready: e.summonsLeft > 0 && minions < A.summon.maxAlive && ready(e, 'summon'), score: 0.45 + 0.35 * ramp(d, 90, 200) },
    ];
    const pick = pickOption(w, e, opts);
    if (pick) {
      const self = pick.atk === 'burst' || pick.atk === 'summon';
      w.startEnemyAttack(e, pick.atk as 'sweep', self ? e.x : t.x, self ? e.y : t.y);
      return STILL;
    }
    return move(w, e, t, spd);
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
                kind: 'iceShard', team: 'e', owner: -e.id, x: e.x + Math.cos(a) * 14, y: e.y + Math.sin(a) * 14,
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
    const spd = e.def.speed * (phase2 ? A.phase2Speed : 1);
    if (thinking(e)) return move(w, e, t, spd);
    const los = lineOfSight(w.map, e.x, e.y, t.x, t.y);
    const heat = kiteHeat(e, BOSS_AI.pursuitDistance, d);
    const opts: AttackOption[] = [
      { atk: 'nova', ready: ready(e, 'nova'), score: d < A.nova.radius ? 0.9 : 0 },
      { atk: 'spikes', ready: ready(e, 'spikes') && d < A.spikes.length, score: 0.4 + 0.35 * window4(d, 40, 100, 220, 260) },
      { atk: 'frostSummon', ready: phase2 && ready(e, 'frostSummon') && minions < A.summon.maxAlive, score: 0.5 + 0.3 * ramp(d, 80, 160) },
      // projétil: resposta a quem fica longe/fustiga de fora
      { atk: 'shards', ready: ready(e, 'shards') && d < A.shards.range && los, score: 0.42 + 0.18 * ramp(d, 90, 200) + 0.35 * heat },
    ];
    const pick = pickOption(w, e, opts);
    if (pick?.atk === 'nova') {
      w.startEnemyAttack(e, 'nova', e.x, e.y);
      const z = w.addZone({ kind: 'nova', x: e.x, y: e.y, r: A.nova.radius, ttl: A.nova.windup, owner: -e.id, b: A.nova.damage * w.edm(e) });
      z.extra = A.nova.windup;
      return STILL;
    }
    if (pick?.atk === 'spikes') {
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
    if (pick?.atk === 'frostSummon') {
      w.startEnemyAttack(e, 'frostSummon', e.x, e.y);
      return STILL;
    }
    if (pick?.atk === 'shards') {
      w.startEnemyAttack(e, 'shards', t.x, t.y);
      return STILL;
    }
    // flutua mantendo distância média (faixa do arquétipo)
    return move(w, e, t, spd);
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
      kind: 'abyssOrb', team: 'e', owner: -e.id, x: e.x, y: e.y, vx: Math.cos(a) * O.speed, vy: Math.sin(a) * O.speed,
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


// ---------------------------------------------------------------- anti-kite (v1.2)

const RANGE_WEIGHT = { ranged: 3, mid: 2, melee: 1 } as const;

/** Move em linha reta se o caminho estiver livre; senão, navega pelo campo de fluxo até o alvo. */
function moveToward(w: World, e: Enemy, x: number, y: number, speed: number, fallback: Target): [number, number] {
  const d = dist(e.x, e.y, x, y);
  if (d < 6) return STILL;
  const step = Math.min(d, 24);
  const nx = e.x + ((x - e.x) / d) * step;
  const ny = e.y + ((y - e.y) / d) * step;
  if (circleFree(w.map, nx, ny, e.r)) return [((x - e.x) / d) * speed, ((y - e.y) / d) * speed];
  return chase(w, e, fallback, speed);
}

/** Aliados perto que estão de fato perseguindo alguém (peso: comum 1, elite/chefe 2). */
function chasingWeight(w: World, e: Enemy): number {
  const M = ATK.shadowAcolyte.march;
  let weight = 0;
  for (const o of w.enemiesInCircle(e.x, e.y, M.radius)) {
    if (o.id === e.id || o.def.objective || o.def.stationary || o.type === 'shadowAcolyte') continue;
    if (o.state !== 'move' && o.state !== 'windup') continue;
    if (o.hasteT > sec(1)) continue; // já acelerado: não desperdiça
    // quem vai ocupar o objetivo ou caçar o sobrevivente também conta (acelera invasores)
    const goal = o.role !== 'none' ? w.targetOf(o) : w.players.get(o.targetId);
    if (!goal || goal.status !== 0 || dist(o.x, o.y, goal.x, goal.y) < M.arrivedDistance) continue;
    weight += o.def.tier === 'common' ? 1 : 2;
  }
  return weight;
}

/** Acólito Sombrio — Condutor da Caçada: fica atrás da linha de frente e acelera a horda. */
const shadowAcolyte: Brain = {
  tick(w, e) {
    const A = ATK.shadowAcolyte;
    const M = A.march;
    const B = A.bolt;
    const W = A.wound;
    if (e.cds.march === undefined) setCd(e, 'march', M.firstDelay);
    if (e.cds.wound === undefined) setCd(e, 'wound', W.firstDelay);
    // Ferida Profana: canaliza com símbolo no alvo, trava a mira pouco antes e lança um pulso reto
    if (e.state === 'windup' && e.atk === 'wound') {
      e.stateT++;
      const t = w.players.get(e.aimPid);
      if (!t || t.status !== 0) {
        w.setEnemyState(e, 'move');
        e.atk = 'none';
        e.aimPid = 0;
        return STILL;
      }
      if (e.stateT < W.windup - W.lockTicks) {
        e.tx = t.x;
        e.ty = t.y;
        faceTo(e, t.x, t.y);
      }
      if (e.stateT >= W.windup) {
        const a = Math.atan2(e.ty - e.y, e.tx - e.x);
        w.spawnProjectile({
          kind: 'woundBolt', team: 'e', owner: -e.id, x: e.x + Math.cos(a) * 8, y: e.y + Math.sin(a) * 8,
          vx: Math.cos(a) * W.speed, vy: Math.sin(a) * W.speed, r: W.radius, dmg: W.damage * w.edm(e), range: W.range + 40, destructible: true, a: t.id,
        });
        w.emit({ k: 'sfx', n: 'woundCast', x: e.x, y: e.y });
        setCd(e, 'wound', W.cooldown);
        e.lastCastTick = w.tick;
        e.aimPid = 0;
        w.setEnemyState(e, 'recover');
      }
      return STILL;
    }
    if (e.state === 'windup' && e.atk === 'march') {
      e.stateT++;
      if (e.stateT === Math.floor(M.windup / 2)) w.emit({ k: 'sfx', n: 'marchGrow', x: e.x, y: e.y });
      if (e.stateT >= M.windup) {
        let n = 0;
        for (const o of w.enemiesInCircle(e.x, e.y, M.radius)) {
          if (o.def.objective || o.def.stationary) continue;
          const bonus = o.def.tier === 'boss' ? M.bossBonus : o.def.tier === 'elite' || o.def.miniboss ? M.eliteBonus : M.commonBonus;
          // não acumula: a nova aplicação só renova a duração (mantém o maior bônus)
          o.hasteMul = o.hasteT > 0 ? Math.max(o.hasteMul, bonus) : bonus;
          o.hasteT = sec(M.duration);
          n++;
        }
        w.emit({ k: 'fx', n: 'marchPulse', x: e.x, y: e.y, a: 0, o: n, r: M.radius });
        w.emit({ k: 'sfx', n: 'marchDone', x: e.x, y: e.y });
        setCd(e, 'march', M.cooldown);
        e.lastCastTick = w.tick;
        e.repositionT = sec(A.repositionSeconds);
        e.counter++;
        w.setEnemyState(e, 'recover');
      }
      return STILL;
    }
    if (e.state === 'windup' && e.atk === 'orb') {
      e.stateT++;
      if (e.stateT >= B.windup) {
        const a = Math.atan2(e.ty - e.y, e.tx - e.x);
        w.spawnProjectile({
          kind: 'orb', team: 'e', owner: -e.id, x: e.x + Math.cos(a) * 8, y: e.y + Math.sin(a) * 8,
          vx: Math.cos(a) * B.speed, vy: Math.sin(a) * B.speed, r: B.radius, dmg: B.damage * w.edm(e), range: B.range, destructible: true,
        });
        w.emit({ k: 'sfx', n: 'orbCast', x: e.x, y: e.y });
        setCd(e, 'orb', B.cooldown);
        w.setEnemyState(e, 'recover');
      }
      return STILL;
    }
    if (e.state === 'recover') {
      e.stateT++;
      if (e.stateT >= (e.atk === 'march' ? M.recovery : e.atk === 'wound' ? W.recovery : B.recovery)) {
        w.setEnemyState(e, 'move');
        e.atk = 'none';
      }
      return STILL;
    }
    if (e.repositionT > 0) e.repositionT--;
    // cerco à distância em ondas avançadas
    if (w.objectives.trySiege(e)) return STILL;
    // Ferida Profana: prefere quem curou muito há pouco (distribui entre jogadores)
    if (ready(e, 'wound') && w.tick - e.lastCastTick > sec(W.spacing)) {
      const v = woundTarget(w, e);
      if (v) {
        e.aimPid = v.id;
        w.startEnemyAttack(e, 'wound', v.x, v.y);
        w.emit({ k: 'fx', n: 'woundMark', x: v.x, y: v.y - 26, a: e.id, o: v.id, r: W.windup });
        w.emit({ k: 'sfx', n: 'woundCharge', x: e.x, y: e.y });
        return STILL;
      }
    }
    const t = w.targetOf(e);
    if (!t) return STILL;
    const d = dist(e.x, e.y, t.x, t.y);
    const los = lineOfSight(w.map, e.x, e.y, t.x, t.y);
    // Marcha Sombria: só com um grupo relevante perseguindo e sem outro Acólito conjurando perto
    if (ready(e, 'march') && w.tick - e.lastCastTick > sec(W.spacing) && --e.aiT <= 0) {
      e.aiT = M.retryTicks;
      let busy = false;
      for (const o of w.enemiesInCircle(e.x, e.y, M.exclusiveRadius)) if (o !== e && o.type === 'shadowAcolyte' && o.atk === 'march' && o.state === 'windup') busy = true;
      if (!busy && chasingWeight(w, e) >= M.minAllyWeight) {
        w.startEnemyAttack(e, 'march', e.x, e.y);
        faceTo(e, t.x, t.y);
        w.emit({ k: 'sfx', n: 'marchStart', x: e.x, y: e.y });
        return STILL;
      }
    }
    // foge de corpo a corpo que chegou perto
    for (const p of w.alivePlayers()) {
      if (CLASS_RANGE[p.cls] === 'ranged') continue;
      const pd = dist(e.x, e.y, p.x, p.y);
      if (pd < A.fleeMelee) {
        const fx = (e.x - p.x) / (pd || 1);
        const fy = (e.y - p.y) / (pd || 1);
        faceTo(e, p.x, p.y);
        if (circleFree(w.map, e.x + fx * 16, e.y + fy * 16, e.r)) return [fx * e.def.speed, fy * e.def.speed];
        const side = e.id % 2 === 0 ? 1 : -1;
        return [-fy * side * e.def.speed, fx * side * e.def.speed];
      }
    }
    if (los && d < B.range - 30 && d > A.fleeMelee && ready(e, 'orb')) {
      w.startEnemyAttack(e, 'orb', t.x, t.y);
      return STILL;
    }
    // cobertura: avaliada em intervalos, atrás de Portadores/elites/grupos em relação ao alvo
    if ((w.tick + e.id) % A.evalTicks === 0) {
      let anchor: Enemy | null = null;
      let best = 0;
      for (const o of w.enemiesInCircle(e.x, e.y, 230)) {
        if (o === e || o.def.objective || o.type === 'shadowAcolyte') continue;
        const score = (o.type === 'ossuaryBearer' ? 5 : o.def.tier === 'elite' ? 3 : 0.6) - dist(e.x, e.y, o.x, o.y) / 400;
        if (score > best) {
          best = score;
          anchor = o;
        }
      }
      const side = (e.counter % 2 === 0 ? 1 : -1) * (e.repositionT > 0 ? 0.6 : 0);
      let cx: number;
      let cy: number;
      if (anchor) {
        const ad = dist(anchor.x, anchor.y, t.x, t.y) || 1;
        const ang = Math.atan2(anchor.y - t.y, anchor.x - t.x) + side;
        cx = anchor.x + Math.cos(ang) * A.coverOffset;
        cy = anchor.y + Math.sin(ang) * A.coverOffset;
        void ad;
      } else {
        const ang = Math.atan2(e.y - t.y, e.x - t.x) + side;
        const keep = (A.keepMin + A.keepMax) / 2;
        cx = t.x + Math.cos(ang) * keep;
        cy = t.y + Math.sin(ang) * keep;
      }
      if (circleFree(w.map, cx, cy, e.r + 4)) {
        e.coverX = cx;
        e.coverY = cy;
      }
    }
    if (d > A.keepMax + 80 || !los) return chase(w, e, t, e.def.speed);
    const v = moveToward(w, e, e.coverX, e.coverY, e.def.speed, t);
    faceTo(e, t.x, t.y);
    return v;
  },
};

/**
 * Alvo da Ferida Profana: jogador ao alcance e em linha de visão, preferindo quem curou muito nos
 * últimos segundos. Nunca dois Acólitos no mesmo jogador ao mesmo tempo, e não relança em quem
 * ainda está bem ferido (distribui a pressão no multiplayer).
 */
function woundTarget(w: World, e: Enemy): Player | null {
  const W = ATK.shadowAcolyte.wound;
  let best: Player | null = null;
  let bestScore = -Infinity;
  for (const p of w.alivePlayers()) {
    const d = dist(e.x, e.y, p.x, p.y);
    if (d > W.range || !lineOfSight(w.map, e.x, e.y, p.x, p.y)) continue;
    if (p.woundT > sec(W.skipIfRemaining)) continue;
    let busy = false;
    for (const o of w.enemies.values()) if (o !== e && o.type === 'shadowAcolyte' && o.atk === 'wound' && o.state === 'windup' && o.aimPid === p.id) busy = true;
    if (busy) continue;
    let score = p.recentHeal - d * 0.02;
    if (p.recentHeal >= W.minRecentHeal) score += 100;
    if (p.buffs.harvest > 0 || p.buffs.feast > 0) score += 40;
    if (score > bestScore) {
      bestScore = score;
      best = p;
    }
  }
  return best;
}

/** Caçador de Névoa desvia de cascas do Lapanha quando pode. */
function avoidPeels(w: World, e: Enemy, v: [number, number]): [number, number] {
  const sp = Math.hypot(v[0], v[1]);
  if (sp < 1) return v;
  const nx = e.x + (v[0] / sp) * 16;
  const ny = e.y + (v[1] / sp) * 16;
  for (const z of w.zones) {
    if (z.kind !== 'peel' || z.dead) continue;
    const dz = dist(nx, ny, z.x, z.y);
    if (dz > z.r + e.r + 8) continue;
    // contorna pelo lado mais livre
    const side = (v[0] / sp) * (z.y - e.y) - (v[1] / sp) * (z.x - e.x) > 0 ? -1 : 1;
    const px = (-v[1] / sp) * side;
    const py = (v[0] / sp) * side;
    if (circleFree(w.map, e.x + px * 12, e.y + py * 12, e.r)) return [px * sp, py * sp];
  }
  return v;
}

/** Escolha de alvo do Caçador de Névoa: prefere quem atira de longe, distribui a pressão. */
function stalkerTarget(w: World, e: Enemy): Player | null {
  const S = ATK.mistStalker;
  if (e.tauntT > 0) {
    const t = w.players.get(e.tauntBy);
    if (t && t.status === 0) return t;
  }
  const cur = w.players.get(e.lockedId);
  if (cur && cur.status === 0 && e.targetT > 0) return cur;
  let best: Player | null = null;
  let bestScore = -Infinity;
  for (const p of w.alivePlayers()) {
    const d = dist(e.x, e.y, p.x, p.y);
    let score = RANGE_WEIGHT[CLASS_RANGE[p.cls]] - d * 0.004;
    if (w.tick - p.lastShotTick < sec(2)) score += 2;
    if (lineOfSight(w.map, e.x, e.y, p.x, p.y)) score += 0.5;
    if (CLASS_RANGE[p.cls] === 'melee' && w.enemiesInCircle(p.x, p.y, 60).length >= S.crowdedMelee) score -= 3;
    // pressiona quem fica parado junto ao objetivo (fogueira/altar)
    if (p.stillT > sec(1.5) && w.objectives.playerInArea(p)) score += 1.5;
    for (const o of w.enemies.values()) if (o !== e && o.type === 'mistStalker' && o.lockedId === p.id) score -= 1.5;
    if (score > bestScore) {
      bestScore = score;
      best = p;
    }
  }
  e.lockedId = best?.id ?? 0;
  e.targetId = e.lockedId;
  e.targetT = S.retargetTicks;
  return best;
}

/** Caçador de Névoa: flanqueia velado e salta na posição prevista de quem atira. */
const mistStalker: Brain = {
  tick(w, e) {
    const v = mistStalkerMove(w, e);
    return e.state === 'move' ? avoidPeels(w, e, v) : v;
  },
};
const mistStalkerMove = (w: World, e: Enemy): [number, number] => {
  {
    const S = ATK.mistStalker;
    const L = S.leap;
    const C = S.claw;
    e.veiled = false;
    if (e.atk === 'mistLeap') {
      if (e.state === 'windup') {
        e.stateT++;
        faceTo(e, e.tx, e.ty);
        if (e.stateT >= L.windup) {
          w.setEnemyState(e, 'air');
          e.hitBy.clear();
          w.emit({ k: 'fx', n: 'mistJump', x: e.x, y: e.y, a: e.facing, o: e.id, r: 0 });
        }
        return STILL;
      }
      if (e.state === 'air') {
        e.stateT++;
        const v = airVelocity(e, L.airTicks - e.stateT + 1);
        if (e.stateT >= L.airTicks) {
          // impacto direto atordoa brevemente; a borda do pouso só fere
          w.enemyCircle(e, e.tx, e.ty, L.stunRadius, L.damage, false, true, L.stun);
          w.enemyCircle(e, e.tx, e.ty, L.landRadius, L.damage, false, true);
          w.emit({ k: 'fx', n: 'mistLand', x: e.tx, y: e.ty, a: 0, o: 0, r: L.landRadius });
          w.emit({ k: 'sfx', n: 'mistLand', x: e.tx, y: e.ty });
          w.setEnemyState(e, 'recover');
          setCd(e, 'mistLeap', L.cooldown);
        }
        return v;
      }
      if (e.state === 'recover') {
        e.stateT++;
        if (e.stateT >= L.recovery) {
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
    const t = stalkerTarget(w, e);
    if (!t) return STILL;
    const d = dist(e.x, e.y, t.x, t.y);
    const los = lineOfSight(w.map, e.x, e.y, t.x, t.y);
    // bloqueado por um servo colado à frente: reage a ele
    const m = w.targetOf(e);
    if (m && m.isMinion && dist(e.x, e.y, m.x, m.y) < C.range + e.r + m.r && ready(e, 'claw')) {
      w.startEnemyAttack(e, 'claw', m.x, m.y);
      return STILL;
    }
    if (d < C.range + e.r + t.r && ready(e, 'claw') && mayStrike(w, e, t)) {
      w.startEnemyAttack(e, 'claw', t.x, t.y);
      return STILL;
    }
    const inView = Math.abs(e.x - t.x) <= L.viewHalfW && Math.abs(e.y - t.y) <= L.viewHalfH;
    let claimed = 0;
    for (const o of w.enemies.values()) if (o !== e && o.type === 'mistStalker' && o.atk === 'mistLeap' && (o.state === 'windup' || o.state === 'air') && o.lockedId === t.id) claimed++;
    if (ready(e, 'mistLeap') && d >= L.minRange && d <= L.maxRange && los && inView && claimed === 0) {
      // previsão curta da posição futura (direção e velocidade atuais), limitada
      const spd = t.base.speed;
      let lx = t.last.mx * spd * L.leadSeconds;
      let ly = t.last.my * spd * L.leadSeconds;
      const ll = Math.hypot(lx, ly);
      if (ll > L.maxLead) {
        lx = (lx / ll) * L.maxLead;
        ly = (ly / ll) * L.maxLead;
      }
      const lp = landingPoint(w, e, t.x + lx, t.y + ly, L.maxRange);
      const land = sweepFree(w.map, e.x, e.y, lp.x, lp.y, e.r); // nunca atravessa paredes
      w.startEnemyAttack(e, 'mistLeap', land.x, land.y);
      w.emit({ k: 'sfx', n: 'mistCue', x: e.x, y: e.y });
      return STILL;
    }
    // Combo Caçador exposto: um acerto em área o revela por um instante, mesmo perto do limite do velamento.
    e.veiled = e.exposedT <= 0 && d > S.veilDistance;
    const sp = e.def.speed;
    // desvia da linha de tiro de quem está mirando nele
    const angToMe = Math.atan2(e.y - t.y, e.x - t.x);
    const side = e.id % 2 === 0 ? 1 : -1;
    if (los && d < S.dodgeAimRange && w.tick - t.lastShotTick < 20 && Math.abs(angleDiff(t.aim, angToMe)) < S.dodgeAimAngle) {
      const px = -Math.sin(angToMe) * side;
      const py = Math.cos(angToMe) * side;
      if (circleFree(w.map, e.x + px * 14, e.y + py * 14, e.r)) {
        faceTo(e, t.x, t.y);
        return [px * sp, py * sp];
      }
    }
    // aproximação diagonal (flanco) quando há visão; senão navegação normal
    if (los && d > 90) {
      const base = Math.atan2(t.y - e.y, t.x - e.x) + side * S.flankAngle * Math.min(1, (d - 90) / 120);
      const fx = Math.cos(base);
      const fy = Math.sin(base);
      if (circleFree(w.map, e.x + fx * 14, e.y + fy * 14, e.r)) {
        faceTo(e, t.x, t.y);
        return [fx * sp, fy * sp];
      }
    }
    return chase(w, e, t, sp);
  }
};

/** Jogador mais "relevante" para apontar o escudo: quem ataca de longe, depois distância. */
function shieldFocus(w: World, e: Enemy): Player | null {
  let best: Player | null = null;
  let bestScore = -Infinity;
  for (const p of w.alivePlayers()) {
    const d = dist(e.x, e.y, p.x, p.y);
    if (d > 420) continue;
    let score = RANGE_WEIGHT[CLASS_RANGE[p.cls]] - d * 0.006;
    if (w.tick - p.lastShotTick < sec(1.5)) score += 1.5;
    if (score > bestScore) {
      bestScore = score;
      best = p;
    }
  }
  return best;
}

/** Portador do Ossário: avança com o escudo virado para o atirador mais relevante. */
const ossuaryBearer: Brain = {
  tick(w, e) {
    const O = ATK.ossuaryBearer;
    const B = O.bash;
    const shielded = e.shieldHp > 0;
    const focus = shielded ? shieldFocus(w, e) : null;
    if (focus) {
      const want = Math.atan2(focus.y - e.y, focus.x - e.x);
      const diff = angleDiff(want, e.shieldDir);
      const maxTurn = O.shield.turnRate * DT;
      e.shieldDir += Math.max(-maxTurn, Math.min(maxTurn, diff));
    }
    if (e.atk === 'bash' && e.state !== 'move') {
      // sem escudo: golpe pesado mais lento de preparar, que atordoa brevemente
      meleeRoutine(w, e, shielded ? B : { ...B, windup: B.brokenWindup }, true, shielded ? 0 : B.brokenStun);
      if (e.state === 'active' && e.stateT === 1) w.emit({ k: 'fx', n: 'bash', x: e.x + Math.cos(e.facing) * 16, y: e.y + Math.sin(e.facing) * 16, a: e.facing, o: 0, r: B.range });
      if (e.state === 'recover' && e.stateT === 1) setCd(e, 'bash', B.cooldown * (shielded ? 1 : O.brokenCooldownMul));
      return STILL;
    }
    const t = w.targetOf(e);
    if (!t) return STILL;
    const d = dist(e.x, e.y, t.x, t.y);
    if (d < B.range + e.r + t.r && ready(e, 'bash') && mayStrike(w, e, t)) {
      w.startEnemyAttack(e, 'bash', t.x, t.y);
      return STILL;
    }
    let speed = shielded ? e.def.speed : O.brokenSpeed;
    // não abandona a formação atrás de alvo muito distante enquanto protege
    if (shielded && d > O.leashDistance) speed *= 0.5;
    let [vx, vy] = chase(w, e, t, speed);
    // espaço entre Portadores: nunca uma parede perfeita
    for (const o of w.enemiesInCircle(e.x, e.y, O.spacing)) {
      if (o === e || o.type !== 'ossuaryBearer') continue;
      const od = dist(e.x, e.y, o.x, o.y) || 0.01;
      const push = (O.spacing - od) / O.spacing;
      vx += ((e.x - o.x) / od) * speed * push;
      vy += ((e.y - o.y) / od) * speed * push;
    }
    if (!shielded) e.shieldDir = e.facing;
    return [vx, vy];
  },
};

const BRAINS: Record<string, Brain> = { shambler, runner, werewolf, acolyte, father, moonDevourer, patriarch, frostBride, falseMoon, abyssTotem, funeralCart, ritualist, shadowAcolyte, mistStalker, ossuaryBearer };
/** Minichefes usam o cérebro do inimigo de base. */
export const brainFor = (t: EnemyType): Brain => BRAINS[brainType(t)] ?? shambler;
