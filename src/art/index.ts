/** Ponto único que gera todas as folhas de sprites (usado pelo jogo e pela exportação). */
import { CLASS_IDS } from '../shared/config/classes.js';
import { buildClassSheet, buildWeapons } from './characters.js';
import { buildEnemySheets } from './enemies.js';
import { climateSheet } from './extra.js';
import { buildFxSheet } from './fx.js';
import { buildIconSheet } from './icons.js';
import type { Frame, PixelCanvas } from './pixel.js';

export interface BuiltSheet {
  canvas: PixelCanvas;
  frames: Record<string, Frame>;
}

export function buildAllSheets(): Record<string, BuiltSheet> {
  const out: Record<string, BuiltSheet> = {};
  for (const c of CLASS_IDS) out[`class_${c}`] = buildClassSheet(c).build(512);
  out.weapons = buildWeapons().build(256);
  out.fx = buildFxSheet().build(256);
  out.icons = buildIconSheet().build(256);
  for (const [k, sb] of Object.entries(buildEnemySheets())) out[k] = sb.build(k.startsWith('boss') ? 1024 : 512);
  // variantes de clima dos inimigos (capítulos II e III): prefixos w_ (inverno) e a_ (cinzas)
  for (const k of ['enemies_common', 'enemies_elite'] as const) {
    const src = out[k];
    if (!src) continue;
    out[`${k}_winter`] = climateSheet(src, 'winter', 'w_').build(512);
    out[`${k}_ash`] = climateSheet(src, 'ash', 'a_').build(512);
  }
  return out;
}
