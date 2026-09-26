/**
 * Lapanha — artilharia de sacrifício. Melancias em arco com centro e borda, casca de escorregão,
 * custo de vida voluntário (Coração Maduro) e a Safra Abençoada (regeneração temporária).
 * Tudo decidido no servidor; o cliente só desenha o arco (altura visual) e os indicadores.
 */
import { LAPANHA, ripeCostFrac, ripePower } from '../../../shared/config/classes.js';
import { UPGRADE_CAPS } from '../../../shared/config/upgrades.js';
import { sec, TILE } from '../../../shared/constants.js';
import { circleFree, resolveCircle, sweepFree } from '../../../shared/collision.js';
import { dist, dist2 } from '../../../shared/math.js';
import { BTN } from '../../../shared/movement.js';
import type { ProjectileKind } from '../../../shared/protocol.js';
import { addShield, healPlayer, sacrificeLife } from '../healing.js';
import { playerSay } from '../lines.js';
import type { Action, Enemy, Player, Zone } from '../types.js';
import type { World } from '../world.js';
import type { Kit } from './kit.js';
import { clampTarget, firstActive, projectileAim } from './kit.js';

const L = LAPANHA;
const MELON_KINDS: ReadonlySet<ProjectileKind> = new Set<ProjectileKind>(['melon', 'melonWide', 'melonDense', 'bigMelon']);

/** Fração de carga (0–1) de uma ação de carga. */
export const chargeFrac = (a: Action): number => Math.max(0, Math.min(1, a.t / L.ripe.chargeMaxTicks));

/** Bônus de alcance dos arremessos (cartas somadas, com teto). */
const rangeMul = (w: World, p: Player): number => 1 + Math.min(UPGRADE_CAPS.projectileRange, w.mod(p, 'g_reach') + w.mod(p, 'l_arm'));

/** Custo de vida (multiplicador) de habilidades: Safra reduz, Economia de Polpa reduz o Q. */
const costMul = (p: Player): number => (p.buffs.harvest > 0 ? L.harvest.costMul : 1);

/** Polpa (= carga da suprema). Suspensa durante a Safra (addUlt já bloqueia). */
function addPulp(w: World, p: Player, amount: number): void {
  if (amount > 0) w.addUlt(p, amount);
}

// ------------------------------------------------------------------ explosões

/** Sementes Saltitantes: inimigos já atingidos por sementes de cada explosão. */
const seedHits = new Map<number, Set<number>>();

interface Blast {
  x: number;
  y: number;
  radius: number;
  centerRadius: number;
  center: number;
  edge: number;
  poise: number;
  edgePoise: number;
  kb: number;
  /** Carga 0–1 (Melancia Madura) ou -1 (básico). */
  charge: number;
  heavy: boolean;
  /** Inimigo atingido diretamente (sempre recebe o dano central). */
  direct: Enemy | null;
}

/** Explosão de polpa: dano central/borda, Polpa por acerto válido, cura na Safra e efeitos de cartas. */
function explode(w: World, owner: Player | null, b: Blast): Enemy[] {
  const hits = w.enemiesInCircle(b.x, b.y, b.radius);
  let pulp = 0;
  const precise = owner && b.heavy && b.charge >= 1 && (owner.mods['l_precise'] ?? 0) > 0 ? L.cards.precise : null;
  for (const e of hits) {
    const d = dist(e.x, e.y, b.x, b.y) - e.r * 0.5;
    const isCenter = e === b.direct || d <= b.centerRadius;
    let dmg = isCenter ? b.center * (1 + (precise?.center ?? 0)) : b.edge * (1 + (precise?.edge ?? 0));
    if (b.heavy && (e.def.tier === 'boss' || e.def.miniboss)) {
      // chefes: só metade do bônus da carga e teto por lançamento
      const base = isCenter ? L.ripe.minDamage : L.ripe.minDamage * L.ripe.edgeMul;
      dmg = Math.min(L.ripe.bossDamageCap, base + Math.max(0, dmg - base) * L.ripe.bossBonusMul);
    }
    const valid = w.hitEnemy(owner, e, dmg, { poise: isCenter ? b.poise : b.edgePoise, kb: b.kb * (isCenter ? 1 : 0.5), fromX: b.x, fromY: b.y, kind: 'aoe' });
    if (!owner || valid <= 0) continue;
    // Polpa: centro rende mais; elites/chefes ×1,5; nada de objetos, objetivos ou cadáveres
    const big = e.def.tier !== 'common' ? L.pulp.bigMul : 1;
    pulp += (isCenter ? L.pulp.center * (1 + w.mod(owner, 'l_pulp')) : L.pulp.edge) * big;
    if (isCenter && (owner.mods['l_frozen'] ?? 0) > 0) w.applyCC(e, 'slow', L.cards.frozenSeconds, L.cards.frozenSlow, null);
    // Safra: acertos no centro curam um pouco (teto por segundo próprio)
    if (isCenter && owner.buffs.harvest > 0 && owner.harvestHitBudget > 0) {
      const amt = Math.min(L.harvest.centerHeal, owner.harvestHitBudget);
      owner.harvestHitBudget -= amt;
      healPlayer(w, owner, amt, 'harvestHit');
    }
  }
  if (owner) addPulp(w, owner, Math.min(L.pulp.perActionCap, pulp));
  w.breakInCircle(b.x, b.y, b.radius, b.center, owner);
  w.emit({ k: 'fx', n: b.heavy ? 'melonBoomBig' : 'melonBoom', x: b.x, y: b.y, a: b.charge, o: owner?.id ?? 0, r: b.radius });
  w.emit({ k: 'sfx', n: b.heavy ? 'melonBurstBig' : 'melonBurst', x: b.x, y: b.y });
  // Sementes Saltitantes: três sementes, no máximo uma por inimigo, sem Polpa
  if (owner && (owner.mods['l_seeds'] ?? 0) > 0) {
    const S = L.cards.seeds;
    const id = w.newId();
    seedHits.set(id, new Set());
    if (seedHits.size > 64) seedHits.delete(seedHits.keys().next().value as number);
    for (let i = 0; i < S.count; i++) {
      const a = (i / S.count) * Math.PI * 2 + (w.tick % 7) * 0.4;
      w.spawnProjectile({ kind: 'seed', team: 'p', owner: owner.id, x: b.x + Math.cos(a) * 6, y: b.y + Math.sin(a) * 6, vx: Math.cos(a) * S.speed, vy: Math.sin(a) * S.speed, r: 3, dmg: S.damage, range: S.range, poise: 2, kb: 10, b: id });
    }
  }
  return hits;
}

// ------------------------------------------------------------------ casca

/** Quem escorregou e em que casca (crédito dos esbarrões). */
const slideOwner = new WeakMap<Enemy, { pid: number; hit: Set<number> }>();

/** Esbarrões durante o escorregão: derruba de leve quem estiver no caminho (uma vez cada). */
export function slideBump(w: World, e: Enemy): void {
  const info = slideOwner.get(e);
  if (!info) return;
  const owner = w.players.get(info.pid) ?? null;
  for (const o of w.enemiesInCircle(e.x, e.y, e.r + 2)) {
    if (o === e || info.hit.has(o.id) || o.def.stationary || o.def.objective) continue;
    info.hit.add(o.id);
    w.hitEnemy(owner, o, L.peel.bumpDamage, { poise: L.peel.bumpPoise, kb: 70, fromX: e.x, fromY: e.y, kind: 'aoe', noUlt: true });
  }
}

function ownPeels(w: World, p: Player, includeSecondary = false): Zone[] {
  return w.zones.filter((z) => z.kind === 'peel' && z.owner === p.id && !z.dead && (includeSecondary || z.b === 0));
}

function placePeel(w: World, p: Player, x: number, y: number, secondary: boolean): void {
  const P = L.peel;
  if (!secondary) {
    const mine = ownPeels(w, p);
    if (mine.length >= P.maxActive) (mine[0] as Zone).dead = true; // substitui a mais antiga
  }
  const pos = { x, y };
  if (!circleFree(w.map, pos.x, pos.y, 4)) resolveCircle(w.map, pos, 4);
  const duration = secondary ? P.cascade.duration : P.duration + w.mod(p, 'l_peel');
  w.addZone({ kind: 'peel', x: pos.x, y: pos.y, r: secondary ? P.cascade.triggerRadius : P.triggerRadius, ttl: sec(duration), owner: p.id, a: sec(P.armSeconds), b: secondary ? 1 : 0 });
}

/** Alguém pisou na casca: escorrega na direção em que andava (chefes só ficam lentos). */
function slip(w: World, z: Zone, e: Enemy, owner: Player | null): void {
  const P = L.peel;
  z.dead = true;
  const boss = e.def.tier === 'boss';
  const mini = !!e.def.miniboss;
  if (boss || mini) {
    w.applyCC(e, 'slow', boss ? P.bossSlowSeconds : P.minibossSlowSeconds, boss ? P.bossSlow : P.minibossSlow, owner);
    w.hitEnemy(owner, e, 1, { poise: boss ? P.bossPoise : P.minibossPoise, kb: 0, fromX: z.x, fromY: z.y, kind: 'aoe', noUlt: true, noProc: true });
  } else {
    const elite = e.def.tier === 'elite';
    const ticks = Math.round(P.slideTicks * (elite ? P.eliteSlideMul : 1));
    const dir = e.facing;
    e.slideT = ticks;
    e.slideVx = Math.cos(dir) * P.slideSpeed;
    e.slideVy = Math.sin(dir) * P.slideSpeed;
    slideOwner.set(e, { pid: owner?.id ?? 0, hit: new Set() });
    w.stagger(e, ticks / 30 + 0.1);
    if (elite) w.applyCC(e, 'slow', P.eliteSlowSeconds, P.eliteSlow, owner);
    if (owner && (owner.mods['l_wet'] ?? 0) > 0) {
      const C = L.cards.wetFloor;
      const puddles = w.zones.filter((q) => q.kind === 'wetFloor' && q.owner === owner.id && !q.dead);
      if (puddles.length >= C.maxActive) (puddles[0] as Zone).dead = true;
      w.addZone({ kind: 'wetFloor', x: z.x, y: z.y, r: C.radius, ttl: sec(C.seconds), owner: owner.id });
    }
    if (owner) playerSay(w, owner, 'slip');
  }
  w.emit({ k: 'fx', n: 'slip', x: e.x, y: e.y, a: e.facing, o: e.id, r: boss || mini ? 0 : 1 });
  w.emit({ k: 'sfx', n: 'slip', x: e.x, y: e.y });
}

// ------------------------------------------------------------------ kit

export const lapanhaKit: Kit = {
  start(w, p, slot) {
    switch (slot) {
      case 'basic': {
        const m = L.melon;
        if (!w.spendStamina(p, m.stamina)) return 'st';
        const speed = 1 + (p.buffs.harvest > 0 ? L.harvest.attackSpeed : 0);
        w.startAction(p, 'basic1', m, { moveMul: m.moveMul, speedMul: speed });
        return null;
      }
      case 'q': {
        const a = w.startAction(p, 'charge', { windup: 0, active: L.ripe.chargeMaxTicks + L.ripe.autoThrowTicks, recovery: 0 }, { moveMul: L.ripe.moveMul });
        a.cancelFrom = 0; // pode esquivar durante a carga (interrompe)
        p.charge = 0;
        w.emit({ k: 'sfx', n: 'melonCharge', x: p.x, y: p.y });
        return null;
      }
      case 'e': {
        const P = L.peel;
        w.startAction(p, 'peel', { windup: P.windup, active: 1, recovery: P.recovery }, { moveMul: 0.6 });
        w.setCooldown(p, 'e', P.cooldown);
        return null;
      }
      case 'r': {
        const H = L.harvest;
        w.startAction(p, 'eat', { windup: H.windup, active: 1, recovery: H.recovery }, { moveMul: H.moveMul });
        w.emit({ k: 'fx', n: 'eatStart', x: p.x, y: p.y, a: 0, o: p.id, r: 0 });
        w.emit({ k: 'sfx', n: 'harvestStart', x: p.x, y: p.y });
        return null;
      }
    }
  },

  /** E durante a recarga: esmaga a casca mais próxima da mira (custa vida). */
  startDuringCooldown(w, p, slot) {
    if (slot !== 'e' || !w.canAct(p)) return false;
    const peels = ownPeels(w, p);
    if (!peels.length) return false;
    let best = peels[0] as Zone;
    for (const z of peels) if (dist2(z.x, z.y, p.aimX, p.aimY) < dist2(best.x, best.y, p.aimX, p.aimY)) best = z;
    w.startAction(p, 'crush', { windup: 3, active: 1, recovery: 6 }, { moveMul: 0.7, tx: best.x, ty: best.y, n: best.id });
    return true;
  },

  tickAction(w, p, a) {
    if (a.name === 'basic1' && firstActive(a)) {
      const m = L.melon;
      let kind: ProjectileKind = 'melon';
      let radius = m.blastRadius;
      let center = m.centerDamage * (1 + w.mod(p, 'l_seed'));
      let edge: number = m.edgeDamage;
      if ((p.mods['l_fair'] ?? 0) > 0) {
        // Feira da Meia-Noite: alterna melancia larga e densa
        const F = L.cards.fair;
        p.fairToggle = !p.fairToggle;
        if (p.fairToggle) {
          kind = 'melonWide';
          radius *= F.wideRadius;
          center *= F.wideDamage;
          edge *= F.wideDamage;
        } else {
          kind = 'melonDense';
          radius *= F.denseRadius;
          center *= F.denseCenter;
        }
      }
      const shot = projectileAim(p);
      a.dir = shot.dir;
      const range = m.range * rangeMul(w, p);
      w.spawnProjectile({
        kind, team: 'p', owner: p.id, x: shot.x, y: shot.y,
        vx: Math.cos(shot.dir) * m.speed, vy: Math.sin(shot.dir) * m.speed,
        r: m.radius, dmg: center, range, lob: range, splash: radius, poise: m.poise, kb: m.knockback, a: edge,
      });
      w.emit({ k: 'sfx', n: 'melonThrow', x: p.x, y: p.y });
    } else if (a.name === 'charge') {
      const R = L.ripe;
      p.charge = a.t;
      if (a.t === R.chargeMaxTicks) {
        w.emit({ k: 'fx', n: 'chargeMax', x: p.x, y: p.y - 20, a: 0, o: p.id, r: 0 });
        w.emit({ k: 'sfx', n: 'melonChargeMax', x: p.x, y: p.y });
      }
      const held = (p.held & BTN.q) !== 0;
      const release = (!held && a.t >= R.chargeMinTicks) || a.t >= R.chargeMaxTicks + R.autoThrowTicks;
      if (release) {
        const frac = chargeFrac(a);
        p.charge = -1;
        const t = w.startAction(p, 'throw', { windup: R.throwWindup, active: 1, recovery: R.throwRecovery }, { moveMul: 0.4, n: Math.round(frac * 1000) });
        t.cancelFrom = t.wu + 1;
      }
    } else if (a.name === 'throw' && firstActive(a)) {
      throwRipe(w, p, a.n / 1000);
    } else if (a.name === 'peel' && firstActive(a)) {
      const P = L.peel;
      const t = clampTarget(p, P.throwRange);
      const land = sweepFree(w.map, p.x, p.y, t.x, t.y, 4);
      placePeel(w, p, land.x, land.y, false);
      w.emit({ k: 'fx', n: 'peelThrow', x: land.x, y: land.y, a: Math.atan2(land.y - p.y, land.x - p.x), o: p.id, r: dist(p.x, p.y, land.x, land.y) });
      w.emit({ k: 'sfx', n: 'peelPlace', x: land.x, y: land.y });
    } else if (a.name === 'crush' && firstActive(a)) {
      crushPeel(w, p, a.n);
    } else if (a.name === 'eat' && firstActive(a)) {
      const H = L.harvest;
      p.buffs.harvest = sec(H.duration);
      const frac = p.hp / p.maxHp;
      p.harvestRate = Math.min(H.maxRegen, H.baseRegen + H.lowHpBonus * (1 - frac));
      p.harvestFreeQ = (p.mods['l_endless'] ?? 0) > 0;
      p.lastPieceOn = false;
      w.emit({ k: 'fx', n: 'harvest', x: p.x, y: p.y, a: p.harvestRate, o: p.id, r: 0 });
      playerSay(w, p, 'ult', true);
    }
  },

  tickPassive(w, p) {
    // carga interrompida (esquiva, atordoamento, golpe pesado, queda): custo parcial só depois da carga mínima
    if (p.charge >= 0 && p.action?.name !== 'charge') {
      const R = L.ripe;
      if (p.charge >= R.chargeMinTicks && p.status === 0) {
        const f = Math.min(1, p.charge / R.chargeMaxTicks);
        sacrificeLife(w, p, p.maxHp * ripeCostFrac(f) * costMul(p) * R.cancelCostFrac);
        w.setCooldown(p, 'q', R.interruptedCooldown);
      }
      p.charge = -1;
      w.emit({ k: 'fx', n: 'chargeCancel', x: p.x, y: p.y - 18, a: 0, o: p.id, r: 0 });
    }
    // Safra Abençoada: regeneração ao longo do tempo (Ferida reduz normalmente)
    if (p.buffs.harvest > 0 && p.status === 0) {
      const H = L.harvest;
      if (p.buffs.harvest % H.tickEvery === 0) {
        const frac = p.hp / p.maxHp;
        if ((p.mods['l_last'] ?? 0) > 0) {
          if (frac < H.lastPiece.below) p.lastPieceOn = true;
          else if (frac > H.lastPiece.until) p.lastPieceOn = false;
        }
        const rate = p.harvestRate + (p.lastPieceOn ? w.mod(p, 'l_last') : 0);
        healPlayer(w, p, (p.maxHp * rate * H.tickEvery) / 30, 'harvest');
      }
      if (p.buffs.harvest === 1) {
        w.emit({ k: 'fx', n: 'harvestEnd', x: p.x, y: p.y, a: 0, o: p.id, r: 0 });
        w.emit({ k: 'sfx', n: 'harvestEnd', x: p.x, y: p.y });
      }
    }
  },

  /** Melancias estouram no primeiro inimigo (uma única colisão); sementes acertam uma vez cada. */
  projectileHit(w, pr, e) {
    const owner = w.players.get(pr.owner) ?? null;
    if (pr.kind === 'bigMelon') return true; // voa por cima da horda até o ponto mirado
    if (pr.kind === 'seed') {
      const set = seedHits.get(pr.b);
      if (set?.has(e.id)) return true;
      set?.add(e.id);
      w.hitEnemy(owner, e, pr.dmg, { poise: pr.poise, kb: pr.kb, fromX: pr.x, fromY: pr.y, kind: 'proj', noUlt: true, noProc: true });
      pr.dead = true;
      return true;
    }
    if (!MELON_KINDS.has(pr.kind)) return false;
    pr.dead = true;
    explode(w, owner, {
      x: pr.x, y: pr.y, radius: pr.splash, centerRadius: L.melon.centerRadius, center: pr.dmg, edge: pr.a,
      poise: pr.poise, edgePoise: L.melon.edgePoise, kb: pr.kb, charge: -1, heavy: false, direct: e,
    });
    return true;
  },

  /** Fim do voo (alcance, ponto mirado ou parede): estoura onde parou. */
  projectileEnd(w, pr) {
    if (!MELON_KINDS.has(pr.kind)) return false;
    const owner = w.players.get(pr.owner) ?? null;
    // na parede, estoura um pouco antes (do lado de quem arremessou)
    const sp = Math.hypot(pr.vx, pr.vy) || 1;
    let x = pr.x;
    let y = pr.y;
    if (!circleFree(w.map, x, y, 2)) {
      x -= (pr.vx / sp) * TILE * 0.4;
      y -= (pr.vy / sp) * TILE * 0.4;
    }
    if (pr.kind === 'bigMelon') {
      const charge = pr.b / 1000;
      const hits = explode(w, owner, {
        x, y, radius: pr.splash, centerRadius: L.ripe.centerRadius, center: pr.dmg, edge: pr.dmg * L.ripe.edgeMul,
        poise: pr.poise, edgePoise: pr.poise * 0.5, kb: pr.kb, charge, heavy: true, direct: null,
      });
      // Coração da Melancia: 4+ inimigos → escudo pequeno (recarga interna; não escala)
      if (owner && (owner.mods['l_heart'] ?? 0) > 0 && owner.heartCdT <= 0 && hits.filter((e) => !e.def.objective).length >= L.cards.heartMin) {
        addShield(owner, L.cards.heartShield, L.cards.heartSeconds);
        owner.heartCdT = sec(L.cards.heartCooldown);
        w.emit({ k: 'fx', n: 'shieldUp', x: owner.x, y: owner.y - 12, a: 0, o: owner.id, r: 0 });
      }
    } else {
      explode(w, owner, {
        x, y, radius: pr.splash, centerRadius: L.melon.centerRadius, center: pr.dmg, edge: pr.a,
        poise: pr.poise, edgePoise: L.melon.edgePoise, kb: pr.kb, charge: -1, heavy: false, direct: null,
      });
    }
    return true;
  },

  zoneTick(w, z, owner) {
    if (z.kind === 'peel') {
      if (z.age < z.a) return;
      z.extra = 1; // pronta (o cliente mostra o brilho)
      for (const e of w.enemiesInCircle(z.x, z.y, z.r)) {
        if (e.state === 'air' || e.state === 'dead' || e.def.stationary || e.def.objective || e.slideT > 0) continue;
        slip(w, z, e, owner);
        break;
      }
    } else if (z.kind === 'wetFloor') {
      for (const e of w.enemiesInCircle(z.x, z.y, z.r)) {
        if (e.def.stationary || e.def.objective) continue;
        w.applyCC(e, 'slow', 0.3, L.cards.wetFloor.slow, null);
      }
    }
  },
};

/** Lança a Melancia Madura: paga a vida (nunca abaixo de 1) e ajusta a força ao que foi pago. */
function throwRipe(w: World, p: Player, frac: number): void {
  const R = L.ripe;
  const econ = (p.mods['l_econ'] ?? 0) > 0;
  const mul = costMul(p) * (econ ? 1 - w.mod(p, 'l_econ') : 1);
  const free = frac >= 1 && p.buffs.harvest > 0 && p.harvestFreeQ;
  const nominal = p.maxHp * ripeCostFrac(frac) * mul;
  let paid = 0;
  let f = frac;
  let scale = 1;
  if (free) {
    p.harvestFreeQ = false;
    w.emit({ k: 'fx', n: 'freeMelon', x: p.x, y: p.y - 22, a: 0, o: p.id, r: 0 });
  } else {
    paid = sacrificeLife(w, p, nominal);
    if (paid < nominal - 0.01) {
      // vida insuficiente: potência proporcional ao que foi pago de verdade
      const minHp = p.maxHp * R.minCost * mul;
      if (paid >= minHp) f = Math.max(0, Math.min(frac, (paid / (p.maxHp * mul) - R.minCost) / (R.maxCost - R.minCost)));
      else {
        f = 0;
        scale = 0.5 + 0.5 * (minHp > 0 ? paid / minHp : 0);
      }
    }
    addPulp(w, p, Math.min(L.pulp.sacrificeCapPerAction, paid * L.pulp.perHpSacrificed));
  }
  const pw = ripePower(f);
  const bonus = econ ? 1 - 0.08 : 1;
  const dmg = (R.minDamage + (R.maxDamage - R.minDamage) * pw * bonus) * scale;
  const radius = R.minRadius + (R.maxRadius - R.minRadius) * pw;
  const t = clampTarget(p, R.maxRange * rangeMul(w, p));
  const land = sweepFree(w.map, p.x, p.y, t.x, t.y, 3);
  const d = Math.max(8, dist(p.x, p.y, land.x, land.y));
  const dir = Math.atan2(land.y - p.y, land.x - p.x);
  w.spawnProjectile({
    kind: 'bigMelon', team: 'p', owner: p.id, x: p.x, y: p.y,
    vx: Math.cos(dir) * R.speed, vy: Math.sin(dir) * R.speed, r: 5,
    dmg, range: d, lob: d, splash: radius, poise: R.minPoise + (R.maxPoise - R.minPoise) * pw,
    kb: R.minKnockback + (R.maxKnockback - R.minKnockback) * pw, b: Math.round(f * 1000), tx: land.x, ty: land.y,
  });
  w.setCooldown(p, 'q', R.cooldown);
  w.emit({ k: 'fx', n: 'ripeThrow', x: p.x, y: p.y, a: f, o: p.id, r: radius });
  w.emit({ k: 'sfx', n: 'melonHeavyThrow', x: p.x, y: p.y });
  if (frac >= 1) playerSay(w, p, 'fullQ');
}

/** Esmaga a casca à distância: pequeno dano em área, sementes e lentidão (custa vida). */
function crushPeel(w: World, p: Player, zoneId: number): void {
  const C = L.peel.crush;
  const z = w.zones.find((q) => q.id === zoneId && !q.dead);
  if (!z) return;
  const nominal = p.maxHp * C.costFrac * costMul(p);
  const paid = sacrificeLife(w, p, nominal);
  const scale = nominal > 0 ? 0.5 + 0.5 * (paid / nominal) : 1;
  z.dead = true;
  let pulp = 0;
  for (const e of w.enemiesInCircle(z.x, z.y, C.radius)) {
    const valid = w.hitEnemy(p, e, C.damage * scale, { poise: C.poise, kb: 40, fromX: z.x, fromY: z.y, kind: 'aoe' });
    if (!e.def.stationary) w.applyCC(e, 'slow', C.slowSeconds, C.slow, null);
    if (valid > 0) pulp += L.pulp.edge * (e.def.tier !== 'common' ? L.pulp.bigMul : 1);
  }
  addPulp(w, p, Math.min(L.pulp.perActionCap, pulp + Math.min(L.pulp.sacrificeCapPerAction, paid * L.pulp.perHpSacrificed)));
  w.breakInCircle(z.x, z.y, C.radius, C.damage, p);
  if ((p.mods['l_cascade'] ?? 0) > 0) placePeel(w, p, z.x, z.y, true);
  w.emit({ k: 'fx', n: 'peelBurst', x: z.x, y: z.y, a: 0, o: p.id, r: C.radius });
  w.emit({ k: 'sfx', n: 'peelBurst', x: z.x, y: z.y });
}

