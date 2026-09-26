/** Gera assets/public/fonts/vigilia-pixel.ttf a partir dos glifos de src/art/font.ts. */
import fs from 'node:fs';
import opentype from 'opentype.js';
import { FONT_BASELINE, FONT_CELL_H, getFont } from '../src/art/font.js';

const U = 100; // unidades por pixel
const glyphs: opentype.Glyph[] = [new opentype.Glyph({ name: '.notdef', unicode: 0, advanceWidth: 4 * U, path: new opentype.Path() })];
for (const [ch, g] of getFont()) {
  const path = new opentype.Path();
  g.rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      if (row[x] !== '#') continue;
      const top = (FONT_BASELINE - y) * U;
      path.moveTo(x * U, top);
      path.lineTo(x * U, top - U);
      path.lineTo((x + 1) * U, top - U);
      path.lineTo((x + 1) * U, top);
      path.close();
    }
  });
  glyphs.push(new opentype.Glyph({ name: `u${ch.codePointAt(0)?.toString(16)}`, unicode: ch.codePointAt(0) ?? 0, advanceWidth: (g.w + 1) * U, path }));
}
const font = new opentype.Font({
  familyName: 'Vigilia Pixel',
  styleName: 'Regular',
  unitsPerEm: FONT_CELL_H * U,
  ascender: FONT_BASELINE * U,
  descender: -(FONT_CELL_H - FONT_BASELINE) * U,
  glyphs,
});
fs.mkdirSync('src/renderer/fonts', { recursive: true });
fs.mkdirSync('assets/fonts', { recursive: true });
fs.writeFileSync('src/renderer/fonts/vigilia-pixel.ttf', Buffer.from(font.toArrayBuffer()));
fs.copyFileSync('src/renderer/fonts/vigilia-pixel.ttf', 'assets/fonts/vigilia-pixel.ttf');
console.log(`fonte gerada com ${glyphs.length} glifos`);
