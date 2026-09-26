import { describe, expect, it } from 'vitest';
import { reflectionAlpha } from '../src/renderer/game/graphics-quality.js';
import { TILE } from '../src/shared/constants.js';
import { Floor, getMap } from '../src/shared/map.js';

describe('efeitos gráficos opcionais', () => {
  it('reflete só em superfícies coerentes das três temáticas', () => {
    for (const [id, floor] of [['village', Floor.Cobble], ['frozen', Floor.FrozenStone], ['abyss', Floor.Marble]] as const) {
      const map = getMap(id);
      const index = map.floor.findIndex((v) => v === floor);
      expect(index).toBeGreaterThanOrEqual(0);
      const x = ((index % map.w) + 0.5) * TILE;
      const y = (Math.floor(index / map.w) + 0.5) * TILE;
      expect(reflectionAlpha(map, x, y)).toBeGreaterThan(0);
    }
    const map = getMap('village');
    expect(reflectionAlpha(map, -1, 0)).toBe(0);
    const grass = map.floor.findIndex((v) => v === Floor.Grass);
    expect(reflectionAlpha(map, ((grass % map.w) + 0.5) * TILE, (Math.floor(grass / map.w) + 0.5) * TILE)).toBe(0);
  });
});
