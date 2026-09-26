/** Gera uma prancha de pré-visualização (frames escolhidos, ampliados) para inspeção visual. */
import fs from 'node:fs';
import { buildAllSheets } from '../src/art/index.js';
import { PixelCanvas } from '../src/art/pixel.js';
import { encodePNG } from './png.js';

const [out, filter, scaleArg, bgArg] = process.argv.slice(2);
const sheets = buildAllSheets();
const names: [string, string][] = [];
for (const [sn, s] of Object.entries(sheets)) for (const f of Object.keys(s.frames)) if (!filter || new RegExp(filter).test(f)) names.push([sn, f]);
const cellW = Math.max(...names.map(([s, f]) => sheets[s]!.frames[f]!.w)) + 4;
const cellH = Math.max(...names.map(([s, f]) => sheets[s]!.frames[f]!.h)) + 4;
const cols = Math.min(names.length, Math.max(1, Math.floor(1400 / (cellW * Number(scaleArg ?? 4)))));
const rows = Math.ceil(names.length / cols);
const c = new PixelCanvas(cols * cellW, rows * cellH);
c.rect(0, 0, c.w, c.h, Number(bgArg ?? 0x2a3040));
names.forEach(([sn, f], i) => {
  const s = sheets[sn]!;
  const fr = s.frames[f]!;
  c.blit(s.canvas, (i % cols) * cellW + 2, Math.floor(i / cols) * cellH + 2, false, fr.x, fr.y, fr.w, fr.h);
});
fs.writeFileSync(out as string, encodePNG(c.w, c.h, c.data, Number(scaleArg ?? 4)));
console.log(`${names.length} frames`);
