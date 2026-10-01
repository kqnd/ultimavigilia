/**
 * v1.7: dinâmica de arena dos chefes. Pilares temporários (sólidos, sincronizados), raios lunares
 * com cobertura, manchas de gelo e fendas do abismo (hazards persistentes) e os novos ataques.
 */
import { describe, expect, it } from 'vitest';
import type { ClassId } from '../src/shared/config/classes.js';
import { ATK } from '../src/shared/config/enemies.js';
import { sec, TILE } from '../src/shared/constants.js';
import { circleFree, lineOfSight } from '../src/shared/collision.js';
import { ENEMY_ATTACKS, ZONE_KINDS } from '../src/shared/protocol.js';
import type { InputFrame } from '../src/shared/movement.js';
import type { Enemy, Player } from '../src/server/world/types.js';
import { World } from '../src/server/world/world.js';

function mkWorld(classes: ClassId[], god = true): World {
  const w = new World({ seed: 17, solo: false });
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
function run(w: World, n: number, fn: ((p: Player) => Partial<InputFrame> | null) | null = null): void {
  for (let i = 0; i < n; i++) {
    for (const p of w.players.values()) {
      const s = (seqs.get(p) ?? p.ack) + 1;
      seqs.set(p, s);
      w.pushInputs(p.id, [{ seq: s, mx: 0, my: 0, ax: p.x + 30, ay: p.y, held: 0, pressed: 0, ...(fn?.(p) ?? {}) }]);
    }
    w.step();
  }
}
function spawn(w: World, type: Parameters<World['spawnEnemy']>[0], x: number, y: number): Enemy {
  const e = w.spawnEnemy(type, x, y, w.players.size);
  e.state = 'move';
  e.threat.clear();
  return e;
}
const place = (p: Player, x: number, y: number): void => {
  p.move.x = x;
  p.move.y = y;
};
/** Procura um trecho aberto (11 tiles em linha, 3 linhas livres) e devolve o centro da linha do meio. */
function openRow(w: World): { x: number; y: number } {
  const m = w.map;
  for (let ty = 3; ty < m.h - 3; ty++) {
    for (let tx = 3; tx < m.w - 14; tx++) {
      let ok = true;
      for (let dx = 0; dx < 11 && ok; dx++) for (let dy = -1; dy <= 1 && ok; dy++) if (!circleFree(m, (tx + dx + 0.5) * TILE, (ty + dy + 0.5) * TILE, 14)) ok = false;
      if (ok) return { x: (tx + 0.5) * TILE, y: (ty + 0.5) * TILE };
    }
  }
  throw new Error('sem trecho aberto no mapa de teste');
}
const hp = (p: Player): number => p.hp;

function recordAttacks(w: World, boss: Enemy, ticks: number): string[] {
  const seq: string[] = [];
  let prev = boss.state as string;
  for (let i = 0; i < ticks; i++) {
    run(w, 1);
    if (boss.state === 'dead') break;
    const st = boss.state as string;
    if (st === 'windup' && prev !== 'windup' && boss.atk !== 'none') seq.push(boss.atk);
    prev = st;
  }
  return seq;
}

describe('protocolo v1.7', () => {
  it('novos ataques e zonas entram no fim das listas (índices antigos não mudam)', () => {
    expect(ENEMY_ATTACKS.indexOf('wound')).toBe(28);
    expect(ENEMY_ATTACKS.slice(-4)).toEqual(['moonRays', 'frostField', 'iceWall', 'rift']);
    expect(ZONE_KINDS.indexOf('rewind')).toBe(23);
    expect(ZONE_KINDS.slice(-4)).toEqual(['moonRay', 'rockWarn', 'frostPatch', 'abyssHole']);
  });
});

describe('pilares de arena', () => {
  it('pilar bloqueia corpo e visão, vai no snapshot e some sozinho', () => {
    const w = mkWorld(['hunter']);
    const o = openRow(w);
    const px = o.x + 5 * TILE;
    expect(w.addPillar(px, o.y, 2)).toBe(true);
    const i = Math.floor(o.y / TILE) * w.map.w + Math.floor(px / TILE);
    expect(w.snapPillars()).toContain(i);
    expect(circleFree(w.map, (Math.floor(px / TILE) + 0.5) * TILE, (Math.floor(o.y / TILE) + 0.5) * TILE, 6)).toBe(false);
    expect(lineOfSight(w.map, px - 80, (Math.floor(o.y / TILE) + 0.5) * TILE, px + 80, (Math.floor(o.y / TILE) + 0.5) * TILE)).toBe(false);
    run(w, sec(2) + 2);
    expect(w.snapPillars()).not.toContain(i);
    expect(circleFree(w.map, (Math.floor(px / TILE) + 0.5) * TILE, (Math.floor(o.y / TILE) + 0.5) * TILE, 6)).toBe(true);
  });

  it('não nasce em cima de ninguém nem em tile ocupado', () => {
    const w = mkWorld(['hunter']);
    const p = w.players.get(1) as Player;
    const o = openRow(w);
    place(p, o.x + 5 * TILE, o.y);
    expect(w.addPillar(p.x, p.y, 5)).toBe(false);
    expect(w.addPillar(o.x + 8 * TILE, o.y, 5)).toBe(true);
    expect(w.addPillar(o.x + 8 * TILE, o.y, 5)).toBe(false);
  });

  it('aviso de pilar (rockWarn) vira pilar ao fim do tempo', () => {
    const w = mkWorld(['hunter']);
    const o = openRow(w);
    const boss = spawn(w, 'moonDevourer', o.x, o.y);
    boss.maxHp = boss.hp = 9_999_999;
    const z = w.addZone({ kind: 'rockWarn', x: o.x + 7 * TILE, y: o.y, r: 18, ttl: 10, owner: -boss.id });
    z.extra = 10;
    z.a = 5;
    expect(w.pillars.size).toBe(0);
    run(w, 12);
    expect(w.pillars.size).toBe(1);
  });

  it('morte do chefe derruba os pilares', () => {
    const w = mkWorld(['hunter']);
    const o = openRow(w);
    const boss = spawn(w, 'frostBride', o.x, o.y);
    expect(w.addPillar(o.x + 6 * TILE, o.y, 30)).toBe(true);
    w.killEnemy(boss, null);
    expect(w.pillars.size).toBe(0);
  });
});

describe('raios lunares', () => {
  function rayAt(w: World, boss: Enemy, x: number, y: number): void {
    const z = w.addZone({ kind: 'moonRay', x, y, r: 17, ttl: 3, owner: -boss.id, b: 20 });
    z.extra = 3;
  }

  it('fere quem está na linha, mas o pilar entre o chefe e o jogador protege', () => {
    const w = mkWorld(['hunter', 'tank'], false);
    const [a, b] = [w.players.get(1) as Player, w.players.get(2) as Player];
    const o = openRow(w);
    const boss = spawn(w, 'moonDevourer', o.x, o.y);
    boss.maxHp = boss.hp = 9_999_999;
    boss.state = 'recover'; // parado
    boss.stateT = -9999;
    // a: sem cobertura, 4 tiles à direita; b: atrás de um pilar, 8 tiles à direita (linha diferente do mesmo corredor)
    place(a, o.x + 3 * TILE, o.y - TILE);
    place(b, o.x + 8 * TILE, o.y);
    expect(w.addPillar(o.x + 5 * TILE, o.y, 30)).toBe(true);
    expect(lineOfSight(w.map, boss.x, boss.y, b.x, b.y)).toBe(false);
    expect(lineOfSight(w.map, boss.x, boss.y, a.x, a.y)).toBe(true);
    const [ha, hb] = [hp(a), hp(b)];
    rayAt(w, boss, a.x, a.y);
    rayAt(w, boss, a.x + 12, a.y); // dois segmentos vizinhos: mesmo disparo, um acerto só
    rayAt(w, boss, b.x, b.y);
    run(w, 5);
    expect(hp(a)).toBeLessThan(ha);
    expect(ha - hp(a)).toBeLessThanOrEqual(30); // não levou os dois segmentos
    expect(hp(b)).toBe(hb);
  });

  it('o Devorador usa Raios Lunares: cria pilares e raios telegrafados com o tempo de aviso do ATK', () => {
    const w = mkWorld(['hunter', 'tank']);
    const [a, b] = [w.players.get(1) as Player, w.players.get(2) as Player];
    const o = openRow(w);
    place(a, o.x + 5 * TILE, o.y);
    place(b, o.x + 6 * TILE, o.y + 8);
    const boss = spawn(w, 'moonDevourer', o.x, o.y);
    boss.maxHp = boss.hp = 9_999_999;
    boss.cds.leap = boss.cds.claws = sec(60);
    boss.cds.moonRays = 0;
    let rays = 0;
    let pillarsSeen = 0;
    for (let i = 0; i < sec(6) && !rays; i++) {
      run(w, 1);
      rays = w.zones.filter((z) => z.kind === 'moonRay').length;
      pillarsSeen = Math.max(pillarsSeen, w.zones.filter((z) => z.kind === 'rockWarn').length + w.pillars.size);
    }
    expect(boss.atk).toBe('moonRays');
    expect(rays).toBeGreaterThan(0);
    expect(pillarsSeen).toBeGreaterThanOrEqual(ATK.moonDevourer.moonRays.pillars - 1);
    // o aviso dura o windup inteiro: o primeiro raio só explode quando o ataque sai da preparação
    const first = w.zones.find((z) => z.kind === 'moonRay');
    expect(first && first.ttl).toBeGreaterThan(ATK.moonDevourer.moonRays.windup - 4);
  });
});

describe('hazards persistentes', () => {
  it('mancha de gelo: avisa, depois deixa o jogador lento e o fere por pulso', () => {
    const w = mkWorld(['hunter'], false);
    const p = w.players.get(1) as Player;
    const o = openRow(w);
    const boss = spawn(w, 'frostBride', o.x, o.y);
    boss.maxHp = boss.hp = 9_999_999;
    boss.state = 'recover';
    boss.stateT = -9999;
    place(p, o.x + 6 * TILE, o.y);
    const F = ATK.frostBride.frostField;
    const z = w.addZone({ kind: 'frostPatch', x: p.x, y: p.y, r: F.radius, ttl: F.warn + sec(3), owner: -boss.id, b: F.tickDamage });
    z.extra = F.warn;
    z.a = F.tickEvery;
    const h0 = hp(p);
    run(w, F.warn - 2);
    expect(hp(p)).toBe(h0); // durante o aviso nada acontece
    expect(p.buffs.slowed).toBe(0);
    run(w, F.tickEvery * 3);
    expect(hp(p)).toBeLessThan(h0);
    expect(p.buffs.slowed).toBeGreaterThan(0);
    expect(p.slowMul).toBeLessThanOrEqual(F.slow);
  });

  it('fenda do abismo: puxa para o centro e só fere no miolo', () => {
    const w = mkWorld(['hunter'], false);
    const p = w.players.get(1) as Player;
    const o = openRow(w);
    const boss = spawn(w, 'patriarch', o.x, o.y);
    boss.maxHp = boss.hp = 9_999_999;
    boss.state = 'recover';
    boss.stateT = -9999;
    const F = ATK.patriarch.rift;
    const cx = o.x + 6 * TILE;
    place(p, cx + F.radius * 0.85, o.y); // na borda: puxa, mas ainda não fere
    const z = w.addZone({ kind: 'abyssHole', x: cx, y: o.y, r: F.radius, ttl: F.warn + sec(4), owner: -boss.id, b: F.tickDamage });
    z.extra = 0;
    z.a = F.tickEvery;
    const d0 = Math.abs(p.x - cx);
    run(w, 10);
    expect(Math.abs(p.x - cx)).toBeLessThan(d0);
    run(w, sec(3));
    expect(hp(p)).toBeLessThan(p.maxHp);
  });

  it('hazard some quando o dono morre', () => {
    const w = mkWorld(['hunter']);
    const o = openRow(w);
    const boss = spawn(w, 'patriarch', o.x, o.y);
    const z = w.addZone({ kind: 'abyssHole', x: o.x + 100, y: o.y, r: 50, ttl: 999, owner: -boss.id, b: 5 });
    z.a = 15;
    w.killEnemy(boss, null);
    run(w, 2);
    expect(w.zones.some((q) => q.kind === 'abyssHole')).toBe(false);
  });
});

describe('novos ataques de chefe aparecem na luta', () => {
  function fight(type: 'frostBride' | 'patriarch', phase: number, ticks: number): string[] {
    const w = mkWorld(['hunter', 'tank']);
    const [a, b] = [w.players.get(1) as Player, w.players.get(2) as Player];
    const o = openRow(w);
    place(a, o.x + 5 * TILE, o.y);
    place(b, o.x + 6 * TILE, o.y + 6);
    const boss = spawn(w, type, o.x, o.y);
    boss.phase = phase;
    boss.summonsLeft = 3;
    boss.maxHp = boss.hp = 9_999_999;
    return recordAttacks(w, boss, ticks);
  }

  it('Noiva do Inverno usa Campo de Gelo e Muralha de Gelo', () => {
    const seq = fight('frostBride', 2, sec(120));
    expect(seq).toContain('frostField');
    expect(seq).toContain('iceWall');
  });

  it('Patriarca usa Fendas do Abismo (fases 1 e 2)', () => {
    expect(fight('patriarch', 1, sec(90))).toContain('rift');
    expect(fight('patriarch', 2, sec(90))).toContain('rift');
  });
});

describe('fase 3, minichefes e IA de locomoção', () => {
  it('Devorador entra na fase 3 abaixo de 25% de vida, com flag e 3 ondas de raios', () => {
    const w = mkWorld(['hunter']);
    const p = w.players.get(1) as Player;
    const o = openRow(w);
    place(p, o.x + 5 * TILE, o.y);
    const boss = spawn(w, 'moonDevourer', o.x, o.y);
    boss.phase = 2;
    boss.maxHp = 100_000;
    boss.hp = 20_000;
    run(w, 4);
    expect(boss.phase).toBe(3);
    expect(w.snapEnemies().some((t) => t.length > 0)).toBe(true);
    // o ataque agora sai em três ondas: recuperação mais longa e mais raios
    boss.state = 'move';
    boss.atk = 'none';
    boss.cds.moonRays = 0;
    boss.cds.leap = boss.cds.claws = boss.cds.crescent = sec(60);
    boss.thinkT = 0;
    let rays = 0;
    for (let i = 0; i < sec(8) && !rays; i++) {
      run(w, 1);
      rays = w.zones.filter((z) => z.kind === 'moonRay').length;
    }
    expect(rays).toBeGreaterThan(ATK.moonDevourer.moonRays.phase3Rays * 3); // 3 ondas x raios x segmentos
  });

  it('Lobo Alfa levanta entulho ao pousar e Pai Ancestral ergue pilares na pancada', () => {
    const w = mkWorld(['hunter']);
    const p = w.players.get(1) as Player;
    const o = openRow(w);
    place(p, o.x + 8 * TILE, o.y);
    const wolf = spawn(w, 'alphaWolf', o.x + 2 * TILE, o.y);
    wolf.maxHp = wolf.hp = 9_999_999;
    wolf.atk = 'pounce';
    wolf.state = 'air';
    wolf.stateT = ATK.werewolf.pounce.airTicks - 1;
    wolf.tx = o.x + 4 * TILE;
    wolf.ty = o.y;
    run(w, 2);
    expect(w.zones.filter((z) => z.kind === 'rockWarn').length).toBe(2);

    const w2 = mkWorld(['hunter']);
    const p2 = w2.players.get(1) as Player;
    const o2 = openRow(w2);
    place(p2, o2.x + 9 * TILE, o2.y);
    const father = spawn(w2, 'elderFather', o2.x + 2 * TILE, o2.y);
    father.maxHp = father.hp = 9_999_999;
    father.atk = 'slam';
    father.state = 'windup';
    father.stateT = ATK.father.slam.minibossWindup - 1;
    father.facing = 0;
    run(w2, 3);
    expect(w2.zones.filter((z) => z.kind === 'rockWarn').length).toBe(2);
  });

  it('inimigo lento (gelo/armadilha) não é lido como travado', () => {
    const w = mkWorld(['hunter']);
    const p = w.players.get(1) as Player;
    const o = openRow(w);
    place(p, o.x + 9 * TILE, o.y);
    const z = spawn(w, 'shambler', o.x, o.y);
    z.maxHp = z.hp = 9_999_999;
    let unstuck = 0;
    for (let i = 0; i < 120; i++) {
      z.cc.slow = 5;
      z.cc.slowMul = 0.25;
      run(w, 1);
      if (z.aiUnstickT > 0) unstuck++;
    }
    expect(unstuck).toBe(0);
  });
});
