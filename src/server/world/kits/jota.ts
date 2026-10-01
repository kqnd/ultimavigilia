/**
 * Jota — vibecoder de capuz, glass cannon de dano à distância (v1.6).
 *
 * - Básico Prompt: linha de código que perfura 1 inimigo (ricocheteia com a bifurcação).
 * - Q Patch: feixe em linha (atravessa tudo) que corta e MARCA: marcados levam mais dano dele.
 * - E Rewind: volta à posição e à vida de 3 s atrás (a "sombra" azul no mapa mostra o destino).
 * - R Modo Batman: transformação de poucos segundos — menos frágil, mais móvel; básico vira
 *   batarangues em leque, Q vira Bomba de Medo (atordoa na entrada) e E vira Gancho.
 * - Passiva Contexto: cada acerto enche; cheio, "/compact" estoura numa nova e dá bônus de ataque.
 *
 * O estado vive em `Player.jota`; tudo aqui é aditivo (nenhum outro kit enxerga estes campos).
 */
import { JOTA } from '../../../shared/config/classes.js';
import { UPGRADE_CAPS } from '../../../shared/config/upgrades.js';
import { sec, SHOT_MUZZLE } from '../../../shared/constants.js';
import { circleFree, resolveCircle, sweepFree } from '../../../shared/collision.js';
import { dist } from '../../../shared/math.js';
import { addShield } from '../healing.js';
import { playerSay } from '../lines.js';
import type { Enemy, JotaState, Player, Zone } from '../types.js';
import type { World } from '../world.js';
import type { Kit } from './kit.js';
import { clampTarget, dash, firstActive, inActive, projectileAim } from './kit.js';

const J = JOTA;
const B = JOTA.bat;

export const newJotaState = (): JotaState => ({ ctx: 0, ctxIdle: 0, hotT: 0, batT: 0, batMax: 1, marks: new Map(), hist: [], ghost: null });

/** O Jota está no Modo Batman agora. */
export const isBat = (p: Player): boolean => p.cls === 'jota' && p.jota.batT > 0;

/** Bônus de dano SOMADO do Jota (Contexto, Compactar e marca do Patch); entra em `World.damageMul`. */
export function jotaDamageBonus(w: World, p: Player, e: Enemy): number {
  const s = p.jota;
  let b = s.ctx * J.context.damagePerPoint;
  if (s.hotT > 0) b += J.context.compact.buffDamage;
  const until = s.marks.get(e.id);
  if (until !== undefined && until > w.tick) b += J.patch.markBonus;
  return b;
}

/** Ganha Contexto (com a carta Janela de Contexto); cheio, estoura em Compactar. */
function addContext(w: World, p: Player, n: number): void {
  const s = p.jota;
  if (s.batT > 0 || n <= 0) return;
  s.ctx = Math.min(J.context.max, s.ctx + n * (1 + w.mod(p, 'j_context')));
  s.ctxIdle = 0;
  if (s.ctx >= J.context.max) compact(w, p);
}

/** /compact: nova em volta do Jota e bônus de dano e de velocidade de ataque. */
function compact(w: World, p: Player): void {
  const C = J.context.compact;
  const s = p.jota;
  s.ctx = 0;
  s.hotT = sec(C.buffSeconds);
  const mul = 1 + w.mod(p, 'j_compact');
  const radius = C.radius * mul;
  for (const e of w.enemiesInCircle(p.x, p.y, radius)) {
    w.hitEnemy(p, e, C.damage * mul, { poise: C.poise, kb: C.knockback, fromX: p.x, fromY: p.y, kind: 'aoe', noProc: true });
  }
  w.breakInCircle(p.x, p.y, radius, C.damage, p);
  w.emit({ k: 'fx', n: 'compact', x: p.x, y: p.y, a: 0, o: p.id, r: radius });
  w.emit({ k: 'sfx', n: 'compact', x: p.x, y: p.y });
  playerSay(w, p, 'compact');
}

/** Distância do ponto ao segmento (para o feixe do Patch). */
function segDist(px: number, py: number, x0: number, y0: number, x1: number, y1: number): number {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const l2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((px - x0) * dx + (py - y0) * dy) / l2));
  return Math.hypot(px - (x0 + dx * t), py - (y0 + dy * t));
}

/** Lentidão contínua de zona (mesmo formato do Selo Glacial): sem retorno decrescente nem suprema. */
function zoneSlow(e: Enemy, mul: number): void {
  const m = e.def.tier === 'boss' ? 1 - (1 - mul) * 0.5 : mul;
  e.cc.slow = Math.max(e.cc.slow, 3);
  e.cc.slowMul = Math.min(e.cc.slowMul === 0 ? 1 : e.cc.slowMul, m);
}

/** Transformação: vira o Batman (escudo, cura da lendária, recargas zeradas). */
function transform(w: World, p: Player): void {
  const s = p.jota;
  const dur = B.duration + (p.mods['j_main'] ? 4 : 0);
  s.batT = sec(dur);
  s.batMax = s.batT;
  s.ctx = 0;
  p.cd.q = 0;
  p.cd.e = 0;
  addShield(p, B.shield, B.shieldSeconds);
  if (p.mods['j_main']) w.healPlayer(p, p.maxHp * 0.35, 'perk');
  p.iframes = Math.max(p.iframes, 6);
  w.emit({ k: 'fx', n: 'batTransform', x: p.x, y: p.y, a: 0, o: p.id, r: 80 });
  w.emit({ k: 'sfx', n: 'batTransform', x: p.x, y: p.y });
}

function endBat(w: World, p: Player): void {
  p.cd.q = Math.max(p.cd.q, sec(B.endQ));
  p.cd.e = Math.max(p.cd.e, sec(B.endE));
  p.cdMax.q = Math.max(p.cdMax.q, p.cd.q);
  p.cdMax.e = Math.max(p.cdMax.e, p.cd.e);
  w.emit({ k: 'fx', n: 'batEnd', x: p.x, y: p.y, a: 0, o: p.id, r: 36 });
  w.emit({ k: 'sfx', n: 'batEnd', x: p.x, y: p.y });
}

/** Bomba de Medo caiu: abre a nuvem no ponto. */
function openFear(w: World, owner: Player, x: number, y: number): void {
  const F = B.fear;
  const pos = { x, y };
  if (!circleFree(w.map, pos.x, pos.y, 4)) resolveCircle(w.map, pos, 4);
  w.addZone({ kind: 'fear', x: pos.x, y: pos.y, r: F.radius, ttl: sec(F.duration), owner: owner.id, a: sec(F.tickInterval), b: F.tickDamage, hit: new Set() });
  w.emit({ k: 'fx', n: 'fearBurst', x: pos.x, y: pos.y, a: 0, o: owner.id, r: F.radius });
  w.emit({ k: 'sfx', n: 'fearBurst', x: pos.x, y: pos.y });
}

/** Rewind: teletransporta à amostra mais antiga, recupera a vida e estoura o ponto de partida. */
function rewind(w: World, p: Player): boolean {
  const R = J.rewind;
  const s = p.jota;
  const to = s.hist[0];
  if (!to || s.hist.length < 4) return false;
  const from = { x: p.x, y: p.y };
  const dest = { x: to.x, y: to.y };
  if (!circleFree(w.map, dest.x, dest.y, p.r)) resolveCircle(w.map, dest, p.r);
  const revert = (p.mods['j_revert'] ?? 0) > 0;
  const radius = R.burstRadius + (revert ? w.mod(p, 'j_revert') : 0);
  const dmg = R.burstDamage + (revert ? 30 : 0);
  for (const e of w.enemiesInCircle(from.x, from.y, radius)) {
    w.hitEnemy(p, e, dmg, { poise: R.burstPoise, kb: R.burstKnockback + (revert ? 80 : 0), fromX: from.x, fromY: from.y, kind: 'aoe', noProc: true });
  }
  w.breakInCircle(from.x, from.y, radius, dmg, p);
  w.emit({ k: 'fx', n: 'rewindOut', x: from.x, y: from.y, a: Math.atan2(dest.y - from.y, dest.x - from.x), o: p.id, r: radius });
  p.move.x = dest.x;
  p.move.y = dest.y;
  p.move.ft = 0;
  p.iframes = Math.max(p.iframes, R.iframes);
  // a vida volta ao que era (nunca reduz); a Ferida Profana ainda segura a cura
  if (p.woundT <= 0) p.hp = Math.min(p.maxHp, Math.max(p.hp, to.hp));
  p.buffs.burn = 0;
  p.buffs.chill = 0;
  s.hist = [{ x: dest.x, y: dest.y, hp: p.hp }];
  w.emit({ k: 'fx', n: 'rewindIn', x: dest.x, y: dest.y, a: Math.atan2(dest.y - from.y, dest.x - from.x), o: p.id, r: dist(from.x, from.y, dest.x, dest.y) });
  w.emit({ k: 'sfx', n: 'rewind', x: dest.x, y: dest.y });
  playerSay(w, p, 'rewind');
  return true;
}

/** Caiu: a transformação e o histórico do Rewind se desfazem. */
export function jotaDown(p: Player): void {
  const s = p.jota;
  s.batT = 0;
  s.hotT = 0;
  s.hist.length = 0;
  if (s.ghost) s.ghost.dead = true;
  s.ghost = null;
}

export const jotaKit: Kit = {
  start(w, p, slot) {
    const bat = isBat(p);
    switch (slot) {
      case 'basic': {
        const spec = bat ? B.batarang : J.prompt;
        if (!w.spendStamina(p, spec.stamina)) return 'st';
        const haste = p.jota.hotT > 0 ? J.context.compact.buffHaste : 0;
        w.startAction(p, 'basic1', spec, { moveMul: spec.moveMul, speedMul: 1 + haste, n: bat ? 1 : 0 });
        return null;
      }
      case 'q': {
        if (bat) {
          const F = B.fear;
          const t = clampTarget(p, F.maxRange);
          w.startAction(p, 'q', { windup: F.windup, active: 1, recovery: F.recovery }, { moveMul: F.moveMul, tx: t.x, ty: t.y, n: 1 });
          w.setCooldown(p, 'q', F.cooldown);
          return null;
        }
        const P = J.patch;
        w.startAction(p, 'q', { windup: P.windup, active: 1, recovery: P.recovery }, { moveMul: P.moveMul, n: 0 });
        w.setCooldown(p, 'q', P.cooldown - (p.mods['j_patch'] ?? 0) * 0.5);
        w.emit({ k: 'fx', n: 'patchCharge', x: p.x, y: p.y, a: p.aim, o: p.id, r: 0 });
        return null;
      }
      case 'e': {
        if (bat) {
          const G = B.grapple;
          if (!w.spendStamina(p, G.stamina)) return 'st';
          const dir = p.aim;
          const dest = sweepFree(w.map, p.x, p.y, p.x + Math.cos(dir) * G.distance, p.y + Math.sin(dir) * G.distance, p.r);
          const d = Math.max(12, dist(p.x, p.y, dest.x, dest.y));
          const a = w.startAction(p, 'e', { windup: 0, active: G.ticks, recovery: G.recovery }, { moveMul: 0, dir, n: 1 });
          a.cancelFrom = G.ticks + 2;
          dash(p, dir, d, G.ticks);
          p.iframes = Math.max(p.iframes, G.iframes);
          w.setCooldown(p, 'e', G.cooldown);
          w.emit({ k: 'fx', n: 'grappleDash', x: p.x, y: p.y, a: dir, o: p.id, r: d });
          w.emit({ k: 'sfx', n: 'grappleDash', x: p.x, y: p.y });
          return null;
        }
        const R = J.rewind;
        if (p.jota.hist.length < 4) return 'busy';
        if (!w.spendStamina(p, R.stamina)) return 'st';
        rewind(w, p);
        w.startAction(p, 'e', { windup: 0, active: 1, recovery: R.recovery }, { moveMul: 1, n: 0 });
        w.setCooldown(p, 'e', R.cooldown - w.mod(p, 'j_cache'));
        return null;
      }
      case 'r': {
        if (bat) return 'busy';
        const a = w.startAction(p, 'r', { windup: B.windup, active: 1, recovery: B.recovery }, { moveMul: 0 });
        a.cancelFrom = a.total;
        p.iframes = Math.max(p.iframes, B.windup + 1);
        w.emit({ k: 'fx', n: 'batStart', x: p.x, y: p.y, a: 0, o: p.id, r: B.windup });
        w.emit({ k: 'sfx', n: 'batStart', x: p.x, y: p.y });
        return null;
      }
    }
  },

  tickAction(w, p, a) {
    if (a.name === 'basic1' && firstActive(a)) {
      const shot = projectileAim(p);
      a.dir = shot.dir;
      const reach = 1 + Math.min(UPGRADE_CAPS.projectileRange, w.mod(p, 'g_reach'));
      const mul = 1 + w.mod(p, 'j_prompt');
      if (a.n === 1) {
        // Modo Batman: leque de batarangues
        const Bt = B.batarang;
        const bounce = (p.mods['j_main'] ?? 0) > 0 ? 1 : 0;
        for (let i = 0; i < Bt.count; i++) {
          const d = shot.dir + (i - (Bt.count - 1) / 2) * Bt.spread;
          w.spawnProjectile({
            kind: 'batarang', team: 'p', owner: p.id,
            x: p.x + Math.cos(d) * SHOT_MUZZLE, y: p.y + Math.sin(d) * SHOT_MUZZLE,
            vx: Math.cos(d) * Bt.speed, vy: Math.sin(d) * Bt.speed,
            r: Bt.radius, dmg: Bt.damage * mul, range: Bt.range * reach, pierce: 0, poise: Bt.poise, kb: Bt.knockback, ricochet: bounce,
          });
        }
        w.emit({ k: 'sfx', n: 'batarang', x: p.x, y: p.y });
      } else {
        const Pr = J.prompt;
        w.spawnProjectile({
          kind: 'prompt', team: 'p', owner: p.id, x: shot.x, y: shot.y,
          vx: Math.cos(shot.dir) * Pr.speed, vy: Math.sin(shot.dir) * Pr.speed,
          r: Pr.radius, dmg: Pr.damage * mul, range: Pr.range * reach, pierce: Pr.pierce, pierceFalloff: Pr.pierceFalloff,
          poise: Pr.poise, kb: Pr.knockback, ricochet: (p.mods['j_rebound'] ?? 0) > 0 ? 1 : 0,
        });
        w.emit({ k: 'sfx', n: 'prompt', x: p.x, y: p.y });
      }
    } else if (a.name === 'q' && firstActive(a)) {
      if (a.n === 1) {
        // Bomba de Medo: sai reta e explode no ponto mirado (ou na primeira parede)
        const F = B.fear;
        const d = Math.max(10, dist(p.x, p.y, a.tx, a.ty));
        const dir = Math.atan2(a.ty - p.y, a.tx - p.x);
        a.dir = dir;
        w.spawnProjectile({ kind: 'fearBomb', team: 'p', owner: p.id, x: p.x, y: p.y, vx: Math.cos(dir) * F.speed, vy: Math.sin(dir) * F.speed, r: 4, dmg: 0, range: d, poise: 0, kb: 0 });
        w.emit({ k: 'sfx', n: 'batarang', x: p.x, y: p.y });
        return;
      }
      // Patch: feixe do muzzle até o alcance (ou a primeira parede), atravessa todos
      const P = J.patch;
      const shot = projectileAim(p);
      a.dir = shot.dir;
      const len = P.length + w.mod(p, 'j_patch');
      const end = sweepFree(w.map, shot.x, shot.y, shot.x + Math.cos(shot.dir) * len, shot.y + Math.sin(shot.dir) * len, 2);
      let hits = 0;
      for (const e of w.enemiesInCircle((shot.x + end.x) / 2, (shot.y + end.y) / 2, dist(shot.x, shot.y, end.x, end.y) / 2 + 30)) {
        if (segDist(e.x, e.y, shot.x, shot.y, end.x, end.y) > P.width / 2 + e.r) continue;
        hits++;
        w.hitEnemy(p, e, P.damage, { poise: P.poise, kb: P.knockback, fromX: shot.x, fromY: shot.y, kind: 'proj', noProc: true });
        p.jota.marks.set(e.id, w.tick + sec(P.markSeconds));
        w.emit({ k: 'fx', n: 'patchHit', x: e.x, y: e.y - 6, a: shot.dir, o: p.id, r: 0 });
      }
      const L = dist(shot.x, shot.y, end.x, end.y);
      for (let k = 12; k <= L; k += 24) w.breakInCircle(shot.x + Math.cos(shot.dir) * k, shot.y + Math.sin(shot.dir) * k, 8, P.damage, p);
      addContext(w, p, Math.min(P.tokensCap, hits * P.tokensPerHit));
      w.emit({ k: 'fx', n: 'patchBeam', x: shot.x, y: shot.y - 10, a: shot.dir, o: p.id, r: L });
      w.emit({ k: 'sfx', n: 'patch', x: p.x, y: p.y });
    } else if (a.name === 'e' && a.n === 1 && inActive(a)) {
      // Gancho: quem a capa toca leva dano e é empurrado para o lado
      const G = B.grapple;
      if (a.t % 2 === 0) w.emit({ k: 'fx', n: 'grappleTrail', x: p.x, y: p.y, a: a.dir, o: p.id, r: 0 });
      for (const e of w.enemiesInCircle(p.x, p.y, G.width)) {
        if (a.hit.has(e.id)) continue;
        a.hit.add(e.id);
        w.hitEnemy(p, e, G.damage, { poise: G.poise, kb: G.knockback, fromX: p.x - Math.cos(a.dir) * 10, fromY: p.y - Math.sin(a.dir) * 10, kind: 'aoe', noProc: true });
        w.emit({ k: 'fx', n: 'grappleHit', x: e.x, y: e.y - 6, a: a.dir, o: p.id, r: 0 });
      }
    } else if (a.name === 'r' && firstActive(a)) {
      transform(w, p);
    }
  },

  tickPassive(w, p) {
    const s = p.jota;
    if (p.status !== 0) {
      s.batT = 0;
      s.hotT = 0;
      s.hist.length = 0;
      if (s.ghost) s.ghost.dead = true;
      s.ghost = null;
      return;
    }
    if (s.hotT > 0) s.hotT--;
    if (s.batT > 0 && --s.batT === 0) endBat(w, p);
    // Contexto escorre quando ele para de acertar (parado também em Batman: fica congelado)
    if (s.batT <= 0 && s.ctx > 0 && ++s.ctxIdle > sec(J.context.idleSeconds)) s.ctx = Math.max(0, s.ctx - J.context.decayPerSecond / 30);
    if (w.tick % 30 === 0) for (const [id, until] of s.marks) if (until <= w.tick) s.marks.delete(id);
    // histórico do Rewind e sombra azul no destino
    if (w.tick % J.rewind.sampleEvery === 0) {
      s.hist.push({ x: p.x, y: p.y, hp: p.hp });
      const max = Math.round((J.rewind.lookbackSeconds * 30) / J.rewind.sampleEvery);
      if (s.hist.length > max) s.hist.shift();
    }
    const to = s.hist[0];
    if (!s.ghost || s.ghost.dead) s.ghost = w.addZone({ kind: 'rewind', x: p.x, y: p.y, r: 9, ttl: 90, owner: p.id });
    const g: Zone = s.ghost;
    g.ttl = 90;
    if (to) {
      g.x = to.x;
      g.y = to.y;
    }
    // 0 = oculta (histórico curto/Batman), 1 = pronta, 2 = em recarga
    g.extra = s.hist.length < 10 || s.batT > 0 ? 0 : p.cd.e > 0 ? 2 : 1;
  },

  zoneTick(w, z, owner) {
    if (z.kind !== 'fear') return;
    const F = B.fear;
    z.hit ??= new Set();
    for (const e of w.enemiesInCircle(z.x, z.y, z.r)) {
      if (e.def.stationary) continue;
      if (!z.hit.has(e.id)) {
        // pavor na entrada: interrompe e atordoa (chefes só desaceleram)
        z.hit.add(e.id);
        w.interrupt(e);
        if (e.def.tier !== 'boss') w.applyCC(e, 'stun', e.def.tier === 'common' ? F.stunCommon : F.stunElite, 1, owner);
        w.hitEnemy(owner, e, 1, { poise: F.poise, kb: 0, fromX: z.x, fromY: z.y, kind: 'aoe', noUlt: true, noProc: true });
      }
      zoneSlow(e, F.slow);
      if (z.age % z.a === 0) w.hitEnemy(owner, e, z.b, { poise: 2, kb: 0, fromX: z.x, fromY: z.y, kind: 'aoe', noProc: true });
    }
  },

  zoneExpire(w, z) {
    if (z.kind === 'fear') w.emit({ k: 'fx', n: 'fearEnd', x: z.x, y: z.y, a: 0, o: z.owner, r: z.r });
  },

  onDealt(w, p, _e, _dmg, o) {
    if (o.noProc || o.kind !== 'proj') return;
    addContext(w, p, J.prompt.tokens);
  },

  projectileHit(_w, pr) {
    return pr.kind === 'fearBomb'; // a bomba passa por cima da horda até o ponto mirado
  },

  projectileEnd(w, pr) {
    if (pr.kind !== 'fearBomb') return false;
    const owner = w.players.get(pr.owner);
    if (owner) openFear(w, owner, pr.x, pr.y);
    return true;
  },
};
