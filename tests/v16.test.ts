/**
 * v1.6 — Jota: vibecoder de capuz, glass cannon de dano à distância (Prompt, Patch, Rewind,
 * Contexto/Compactar e a suprema Modo Batman). Tudo verificado no servidor.
 */
import { describe, expect, it } from 'vitest';
import { CLASS_IDS, CLASSES, type ClassId, JOTA } from '../src/shared/config/classes.js';
import { LINES } from '../src/shared/config/lines.js';
import { FORKS, UPGRADE_BY_ID, UPGRADES } from '../src/shared/config/upgrades.js';
import { PLAYER_FLAGS, PROJECTILE_KINDS, ZONE_KINDS } from '../src/shared/protocol.js';
import { BTN, type InputFrame } from '../src/shared/movement.js';
import { availableUpgrades } from '../src/server/world/upgrades.js';
import type { Enemy, Player } from '../src/server/world/types.js';
import { World } from '../src/server/world/world.js';

type InputFn = (p: Player, w: World) => Partial<InputFrame> | null;

function mkWorld(classes: ClassId[], god = true): World {
  const w = new World({ seed: 16, solo: false });
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
const snapFlags = (w: World): number => w.snapPlayers().find((s) => s.id === 1)?.f ?? 0;

describe('Jota — conteúdo', () => {
  it('é a 10ª classe: glass cannon com vida baixa, ult nomeada e arte/ícones/kit registrados', () => {
    expect(CLASS_IDS.length).toBe(10);
    expect(CLASS_IDS).toContain('jota');
    const c = CLASSES.jota;
    expect(c.hp).toBeGreaterThanOrEqual(85);
    expect(c.hp).toBeLessThanOrEqual(95);
    expect(c.ultName).toBe('Deploy');
    for (const slot of ['basic', 'q', 'e', 'r', 'passive'] as const) expect(c.texts[slot].desc.length).toBeGreaterThan(30);
    expect(PROJECTILE_KINDS).toEqual(expect.arrayContaining(['prompt', 'batarang', 'fearBomb']));
    expect(ZONE_KINDS).toEqual(expect.arrayContaining(['fear', 'rewind']));
  });

  it('tem falas de vibecoder (incluindo checkpoint e a fala da ult do Batman) e cartas próprias', () => {
    const L = LINES.jota ?? {};
    expect(L.ult).toContain('Eu sou a branch main.');
    expect((L.checkpoint ?? []).length).toBeGreaterThanOrEqual(2);
    expect((L.compact ?? []).length).toBeGreaterThan(0);
    expect((L.rewind ?? []).length).toBeGreaterThan(0);
    const all = Object.values(L).flat().join(' ');
    expect(all).toMatch(/prompt/i);
    expect(all).toMatch(/máquina/);
    expect(all).toMatch(/prod/);
    expect(all).toMatch(/alucin/);
    expect(all).toMatch(/revert/);
  });

  it('cartas: comuns, uma bifurcação (exclusiva) e uma lendária', () => {
    const mine = UPGRADES.filter((u) => u.cls === 'jota');
    expect(mine.length).toBeGreaterThanOrEqual(7);
    expect(mine.filter((u) => u.rarity === 'common').length).toBeGreaterThanOrEqual(3);
    const forks = mine.filter((u) => u.fork === 'jota_path');
    expect(forks.map((u) => u.id).sort()).toEqual(['j_rebound', 'j_revert']);
    expect(FORKS.jota_path).toBeTruthy();
    expect(mine.filter((u) => u.rarity === 'legendary').map((u) => u.id)).toEqual(['j_main']);
    // escolher um lado da bifurcação tira o outro da oferta
    const w = mkWorld(['jota']);
    const p = me(w);
    expect(availableUpgrades(p).map((u) => u.id)).toEqual(expect.arrayContaining(['j_rebound', 'j_revert']));
    p.mods['j_rebound'] = 1;
    const ids = availableUpgrades(p).map((u) => u.id);
    expect(ids).not.toContain('j_revert');
    expect(UPGRADE_BY_ID.get('j_main')?.kind).toBe('transform');
  });
});

describe('Jota — Prompt, Contexto e Compactar', () => {
  it('o Prompt perfura 1 inimigo, o segundo leva menos dano e cada acerto enche o Contexto', () => {
    const w = mkWorld(['jota']);
    const p = me(w);
    const a = spawn(w, 'father', p.x + 50, p.y);
    const b = spawn(w, 'father', p.x + 70, p.y);
    const c = spawn(w, 'father', p.x + 90, p.y);
    run(w, 1, () => ({ pressed: BTN.attack, ax: c.x, ay: c.y }));
    run(w, JOTA.prompt.windup + 1, () => ({ ax: c.x, ay: c.y }));
    expect(w.projectiles.some((pr) => pr.kind === 'prompt')).toBe(true);
    run(w, 25, () => ({ ax: c.x, ay: c.y }));
    expect(a.hp).toBeLessThan(5000);
    expect(b.hp).toBeLessThan(5000);
    expect(5000 - b.hp).toBeLessThan(5000 - a.hp);
    expect(c.hp).toBe(5000);
    expect(p.jota.ctx).toBeGreaterThanOrEqual(JOTA.prompt.tokens * 2 - 0.01);
  });

  it('com o Contexto cheio ele compacta: nova em volta, Contexto zera e vem o bônus de dano e de ataque', () => {
    const w = mkWorld(['jota']);
    const p = me(w);
    const near = spawn(w, 'shambler', p.x - 30, p.y);
    const target = spawn(w, 'father', p.x + 60, p.y);
    p.jota.ctx = JOTA.context.max - 1;
    run(w, 1, () => ({ pressed: BTN.attack, ax: target.x, ay: target.y }));
    run(w, 20, () => ({ ax: target.x, ay: target.y }));
    expect(p.jota.ctx).toBeLessThan(JOTA.prompt.tokens);
    expect(near.hp).toBeLessThan(5000);
    expect(p.jota.hotT).toBeGreaterThan(0);
    expect(snapFlags(w) & PLAYER_FLAGS.compact).toBeTruthy();
    // o bônus de dano vale para qualquer golpe dele
    const e = spawn(w, 'father', p.x + 200, p.y);
    const hp0 = e.hp;
    w.hitEnemy(p, e, 100, { poise: 0, kb: 0, fromX: p.x, fromY: p.y, kind: 'proj' });
    expect(hp0 - e.hp).toBe(Math.round(100 * (1 + JOTA.context.compact.buffDamage)));
  });

  it('o Contexto escorre quando ele para de acertar e sobe o dano gradualmente', () => {
    const w = mkWorld(['jota']);
    const p = me(w);
    p.jota.ctx = 50;
    const e = spawn(w, 'father', p.x + 100, p.y);
    const hp0 = e.hp;
    w.hitEnemy(p, e, 100, { poise: 0, kb: 0, fromX: p.x, fromY: p.y, kind: 'melee' });
    expect(hp0 - e.hp).toBe(Math.round(100 * (1 + 50 * JOTA.context.damagePerPoint)));
    run(w, JOTA.context.idleSeconds * 30 + 60);
    expect(p.jota.ctx).toBeLessThan(50);
  });
});

describe('Jota — Patch', () => {
  it('o feixe atravessa tudo na linha, marca e a marca aumenta o dano seguinte do Jota', () => {
    const w = mkWorld(['jota']);
    const p = me(w);
    const a = spawn(w, 'shambler', p.x + 60, p.y);
    const b = spawn(w, 'shambler', p.x + 150, p.y);
    const off = spawn(w, 'shambler', p.x + 100, p.y + 80);
    run(w, 1, () => ({ pressed: BTN.q, ax: b.x, ay: b.y }));
    run(w, JOTA.patch.windup + 3, () => ({ ax: b.x, ay: b.y }));
    expect(a.hp).toBeLessThan(5000);
    expect(b.hp).toBeLessThan(5000);
    expect(off.hp).toBe(5000);
    expect(p.jota.marks.has(a.id) && p.jota.marks.has(b.id)).toBe(true);
    expect(p.cd.q).toBeGreaterThan(0);
    // marcado leva +18%; o que não foi marcado, não
    p.jota.ctx = 0;
    const hpA = a.hp;
    const hpO = off.hp;
    w.hitEnemy(p, a, 100, { poise: 0, kb: 0, fromX: p.x, fromY: p.y, kind: 'aoe' });
    w.hitEnemy(p, off, 100, { poise: 0, kb: 0, fromX: p.x, fromY: p.y, kind: 'aoe' });
    expect(hpA - a.hp).toBe(Math.round(100 * (1 + JOTA.patch.markBonus)));
    expect(hpO - off.hp).toBe(100);
  });
});

describe('Jota — Rewind', () => {
  it('volta à posição e à vida de 3s atrás, limpa fogo/gelo, estoura a partida e a sombra mostra o destino', () => {
    const w = mkWorld(['jota'], false);
    const p = me(w);
    p.hp = p.maxHp;
    const x0 = p.x;
    // anda ~2,5s para a direita sem tomar dano
    run(w, 75, () => ({ mx: 1, ax: p.x + 100, ay: p.y }));
    expect(p.x).toBeGreaterThan(x0 + 60);
    const ghost = w.zones.find((z) => z.kind === 'rewind');
    expect(ghost).toBeTruthy();
    expect(ghost?.extra).toBe(1);
    expect(ghost?.x ?? 0).toBeLessThan(p.x - 40);
    // toma dano e fica queimado; mais um pouco de caminhada
    p.hp = p.maxHp - 40;
    p.buffs.burn = 90;
    const e = spawn(w, 'shambler', p.x + 4, p.y);
    const target = ghost ? { x: ghost.x, y: ghost.y } : { x: 0, y: 0 };
    run(w, 1, () => ({ pressed: BTN.e }));
    expect(Math.hypot(p.x - target.x, p.y - target.y)).toBeLessThan(40);
    expect(p.hp).toBeGreaterThan(p.maxHp - 40);
    expect(p.buffs.burn).toBe(0);
    expect(e.hp).toBeLessThan(5000);
    expect(p.iframes).toBeGreaterThan(0);
    expect(p.cd.e).toBeGreaterThan(0);
    // em recarga: a sombra fica apagada (extra 2) e não rewinda de novo
    run(w, 5);
    expect(w.zones.find((z) => z.kind === 'rewind')?.extra).not.toBe(1);
    const xNow = p.x;
    run(w, 1, () => ({ pressed: BTN.e }));
    expect(p.x).toBeCloseTo(xNow, 0);
  });

  it('sem histórico suficiente o Rewind nega (e não gasta recarga)', () => {
    const w = mkWorld(['jota']);
    const p = me(w);
    p.jota.hist.length = 0;
    expect(w.tryStart(p, 'e')).toBe(false);
    expect(p.cd.e).toBe(0);
  });

  it('nunca reduz a vida (se estava mais baixa há 3s) e respeita a Ferida Profana', () => {
    const w = mkWorld(['jota'], false);
    const p = me(w);
    p.hp = 30;
    run(w, 40);
    p.hp = 70;
    run(w, 1, () => ({ pressed: BTN.e }));
    expect(p.hp).toBeGreaterThanOrEqual(70);
    const w2 = mkWorld(['jota'], false);
    const q = me(w2);
    run(w2, 40);
    q.hp = 40;
    q.woundT = 90;
    run(w2, 1, () => ({ pressed: BTN.e }));
    expect(q.hp).toBeLessThanOrEqual(40);
  });
});

describe('Jota — Modo Batman (ultimate)', () => {
  const transform = (w: World, p: Player): void => {
    p.ult = 100;
    expect(w.tryStart(p, 'r')).toBe(true);
    run(w, JOTA.bat.windup + JOTA.bat.recovery + 4);
  };

  it('vira o Batman: flags, escudo, menos dano, mais velocidade, imune a atordoamento; volta ao capuz', () => {
    const w = mkWorld(['jota'], false);
    const p = me(w);
    const v0 = w.moveParams(p).speed;
    const dodge0 = w.moveParams(p).dodgeSpeed;
    transform(w, p);
    expect(p.jota.batT).toBeGreaterThan(0);
    expect(snapFlags(w) & PLAYER_FLAGS.batman).toBeTruthy();
    expect(w.snapPlayers()[0]?.ch).toBeGreaterThan(0);
    expect(p.shieldHp).toBeGreaterThan(0);
    expect(w.moveParams(p).speed).toBeCloseTo(v0 * JOTA.bat.speedMul, 5);
    expect(w.moveParams(p).dodgeSpeed).toBeCloseTo(dodge0 * JOTA.bat.dodgeMul, 5);
    p.shieldHp = 0;
    p.iframes = 0;
    const hp0 = p.hp;
    w.hitPlayer(p, { dmg: 50, heavy: false, fromX: p.x + 10, fromY: p.y, enemy: null, proj: null, blockable: false });
    expect(hp0 - p.hp).toBeLessThanOrEqual(Math.round(50 * JOTA.bat.damageTaken));
    expect(hp0 - p.hp).toBeGreaterThan(0);
    run(w, 1);
    w.hitPlayer(p, { dmg: 5, heavy: false, fromX: p.x + 10, fromY: p.y, enemy: null, proj: null, blockable: false, stun: 1 });
    expect(p.action?.name).not.toBe('stun');
    // não dá para recomeçar a transformação enquanto dura
    p.ult = 100;
    expect(w.tryStart(p, 'r')).toBe(false);
    // acaba sozinho, volta ao capuz e Q/E ficam em recarga
    run(w, JOTA.bat.duration * 30 + 10);
    expect(p.jota.batT).toBe(0);
    expect(snapFlags(w) & PLAYER_FLAGS.batman).toBeFalsy();
    expect(w.moveParams(p).speed).toBeCloseTo(v0, 5);
  });

  it('o básico vira um leque de batarangues; Q vira Bomba de Medo que atordoa; E é o Gancho', () => {
    const w = mkWorld(['jota']);
    const p = me(w);
    transform(w, p);
    const e = spawn(w, 'shambler', p.x + 120, p.y);
    run(w, 1, () => ({ pressed: BTN.attack, ax: e.x, ay: e.y }));
    run(w, JOTA.bat.batarang.windup + 1, () => ({ ax: e.x, ay: e.y }));
    expect(w.projectiles.filter((pr) => pr.kind === 'batarang').length).toBe(JOTA.bat.batarang.count);
    run(w, 30, () => ({ ax: e.x, ay: e.y }));
    expect(e.hp).toBeLessThan(5000);
    // bomba de medo
    run(w, 20);
    run(w, 1, () => ({ pressed: BTN.q, ax: e.x, ay: e.y }));
    run(w, JOTA.bat.fear.windup + 40, () => ({ ax: e.x, ay: e.y }));
    const fog = w.zones.find((z) => z.kind === 'fear');
    expect(fog).toBeTruthy();
    expect(e.cc.stun + e.cc.slow).toBeGreaterThan(0);
    expect(e.hp).toBeLessThan(5000);
    // gancho
    run(w, 15);
    const x0 = p.x;
    run(w, 1, () => ({ pressed: BTN.e, ax: p.x + 100, ay: p.y }));
    run(w, JOTA.bat.grapple.ticks + 4);
    expect(p.x - x0).toBeGreaterThan(JOTA.bat.grapple.distance * 0.6);
  });

  it('a lendária Push na Main estende o Modo Batman e cura; sem ela, o tempo é o base', () => {
    const w = mkWorld(['jota'], false);
    const p = me(w);
    p.mods['j_main'] = 1;
    p.hp = 20;
    transform(w, p);
    expect(p.jota.batMax).toBe(Math.round((JOTA.bat.duration + 4) * 30));
    expect(p.hp).toBeGreaterThan(20 + p.maxHp * 0.3);
  });

  it('cair no meio da transformação desfaz e o checkpoint zera o estado do Jota', () => {
    const w = mkWorld(['jota'], false);
    const p = me(w);
    transform(w, p);
    p.hp = 1;
    p.shieldHp = 0;
    p.iframes = 0;
    p.jota.batT = 100;
    w.damagePlayerRaw(p, 50, false);
    run(w, 2);
    expect(p.status).not.toBe(0);
    expect(p.jota.batT).toBe(0);
  });
});
