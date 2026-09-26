import { describe, expect, it } from 'vitest';
import { DEFAULT_KEYS, normalizeSettings } from '../src/shared/bridge.js';
import { CLASS_IDS } from '../src/shared/config/classes.js';
import { UPGRADES } from '../src/shared/config/upgrades.js';
import { WAVES } from '../src/shared/config/waves.js';
import { circleFree, moveCircle, sweepFree } from '../src/shared/collision.js';
import { TILE } from '../src/shared/constants.js';
import { getArena, getMap, isSolidTile, onSlowFloor } from '../src/shared/map.js';
import { BTN, stepMovement } from '../src/shared/movement.js';
import { parseClientMessage, sanitizeName } from '../src/shared/protocol.js';
import { FlowField } from '../src/server/world/nav.js';

describe('mapa e colisão compartilhados', () => {
  const map = getArena();
  it('tem 64×40 tiles, spawns e inícios livres', () => {
    expect(map.w).toBe(64);
    expect(map.h).toBe(40);
    for (const s of map.spawns) expect(circleFree(map, s.x, s.y, 10)).toBe(true);
    for (const s of map.starts) expect(circleFree(map, s.x, s.y, 8)).toBe(true);
  });
  it('todos os portões são alcançáveis a partir da fogueira', () => {
    const f = new FlowField(map);
    f.compute(map.campfire.x, map.campfire.y + 48);
    for (const s of map.spawns) expect(f.at(s.x, s.y)).toBeLessThan(0xffff);
  });
  it('movimento rápido não atravessa paredes', () => {
    // encontra um tile sólido com vizinho livre à esquerda
    let wx = 0;
    let wy = 0;
    outer: for (let y = 3; y < map.h - 3; y++)
      for (let x = 3; x < map.w - 3; x++)
        if (isSolidTile(map, x, y) && !isSolidTile(map, x - 1, y) && !isSolidTile(map, x - 2, y)) {
          wx = x;
          wy = y;
          break outer;
        }
    const p = { x: (wx - 1.5) * TILE, y: (wy + 0.5) * TILE };
    moveCircle(map, p, 7, 400, 0);
    expect(p.x).toBeLessThanOrEqual(wx * TILE - 7 + 0.01);
    const s = sweepFree(map, (wx - 1.5) * TILE, (wy + 0.5) * TILE, (wx + 3) * TILE, (wy + 0.5) * TILE, 7);
    expect(s.x).toBeLessThan(wx * TILE);
  });
  it('esquiva gasta stamina e respeita recarga', () => {
    const s = { x: map.campfire.x, y: map.campfire.y + 60, fvx: 0, fvy: 0, ft: 0, stamina: 50, dodgeCd: 0 };
    const params = { radius: 7, speed: 100, moveMul: 1, canDodge: true, dodgeCost: 22, dodgeSpeed: 270, dodgeTicks: 9, dodgeCooldown: 4 };
    const inp = { seq: 1, mx: 1, my: 0, ax: 0, ay: 0, held: 0, pressed: BTN.dodge };
    expect(stepMovement(s, inp, params, map).dodged).toBe(true);
    expect(s.stamina).toBe(28);
    expect(stepMovement(s, { ...inp, seq: 2 }, params, map).dodged).toBe(false);
  });
});

describe('protocolo', () => {
  it('rejeita payloads inválidos', () => {
    expect(parseClientMessage(null)).toBeNull();
    expect(parseClientMessage({ t: 'x' })).toBeNull();
    expect(parseClientMessage({ t: 'cls', cls: 'dragao' })).toBeNull();
    expect(parseClientMessage({ t: 'in', i: [[1, 5, 0, 0, 0, 0, 0]] })).toBeNull();
    expect(parseClientMessage({ t: 'in', i: [[1, 0, 0, 0, 0, 999, 0]] })).toBeNull();
    expect(parseClientMessage({ t: 'in', i: new Array(20).fill([1, 0, 0, 0, 0, 0, 0]) })).toBeNull();
    expect(parseClientMessage({ t: 'in', i: [[1, Number.NaN, 0, 0, 0, 0, 0]] })).toBeNull();
    expect(parseClientMessage({ t: 'hello', v: 1, gv: '0', name: 'a'.repeat(200), pw: '', token: null, hostKey: null })).toBeNull();
  });
  it('aceita mensagens válidas', () => {
    expect(parseClientMessage({ t: 'cls', cls: 'dog' })).toEqual({ t: 'cls', cls: 'dog' });
    expect(parseClientMessage({ t: 'in', i: [[3, 0.5, -1, 10, 20, 1, 2]] })).not.toBeNull();
  });
  it('limpa apelidos', () => {
    expect(sanitizeName('  <b>Zé\n  da   Silva</b> ')).toBe('bZé da Silva/b');
    expect(sanitizeName('\u0000\u0001')).toBe('');
  });
});

describe('conteúdo', () => {
  it('7 classes (sem Guerreiro), 30 ondas com chefes em 10/20/30, ≥3 melhorias por classe', () => {
    expect(CLASS_IDS.length).toBe(7);
    expect(CLASS_IDS).toContain('berserker');
    expect(CLASS_IDS).toContain('necromancer');
    expect(CLASS_IDS as readonly string[]).not.toContain('warrior');
    expect(WAVES.length).toBe(30);
    expect(WAVES[9]?.boss).toBe('moonDevourer');
    expect(WAVES[19]?.boss).toBe('frostBride');
    expect(WAVES[29]?.boss).toBe('patriarch');
    for (const c of CLASS_IDS) expect(UPGRADES.filter((u) => u.cls === c).length).toBeGreaterThanOrEqual(3);
    expect(new Set(UPGRADES.map((u) => u.id)).size).toBe(UPGRADES.length);
  });

  it('melhorias têm valores coerentes com os limites anunciados', () => {
    const byId = new Map(UPGRADES.map((u) => [u.id, u]));
    expect(byId.get('h_rain')).toMatchObject({ maxStacks: 2, value: 2 });
    expect(byId.get('h_mark')).toMatchObject({ maxStacks: 2, value: 0.015 });
    expect(byId.get('h_ricochet')).toMatchObject({ maxStacks: 1, value: 0.4 });
    expect(byId.get('t_taunt')).toMatchObject({ maxStacks: 2, value: 18 });
    expect(byId.get('b_quake')).toMatchObject({ maxStacks: 2, value: 0.15 });
    expect(byId.get('d_resonance')).toMatchObject({ maxStacks: 2, value: 3 });
    expect(byId.get('n_lord')).toMatchObject({ maxStacks: 2, value: 0.25 });
  });
});

describe('mapas dos três capítulos', () => {
  for (const id of ['village', 'frozen', 'abyss'] as const) {
    it(`${id}: portões alcançáveis, inícios livres e quebráveis indexados`, () => {
      const m = getMap(id);
      for (const s of m.starts) expect(circleFree(m, s.x, s.y, 8)).toBe(true);
      const f = new FlowField(m);
      f.compute(m.campfire.x, m.campfire.y + 48);
      for (const s of m.spawns) expect(f.at(s.x, s.y)).toBeLessThan(0xffff);
      for (const b of m.breakables) expect(m.breakIdx[b.ty * m.w + b.tx]).toBe(b.i);
      for (const p of [...m.points.moons, ...m.points.totems, ...m.points.altar]) expect(circleFree(m, p.x, p.y, 10)).toBe(true);
    });
  }
  it('chão lento reduz a velocidade na predição compartilhada', () => {
    const m = getMap('frozen');
    let slow: { x: number; y: number } | null = null;
    for (let ty = 0; ty < m.h && !slow; ty++)
      for (let tx = 0; tx < m.w && !slow; tx++)
        if (onSlowFloor(m, (tx + 0.5) * TILE, (ty + 0.5) * TILE) && circleFree(m, (tx + 0.5) * TILE, (ty + 0.5) * TILE, 7) && circleFree(m, (tx + 1.5) * TILE, (ty + 0.5) * TILE, 7))
          slow = { x: (tx + 0.5) * TILE, y: (ty + 0.5) * TILE };
    expect(slow).toBeTruthy();
    if (!slow) return;
    const params = { radius: 7, speed: 100, moveMul: 1, canDodge: false, dodgeCost: 0, dodgeSpeed: 0, dodgeTicks: 0, dodgeCooldown: 0, slowFloorMul: 0.8 };
    const st = { x: slow.x, y: slow.y, fvx: 0, fvy: 0, ft: 0, stamina: 100, dodgeCd: 0 };
    stepMovement(st, { seq: 1, mx: 1, my: 0, ax: 0, ay: 0, held: 0, pressed: 0 }, params, m);
    expect(st.x - slow.x).toBeCloseTo((100 * 0.8) / 30, 3);
  });
});

describe('configurações salvas', () => {
  it('normaliza valores do disco: faixas, escala de pixels e teclas inválidas', () => {
    const s = normalizeSettings({ volumeMaster: 5, port: 80, pixelScale: 'fit', shake: -1, brightness: 2, keys: { q: 'KeyZ', e: '<script>' } });
    expect(s.volumeMaster).toBe(1);
    expect(s.port).toBe(1024);
    expect(s.pixelScale).toBe('fit');
    expect(s.shake).toBe(0);
    expect(s.brightness).toBe(1);
    expect(s.keys.q).toBe('KeyZ');
    expect(s.keys.e).toBe(DEFAULT_KEYS.e);
    expect(normalizeSettings({ pixelScale: 'qualquer' }).pixelScale).toBe('integer');
    expect(normalizeSettings('lixo').port).toBe(7777);
    expect(normalizeSettings('lixo').brightness).toBe(0);
    expect(normalizeSettings('lixo').enhancedLighting).toBe(false);
    expect(normalizeSettings({ enhancedLighting: true }).enhancedLighting).toBe(true);
    expect(normalizeSettings({ enhancedLighting: 'true' }).enhancedLighting).toBe(false);
  });
});
