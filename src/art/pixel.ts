/**
 * Tela de pixels independente de DOM. Toda a arte do jogo é gerada aqui a partir de
 * matrizes e primitivas determinísticas; o renderer converte para texturas e as
 * ferramentas exportam PNGs em assets/sprites.
 */

export type Color = number; // 0xRRGGBB
export const T = -1; // transparente

export class PixelCanvas {
  readonly data: Uint8ClampedArray;
  constructor(
    readonly w: number,
    readonly h: number,
  ) {
    this.data = new Uint8ClampedArray(w * h * 4);
  }

  inb(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.w && y < this.h;
  }

  set(x: number, y: number, c: Color, a = 255): void {
    x |= 0;
    y |= 0;
    if (!this.inb(x, y) || c === T) return;
    const i = (y * this.w + x) * 4;
    if (a >= 255) {
      this.data[i] = (c >> 16) & 255;
      this.data[i + 1] = (c >> 8) & 255;
      this.data[i + 2] = c & 255;
      this.data[i + 3] = 255;
    } else {
      // mistura simples sobre o que existe
      const ia = this.data[i + 3] as number;
      const fa = a / 255;
      const outA = fa + (ia / 255) * (1 - fa);
      const mix = (src: number, dst: number): number => (outA === 0 ? 0 : (src * fa + dst * (ia / 255) * (1 - fa)) / outA);
      this.data[i] = mix((c >> 16) & 255, this.data[i] as number);
      this.data[i + 1] = mix((c >> 8) & 255, this.data[i + 1] as number);
      this.data[i + 2] = mix(c & 255, this.data[i + 2] as number);
      this.data[i + 3] = outA * 255;
    }
  }

  get(x: number, y: number): Color {
    if (!this.inb(x, y)) return T;
    const i = (y * this.w + x) * 4;
    if ((this.data[i + 3] as number) === 0) return T;
    return ((this.data[i] as number) << 16) | ((this.data[i + 1] as number) << 8) | (this.data[i + 2] as number);
  }

  alpha(x: number, y: number): number {
    if (!this.inb(x, y)) return 0;
    return this.data[(y * this.w + x) * 4 + 3] as number;
  }

  clear(x: number, y: number): void {
    if (!this.inb(x, y)) return;
    this.data.fill(0, (y * this.w + x) * 4, (y * this.w + x) * 4 + 4);
  }

  rect(x: number, y: number, w: number, h: number, c: Color, a = 255): void {
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) this.set(xx, yy, c, a);
  }

  hline(x0: number, x1: number, y: number, c: Color): void {
    for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) this.set(x, y, c);
  }

  vline(x: number, y0: number, y1: number, c: Color): void {
    for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) this.set(x, y, c);
  }

  line(x0: number, y0: number, x1: number, y1: number, c: Color, a = 255): void {
    x0 = Math.round(x0);
    y0 = Math.round(y0);
    x1 = Math.round(x1);
    y1 = Math.round(y1);
    const dx = Math.abs(x1 - x0);
    const dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (let guard = 0; guard < 4096; guard++) {
      this.set(x0, y0, c, a);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        x0 += sx;
      }
      if (e2 <= dx) {
        err += dx;
        y0 += sy;
      }
    }
  }

  /** Elipse preenchida (centro cx,cy; raios rx,ry). */
  ellipse(cx: number, cy: number, rx: number, ry: number, c: Color, a = 255): void {
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        const dx = (x + 0.5 - cx) / rx;
        const dy = (y + 0.5 - cy) / ry;
        if (dx * dx + dy * dy <= 1) this.set(x, y, c, a);
      }
    }
  }

  /** Anel (contorno de círculo) com espessura. */
  ring(cx: number, cy: number, r: number, thick: number, c: Color, a = 255): void {
    for (let y = Math.floor(cy - r - 1); y <= Math.ceil(cy + r + 1); y++) {
      for (let x = Math.floor(cx - r - 1); x <= Math.ceil(cx + r + 1); x++) {
        const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
        if (d <= r && d > r - thick) this.set(x, y, c, a);
      }
    }
  }

  /** Desenha uma matriz de caracteres usando um mapa de cores. '.' e ' ' são transparentes. */
  matrix(rows: readonly string[], pal: Readonly<Record<string, Color>>, ox: number, oy: number, flipX = false): void {
    const w = rows.reduce((m, r) => Math.max(m, r.length), 0);
    rows.forEach((row, y) => {
      for (let i = 0; i < row.length; i++) {
        const ch = row[i] as string;
        if (ch === '.' || ch === ' ') continue;
        const c = pal[ch];
        if (c === undefined) continue;
        const x = flipX ? w - 1 - i : i;
        this.set(ox + x, oy + y, c);
      }
    });
  }

  blit(src: PixelCanvas, dx: number, dy: number, flipX = false, sx = 0, sy = 0, sw = src.w, sh = src.h): void {
    for (let y = 0; y < sh; y++) {
      for (let x = 0; x < sw; x++) {
        const xx = flipX ? sw - 1 - x : x;
        const i = ((sy + y) * src.w + (sx + xx)) * 4;
        const a = src.data[i + 3] as number;
        if (a === 0) continue;
        const c = ((src.data[i] as number) << 16) | ((src.data[i + 1] as number) << 8) | (src.data[i + 2] as number);
        this.set(dx + x, dy + y, c, a);
      }
    }
  }

  /** Contorno externo de 1px (selout simples) ao redor de pixels opacos. */
  outline(c: Color, diagonals = false): void {
    const add: number[] = [];
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        if (this.alpha(x, y) > 0) continue;
        const n =
          this.alpha(x - 1, y) > 128 || this.alpha(x + 1, y) > 128 || this.alpha(x, y - 1) > 128 || this.alpha(x, y + 1) > 128 ||
          (diagonals && (this.alpha(x - 1, y - 1) > 128 || this.alpha(x + 1, y - 1) > 128 || this.alpha(x - 1, y + 1) > 128 || this.alpha(x + 1, y + 1) > 128));
        if (n) add.push(x, y);
      }
    }
    for (let i = 0; i < add.length; i += 2) this.set(add[i] as number, add[i + 1] as number, c);
  }

  /** Substitui cores (paleta de troca). */
  recolor(map: ReadonlyMap<Color, Color>): void {
    for (let y = 0; y < this.h; y++)
      for (let x = 0; x < this.w; x++) {
        const c = this.get(x, y);
        if (c === T) continue;
        const r = map.get(c);
        if (r !== undefined) this.set(x, y, r, this.alpha(x, y));
      }
  }

  /** Silhueta branca (flash de dano). */
  silhouette(c: Color = 0xffffff): PixelCanvas {
    const out = new PixelCanvas(this.w, this.h);
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) if (this.alpha(x, y) > 0) out.set(x, y, c, this.alpha(x, y));
    return out;
  }

  clone(): PixelCanvas {
    const o = new PixelCanvas(this.w, this.h);
    o.data.set(this.data);
    return o;
  }

  /** Rotação de 90° no sentido horário. */
  rot90(): PixelCanvas {
    const o = new PixelCanvas(this.h, this.w);
    for (let y = 0; y < this.h; y++)
      for (let x = 0; x < this.w; x++) {
        const i = (y * this.w + x) * 4;
        const j = (x * o.w + (o.w - 1 - y)) * 4;
        o.data[j] = this.data[i] as number;
        o.data[j + 1] = this.data[i + 1] as number;
        o.data[j + 2] = this.data[i + 2] as number;
        o.data[j + 3] = this.data[i + 3] as number;
      }
    return o;
  }

  /** Rotação arbitrária por amostragem do vizinho mais próximo (mantém pixels nítidos). */
  rotated(angle: number, size = Math.ceil(Math.hypot(this.w, this.h))): PixelCanvas {
    const o = new PixelCanvas(size, size);
    const cx = this.w / 2;
    const cy = this.h / 2;
    const oc = size / 2;
    const cos = Math.cos(-angle);
    const sin = Math.sin(-angle);
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        const dx = x + 0.5 - oc;
        const dy = y + 0.5 - oc;
        const sx = Math.floor(dx * cos - dy * sin + cx);
        const sy = Math.floor(dx * sin + dy * cos + cy);
        if (!this.inb(sx, sy)) continue;
        const i = (sy * this.w + sx) * 4;
        if ((this.data[i + 3] as number) === 0) continue;
        const j = (y * size + x) * 4;
        o.data[j] = this.data[i] as number;
        o.data[j + 1] = this.data[i + 1] as number;
        o.data[j + 2] = this.data[i + 2] as number;
        o.data[j + 3] = this.data[i + 3] as number;
      }
    return o;
  }
}

/** Hash determinístico para ruído/dithering. */
export function noise(x: number, y: number, seed = 0): number {
  let h = (x * 374761393 + y * 668265263 + seed * 982451653) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Dithering ordenado 4×4 (Bayer). */
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
export const bayer = (x: number, y: number): number => (BAYER[(y & 3) * 4 + (x & 3)] as number) / 16;

export function mix(a: Color, b: Color, t: number): Color {
  const r = Math.round(((a >> 16) & 255) * (1 - t) + ((b >> 16) & 255) * t);
  const g = Math.round(((a >> 8) & 255) * (1 - t) + ((b >> 8) & 255) * t);
  const bl = Math.round((a & 255) * (1 - t) + (b & 255) * t);
  return (r << 16) | (g << 8) | bl;
}

// ------------------------------------------------------------------ folhas de sprites

export interface Frame {
  x: number;
  y: number;
  w: number;
  h: number;
}

export class SheetBuilder {
  private frames = new Map<string, { c: PixelCanvas }>();
  add(name: string, c: PixelCanvas): void {
    this.frames.set(name, { c });
  }
  has(name: string): boolean {
    return this.frames.has(name);
  }
  /** Empacota em linhas (frames de mesmo tamanho ficam alinhados). */
  build(maxWidth = 1024): { canvas: PixelCanvas; frames: Record<string, Frame> } {
    const entries = [...this.frames.entries()];
    let x = 0;
    let y = 0;
    let rowH = 0;
    const pos: [string, number, number, PixelCanvas][] = [];
    for (const [name, { c }] of entries) {
      if (x + c.w > maxWidth) {
        x = 0;
        y += rowH + 1;
        rowH = 0;
      }
      pos.push([name, x, y, c]);
      x += c.w + 1;
      rowH = Math.max(rowH, c.h);
    }
    const H = y + rowH;
    const W = Math.min(maxWidth, Math.max(1, ...pos.map(([, px, , c]) => px + c.w)));
    const canvas = new PixelCanvas(W, Math.max(1, H));
    const frames: Record<string, Frame> = {};
    for (const [name, px, py, c] of pos) {
      canvas.blit(c, px, py);
      frames[name] = { x: px, y: py, w: c.w, h: c.h };
    }
    return { canvas, frames };
  }
}
