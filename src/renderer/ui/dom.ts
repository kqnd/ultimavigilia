/** Mini-helpers de DOM (sem framework). */
import { buildClassSheet } from '../../art/characters.js';
import { iconCanvas } from '../../art/icons.js';
import type { PixelCanvas } from '../../art/pixel.js';
import type { ClassId } from '../../shared/config/classes.js';
import { audio } from '../audio.js';

type Attrs = Record<string, string | number | boolean | ((e: Event) => void) | undefined>;
type Child = Node | string | null | undefined | false;

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') {
      const ev = k.slice(2).toLowerCase();
      el.addEventListener(ev, (e) => {
        if (ev === 'click') audio.play('uiClick');
        (v as (e: Event) => void)(e);
      });
    } else if (k === 'class') el.className = String(v);
    else if (k === 'style') el.setAttribute('style', String(v));
    else if (k === 'text') el.textContent = String(v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, String(v));
  }
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    el.append(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  if (el instanceof HTMLButtonElement) el.addEventListener('mouseenter', () => audio.play('uiHover'));
  return el;
}

export function pcToCanvas(pc: PixelCanvas, scale = 1): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = pc.w * scale;
  cv.height = pc.h * scale;
  const ctx = cv.getContext('2d') as CanvasRenderingContext2D;
  const tmp = document.createElement('canvas');
  tmp.width = pc.w;
  tmp.height = pc.h;
  (tmp.getContext('2d') as CanvasRenderingContext2D).putImageData(new ImageData(new Uint8ClampedArray(pc.data), pc.w, pc.h), 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(tmp, 0, 0, cv.width, cv.height);
  return cv;
}

export function iconEl(name: string, scale = 1): HTMLCanvasElement {
  const c = pcToCanvas(iconCanvas(name), scale);
  c.style.width = `${16 * scale}px`;
  c.style.height = `${16 * scale}px`;
  return c;
}

const sheets = new Map<ClassId, ReturnType<ReturnType<typeof buildClassSheet>['build']>>();
/** Canvas com o sprite animado (idle/walk) de uma classe. */
export function classSprite(cls: ClassId, scale = 1, anim: 'idle' | 'walk' = 'idle'): HTMLCanvasElement {
  let sheet = sheets.get(cls);
  if (!sheet) {
    sheet = buildClassSheet(cls).build(512);
    sheets.set(cls, sheet);
  }
  const s = sheet;
  const cv = document.createElement('canvas');
  cv.width = 32 * scale;
  cv.height = 32 * scale;
  cv.style.width = `${32 * scale}px`;
  cv.style.height = `${32 * scale}px`;
  const ctx = cv.getContext('2d') as CanvasRenderingContext2D;
  ctx.imageSmoothingEnabled = false;
  const full = pcToCanvas(s.canvas);
  let i = 0;
  const frames = anim === 'idle' ? ['idle_down_0', 'idle_down_1'] : ['walk_down_0', 'walk_down_1', 'walk_down_2', 'walk_down_3', 'walk_side_0', 'walk_side_1', 'walk_side_2', 'walk_side_3'];
  const draw = (): void => {
    if (!cv.isConnected && i > 0) return;
    const f = s.frames[`${cls}_${frames[i % frames.length]}`];
    ctx.clearRect(0, 0, cv.width, cv.height);
    if (f) ctx.drawImage(full, f.x, f.y, f.w, f.h, 0, 0, f.w * scale, f.h * scale);
    i++;
    setTimeout(draw, anim === 'idle' ? 480 : 140);
  };
  draw();
  return cv;
}

export function stars(n: number): string {
  return '★'.repeat(n) + '☆'.repeat(3 - n);
}
