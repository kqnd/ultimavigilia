/** Renderiza uma arena completa (chão + objetos, sem luz) para inspeção. Uso: map-preview.ts <saida.png> [village|frozen|abyss] */
import fs from 'node:fs';
import type { MapId } from '../src/shared/config/chapters.js';
import { PixelCanvas } from '../src/art/pixel.js';
import { placeObjects } from '../src/art/placement.js';
import { buildObjectSheet, paintFloor } from '../src/art/tiles.js';
import { getMap } from '../src/shared/map.js';
import { encodePNG } from './png.js';

const [out, id = 'village', x0, y0, w, h, scale] = process.argv.slice(2);
const map = getMap(id as MapId);
const floor = paintFloor(map);
const sheet = buildObjectSheet(getMap('village')).build(1024);
const c = new PixelCanvas(floor.w, floor.h);
c.blit(floor, 0, 0);
for (const p of placeObjects(map).sort((a, b) => a.depth - b.depth)) {
  const f = sheet.frames[p.key];
  if (!f) {
    console.warn('sem quadro:', p.key);
    continue;
  }
  c.blit(sheet.canvas, Math.round(p.x - f.w / 2), Math.round(p.y - f.h), p.flipX, f.x, f.y, f.w, f.h);
}
const X = Number(x0 ?? 0), Y = Number(y0 ?? 0), W = Number(w ?? c.w), H = Number(h ?? c.h);
const crop = new PixelCanvas(W, H);
crop.blit(c, 0, 0, false, X, Y, W, H);
fs.writeFileSync(out ?? 'map.png', encodePNG(W, H, crop.data, Number(scale ?? 1)));
