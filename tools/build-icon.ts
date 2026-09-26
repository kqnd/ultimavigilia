/** Gera build/icon.png (256×256) em pixel art a partir da fogueira do jogo. */
import fs from 'node:fs';
import { P } from '../src/art/palette.js';
import { PixelCanvas } from '../src/art/pixel.js';
import { buildObjectSheet } from '../src/art/tiles.js';
import { getArena } from '../src/shared/map.js';
import { encodePNG } from './png.js';

const c = new PixelCanvas(64, 64);
c.ellipse(32, 32, 31, 31, P.outline);
c.ellipse(32, 32, 29.5, 29.5, P.blue1);
c.ellipse(32, 38, 22, 12, P.blue2);
c.ring(32, 32, 30, 1, P.amb2);
const sheet = buildObjectSheet(getArena()).build(1024);
const f = sheet.frames['fire_2'];
if (f) c.blit(sheet.canvas, 0, -8, false, f.x, f.y, f.w, f.h);
fs.mkdirSync('build', { recursive: true });
fs.writeFileSync('build/icon.png', encodePNG(64, 64, c.data, 4));
console.log('build/icon.png gerado');
