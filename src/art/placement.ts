/** Onde cada objeto do mapa é desenhado (ancorado pela base) e qual quadro usa. */
import { TILE } from '../shared/constants.js';
import { type ArenaMap, type MapObject, Obst, obstAt } from '../shared/map.js';
import { noise } from './pixel.js';

export interface Placed {
  key: string;
  /** Centro-x e base-y em pixels de mundo. */
  x: number;
  y: number;
  /** Profundidade para y-sort (base do objeto). */
  depth: number;
  tall: boolean;
  animated: 'fire' | 'fire_w' | 'fire_a' | 'torch' | null;
  flipX: boolean;
  /** Índice do quebrável (caixas/barris). */
  breakIdx?: number;
}

export function placeObjects(map: ArenaMap): Placed[] {
  const out: Placed[] = [];
  const cs = map.climate === 'winter' ? '_w' : map.climate === 'ash' ? '_a' : '';
  const add = (o: MapObject, key: string, tall: boolean, animated: Placed['animated'] = null, dy = 0, flipX = false, breakIdx = -1): void => {
    const x = (o.tx + o.tw / 2) * TILE;
    const y = (o.ty + o.th) * TILE + dy;
    out.push({ key, x, y, depth: y, tall, animated, flipX, ...(breakIdx !== undefined && breakIdx >= 0 ? { breakIdx } : {}) });
  };
  for (const o of map.objects) {
    switch (o.kind) {
      case Obst.House:
        add(o, `house_${o.tw}x${o.th}_${o.variant}`, true);
        break;
      case Obst.Ruin: {
        const l = obstAt(map, o.tx - 1, o.ty) === Obst.Ruin ? 1 : 0;
        const r = obstAt(map, o.tx + 1, o.ty) === Obst.Ruin ? 1 : 0;
        add(o, `ruin_${o.variant}_${l}${r}`, true);
        break;
      }
      case Obst.Tree:
        add(o, `tree${cs}_${o.variant}`, true, null, -2, noise(o.tx, o.ty, 5) > 0.5);
        break;
      case Obst.Tomb:
        add(o, map.climate === 'winter' ? `tomb_w_${o.variant}` : `tomb_${o.variant}`, false, null, -4);
        break;
      case Obst.Hedge: {
        const l = obstAt(map, o.tx - 1, o.ty) === Obst.Hedge ? 1 : 0;
        const r = obstAt(map, o.tx + 1, o.ty) === Obst.Hedge ? 1 : 0;
        add(o, `hedge_${o.variant}_${l}${r}`, true);
        break;
      }
      case Obst.Wall: {
        const l = obstAt(map, o.tx - 1, o.ty) === Obst.Wall ? 1 : 0;
        const r = obstAt(map, o.tx + 1, o.ty) === Obst.Wall ? 1 : 0;
        add(o, `wall_${o.variant}_${l}${r}`, true);
        break;
      }
      case Obst.Pillar:
        add(o, 'pillar', true, null, -2);
        break;
      case Obst.Obelisk:
        add(o, `obelisk_${o.variant}`, true, null, -2);
        break;
      case Obst.Statue:
        add(o, `statue_${o.variant}`, true, null, -2);
        break;
      case Obst.Fissure: {
        // rente ao chão: desenhado como decalque (profundidade baixa)
        const x = (o.tx + 0.5) * TILE;
        const y = (o.ty + 1) * TILE;
        out.push({ key: `fissure_${o.variant}`, x, y, depth: -9500, tall: false, animated: null, flipX: false });
        break;
      }
      case Obst.Fence:
        add(o, o.variant === 1 ? 'fence_h' : 'fence_v', false, null, o.variant === 1 ? -6 : 0);
        break;
      case Obst.Crypt:
        add(o, o.variant === 1 ? 'crypt_w' : 'crypt', true);
        break;
      case Obst.Fire:
        add(o, o.variant === 1 ? 'fire_w_0' : o.variant === 2 ? 'fire_a_0' : 'fire_0', false, o.variant === 1 ? 'fire_w' : o.variant === 2 ? 'fire_a' : 'fire', -4);
        break;
      case Obst.Torch:
        add(o, 'torch_0', false, 'torch', -6);
        break;
      case Obst.Well:
        add(o, 'well', false, null, -2);
        break;
      case Obst.Crate:
        add(o, `crate${cs}`, false, null, -4, false, map.breakIdx[o.ty * map.w + o.tx]);
        break;
      case Obst.Barrel:
        add(o, `barrel${cs}`, false, null, -4, false, map.breakIdx[o.ty * map.w + o.tx]);
        break;
      default:
        break;
    }
  }
  // árvores escuras na borda (uma a cada tile com variação)
  for (let ty = 0; ty < map.h; ty++)
    for (let tx = 0; tx < map.w; tx++) {
      if (obstAt(map, tx, ty) !== Obst.Border) continue;
      if (noise(tx, ty, 77) < 0.35) continue;
      const x = (tx + 0.5) * TILE + (noise(tx, ty, 78) - 0.5) * 12;
      const y = (ty + 1) * TILE - 2;
      out.push({ key: `border${cs}_${Math.floor(noise(tx, ty, 79) * 3)}`, x, y, depth: y, tall: true, animated: null, flipX: noise(tx, ty, 80) > 0.5 });
    }
  return out;
}
