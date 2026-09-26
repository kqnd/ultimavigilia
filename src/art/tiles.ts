/**
 * Cenário: chão pintado por pixel (transições orgânicas entre tipos) e objetos altos
 * (casas, ruínas, árvores, cripta, túmulos...). Tons escuros e pouco contrastados.
 */
import { TILE } from '../shared/constants.js';
import { type ArenaMap, Floor, Obst } from '../shared/map.js';
import { bayer, type Color, mix, noise, PixelCanvas, SheetBuilder } from './pixel.js';
import { P } from './palette.js';
import { climatize } from './extra.js';

// ---------------------------------------------------------------- chão

function grass(x: number, y: number): Color {
  const n = noise(x >> 3, y >> 3, 1) * 0.6 + noise(x >> 1, y >> 1, 2) * 0.4;
  let c: Color = n > 0.62 ? P.grn2 : n > 0.3 ? mix(P.grn1, P.blue1, 0.35) : mix(P.grn1, P.blue0, 0.5);
  // tufos
  if (noise(x, y >> 1, 3) > 0.93 && noise(x >> 2, y >> 2, 4) > 0.4) c = P.grn3;
  return c;
}

function cobble(x: number, y: number): Color {
  const row = Math.floor(y / 7);
  const off = (row % 2) * 5;
  const col = Math.floor((x + off) / 10);
  const lx = (x + off) % 10;
  const ly = y % 7;
  const n = noise(col, row, 5);
  if (n > 0.93) return grass(x, y); // pedra faltando
  if (lx === 0 || ly === 0) return mix(P.gray0, P.blue0, 0.4);
  let c: Color = n > 0.66 ? P.gray2 : n > 0.33 ? mix(P.gray1, P.blue2, 0.3) : P.gray1;
  if (ly === 1 && lx > 1) c = mix(c, P.gray3, 0.35);
  if (ly === 6 || lx === 9) c = mix(c, P.ink, 0.25);
  if (noise(x, y, 6) > 0.97) c = P.grn2;
  return c;
}

function dirt(x: number, y: number): Color {
  const n = noise(x >> 2, y >> 2, 7) * 0.7 + noise(x, y, 8) * 0.3;
  let c: Color = n > 0.6 ? mix(P.brn2, P.blue1, 0.55) : n > 0.25 ? mix(P.brn1, P.blue1, 0.45) : mix(P.brn1, P.blue0, 0.55);
  if (noise(x, y, 9) > 0.975) c = P.gray3;
  return c;
}

function soil(x: number, y: number): Color {
  const n = noise(x >> 2, y >> 2, 10) * 0.6 + noise(x, y, 11) * 0.4;
  let c: Color = n > 0.62 ? mix(P.pur1, P.brn2, 0.4) : n > 0.28 ? mix(P.pur1, P.brn1, 0.5) : P.pur0;
  if (noise(x, y >> 1, 12) > 0.95) c = mix(P.grn2, P.pur1, 0.5);
  return c;
}

// --- inverno
/** Ruído de valor suavizado (bilinear) em células de `cell` px: manchas amplas sem "chuvisco". */
function smooth(x: number, y: number, cell: number, seed: number): number {
  const gx = Math.floor(x / cell);
  const gy = Math.floor(y / cell);
  const fx = (x - gx * cell) / cell;
  const fy = (y - gy * cell) / cell;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const a = noise(gx, gy, seed);
  const b = noise(gx + 1, gy, seed);
  const c = noise(gx, gy + 1, seed);
  const d = noise(gx + 1, gy + 1, seed);
  return (a + (b - a) * sx) * (1 - sy) + (c + (d - c) * sx) * sy;
}

const SNOW_LIGHT = mix(P.gray5, P.ice2, 0.22);
const SNOW_MID = mix(P.gray4, P.ice1, 0.3);
const SNOW_SHADE = mix(P.gray4, P.blue4, 0.42);

function snow(x: number, y: number): Color {
  // montes amplos com transição pontilhada; sulcos de vento finos e raros cristais
  const n = smooth(x, y, 28, 201) * 0.7 + smooth(x, y, 9, 202) * 0.3 + (bayer(x, y) - 0.5) * 0.12;
  let c: Color = n > 0.6 ? SNOW_LIGHT : n > 0.36 ? SNOW_MID : SNOW_SHADE;
  if (Math.sin(x * 0.07 + y * 0.42 + smooth(x, y, 40, 215) * 7) > 0.96) c = mix(c, P.blue4, 0.22);
  if (noise(x, y, 203) > 0.996) c = mix(P.gray6, P.ice3, 0.5); // cristal
  return c;
}

function deepSnow(x: number, y: number): Color {
  // neve funda: mais clara e com sulcos ondulados regulares (leitura de "terreno lento")
  const ridge = Math.sin(x * 0.16 + Math.sin(y * 0.09) * 2.4 + y * 0.05) > 0.78;
  const n = smooth(x, y, 12, 204) + (bayer(x, y) - 0.5) * 0.15;
  let c: Color = n > 0.5 ? mix(P.gray6, P.ice3, 0.15) : mix(P.gray5, P.ice2, 0.3);
  if (ridge) c = mix(P.gray4, P.ice1, 0.35);
  return c;
}

function frozenStone(x: number, y: number): Color {
  const c = cobble(x, y);
  return mix(c, smooth(x, y, 20, 205) > 0.66 ? P.ice2 : P.ice1, 0.3);
}

// --- deserto de cinzas / mansão
const SAND0 = 0x5e4a3a;
const SAND1 = 0x7a604a;
const SAND2 = 0x94785a;
function sand(x: number, y: number): Color {
  const ripple = Math.sin(y * 0.42 + Math.sin(x * 0.07) * 3 + smooth(x, y, 48, 206) * 5) > 0.84;
  const n = smooth(x, y, 26, 207) * 0.7 + smooth(x, y, 8, 208) * 0.3 + (bayer(x, y) - 0.5) * 0.12;
  let c: Color = n > 0.6 ? SAND2 : n > 0.36 ? SAND1 : SAND0;
  if (ripple) c = mix(c, P.ink, 0.22);
  if (noise(x, y, 209) > 0.992) c = P.gray3;
  return c;
}

function quicksand(x: number, y: number): Color {
  // redemoinhos concêntricos por célula: perigo legível
  const cx = ((x >> 5) << 5) + 16;
  const cy = ((y >> 5) << 5) + 16;
  const d = Math.hypot(x - cx, (y - cy) * 1.3);
  const ring = Math.sin(d * 0.55 - noise(x >> 5, y >> 5, 210) * 6) > 0.55;
  let c: Color = mix(SAND0, P.brn1, 0.5);
  if (ring) c = mix(SAND1, P.amb1, 0.25);
  if (d < 3) c = P.brn0;
  return c;
}

function marble(x: number, y: number): Color {
  const tx = x >> 4;
  const ty = y >> 4;
  const dark = (tx + ty) % 2 === 0;
  let c: Color = dark ? mix(P.gray1, P.pur1, 0.45) : mix(P.gray2, P.pur2, 0.4);
  // veios curvos e esparsos
  if (smooth(x, y, 64, 216) > 0.6 && Math.abs(smooth(x, y, 36, 211) - 0.5) < 0.01) c = mix(c, P.gray4, 0.35);
  if ((x & 15) === 0 || (y & 15) === 0) c = mix(c, P.ink, 0.3);
  return c;
}

function ashRock(x: number, y: number): Color {
  const n = noise(x >> 2, y >> 2, 212) * 0.7 + noise(x, y, 213) * 0.3;
  let c: Color = n > 0.6 ? mix(P.gray2, P.brn2, 0.4) : n > 0.3 ? mix(P.gray1, P.brn1, 0.5) : P.gray0;
  if (noise(x, y >> 1, 214) > 0.97) c = P.amb1; // brasa
  return c;
}

const FLOOR_FN: Record<Floor, (x: number, y: number) => Color> = {
  [Floor.Grass]: grass,
  [Floor.Cobble]: cobble,
  [Floor.Dirt]: dirt,
  [Floor.Soil]: soil,
  [Floor.Snow]: snow,
  [Floor.DeepSnow]: deepSnow,
  [Floor.FrozenStone]: frozenStone,
  [Floor.Sand]: sand,
  [Floor.Quicksand]: quicksand,
  [Floor.Marble]: marble,
  [Floor.AshRock]: ashRock,
};

/** Pinta o chão inteiro da arena (px) com transições irregulares entre tipos. */
export function paintFloor(map: ArenaMap): PixelCanvas {
  const W = map.w * TILE;
  const H = map.h * TILE;
  const c = new PixelCanvas(W, H);
  const floorAt = (tx: number, ty: number): Floor => {
    tx = Math.max(0, Math.min(map.w - 1, tx));
    ty = Math.max(0, Math.min(map.h - 1, ty));
    return map.floor[ty * map.w + tx] as Floor;
  };
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      // deslocamento ruidoso para bordas orgânicas
      const jx = Math.round((noise(x >> 2, y >> 2, 21) - 0.5) * 10);
      const jy = Math.round((noise(x >> 2, y >> 2, 22) - 0.5) * 10);
      const f = floorAt(Math.floor((x + jx) / TILE), Math.floor((y + jy) / TILE));
      c.set(x, y, FLOOR_FN[f](x, y));
    }
  }
  // sombra de contato ao pé dos sólidos e da borda
  for (let ty = 0; ty < map.h; ty++)
    for (let tx = 0; tx < map.w; tx++) {
      const o = map.obst[ty * map.w + tx] as Obst;
      if (o === Obst.None) continue;
      if (o === Obst.Fissure) continue;
      const shadowH = o === Obst.House || o === Obst.Crypt || o === Obst.Border || o === Obst.Wall ? 10 : o === Obst.Ruin || o === Obst.Tree || o === Obst.Hedge || o === Obst.Obelisk || o === Obst.Pillar ? 7 : 4;
      for (let y = 0; y < shadowH; y++)
        for (let x = -2; x < TILE + 2; x++) {
          const px = tx * TILE + x;
          const py = (ty + 1) * TILE + y;
          if (!c.inb(px, py)) continue;
          if (bayer(px, py) < 0.7 - y / shadowH) c.set(px, py, mix(c.get(px, py), P.ink, 0.45));
        }
    }
  // borda: vegetação morta densa (camada de chão)
  for (let ty = 0; ty < map.h; ty++)
    for (let tx = 0; tx < map.w; tx++) {
      if ((map.obst[ty * map.w + tx] as Obst) !== Obst.Border) continue;
      for (let y = 0; y < TILE; y++)
        for (let x = 0; x < TILE; x++) {
          const px = tx * TILE + x;
          const py = ty * TILE + y;
          const n = noise(px >> 2, py >> 2, 30);
          if (map.climate === 'winter') c.set(px, py, n > 0.55 ? mix(P.gray4, P.ice1, 0.3) : n > 0.25 ? P.gray3 : P.blue2);
          else if (map.climate === 'ash') c.set(px, py, n > 0.55 ? SAND0 : n > 0.25 ? P.brn1 : P.brn0);
          else c.set(px, py, n > 0.55 ? P.grn1 : n > 0.25 ? P.grn0 : P.ink);
        }
    }
  decorate(c, map);
  return c;
}

/** Detalhes no chão: ossos, velas, poças, pedras, flores murchas. */
function decorate(c: PixelCanvas, map: ArenaMap): void {
  for (let ty = 1; ty < map.h - 1; ty++)
    for (let tx = 1; tx < map.w - 1; tx++) {
      if ((map.obst[ty * map.w + tx] as Obst) !== Obst.None) continue;
      const f = map.floor[ty * map.w + tx] as Floor;
      const r = noise(tx, ty, 40);
      const x = tx * TILE + Math.floor(noise(tx, ty, 41) * 22) + 4;
      const y = ty * TILE + Math.floor(noise(tx, ty, 42) * 22) + 4;
      if (f === Floor.Soil && r > 0.8) {
        // ossos
        c.hline(x, x + 4, y, P.gray5);
        c.set(x - 1, y - 1, P.gray5);
        c.set(x - 1, y + 1, P.gray5);
        c.set(x + 5, y - 1, P.gray5);
        c.set(x + 5, y + 1, P.gray5);
      } else if (f === Floor.Grass && r > 0.86) {
        // flores murchas
        c.set(x, y, P.pur4);
        c.set(x + 2, y + 1, P.pur3);
        c.set(x + 1, y + 2, P.grn3);
      } else if (f === Floor.Dirt && r > 0.9) {
        // poça escura refletindo o céu
        c.ellipse(x + 3, y + 2, 5, 2, P.blue2);
        c.hline(x + 1, x + 3, y + 1, P.blue4);
      } else if (f === Floor.Cobble && r > 0.9) {
        // mancha de sangue antiga
        c.ellipse(x + 2, y + 2, 3, 2, P.red1);
        c.set(x + 5, y + 3, P.red1);
      } else if ((f === Floor.Snow || f === Floor.FrozenStone) && r > 0.88) {
        // pegadas na neve
        for (let i = 0; i < 3; i++) {
          c.set(x + i * 4, y + (i % 2) * 2, P.gray3);
          c.set(x + i * 4 + 1, y + (i % 2) * 2, P.gray3);
        }
      } else if (f === Floor.Sand && r > 0.9) {
        // ossada meio enterrada
        c.hline(x, x + 5, y, P.gray4);
        c.set(x - 1, y - 1, P.gray4);
        c.set(x + 6, y + 1, P.gray4);
      } else if (f === Floor.Marble && r > 0.92) {
        // cacos de vidro e poeira
        c.set(x, y, P.gray5);
        c.set(x + 2, y + 1, P.ice2);
      } else if (r < 0.04) {
        // pedrinhas
        c.set(x, y, P.gray3);
        c.set(x + 1, y, P.gray2);
      }
    }
}

// ---------------------------------------------------------------- objetos

function house(tw: number, th: number, variant: number): PixelCanvas {
  const w = tw * TILE;
  const roofExtra = 34;
  const H = th * TILE + roofExtra;
  const c = new PixelCanvas(w, H);
  const wallH = 30;
  const wallTop = H - wallH;
  // telhado (vista de cima em perspectiva)
  const roofTop = 2;
  const roofBottom = wallTop + 4;
  for (let y = roofTop; y < roofBottom; y++) {
    const inset = Math.max(0, 6 - (y - roofTop)) ;
    for (let x = inset; x < w - inset; x++) {
      const row = Math.floor((y - roofTop) / 4);
      const off = (row % 2) * 4;
      const sh = (x + off) % 8 === 0 || (y - roofTop) % 4 === 0;
      const n = noise(Math.floor((x + off) / 8), row, 60 + variant);
      let col: Color = n > 0.6 ? P.blue2 : n > 0.25 ? mix(P.blue1, P.gray1, 0.4) : P.blue1;
      if (variant === 1) col = n > 0.5 ? mix(P.brn2, P.gray1, 0.5) : mix(P.brn1, P.gray1, 0.5);
      if (sh) col = mix(col, P.ink, 0.45);
      // cumeeira
      const ridgeY = roofTop + Math.floor((roofBottom - roofTop) * 0.42);
      if (y === ridgeY || y === ridgeY + 1) col = y === ridgeY ? P.gray3 : P.gray2;
      if (y < ridgeY) col = mix(col, P.white, 0.05);
      else col = mix(col, P.ink, 0.12);
      c.set(x, y, col);
    }
  }
  // buraco no telhado
  if (variant !== 2) {
    const hx = Math.floor(w * (0.25 + 0.4 * noise(tw, th, variant)));
    const hy = roofTop + 10 + (variant % 2) * 8;
    c.ellipse(hx, hy, 8, 5, P.ink);
    for (let i = -8; i <= 8; i += 4) c.line(hx + i, hy - 5, hx + i + 2, hy + 5, P.brn2);
  }
  // chaminé
  const chx = w - 22 - variant * 6;
  c.rect(chx, roofTop + 2, 8, 12, P.gray2);
  c.rect(chx, roofTop + 2, 8, 2, P.gray3);
  c.rect(chx + 1, roofTop + 13, 6, 1, P.gray1);
  // beiral
  c.hline(0, w - 1, roofBottom - 1, P.ink);
  c.hline(0, w - 1, roofBottom, mix(P.ink, P.blue1, 0.5));
  // parede com enxaimel
  for (let y = roofBottom + 1; y < H; y++)
    for (let x = 0; x < w; x++) {
      const n = noise(x >> 1, y >> 1, 70);
      let col: Color = n > 0.5 ? mix(P.gray2, P.blue2, 0.3) : mix(P.gray1, P.blue2, 0.3);
      if (y > H - 5) col = (x + y) % 6 === 0 ? P.gray0 : P.gray1; // alicerce de pedra
      c.set(x, y, col);
    }
  const beam = P.brn1;
  c.hline(0, w - 1, roofBottom + 1, beam);
  c.hline(0, w - 1, H - 6, beam);
  for (let x = 0; x < w; x += 22) c.rect(x, roofBottom + 1, 3, H - roofBottom - 6, beam);
  c.rect(w - 3, roofBottom + 1, 3, H - roofBottom - 6, beam);
  // porta
  const dx = Math.floor(w / 2) - 7 + (variant - 1) * 14;
  c.rect(dx, H - 22, 13, 22, P.brn2);
  c.rect(dx + 1, H - 21, 11, 21, P.brn1);
  for (let x = dx + 3; x < dx + 12; x += 3) c.vline(x, H - 21, H - 1, P.brn0);
  c.set(dx + 10, H - 11, P.amb3);
  if (variant === 2) {
    // porta pregada com tábuas
    c.line(dx - 1, H - 18, dx + 13, H - 8, P.brn3);
    c.line(dx - 1, H - 8, dx + 13, H - 18, P.brn3);
  }
  // janelas (algumas acesas)
  const wins = Math.max(1, tw - 3);
  for (let i = 0; i < wins + 1; i++) {
    const wx = 8 + i * Math.floor((w - 26) / Math.max(1, wins));
    if (Math.abs(wx - dx) < 16) continue;
    const lit = noise(i, variant, tw) > 0.45;
    c.rect(wx, H - 22, 10, 9, P.ink);
    c.rect(wx + 1, H - 21, 8, 7, lit ? P.amb3 : P.blue1);
    if (lit) {
      c.rect(wx + 1, H - 21, 8, 2, P.amb4);
      c.set(wx + 2, H - 20, P.amb5);
    }
    c.vline(wx + 5, H - 21, H - 15, P.brn1);
    c.hline(wx + 1, wx + 8, H - 18, P.brn1);
    c.hline(wx - 1, wx + 10, H - 13, P.brn2);
  }
  c.outline(P.outline);
  return c;
}

function ruinBlock(variant: number, left: boolean, right: boolean): PixelCanvas {
  const c = new PixelCanvas(TILE, TILE + 18);
  const top = 2 + (variant % 3) * 3;
  for (let y = top; y < c.h; y++) {
    for (let x = 0; x < TILE; x++) {
      // topo irregular
      const edge = top + Math.floor(noise(x >> 2, variant, 80) * 6);
      if (y < edge) continue;
      if (!left && x < 2 && y < c.h - 6) continue;
      if (!right && x > TILE - 3 && y < c.h - 6) continue;
      const row = Math.floor((y - top) / 6);
      const off = (row % 2) * 6;
      const mortar = (y - top) % 6 === 0 || (x + off) % 12 === 0;
      const n = noise(Math.floor((x + off) / 12), row, 81 + variant);
      let col: Color = n > 0.6 ? P.gray3 : n > 0.3 ? P.gray2 : mix(P.gray2, P.blue2, 0.4);
      if (mortar) col = P.gray1;
      if (y < edge + 3) col = mix(col, P.white, 0.12);
      if (y > c.h - 12) col = mix(col, P.ink, 0.25);
      if (noise(x, y, 82 + variant) > 0.9 && y > edge + 2) col = P.grn3; // musgo
      c.set(x, y, col);
    }
  }
  c.outline(P.outline);
  return c;
}

function deadTree(variant: number): PixelCanvas {
  const c = new PixelCanvas(72, 104);
  const bx = 36;
  const by = 100;
  const bark: Color = mix(P.brn1, P.gray1, 0.5);
  const barkL: Color = mix(P.brn2, P.gray2, 0.5);
  // raízes
  c.line(bx - 8, by, bx - 2, by - 6, bark);
  c.line(bx + 9, by, bx + 2, by - 6, bark);
  // tronco retorcido
  let x = bx;
  for (let y = by; y > 40; y--) {
    x += Math.sin(y * 0.09 + variant) * 0.35;
    const w = 3 + (y - 40) / 18;
    for (let i = -w; i <= w; i++) c.set(Math.round(x + i), y, i < -w / 3 ? barkL : bark);
  }
  // galhos recursivos
  const branch = (x0: number, y0: number, ang: number, len: number, depth: number): void => {
    const x1 = x0 + Math.cos(ang) * len;
    const y1 = y0 + Math.sin(ang) * len;
    const th = Math.max(1, depth);
    for (let t = 0; t <= th - 1; t++) c.line(x0 + t * 0.5, y0, x1 + t * 0.5, y1, t === 0 ? barkL : bark);
    if (depth <= 0) return;
    const s = noise(Math.round(x1), Math.round(y1), variant);
    branch(x1, y1, ang - 0.45 - s * 0.3, len * 0.72, depth - 1);
    branch(x1, y1, ang + 0.4 + s * 0.3, len * 0.68, depth - 1);
  };
  branch(x, 42, -Math.PI / 2 - 0.5, 20, 3);
  branch(x, 46, -Math.PI / 2 + 0.55, 18, 3);
  branch(x, 58, -Math.PI / 2 - 1.2, 14, 2);
  // folhagem escassa, escura
  for (let i = 0; i < 7 + variant * 2; i++) {
    const lx = 14 + noise(i, variant, 90) * 44;
    const ly = 8 + noise(i, variant, 91) * 36;
    const r = 4 + noise(i, variant, 92) * 5;
    for (let yy = -r; yy <= r; yy++)
      for (let xx = -r; xx <= r; xx++) {
        if (xx * xx + yy * yy > r * r) continue;
        if (bayer(Math.round(lx + xx), Math.round(ly + yy)) > 0.62) continue;
        c.set(Math.round(lx + xx), Math.round(ly + yy), yy < -r / 3 ? P.grn3 : P.grn2);
      }
  }
  // musgo pendurado
  for (let i = 0; i < 4; i++) {
    const mx = 20 + noise(i, variant, 93) * 32;
    const my = 30 + noise(i, variant, 94) * 14;
    c.vline(Math.round(mx), Math.round(my), Math.round(my + 6 + i), P.grn3);
  }
  c.outline(P.outline);
  return c;
}

function borderTree(variant: number): PixelCanvas {
  const c = new PixelCanvas(48, 78);
  const col0 = P.grn0;
  const col1 = mix(P.grn1, P.blue1, 0.4);
  const col2 = mix(P.grn2, P.blue2, 0.4);
  // pinheiro morto escuro em camadas
  c.rect(22, 60, 4, 18, P.brn0);
  for (let layer = 0; layer < 5; layer++) {
    const y = 8 + layer * 11;
    const w = 6 + layer * 4 + (variant % 2) * 2;
    for (let yy = 0; yy < 16; yy++) {
      const ww = Math.round((w * yy) / 16);
      for (let xx = -ww; xx <= ww; xx++) {
        const px = 24 + xx;
        const py = y + yy;
        const n = noise(px, py, 100 + variant);
        c.set(px, py, xx < -ww / 3 && n > 0.4 ? col2 : n > 0.3 ? col1 : col0);
      }
    }
  }
  c.outline(P.ink);
  return c;
}

function tomb(variant: number): PixelCanvas {
  const c = new PixelCanvas(20, 26);
  const stone: Color = mix(P.gray2, P.blue2, 0.3);
  const light: Color = P.gray3;
  if (variant === 0) {
    c.rect(4, 6, 12, 18, stone);
    c.ellipse(10, 7, 6, 5, stone);
    c.vline(4, 6, 23, light);
    c.hline(7, 12, 11, P.gray1);
    c.hline(7, 11, 14, P.gray1);
  } else if (variant === 1) {
    c.rect(8, 2, 4, 22, stone);
    c.rect(3, 7, 14, 4, stone);
    c.vline(8, 2, 23, light);
    c.hline(3, 16, 7, light);
  } else {
    // lápide quebrada inclinada
    for (let y = 8; y < 24; y++) c.hline(3 + Math.floor((24 - y) / 6), 14 + Math.floor((24 - y) / 6), y, stone);
    c.line(6, 8, 15, 12, P.ink);
    c.vline(3, 20, 23, light);
  }
  c.rect(2, 22, 16, 3, P.gray1);
  // vela acesa em alguns
  if (variant !== 1) {
    c.rect(15, 18, 2, 4, P.gray6);
    c.set(15, 17, P.amb4);
    c.set(15, 16, P.amb5);
  }
  if (noise(variant, 3, 110) > 0.3) c.set(5, 18, P.grn3);
  c.outline(P.outline);
  return c;
}

function fence(horizontal: boolean): PixelCanvas {
  if (horizontal) {
    const c = new PixelCanvas(TILE, 26);
    c.hline(0, TILE - 1, 8, P.gray2);
    c.hline(0, TILE - 1, 20, P.gray2);
    for (let x = 1; x < TILE; x += 4) {
      c.vline(x, 4, 24, P.gray3);
      c.set(x, 3, P.gray4);
      c.set(x, 2, P.gray4);
    }
    c.outline(P.outline);
    return c;
  }
  const c = new PixelCanvas(10, TILE + 16);
  for (let y = 4; y < c.h; y += 5) {
    c.hline(2, 7, y, P.gray3);
    c.set(1, y, P.gray4);
  }
  c.vline(3, 2, c.h - 2, P.gray2);
  c.vline(6, 2, c.h - 2, P.gray2);
  c.outline(P.outline);
  return c;
}

function crypt(): PixelCanvas {
  const W = 5 * TILE;
  const H = 4 * TILE + 44;
  const c = new PixelCanvas(W, H);
  const stone: Color = mix(P.gray2, P.pur1, 0.25);
  const stoneL: Color = mix(P.gray3, P.pur2, 0.2);
  const stoneD: Color = mix(P.gray1, P.pur0, 0.3);
  // telhado triangular (frontão)
  for (let y = 0; y < 40; y++) {
    const half = Math.round((W / 2) * (y / 40));
    for (let x = W / 2 - half; x < W / 2 + half; x++) c.set(x, y + 4, y < 3 ? stoneL : (x + y) % 9 === 0 ? stoneD : stone);
  }
  c.line(0, 44, W / 2, 4, stoneL);
  c.line(W / 2, 4, W - 1, 44, stoneD);
  // caveira no frontão
  c.ellipse(W / 2, 30, 6, 5, P.gray5);
  c.rect(W / 2 - 4, 29, 3, 3, P.ink);
  c.rect(W / 2 + 1, 29, 3, 3, P.ink);
  c.rect(W / 2 - 3, 34, 6, 2, P.gray4);
  // corpo
  c.rect(4, 44, W - 8, H - 44, stone);
  for (let y = 48; y < H; y += 8) c.hline(4, W - 5, y, stoneD);
  // colunas
  for (const x of [8, 32, W - 44, W - 20]) {
    c.rect(x, 44, 12, H - 48, stoneL);
    c.vline(x, 44, H - 5, P.gray4);
    c.vline(x + 11, 44, H - 5, stoneD);
    c.rect(x - 2, 44, 16, 4, P.gray4);
    c.rect(x - 2, H - 8, 16, 4, P.gray3);
  }
  // porta arqueada com brilho do abismo
  const dx = W / 2 - 18;
  c.rect(dx, H - 60, 36, 60, P.ink);
  c.ellipse(W / 2, H - 60, 18, 12, P.ink);
  for (let y = H - 70; y < H; y++)
    for (let x = dx + 3; x < dx + 33; x++) {
      if (c.get(x, y) !== P.ink) continue;
      const t = (y - (H - 70)) / 70;
      if (bayer(x, y) < t * 0.6) c.set(x, y, t > 0.7 ? P.abyss2 : P.abyss1);
    }
  c.rect(0, H - 6, W, 6, P.gray1);
  c.outline(P.outline);
  return c;
}

function campfire(frame: number): PixelCanvas {
  const c = new PixelCanvas(64, 72);
  const cx = 32;
  const base = 62;
  // pedras
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const x = cx + Math.cos(a) * 20;
    const y = base - 4 + Math.sin(a) * 8;
    c.ellipse(x, y, 4, 3, i % 3 === 0 ? P.gray3 : P.gray2);
    c.set(Math.round(x - 1), Math.round(y - 1), P.gray4);
  }
  // lenha
  c.line(cx - 14, base - 2, cx + 12, base - 9, P.brn2);
  c.line(cx - 14, base - 1, cx + 12, base - 8, P.brn1);
  c.line(cx + 14, base - 2, cx - 12, base - 9, P.brn3);
  c.line(cx + 14, base - 1, cx - 12, base - 8, P.brn2);
  c.ellipse(cx, base - 5, 9, 3, P.amb1);
  // chamas (camadas)
  const layers: [number, Color][] = [
    [1, P.red3],
    [0.78, P.amb2],
    [0.56, P.amb3],
    [0.34, P.amb4],
    [0.16, P.amb5],
  ];
  for (const [scale, col] of layers) {
    const h = 44 * scale + 6;
    const w = 13 * scale + 3;
    for (let y = 0; y < h; y++) {
      const t = y / h;
      const sway = Math.sin(t * 5 + frame * 1.1) * 2.5 * t + Math.sin(frame * 0.7 + t * 9) * t;
      const ww = w * Math.sin(Math.PI * Math.min(1, (1 - t) * 1.05)) * (1 - t * 0.35);
      for (let x = -ww; x <= ww; x++) {
        const px = Math.round(cx + x + sway);
        const py = Math.round(base - 6 - y);
        if (t > 0.6 && bayer(px, py + frame) < (t - 0.6) * 2.2) continue;
        c.set(px, py, col);
      }
    }
  }
  // línguas de fogo soltas
  for (let i = 0; i < 3; i++) {
    const fx = cx - 8 + i * 8 + Math.round(Math.sin(frame + i) * 2);
    const fy = base - 44 - ((frame * 3 + i * 5) % 10);
    c.rect(fx, fy, 2, 3, P.amb3);
  }
  return c;
}

function torch(frame: number): PixelCanvas {
  const c = new PixelCanvas(16, 44);
  c.rect(7, 16, 3, 28, P.brn2);
  c.vline(7, 16, 43, P.brn3);
  c.rect(5, 14, 7, 3, P.gray2);
  c.rect(6, 12, 5, 3, P.brn1);
  const flick = [0, 1, 0, -1][frame % 4] as number;
  c.ellipse(8.5 + flick * 0.5, 8, 3.5, 5.5, P.red3);
  c.ellipse(8.5 + flick * 0.5, 9, 2.5, 4, P.amb3);
  c.ellipse(8.5, 10, 1.5, 2.5, P.amb5);
  c.set(8 + flick, 2, P.amb3);
  c.outline(P.outline);
  return c;
}

function well(): PixelCanvas {
  const c = new PixelCanvas(34, 52);
  c.ellipse(17, 40, 15, 8, P.gray2);
  c.ellipse(17, 38, 15, 7, P.gray3);
  c.ellipse(17, 38, 11, 5, P.ink);
  c.ellipse(17, 39, 8, 3, P.blue2);
  for (let i = 0; i < 8; i++) c.set(4 + i * 4, 44 + (i % 2), P.gray1);
  c.rect(3, 12, 3, 30, P.brn2);
  c.rect(28, 12, 3, 30, P.brn2);
  for (let y = 4; y < 14; y++) c.hline(1 + (14 - y) / 1.2, 33 - (14 - y) / 1.2, y, y % 3 === 0 ? P.blue1 : P.blue2);
  c.hline(6, 28, 16, P.brn3);
  c.vline(17, 16, 28, P.gray4);
  c.rect(15, 28, 5, 4, P.brn2);
  c.outline(P.outline);
  return c;
}

function crate(): PixelCanvas {
  const c = new PixelCanvas(26, 26);
  c.rect(1, 3, 24, 22, P.brn2);
  c.rect(1, 3, 24, 3, P.brn3);
  for (const y of [9, 15, 21]) c.hline(1, 24, y, P.brn1);
  c.line(2, 6, 23, 24, P.brn3);
  c.rect(1, 3, 2, 22, P.brn3);
  c.rect(23, 3, 2, 22, P.brn1);
  c.outline(P.outline);
  return c;
}

function barrel(): PixelCanvas {
  const c = new PixelCanvas(22, 28);
  c.ellipse(11, 16, 9, 11, P.brn2);
  c.rect(2, 8, 18, 16, P.brn2);
  for (let x = 4; x < 20; x += 4) c.vline(x, 6, 25, P.brn1);
  c.hline(2, 19, 9, P.gray3);
  c.hline(2, 19, 21, P.gray3);
  c.ellipse(11, 6, 8, 3, P.brn3);
  c.ellipse(11, 6, 6, 2, P.brn1);
  c.vline(3, 8, 22, P.brn3);
  c.outline(P.outline);
  return c;
}

/** Caixa/barril rachados (dano parcial visível). */
function cracked(src: PixelCanvas, seed: number): PixelCanvas {
  const c = src.clone();
  let x = Math.floor(src.w * 0.35);
  for (let y = 4; y < src.h - 4; y++) {
    x += noise(x, y, seed) > 0.5 ? 1 : -1;
    if (c.alpha(x, y) > 0) c.set(x, y, P.ink);
    if (y % 5 === 0 && c.alpha(x + 1, y) > 0) c.set(x + 1, y, P.ink);
  }
  for (let i = 0; i < 6; i++) {
    const px = Math.floor(noise(i, seed, 3) * src.w);
    const py = Math.floor(noise(i, seed, 4) * src.h);
    if (c.alpha(px, py) > 0) c.set(px, py, P.brn0);
  }
  return c;
}

/** Sebe congelada (labirinto do capítulo II): folhagem escura com geada no topo. */
function hedgeBlock(variant: number, left: boolean, right: boolean): PixelCanvas {
  const c = new PixelCanvas(TILE, TILE + 20);
  for (let y = 2; y < c.h; y++)
    for (let x = 0; x < TILE; x++) {
      const edge = 2 + Math.floor(noise(x >> 1, variant, 301) * 5);
      if (y < edge) continue;
      if (!left && x < 2 && y < c.h - 4) continue;
      if (!right && x > TILE - 3 && y < c.h - 4) continue;
      const n = noise(x >> 1, y >> 1, 302 + variant);
      let col: Color = n > 0.66 ? mix(P.grn3, P.blue3, 0.35) : n > 0.33 ? mix(P.grn2, P.blue2, 0.4) : P.grn1;
      if (y < edge + 4) col = mix(col, P.ice3, 0.7 - (y - edge) * 0.15); // geada
      else if (noise(x, y, 303) > 0.93) col = P.ice2;
      if (y > c.h - 10) col = mix(col, P.ink, 0.3);
      c.set(x, y, col);
    }
  c.outline(P.outline);
  return c;
}

/** Parede da mansão: tijolo escuro, friso e janelas estreitas com luz tênue. */
function wallBlock(variant: number, left: boolean, right: boolean): PixelCanvas {
  const c = new PixelCanvas(TILE, TILE + 30);
  const top = 2;
  for (let y = top; y < c.h; y++)
    for (let x = 0; x < TILE; x++) {
      if (!left && x < 2 && y < c.h - 6) continue;
      if (!right && x > TILE - 3 && y < c.h - 6) continue;
      const row = Math.floor((y - top) / 5);
      const off = (row % 2) * 5;
      const mortar = (y - top) % 5 === 0 || (x + off) % 10 === 0;
      const n = noise(Math.floor((x + off) / 10), row, 311 + variant);
      let col: Color = n > 0.6 ? mix(P.gray2, P.pur2, 0.35) : n > 0.3 ? mix(P.gray1, P.pur1, 0.4) : mix(P.gray1, P.brn1, 0.4);
      if (mortar) col = P.gray0;
      if (y < top + 4) col = mix(P.gray3, P.pur3, 0.3); // friso
      if (y > c.h - 12) col = mix(col, P.ink, 0.3);
      c.set(x, y, col);
    }
  if (variant === 1) {
    // janela gótica
    c.rect(12, 14, 8, 16, P.ink);
    c.ellipse(16, 14, 4, 3, P.ink);
    for (let y = 13; y < 30; y++) for (let x = 13; x < 19; x++) if (c.get(x, y) === P.ink && bayer(x, y) < 0.35) c.set(x, y, P.amb1);
  }
  c.outline(P.outline);
  return c;
}

function pillar(): PixelCanvas {
  const c = new PixelCanvas(22, 70);
  c.rect(2, 62, 18, 7, P.gray3);
  c.rect(4, 8, 14, 54, mix(P.gray4, P.pur2, 0.2));
  for (let x = 6; x < 17; x += 3) c.vline(x, 10, 60, mix(P.gray3, P.pur1, 0.3));
  c.vline(4, 8, 61, P.gray5);
  c.rect(1, 2, 20, 6, P.gray4);
  c.hline(1, 20, 2, P.gray5);
  // rachadura
  c.line(12, 20, 9, 34, P.gray1);
  c.outline(P.outline);
  return c;
}

function obelisk(variant: number): PixelCanvas {
  const c = new PixelCanvas(22, 80);
  for (let y = 6; y < 74; y++) {
    const w = 3 + Math.floor((y - 6) / 11);
    for (let x = -w; x <= w; x++) c.set(11 + x, y, x < 0 ? mix(P.gray1, P.brn1, 0.4) : mix(P.gray0, P.brn0, 0.4));
  }
  for (let y = 0; y < 6; y++) c.hline(11 - Math.floor(y / 2), 11 + Math.floor(y / 2), y, P.gray2);
  c.rect(3, 74, 16, 5, P.gray2);
  // runas brilhantes
  const glow = variant ? P.abyss4 : P.amb3;
  for (let i = 0; i < 4; i++) {
    const y = 18 + i * 13;
    c.hline(9, 13, y, glow);
    c.vline(11, y - 2, y + 2, glow);
  }
  c.outline(P.outline);
  return c;
}

function fissure(variant: number): PixelCanvas {
  const c = new PixelCanvas(TILE, TILE);
  let x = 4 + variant * 3;
  for (let y = 2; y < TILE - 2; y++) {
    x += noise(x, y, 320 + variant) > 0.5 ? 1 : -1;
    const w = 3 + Math.floor(noise(x, y >> 2, 321) * 5);
    for (let i = -w; i <= w; i++) {
      const px = x + 10 + i;
      const core = Math.abs(i) < w - 2;
      c.set(px, y, core ? (Math.abs(i) < 1 ? P.abyss3 : P.abyss1) : P.ink);
    }
  }
  return c;
}

function statue(variant: number): PixelCanvas {
  const c = new PixelCanvas(28, 64);
  const st: Color = variant ? mix(P.gray2, P.brn1, 0.3) : mix(P.gray3, P.blue2, 0.2);
  const stL: Color = mix(st, P.white, 0.18);
  c.rect(4, 54, 20, 9, P.gray2);
  c.hline(4, 23, 54, P.gray4);
  // figura encapuzada rezando
  for (let y = 16; y < 54; y++) {
    const w = 5 + Math.floor((y - 16) / 6);
    for (let x = -w; x <= w; x++) c.set(14 + x, y, x < -w / 3 ? stL : st);
  }
  c.ellipse(14, 12, 6, 7, st);
  c.ellipse(13, 11, 5, 6, stL);
  c.rect(11, 12, 6, 4, P.gray1);
  c.rect(12, 24, 4, 8, stL); // mãos
  c.outline(P.outline);
  return c;
}

/** Rochas pontiagudas da borda do deserto. */
function borderRock(variant: number): PixelCanvas {
  const c = new PixelCanvas(44, 70);
  for (let k = 0; k < 3; k++) {
    const bx = 10 + k * 12 + (variant % 2) * 2;
    const h = 40 + ((k + variant) % 3) * 10;
    for (let y = 0; y < h; y++) {
      const w = Math.floor((y / h) * (7 + k));
      for (let x = -w; x <= w; x++) c.set(bx + x, 68 - h + y, x < 0 ? mix(P.brn1, P.gray1, 0.4) : P.brn0);
    }
  }
  c.outline(P.ink);
  return c;
}

/** Recolore um quadro (fogo azul/roxo, etc.). */
function recolorFire(src: PixelCanvas, ramp: [Color, Color, Color, Color, Color]): PixelCanvas {
  const c = src.clone();
  c.recolor(new Map<Color, Color>([
    [P.red3, ramp[0]],
    [P.amb2, ramp[1]],
    [P.amb3, ramp[2]],
    [P.amb4, ramp[3]],
    [P.amb5, ramp[4]],
  ]));
  return c;
}

/** Folha com todos os objetos de todos os mapas (chaves por tipo/variante/clima). */
export function buildObjectSheet(map: ArenaMap): SheetBuilder {
  const sb = new SheetBuilder();
  for (const o of map.objects) {
    if (o.kind === Obst.House) {
      const k = `house_${o.tw}x${o.th}_${o.variant}`;
      if (!sb.has(k)) sb.add(k, house(o.tw, o.th, o.variant));
    }
  }
  // capítulo II (inverno) e III (cinzas)
  for (let v = 0; v < 3; v++) for (const l of [0, 1]) for (const r of [0, 1]) sb.add(`hedge_${v}_${l}${r}`, hedgeBlock(v, l === 1, r === 1));
  for (let v = 0; v < 3; v++) for (const l of [0, 1]) for (const r of [0, 1]) sb.add(`wall_${v}_${l}${r}`, wallBlock(v, l === 1, r === 1));
  sb.add('pillar', pillar());
  for (let v = 0; v < 2; v++) sb.add(`obelisk_${v}`, obelisk(v));
  for (let v = 0; v < 3; v++) sb.add(`fissure_${v}`, fissure(v));
  for (let v = 0; v < 2; v++) sb.add(`statue_${v}`, climatize(statue(v), v ? 'ash' : 'winter'));
  for (let v = 0; v < 3; v++) {
    sb.add(`tree_w_${v}`, climatize(deadTree(v), 'winter'));
    sb.add(`tree_a_${v}`, climatize(deadTree(v + 3), 'ash'));
    sb.add(`border_w_${v}`, climatize(borderTree(v), 'winter'));
    sb.add(`border_a_${v}`, borderRock(v));
    sb.add(`tomb_w_${v}`, climatize(tomb(v), 'winter'));
  }
  sb.add('crypt_w', climatize(crypt(), 'winter'));
  for (let f = 0; f < 6; f++) {
    sb.add(`fire_w_${f}`, recolorFire(campfire(f), [P.ice0, P.ice1, P.ice2, P.ice3, P.white]));
    sb.add(`fire_a_${f}`, recolorFire(campfire(f), [P.abyss1, P.abyss2, P.abyss3, P.abyss4, P.pur6]));
  }
  for (const [suffix, cl] of [['', 'night'], ['_w', 'winter'], ['_a', 'ash']] as const) {
    const cr = climatize(crate(), cl);
    const br = climatize(barrel(), cl);
    sb.add(`crate${suffix}`, cr);
    sb.add(`crate${suffix}_d`, cracked(cr, 1));
    sb.add(`barrel${suffix}`, br);
    sb.add(`barrel${suffix}_d`, cracked(br, 2));
  }
  for (let v = 0; v < 4; v++) for (const l of [0, 1]) for (const r of [0, 1]) sb.add(`ruin_${v}_${l}${r}`, ruinBlock(v, l === 1, r === 1));
  for (let v = 0; v < 3; v++) sb.add(`tree_${v}`, deadTree(v));
  for (let v = 0; v < 3; v++) sb.add(`border_${v}`, borderTree(v));
  for (let v = 0; v < 3; v++) sb.add(`tomb_${v}`, tomb(v));
  sb.add('fence_h', fence(true));
  sb.add('fence_v', fence(false));
  sb.add('crypt', crypt());
  for (let f = 0; f < 6; f++) sb.add(`fire_${f}`, campfire(f));
  for (let f = 0; f < 4; f++) sb.add(`torch_${f}`, torch(f));
  sb.add('well', well());
  return sb;
}
