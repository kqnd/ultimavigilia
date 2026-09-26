/**
 * v1.2: inimigos anti-kite (Acólito Sombrio, Caçador de Névoa, Portador do Ossário), alvo
 * inteligente de chefes, Vampiro corpo a corpo com dano em área, limite da suprema do
 * Necromante e a convenção única de mira dos projéteis. Tudo verificado no servidor.
 */
import { describe, expect, it } from 'vitest';
import { CLASS_RANGE, type ClassId, NECRO, VAMPIRE } from '../src/shared/config/classes.js';
import { ATK, BOSS_AI, SPECIAL_CAPS } from '../src/shared/config/enemies.js';
import { WAVES } from '../src/shared/config/waves.js';
import { circleFree } from '../src/shared/collision.js';
import { sec, SHOT_HEIGHT } from '../src/shared/constants.js';
import { BTN, type InputFrame } from '../src/shared/movement.js';
import { projectileAim } from '../src/server/world/kits/kit.js';
import { spawnMinion } from '../src/server/world/minions.js';
import type { Enemy, Player } from '../src/server/world/types.js';
import { World } from '../src/server/world/world.js';

type InputFn = (p: Player, w: World) => Partial<InputFrame> | null;

function mkWorld(classes: ClassId[]): World {
  const w = new World({ seed: 11, solo: false });
  classes.forEach((c, i) => w.addPlayer(i + 1, `P${i + 1}`, c));
  w.startMatch();
  w.phaseTimer = 0;
  w.director.reset();
  return w;
}
const seqs = new WeakMap<Player, number>();
function run(w: World, n: number, fn: InputFn | null = null): void {
  for (let i = 0; i < n; i++) {
    for (const p of w.players.values()) {
      const s = (seqs.get(p) ?? p.ack) + 1;
      seqs.set(p, s);
      w.pushInputs(p.id, [{ seq: s, mx: 0, my: 0, ax: p.x + 30, ay: p.y, held: 0, pressed: 0, ...(fn?.(p, w) ?? {}) }]);
    }
    w.step();
  }
}
function spawn(w: World, type: Parameters<World['spawnEnemy']>[0], x: number, y: number, frozen = true): Enemy {
  const e = w.spawnEnemy(type, x, y, w.players.size);
  e.state = 'move';
  if (frozen) e.def = { ...e.def, speed: 0 };
  return e;
}
/** Ponto livre perto do jogador numa direção. */
function freeNear(w: World, p: Player, dx: number, dy: number): { x: number; y: number } {
  for (let k = 1; k < 8; k++) {
    const x = p.x + dx * k * 0.5;
    const y = p.y + dy * k * 0.5;
    if (k >= 2 && circleFree(w.map, x, y, 14)) return { x, y };
  }
  return { x: p.x + dx, y: p.y + dy };
}

// ================================================================== mira

describe('mira dos projéteis (convenção única servidor/cliente)', () => {
  it('a trajetória desenhada (plano do chão + SHOT_HEIGHT) passa exatamente pelo ponto clicado', () => {
    const w = mkWorld(['hunter']);
    const p = w.players.get(1) as Player;
    for (const [cx, cy] of [[p.x + 200, p.y - 120], [p.x - 310, p.y + 40], [p.x + 5, p.y + 170], [p.x - 60, p.y - 175]] as const) {
      p.aimX = cx;
      p.aimY = cy;
      const shot = projectileAim(p);
      // ponto desenhado ao longo da trajetória: (x, y - SHOT_HEIGHT)
      const vx = Math.cos(shot.dir);
      const vy = Math.sin(shot.dir);
      const t = (cx - shot.x) / (vx || 1e-9);
      const drawnY = shot.y + vy * t - SHOT_HEIGHT;
      if (Math.abs(vx) > 0.2) expect(Math.abs(drawnY - cy)).toBeLessThan(0.01);
      // distância perpendicular do clique à linha desenhada
      const px = cx - shot.x;
      const py = cy - (shot.y - SHOT_HEIGHT);
      expect(Math.abs(px * vy - py * vx)).toBeLessThan(0.01);
    }
  });

  it('cursor em cima do jogador preserva a última direção válida', () => {
    const w = mkWorld(['mage']);
    const p = w.players.get(1) as Player;
    p.aim = 1.234;
    p.aimX = p.x;
    p.aimY = p.y - SHOT_HEIGHT;
    expect(projectileAim(p).dir).toBeCloseTo(1.234, 5);
  });

  it('o servidor cria o virote com a mesma direção enviada pelo cliente', () => {
    const w = mkWorld(['hunter']);
    const p = w.players.get(1) as Player;
    const ax = p.x + 150;
    const ay = p.y - 90;
    run(w, 1, () => ({ pressed: BTN.attack, ax, ay }));
    run(w, 10, () => ({ ax, ay }));
    const pr = w.projectiles.find((q) => q.team === 'p');
    expect(pr).toBeTruthy();
    if (!pr) return;
    const want = Math.atan2(ay + SHOT_HEIGHT - p.y, ax - p.x);
    expect(Math.atan2(pr.vy, pr.vx)).toBeCloseTo(want, 5);
  });
});

// ================================================================== Vampiro

describe('Vampiro: Redemoinho Rubro e Banquete em área', () => {
  it('o E acerta todos em volta (360°), puxa, cura com teto e gera Sede', () => {
    const w = mkWorld(['vampire']);
    const p = w.players.get(1) as Player;
    p.hp = 40;
    const around = [0, 1.6, 3.1, 4.7].map((a) => spawn(w, 'shambler', p.x + Math.cos(a) * 40, p.y + Math.sin(a) * 40));
    for (const e of around) e.hp = e.maxHp = 5000;
    run(w, 1, () => ({ pressed: BTN.e }));
    run(w, VAMPIRE.vortex.windup + VAMPIRE.vortex.pulses * VAMPIRE.vortex.pulseEvery + 3);
    for (const e of around) expect(e.maxHp - e.hp).toBeGreaterThanOrEqual(VAMPIRE.vortex.damage * VAMPIRE.vortex.pulses * 0.9);
    expect(p.hp).toBeGreaterThan(40);
    expect(p.hp - 40).toBeLessThanOrEqual(VAMPIRE.vortex.healCapPerCast + 0.01);
    expect(p.thirst).toBeGreaterThan(0);
  });

  it('recebe menos dano girando', () => {
    const w = mkWorld(['vampire']);
    const p = w.players.get(1) as Player;
    run(w, 1, () => ({ pressed: BTN.e }));
    run(w, VAMPIRE.vortex.windup + 2);
    const hp = p.hp;
    p.iframes = 0;
    w.hitPlayer(p, { dmg: 20, heavy: false, fromX: p.x + 10, fromY: p.y, enemy: null, proj: null, blockable: false });
    expect(hp - p.hp).toBeLessThan(20 * VAMPIRE.vortex.damageTaken + 0.01);
  });

  it('o Banquete explode em área ao conjurar', () => {
    const w = mkWorld(['vampire']);
    const p = w.players.get(1) as Player;
    const es = [0.3, 2.2, 4.4].map((a) => spawn(w, 'shambler', p.x + Math.cos(a) * 60, p.y + Math.sin(a) * 60));
    for (const e of es) e.hp = e.maxHp = 5000;
    p.ult = 100;
    run(w, 1, () => ({ pressed: BTN.r }));
    run(w, VAMPIRE.feast.windup + 3);
    for (const e of es) expect(e.hp).toBeLessThan(5000);
    expect(p.buffs.feast).toBeGreaterThan(0);
  });
});

// ================================================================== Necromante

describe('Necromante: Exército com tempo limite', () => {
  it('depois do Exército a suprema fica selada e servos geram pouca suprema', () => {
    const w = mkWorld(['necromancer']);
    const p = w.players.get(1) as Player;
    p.essence = NECRO.essence.max;
    p.ult = 100;
    run(w, 1, () => ({ pressed: BTN.r }));
    run(w, NECRO.army.windup + 3);
    expect(p.ultLockT).toBeGreaterThan(0);
    const horde = [...w.minions.values()].filter((m) => m.kind === 'horde');
    expect(horde.length).toBeLessThanOrEqual(NECRO.army.maxUnits);
    const e = spawn(w, 'shambler', p.x + 50, p.y);
    e.hp = e.maxHp = 5000;
    w.hitEnemy(p, e, 100, { poise: 0, kb: 0, fromX: p.x, fromY: p.y, kind: 'melee' });
    expect(p.ult).toBe(0); // selada
    p.ultLockT = 0;
    w.hitEnemy(p, e, 100, { poise: 0, kb: 0, fromX: p.x, fromY: p.y, kind: 'melee', fromMinion: true });
    expect(p.ult).toBeCloseTo(100 * p.base.ultPerDamage * NECRO.minionUltMul, 3);
  });
});

// ================================================================== chefes

describe('chefes: alvo prioritário inteligente', () => {
  it('prefere quem ataca à distância, fica travado e só troca com provocação ou queda', () => {
    const w = mkWorld(['tank', 'hunter', 'vampire']);
    const [tank, hunter] = [w.players.get(1), w.players.get(2)] as Player[];
    if (!tank || !hunter) return;
    const boss = spawn(w, 'moonDevourer', tank.x + 60, tank.y, false);
    // o tank está mais perto, mas o chefe escolhe o caçador
    expect(CLASS_RANGE.hunter).toBe('ranged');
    expect(w.targetOf(boss)?.id).toBe(hunter.id);
    // servos não desviam a atenção do chefe
    spawnMinion(w, tank.id, 'thrall', boss.x + 10, boss.y, { hp: 50, ttl: 300, speed: 0, damage: 1 });
    expect(w.targetOf(boss)?.id).toBe(hunter.id);
    // provocação transfere a trava
    boss.tauntBy = tank.id;
    boss.tauntT = 3;
    expect(w.targetOf(boss)?.id).toBe(tank.id);
    boss.tauntT = 0;
    expect(w.targetOf(boss)?.id).toBe(tank.id); // continua travado no provocador
    // queda libera a trava
    w.damagePlayerRaw(tank, 9999, false);
    expect(w.targetOf(boss)?.id).toBe(hunter.id);
  });

  it('acelera quando o alvo travado foge por muito tempo', () => {
    const w = mkWorld(['hunter']);
    const p = w.players.get(1) as Player;
    const boss = spawn(w, 'patriarch', p.x + BOSS_AI.pursuitDistance + 150, p.y, false);
    for (let i = 0; i < sec(BOSS_AI.pursuitDelay) + 5; i++) w.targetOf(boss);
    expect(boss.farT).toBeGreaterThan(sec(BOSS_AI.pursuitDelay));
  });
});

// ================================================================== inimigos anti-kite

describe('Acólito Sombrio — Marcha Sombria', () => {
  it('só conjura com aliados perseguindo, acelera por categoria sem acumular e pode ser interrompido', () => {
    const w = mkWorld(['hunter']);
    const p = w.players.get(1) as Player;
    const at = freeNear(w, p, 260, 0);
    const ac = spawn(w, 'shadowAcolyte', at.x, at.y);
    ac.cds.march = 0;
    // sozinho: não conjura
    run(w, 40);
    expect(ac.atk).not.toBe('march');
    // grupo perseguindo
    const allies = [0, 1, 2, 3].map((i) => spawn(w, 'shambler', at.x + 20 + i * 6, at.y + (i % 2 ? 18 : -18)));
    const wolf = spawn(w, 'werewolf', at.x - 30, at.y + 30);
    for (const e of [...allies, wolf]) {
      e.targetId = p.id;
      e.targetT = 9999;
    }
    ac.cds.march = 0;
    ac.aiT = 0;
    let started = false;
    for (let i = 0; i < 60 && !started; i++) {
      run(w, 1);
      started = ac.atk === 'march' && ac.state === 'windup';
    }
    expect(started).toBe(true);
    // interrupção (ex.: Pulso do Dog) cancela e não acelera ninguém
    expect(w.interrupt(ac)).toBe(true);
    for (const e of allies) expect(e.hasteT).toBe(0);
    // conjura até o fim
    ac.state = 'move';
    ac.atk = 'none';
    ac.cds.march = 0;
    ac.aiT = 0;
    run(w, ATK.shadowAcolyte.march.windup + 25);
    const M = ATK.shadowAcolyte.march;
    const hasted = allies.filter((e) => e.hasteT > 0);
    expect(hasted.length).toBeGreaterThan(0);
    for (const e of hasted) expect(e.hasteMul).toBeCloseTo(M.commonBonus, 5);
    if (wolf.hasteT > 0) expect(wolf.hasteMul).toBeCloseTo(M.eliteBonus, 5);
    // nova aplicação renova a duração, não soma o bônus
    const e0 = hasted[0] as Enemy;
    e0.hasteT = 5;
    e0.hasteMul = M.commonBonus;
    ac.state = 'windup';
    ac.atk = 'march';
    ac.stateT = M.windup - 1;
    run(w, 2);
    expect(e0.hasteMul).toBeCloseTo(M.commonBonus, 5);
    expect(e0.hasteT).toBeGreaterThan(sec(M.duration) - 5);
  });
});

describe('Caçador de Névoa', () => {
  it('prefere quem atira, salta dentro da visão, fica exposto na recuperação e não empilha saltos no mesmo alvo', () => {
    const w = mkWorld(['berserker', 'hunter']);
    const [melee, ranged] = [w.players.get(1), w.players.get(2)] as Player[];
    if (!melee || !ranged) return;
    ranged.lastShotTick = w.tick;
    const pos = freeNear(w, ranged, 130, 20);
    const s1 = spawn(w, 'mistStalker', pos.x, pos.y, false);
    const s2 = spawn(w, 'mistStalker', pos.x + 4, pos.y - 30, false);
    s1.cds.mistLeap = 0;
    s2.cds.mistLeap = 0;
    let leapers = 0;
    let target = 0;
    for (let i = 0; i < 20; i++) {
      run(w, 1);
      leapers = [s1, s2].filter((s) => s.atk === 'mistLeap' && (s.state === 'windup' || s.state === 'air')).length;
      if (leapers) {
        target = [s1, s2].find((s) => s.atk === 'mistLeap')?.lockedId ?? 0;
        break;
      }
    }
    expect(leapers).toBe(1);
    expect(target).toBe(ranged.id);
    const s = [s1, s2].find((x) => x.atk === 'mistLeap') as Enemy;
    // o pouso nunca fica dentro de parede
    expect(circleFree(w.map, s.tx, s.ty, s.r)).toBe(true);
    run(w, ATK.mistStalker.leap.windup + ATK.mistStalker.leap.airTicks + 2);
    expect(s.state).toBe('recover');
    const poise0 = s.poise;
    w.hitEnemy(null, s, 1, { poise: 5, kb: 0, fromX: s.x + 10, fromY: s.y, kind: 'melee' });
    expect(s.poise - poise0).toBeCloseTo(5 * ATK.mistStalker.leap.recoverPoiseMul, 5);
  });

  it('fora da visão do alvo não salta', () => {
    const w = mkWorld(['hunter']);
    const p = w.players.get(1) as Player;
    const s = spawn(w, 'mistStalker', p.x + ATK.mistStalker.leap.viewHalfW + 40, p.y, true);
    s.cds.mistLeap = 0;
    run(w, 10);
    expect(s.atk).not.toBe('mistLeap');
  });
});

describe('Portador do Ossário', () => {
  it('bloqueia projéteis pela frente (sem atravessar), é vulnerável pelas costas e golpes pesados quebram o escudo', () => {
    const w = mkWorld(['hunter']);
    const p = w.players.get(1) as Player;
    const pos = freeNear(w, p, 120, 0);
    const b = spawn(w, 'ossuaryBearer', pos.x, pos.y);
    const behind = spawn(w, 'shambler', pos.x + 30, pos.y);
    behind.hp = behind.maxHp = 5000;
    b.shieldDir = Math.PI; // virado para o jogador (à esquerda)
    const body0 = b.hp;
    const shield0 = b.shieldHp;
    // projétil perfurante vindo pela frente
    w.spawnProjectile({ kind: 'pierceBolt', team: 'p', owner: p.id, x: pos.x - 40, y: pos.y, vx: 400, vy: 0, r: 5, dmg: 30, range: 400, pierce: 5, poise: 20, kb: 0 });
    run(w, 10);
    expect(b.shieldHp).toBeLessThan(shield0);
    expect(body0 - b.hp).toBeLessThanOrEqual(30 * ATK.ossuaryBearer.shield.projBodyMul + 1);
    expect(behind.hp).toBe(5000); // não atravessou
    // pelas costas: dano cheio
    w.killEnemy(behind, null);
    const body1 = b.hp;
    w.spawnProjectile({ kind: 'bolt', team: 'p', owner: p.id, x: pos.x + 40, y: pos.y + 2, vx: -400, vy: 0, r: 4, dmg: 20, range: 60, pierce: 0, poise: 5, kb: 0 });
    run(w, 6);
    expect(body1 - b.hp).toBeGreaterThanOrEqual(19);
    // golpe pesado frontal (investida/berserker) destrói o escudo mais rápido
    const s0 = b.shieldHp;
    w.hitEnemy(null, b, 30, { poise: 60, kb: 0, fromX: pos.x - 20, fromY: pos.y, kind: 'melee' });
    expect(s0 - b.shieldHp).toBeCloseTo(30 * ATK.ossuaryBearer.shield.heavyShieldMul, 3);
    w.damageShield(b, 9999, null);
    expect(b.shieldHp).toBe(0);
    b.hp = b.maxHp = 5000;
    // sem escudo: nenhuma resistência especial a projéteis
    const body2 = b.hp;
    w.spawnProjectile({ kind: 'bolt', team: 'p', owner: p.id, x: pos.x - 40, y: pos.y, vx: 400, vy: 0, r: 4, dmg: 20, range: 60, pierce: 0, poise: 5, kb: 0 });
    run(w, 6);
    expect(body2 - b.hp).toBeGreaterThanOrEqual(19);
  });

  it('Portadores mantêm espaço entre si', () => {
    const w = mkWorld(['hunter']);
    const p = w.players.get(1) as Player;
    const pos = freeNear(w, p, 220, 0);
    const a = spawn(w, 'ossuaryBearer', pos.x, pos.y, false);
    const b = spawn(w, 'ossuaryBearer', pos.x + 2, pos.y + 2, false);
    run(w, 45);
    expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(a.r + b.r);
  });
});

describe('ondas e diretor', () => {
  it('apresentação gradual: cada especial aparece sozinho antes das combinações', () => {
    const first = (t: string): number => WAVES.findIndex((d) => (d.guaranteed as Record<string, number> | undefined)?.[t]);
    const ac = first('shadowAcolyte');
    const be = first('ossuaryBearer');
    const st = first('mistStalker');
    const g = (i: number): Record<string, number> => (WAVES[i]?.guaranteed ?? {}) as Record<string, number>;
    expect(g(ac).ossuaryBearer ?? 0).toBe(0);
    expect(g(be).shadowAcolyte ?? 0).toBe(0);
    expect(g(st).ossuaryBearer ?? 0).toBe(0);
    const combos = WAVES.map((_, i) => i).filter((i) => ['shadowAcolyte', 'ossuaryBearer', 'mistStalker'].filter((t) => (g(i)[t] ?? 0) > 0).length >= 2);
    expect(Math.min(...combos)).toBeGreaterThan(Math.max(ac, be, st));
    // chefes e minichefes não vêm acompanhados de especiais
    for (const d of WAVES) if (d.boss || d.miniboss) expect(Object.entries(d.guaranteed ?? {}).filter(([t]) => t in SPECIAL_CAPS).reduce((a, [, n]) => a + (n as number), 0)).toBeLessThanOrEqual(1);
  });

  it('respeita o limite simultâneo de especiais', () => {
    const w = mkWorld(['hunter', 'mage', 'dog', 'tank']);
    const wave = WAVES.findIndex((d) => (d.guaranteed?.ossuaryBearer ?? 0) >= 2) + 1;
    w.debug('wave', wave, '');
    w.phaseTimer = 0;
    let max = 0;
    for (let i = 0; i < sec(40); i++) {
      run(w, 1);
      const n = [...w.enemies.values()].filter((e) => e.type === 'ossuaryBearer' && e.state !== 'dead').length;
      max = Math.max(max, n);
    }
    expect(max).toBeLessThanOrEqual(SPECIAL_CAPS.ossuaryBearer ?? 99);
  });
});
