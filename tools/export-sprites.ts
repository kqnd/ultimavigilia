/** Exporta todas as folhas de sprites geradas por código para assets/sprites (PNG). */
import fs from 'node:fs';
import path from 'node:path';
import { buildAllSheets } from '../src/art/index.js';
import { encodePNG } from './png.js';

const out = process.argv[2] ?? 'assets/sprites';
const scale = Number(process.argv[3] ?? 1);
fs.mkdirSync(out, { recursive: true });
for (const [name, sheet] of Object.entries(buildAllSheets())) {
  const png = encodePNG(sheet.canvas.w, sheet.canvas.h, sheet.canvas.data, scale);
  fs.writeFileSync(path.join(out, `${name}.png`), png);
  fs.writeFileSync(path.join(out, `${name}.json`), JSON.stringify({ frames: sheet.frames }, null, 0));
  console.log(`${name}: ${sheet.canvas.w}×${sheet.canvas.h}, ${Object.keys(sheet.frames).length} frames`);
}
