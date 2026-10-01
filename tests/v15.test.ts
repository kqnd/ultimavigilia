/**
 * v1.5 — checkpoints por chefe, Maycon (controle de área no tapete), Guardião mais resistente e
 * interessante (Martelo Sísmico, muralha móvel que provoca, reflexo de projéteis) e Berserker
 * mais forte (Sede de Sangue, roubo de vida na Loucura). Tudo verificado no servidor.
 */
import { describe, expect, it } from 'vitest';
import { BERSERKER, type ClassId, MAYCON, TANK } from '../src/shared/config/classes.js';
import { LINES } from '../src/shared/config/lines.js';
import { UPGRADES } from '../src/shared/config/upgrades.js';
import { CHECKPOINT, isCheckpointWave } from '../src/shared/config/waves.js';
import { sec } from '../src/shared/constants.js';
import { BTN, type InputFrame } from '../src/shared/movement.js';
import type { Enemy, Player } from '../src/server/world/types.js';
import { World } from '../src/server/world/world.js';

type InputFn = (p: Player, w: World) => Partial<InputFrame> | null;

function mkWorld(classes: ClassId[], god = true): World {
  const w = new World({ seed: 21, solo: false });
  classes.forEach((c, i) => w.addPlayer(i + 1, `P${i + 1}`, c));
  w.startMatch();
  w.phaseTimer = 0;
  w.director.reset();
  w.debug('hold', 0, '');
  w.debug('kill', 0, '');
  w.god = god;
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
function spawn(w: World, type: Parameters<World['spawnEnemy']>[0], x: number, y: number): Enemy {
  const e = w.spawnEnemy(type, x, y, w.players.size);
  e.state = 'move';
  e.def = { ...e.def, speed: 0 };
  e.hp = e.maxHp = 5000;
  return e;
}
const me = (w: World): Player => w.players.get(1) as Player;

describe('Checkpoints por chefe', () => {
  it('ondas de chefe e minichefe são checkpoints (5, 10, 15, 20, 25, 30)', () => {
    const cps = Array.from({ length: 30 }, (_, i) => i + 1).filter(isCheckpointWave);
    expect(cps).toEqual([5, 10, 15, 20, 25, 30]);
  });

  it('sem checkpoint, cair todo mundo ainda é derrota', () => {
    const w = mkWorld(['tank', 'dog'], false);
    w.debug('hold', 0, '');
    for (const p of w.players.values()) p.status = 2;
    w.step();
    expect(w.phase).toBe('defeat');
  });

  it('vencer a onda do minichefe salva; cair depois volta para a onda seguinte, sem as melhorias novas e com -10% de vida', () => {
    const w = mkWorld(['tank', 'dog'], false);
    w.debug('wave', 5, '');
    w.debug('hold', 0, '');
    w.debug('kill', 0, '');
    const tank = me(w);
    tank.mods = { g_hide: 1 };
    tank.maxHp = tank.base.hp + 6;
    // fim da onda 5 (minichefe) → checkpoint antes das escolhas
    w.director.complete = () => true;
    w.step();
    expect(w.checkpoint?.wave).toBe(5);
    expect(w.phase).toBe('intermission');
    // ganha melhorias depois do checkpoint (ondas 6 e 7)
    tank.mods = { g_hide: 2, t_mace: 1 };
    tank.maxHp = tank.base.hp + 12;
    w.debug('wave', 7, '');
    w.director.complete = () => false;
    for (const p of w.players.values()) p.status = 2;
    w.step();
    expect(w.phase).toBe('wave');
    expect(w.wave).toBe(6);
    expect(w.wipes).toBe(1);
    expect(tank.mods).toEqual({ g_hide: 1 });
    expect(tank.maxHp).toBe(Math.round(tank.base.hp + 6 - tank.base.hp * CHECKPOINT.hpPenalty));
    expect(tank.hp).toBe(tank.maxHp);
    expect(tank.status).toBe(0);
    // segunda queda: a penalidade acumula
    for (const p of w.players.values()) p.status = 2;
    w.step();
    expect(w.wave).toBe(6);
    expect(tank.maxHp).toBe(Math.round(tank.base.hp + 6 - tank.base.hp * CHECKPOINT.hpPenalty * 2));
  });

  it('a penalidade tem teto', () => {
    const w = mkWorld(['hunter'], false);
    w.debug('wave', 10, '');
    w.debug('hold', 0, '');
    w['saveCheckpoint']();
    const p = me(w);
    for (let i = 0; i < 12; i++) {
      p.status = 2;
      w.step();
    }
    expect(p.hpPenalty).toBeCloseTo(CHECKPOINT.maxPenalty);
    expect(p.maxHp).toBe(Math.round(p.base.hp * (1 - CHECKPOINT.maxPenalty)));
    expect(w.wave).toBe(11);
  });
});

describe('Maycon — controle de área no tapete', () => {
  it('tem falas citando Hunt: Showdown e cartas próprias', () => {
    const all = Object.values(LINES.maycon ?? {}).flat().join(' ');
    expect(all).toMatch(/Bounty|Dark Sight|extra|Choke|Lawson|Bayou/);
    expect(UPGRADES.filter((u) => u.cls === 'maycon').length).toBeGreaterThanOrEqual(5);
  });

  it('garrafa estoura, respinga, desacelera e marca (Visão Sombria aumenta o dano recebido)', () => {
    const w = mkWorld(['maycon']);
    const p = me(w);
    const a = spawn(w, 'father', p.x + 60, p.y);
    const b = spawn(w, 'father', p.x + 70, p.y + 14);
    run(w, 1, () => ({ pressed: BTN.attack, ax: a.x, ay: a.y }));
    let slowed = false;
    for (let i = 0; i < 30 && a.hp >= 5000; i++) run(w, 1, () => ({ ax: a.x, ay: a.y }));
    slowed = a.cc.slow > 0;
    expect(a.hp).toBeLessThan(5000);
    expect(a.dsT).toBeGreaterThan(0);
    expect(b.dsT).toBeGreaterThan(0);
    expect(slowed).toBe(true);
    // marcado recebe mais dano de qualquer fonte
    const hp0 = a.hp;
    w.hitEnemy(null, a, 100, { poise: 0, kb: 0, fromX: a.x, fromY: a.y, kind: 'aoe' });
    expect(hp0 - a.hp).toBe(Math.round(100 * MAYCON.darkSight.damageMul));
  });

  it('Bomba de Fumaça cai no ponto mirado, atordoa quem entra e apaga projéteis inimigos', () => {
    const w = mkWorld(['maycon']);
    const p = me(w);
    const tx = p.x + 120;
    const e = spawn(w, 'shambler', tx, p.y);
    run(w, 1, () => ({ pressed: BTN.q, ax: tx, ay: p.y }));
    run(w, MAYCON.choke.windup + 30, () => ({ ax: tx, ay: p.y }));
    const cloud = w.zones.find((z) => z.kind === 'choke');
    expect(cloud).toBeTruthy();
    expect(Math.hypot((cloud?.x ?? 0) - tx, (cloud?.y ?? 0) - p.y)).toBeLessThan(16);
    expect(e.cc.stun + e.cc.slow).toBeGreaterThan(0);
    const shot = w.spawnProjectile({ kind: 'orb', team: 'e', owner: -e.id, x: tx + 10, y: p.y, vx: 0, vy: 0, range: 300 });
    run(w, 2);
    expect(shot.dead).toBe(true);
  });

  it('Voo Rasante joga a horda para os lados e deixa lenta', () => {
    const w = mkWorld(['maycon']);
    const p = me(w);
    const x0 = p.x;
    const e = spawn(w, 'shambler', p.x + 40, p.y + 8);
    e.hp = e.maxHp = 5000;
    e.def = { ...e.def, speed: 0 };
    run(w, 1, () => ({ pressed: BTN.e, ax: p.x + 200, ay: p.y }));
    run(w, MAYCON.flight.ticks + 4);
    expect(p.x - x0).toBeGreaterThan(MAYCON.flight.distance * 0.7);
    expect(e.hp).toBeLessThan(5000);
    expect(e.dsT).toBeGreaterThan(0);
  });

  it('Rodada da Casa: anel de cachaça que puxa, queima e cura aliados', () => {
    const w = mkWorld(['maycon', 'tank']);
    const p = me(w);
    const ally = w.players.get(2) as Player;
    ally.move.x = p.x + 30;
    ally.move.y = p.y;
    ally.hp = ally.maxHp - 40;
    w.god = false;
    const e = spawn(w, 'shambler', p.x + 90, p.y);
    p.ult = 100;
    run(w, 1, () => ({ pressed: BTN.r }));
    run(w, MAYCON.brew.windup + 2);
    const ring = w.zones.find((z) => z.kind === 'brew');
    expect(ring).toBeTruthy();
    run(w, 60);
    expect(e.hp).toBeLessThan(5000);
    expect(e.dsT).toBeGreaterThan(0);
    expect(ally.tele.heal.brew ?? 0).toBeGreaterThan(0);
  });
});

describe('Guardião — muralha mais resistente e mais interessante', () => {
  it('o 3º golpe seguido vira o Martelo Sísmico (360°, atordoa comuns)', () => {
    const w = mkWorld(['tank']);
    const p = me(w);
    const behind = spawn(w, 'shambler', p.x - 30, p.y);
    for (let i = 0; i < 3; i++) {
      run(w, 1, () => ({ pressed: BTN.attack, ax: p.x + 30, ay: p.y }));
      run(w, i < 2 ? TANK.mace.windup + TANK.mace.active + TANK.mace.recovery : TANK.quake.windup + 3, () => ({ ax: p.x + 30, ay: p.y }));
    }
    expect(behind.hp).toBeLessThan(5000);
    expect(behind.cc.stun).toBeGreaterThan(0);
  });

  it('na Última Vigília recebe metade do dano, ganha escudo, não é atordoado e provoca em volta', () => {
    const w = mkWorld(['tank', 'dog']);
    w.god = false;
    const p = me(w);
    const e = spawn(w, 'shambler', p.x + 40, p.y);
    p.ult = 100;
    expect(w.tryStart(p, 'r')).toBe(true);
    expect(p.shieldHp).toBeGreaterThanOrEqual(TANK.bastion.shield);
    run(w, 2);
    expect(e.tauntBy).toBe(p.id);
    p.shieldHp = 0;
    const hp0 = p.hp;
    w.hitPlayer(p, { dmg: 40, heavy: true, fromX: p.x + 10, fromY: p.y, enemy: null, proj: null, blockable: true, stun: 0.5 });
    expect(hp0 - p.hp).toBeLessThanOrEqual(Math.round(40 * (1 - TANK.bastion.selfReduction) * (1 - TANK.bastion.reduction)));
    expect(p.action?.name).toBe('r');
  });

  it('bloqueio perfeito devolve o projétil', () => {
    const w = mkWorld(['tank']);
    w.god = false;
    const p = me(w);
    const e = spawn(w, 'acolyte', p.x + 120, p.y);
    run(w, 1, () => ({ pressed: BTN.q, held: BTN.q }));
    const shot = w.spawnProjectile({ kind: 'orb', team: 'e', owner: -e.id, x: p.x + 4, y: p.y, vx: -10, vy: 0, dmg: 10, range: 100 });
    void shot;
    run(w, 1, () => ({ held: BTN.q }));
    expect(w.projectiles.some((pr) => pr.team === 'p' && pr.owner === p.id)).toBe(true);
  });
});

describe('Berserker — mais forte', () => {
  it('abates curam (Sede de Sangue) e a Loucura rouba vida', () => {
    const w = mkWorld(['berserker']);
    const p = me(w);
    p.hp = 50;
    const e = spawn(w, 'shambler', p.x + 20, p.y);
    e.hp = 1;
    w.hitEnemy(p, e, 10, { poise: 0, kb: 0, fromX: p.x, fromY: p.y, kind: 'melee' });
    expect(p.hp).toBeGreaterThan(50);
    expect(p.hp).toBeLessThanOrEqual(50 + BERSERKER.bloodlust.healPerKill);
    p.buffs.madness = sec(3);
    p.hp = 50;
    p.healBudget = 16;
    const f = spawn(w, 'father', p.x + 20, p.y);
    w.hitEnemy(p, f, 80, { poise: 0, kb: 0, fromX: p.x, fromY: p.y, kind: 'melee' });
    expect(p.hp).toBeGreaterThan(50);
  });
});
