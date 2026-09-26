/** Converte a arte gerada (PixelCanvas) em texturas Phaser, fonte bitmap e animações. */
import Phaser from 'phaser';
import { FONT_BASELINE, FONT_CELL_H, getFont } from '../../art/font.js';
import { buildAllSheets } from '../../art/index.js';
import { LIGHT_RADII, lightDisc } from '../../art/fx.js';
import type { PixelCanvas } from '../../art/pixel.js';
import { paintFloor, buildObjectSheet } from '../../art/tiles.js';
import type { MapId } from '../../shared/config/chapters.js';
import { getArena, getMap } from '../../shared/map.js';

export const FONT = 'vpx';

export function toCanvas(pc: PixelCanvas): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = pc.w;
  cv.height = pc.h;
  const ctx = cv.getContext('2d');
  if (ctx) ctx.putImageData(new ImageData(new Uint8ClampedArray(pc.data), pc.w, pc.h), 0, 0);
  return cv;
}

/** Frame → chave de textura (folha) para lookup rápido. */
export const frameSheet = new Map<string, string>();

function addSheet(scene: Phaser.Scene, key: string, pc: PixelCanvas, frames: Record<string, { x: number; y: number; w: number; h: number }>): void {
  if (scene.textures.exists(key)) return;
  const tex = scene.textures.addCanvas(key, toCanvas(pc));
  if (!tex) return;
  for (const [name, f] of Object.entries(frames)) {
    tex.add(name, 0, f.x, f.y, f.w, f.h);
    frameSheet.set(name, key);
  }
}

function addFont(scene: Phaser.Scene): void {
  if (scene.cache.bitmapFont.exists(FONT)) return;
  const font = getFont();
  const chars = [...font.keys()];
  const totalW = chars.reduce((s, ch) => s + (font.get(ch)?.w ?? 0) + 1, 0);
  const cv = document.createElement('canvas');
  cv.width = totalW;
  cv.height = FONT_CELL_H;
  const ctx = cv.getContext('2d') as CanvasRenderingContext2D;
  ctx.fillStyle = '#ffffff';
  const data: {
    retroFont: boolean;
    font: string;
    size: number;
    lineHeight: number;
    chars: Record<number, unknown>;
  } = { retroFont: true, font: FONT, size: FONT_CELL_H, lineHeight: FONT_CELL_H + 1, chars: {} };
  let x = 0;
  for (const ch of chars) {
    const g = font.get(ch);
    if (!g) continue;
    g.rows.forEach((row, y) => {
      for (let i = 0; i < row.length; i++) if (row[i] === '#') ctx.fillRect(x + i, y, 1, 1);
    });
    const w = g.w;
    data.chars[ch.codePointAt(0) ?? 0] = {
      x,
      y: 0,
      width: w,
      height: FONT_CELL_H,
      centerX: Math.floor(w / 2),
      centerY: Math.floor(FONT_CELL_H / 2),
      xOffset: 0,
      yOffset: 0,
      xAdvance: w + 1,
      data: {},
      kerning: {},
      u0: x / totalW,
      v0: 1,
      u1: (x + w) / totalW,
      v1: 0,
    };
    x += w + 1;
  }
  scene.textures.addCanvas(FONT, cv);
  scene.cache.bitmapFont.add(FONT, { data, frame: null, texture: FONT, fromAtlas: false });
  void FONT_BASELINE;
}

/** Chão pintado de um mapa (gerado sob demanda: ~0,3 s por mapa). */
export function ensureFloor(scene: Phaser.Scene, id: MapId): string {
  const key = `floor_${id}`;
  if (!scene.textures.exists(key)) scene.textures.addCanvas(key, toCanvas(paintFloor(getMap(id))));
  return key;
}

let built = false;
/** Gera (uma vez) todas as texturas. Retorna chave da textura do chão. */
export function ensureTextures(scene: Phaser.Scene): void {
  if (built && scene.textures.exists('floor_village')) return;
  const map = getArena();
  for (const [key, sheet] of Object.entries(buildAllSheets())) addSheet(scene, key, sheet.canvas, sheet.frames);
  const objs = buildObjectSheet(map).build(1024);
  addSheet(scene, 'objects', objs.canvas, objs.frames);
  ensureFloor(scene, 'village');
  for (const r of LIGHT_RADII) if (!scene.textures.exists(`light_${r}`)) scene.textures.addCanvas(`light_${r}`, toCanvas(lightDisc(r)));
  // névoa: ruído pixelado em blocos
  if (!scene.textures.exists('fog')) {
    const cv = document.createElement('canvas');
    cv.width = 256;
    cv.height = 256;
    const ctx = cv.getContext('2d') as CanvasRenderingContext2D;
    for (let y = 0; y < 256; y += 4)
      for (let x = 0; x < 256; x += 4) {
        const n = Math.sin(x * 0.045 + Math.sin(y * 0.03) * 2) * Math.cos(y * 0.05 + Math.sin(x * 0.02)) * 0.5 + 0.5;
        const a = n > 0.62 ? 0.5 : n > 0.48 ? 0.25 : 0;
        if (a > 0) {
          ctx.fillStyle = `rgba(125,160,207,${a})`;
          ctx.fillRect(x, y, 4, 4);
        }
      }
    scene.textures.addCanvas('fog', cv);
  }
  addFont(scene);
  built = true;
}

/** Retorna [textura, frame] para um nome de frame. */
export function tf(frame: string): [string, string] {
  return [frameSheet.get(frame) ?? '__MISSING', frame];
}

/** Posiciona BitmapText em coordenadas inteiras (evita perder colunas de glifos em meio-pixel). */
export function placeText(t: { width: number; height: number; scaleX: number; setOrigin(x: number, y: number): unknown; setPosition(x: number, y: number): unknown }, x: number, y: number, ox = 0, oy = 0): void {
  t.setOrigin(0, 0);
  t.setPosition(Math.round(x - t.width * ox), Math.round(y - t.height * oy));
}

/**
 * Origem "pixel perfect": centraliza na horizontal arredondando para baixo, para que a borda
 * esquerda caia sempre em coluna inteira mesmo com largura ímpar (origem 0,5 em largura ímpar
 * deixava estruturas meio pixel fora da grade e com bordas borradas/irregulares).
 */
export function pixelOrigin<T extends { width: number; height: number; setOrigin(x: number, y: number): unknown }>(img: T, bottomInset = 0): T {
  const w = Math.max(1, img.width);
  const h = Math.max(1, img.height);
  img.setOrigin(Math.floor(w / 2) / w, (h - bottomInset) / h);
  return img;
}
