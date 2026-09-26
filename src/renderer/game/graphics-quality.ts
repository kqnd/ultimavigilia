import { Floor, type ArenaMap } from '../../shared/map.js';
import { TILE } from '../../shared/constants.js';

/** Reflexo só em pedra molhada, gelo polido ou mármore; nunca em terra/grama. */
export function reflectionAlpha(map: ArenaMap, x: number, y: number): number {
  const tx = Math.floor(x / TILE);
  const ty = Math.floor(y / TILE);
  if (tx < 0 || ty < 0 || tx >= map.w || ty >= map.h) return 0;
  const floor = map.floor[ty * map.w + tx];
  if (floor === Floor.Cobble) return 0.28;
  if (floor === Floor.FrozenStone) return 0.33;
  if (floor === Floor.Marble) return 0.4;
  return 0;
}
