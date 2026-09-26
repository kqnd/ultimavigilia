/**
 * Panoramas pixelados da cinemática de viagem entre capítulos.
 * Cada clima tem céu, montanhas/dunas distantes, árvores/ruínas, chão e um marco de chegada.
 * As camadas horizontais repetem sem emenda em 640 px (senos com período inteiro e ruído módulo 640).
 */
import type { Climate } from '../shared/config/chapters.js';
import { P } from './palette.js';
import { type Color, mix, noise, PixelCanvas } from './pixel.js';

export const CIN_W = 640;
export const CIN_H = 360;
/** Linha do horizonte e topo do chão em que o grupo caminha. */
export const CIN_HORIZON = 226;
export const CIN_GROUND_Y = 278;

const TAU = Math.PI * 2;
const wave = (x: number, k: number, ph = 0): number => Math.sin((x / CIN_W) * TAU * k + ph);
const nz = (x: number, y: number, s: number): number => noise(((x % CIN_W) + CIN_W) % CIN_W, y, s);

/** Gradiente vertical com pontilhado ordenado entre faixas (sem suavização). */
function gradient(pc: PixelCanvas, y0: number, y1: number, stops: readonly Color[]): void {
  const B = [
    [0, 8, 2, 10],
    [12, 4, 14, 6],
    [3, 11, 1, 9],
    [15, 7, 13, 5],
  ];
  for (let y = y0; y < y1; y++) {
    const t = ((y - y0) / Math.max(1, y1 - y0 - 1)) * (stops.length - 1);
    const i = Math.min(stops.length - 2, Math.floor(t));
    const f = t - i;
    for (let x = 0; x < pc.w; x++) {
      const th = ((B[y % 4] as number[])[x % 4] as number) / 16;
      pc.set(x, y, (f > th ? stops[i + 1] : stops[i]) as Color);
    }
  }
}

function disc(pc: PixelCanvas, cx: number, cy: number, r: number, c: Color, a = 255): void {
  for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) if (x * x + y * y <= r * r) pc.set(cx + x, cy + y, c, a);
}

// ------------------------------------------------------------------ céu

export function cinSky(c: Climate): PixelCanvas {
  const pc = new PixelCanvas(CIN_W, CIN_H);
  if (c === 'night') {
    gradient(pc, 0, CIN_H, [P.ink, P.blue0, P.blue1, P.blue2, P.blue3]);
    for (let i = 0; i < 90; i++) {
      const x = Math.floor(noise(i, 1, 7) * CIN_W);
      const y = Math.floor(noise(i, 2, 7) * 180);
      pc.set(x, y, noise(i, 3, 7) > 0.8 ? P.white : P.gray4);
    }
    disc(pc, 470, 86, 15, P.gray5);
    disc(pc, 466, 82, 14, P.gray6);
    disc(pc, 472, 88, 3, P.gray5);
    disc(pc, 462, 80, 2, P.gray5);
  } else if (c === 'winter') {
    gradient(pc, 0, CIN_H, [P.blue1, P.blue2, P.blue3, P.blue5, P.gray4, P.gray5]);
    // lua pálida atrás de nuvens baixas
    disc(pc, 180, 92, 20, P.ice3, 200);
    disc(pc, 180, 92, 26, P.ice2, 40);
    for (let b = 0; b < 4; b++) {
      const y0 = 70 + b * 26;
      for (let x = 0; x < CIN_W; x++) {
        const h = Math.round(4 + wave(x, 3 + b, b) * 3 + wave(x, 7, b * 2) * 2);
        for (let y = 0; y < h; y++) pc.set(x, y0 + y, b % 2 ? P.gray3 : P.blue4, 110);
      }
    }
  } else {
    gradient(pc, 0, CIN_H, [0x120606, P.red0, P.red1, P.amb0, P.amb1, P.amb2]);
    // sol baixo e avermelhado riscado por faixas de cinza
    disc(pc, 440, 156, 30, P.amb3, 60);
    disc(pc, 440, 156, 22, P.red4);
    disc(pc, 440, 156, 18, P.amb3);
    for (let y = 136; y < 180; y += 7) for (let x = 400; x < 480; x++) pc.set(x, y, P.red2, 180);
    for (let i = 0; i < 70; i++) {
      const x = Math.floor(noise(i, 4, 9) * CIN_W);
      const y = Math.floor(noise(i, 5, 9) * 200);
      pc.set(x, y, P.gray3, 150);
    }
  }
  return pc;
}

// ------------------------------------------------------------------ montanhas / dunas distantes

export const FAR_H = 130;

export function cinFar(c: Climate): PixelCanvas {
  const pc = new PixelCanvas(CIN_W, FAR_H);
  for (let x = 0; x < CIN_W; x++) {
    if (c === 'winter') {
      // picos serrilhados com neve no alto
      const base = 50 + wave(x, 2) * 14 + wave(x, 5, 1) * 10;
      const jag = Math.abs(wave(x, 11, 0.4)) * 26 + Math.abs(wave(x, 23, 2)) * 8;
      const top = Math.round(FAR_H - base - jag);
      for (let y = Math.max(0, top); y < FAR_H; y++) {
        const d = y - top;
        let col: Color = d < 6 + nz(x, 1, 3) * 6 ? P.gray6 : d < 12 ? P.ice1 : P.blue3;
        if (d > 14 && (x + y) % 11 === 0 && nz(x, y, 4) > 0.6) col = P.blue4;
        if (wave(x, 11, 0.4) < 0 && d < 30 && d > 3) col = mix(col, P.blue2, 0.45);
        pc.set(x, y, col);
      }
    } else if (c === 'ash') {
      // dunas longas e suaves, crista clara, sombra do lado oposto
      const top = Math.round(FAR_H - (44 + wave(x, 2, 0.5) * 18 + wave(x, 3, 2) * 10 + wave(x, 7, 1) * 4));
      const slope = Math.cos((x / CIN_W) * TAU * 2 + 0.5) * 2 + Math.cos((x / CIN_W) * TAU * 3 + 2);
      for (let y = Math.max(0, top); y < FAR_H; y++) {
        const d = y - top;
        let col: Color = d < 2 ? P.amb3 : slope > 0 ? P.brn4 : P.brn3;
        if (d > 18) col = slope > 0 ? P.brn3 : P.brn2;
        if (d > 40) col = P.brn2;
        pc.set(x, y, col);
      }
    } else {
      // colinas escuras com floresta distante
      const top = Math.round(FAR_H - (40 + wave(x, 3) * 12 + wave(x, 7, 1) * 6 + nz(x, 1, 2) * 3));
      for (let y = Math.max(0, top); y < FAR_H; y++) pc.set(x, y, y - top < 2 ? P.blue3 : mix(P.blue1, P.grn1, 0.4));
      if (x % 9 === 0 && nz(x, 2, 5) > 0.3) {
        const h = 8 + Math.floor(nz(x, 3, 5) * 10);
        for (let k = 0; k < h; k++) for (let w = -Math.floor(k / 3); w <= Math.floor(k / 3); w++) pc.set(x + w, top - h + k + 1, mix(P.blue1, P.grn1, 0.5));
      }
    }
  }
  return pc;
}

// ------------------------------------------------------------------ árvores e ruínas (plano médio)

export const MID_H = 140;

function pine(pc: PixelCanvas, x: number, base: number, h: number, dark: Color, light: Color, snow: boolean): void {
  pc.rect(x - 1, base - 6, 3, 6, P.brn1);
  for (let k = 0; k < h; k++) {
    const w = Math.floor(((k % 9) + 3) * 0.55 + (k / h) * 5);
    const y = base - h - 4 + k;
    for (let i = -w; i <= w; i++) {
      let col = i > w - 2 ? light : dark;
      if (snow && (k % 9 === 0 || k % 9 === 1) && Math.abs(i) < w) col = k % 9 === 0 ? P.white : P.gray5;
      pc.set(x + i, y, col);
    }
  }
}

function deadTree(pc: PixelCanvas, x: number, base: number, h: number, seed: number): void {
  const col = P.brn0;
  pc.rect(x - 1, base - h, 3, h, col);
  for (let b = 0; b < 4; b++) {
    const y = base - h + 6 + b * Math.floor(h / 5);
    const dir = (b + seed) % 2 ? 1 : -1;
    const len = 6 + Math.floor(noise(seed, b, 3) * 10);
    for (let i = 0; i < len; i++) pc.set(x + dir * i, y - Math.floor(i / 2), col);
    pc.set(x + dir * len, y - Math.floor(len / 2) - 1, col);
  }
}

export function cinMid(c: Climate): PixelCanvas {
  const pc = new PixelCanvas(CIN_W, MID_H);
  const base = MID_H;
  for (let x = 8; x < CIN_W; x += 22) {
    const r = nz(x, 9, 11);
    const xx = x + Math.floor(nz(x, 10, 11) * 10);
    if (c === 'night') {
      if (r > 0.25) pine(pc, xx, base - Math.floor(nz(x, 12, 1) * 8), 30 + Math.floor(r * 40), P.grn1, P.grn2, false);
    } else if (c === 'winter') {
      if (r > 0.3) pine(pc, xx, base - Math.floor(nz(x, 12, 1) * 8), 28 + Math.floor(r * 42), P.blue2, P.blue3, true);
      else if (r > 0.12) {
        // lápide coberta de neve
        pc.rect(xx - 4, base - 16, 9, 16, P.gray2);
        pc.rect(xx - 3, base - 18, 7, 2, P.gray2);
        pc.hline(xx - 4, xx + 4, base - 17, P.white);
        pc.hline(xx - 3, xx + 3, base - 19, P.white);
      } else {
        // cruz de ferro
        pc.rect(xx, base - 26, 2, 26, P.gray1);
        pc.rect(xx - 5, base - 20, 12, 2, P.gray1);
        pc.set(xx, base - 27, P.white);
      }
    } else {
      if (r > 0.55) deadTree(pc, xx, base - Math.floor(nz(x, 12, 1) * 6), 30 + Math.floor(r * 30), x);
      else if (r > 0.32) {
        // obelisco partido
        const h = 24 + Math.floor(r * 30);
        for (let k = 0; k < h; k++) {
          const w = 4 - Math.floor((k / h) * 3);
          for (let i = -w; i <= w; i++) pc.set(xx + i, base - k, i > w - 2 ? P.brn3 : P.brn1);
        }
        pc.set(xx, base - h + 4, P.abyss4);
      } else if (r > 0.15) {
        // rocha
        for (let y = 0; y < 10; y++) for (let i = -8 + Math.floor(y / 2); i <= 8 - Math.floor(y / 3); i++) pc.set(xx + i, base - y, y > 7 ? P.brn3 : P.brn2);
      }
    }
  }
  return pc;
}

// ------------------------------------------------------------------ chão (onde o grupo caminha)

export const GROUND_H = CIN_H - CIN_GROUND_Y;

export function cinGround(c: Climate): PixelCanvas {
  const pc = new PixelCanvas(CIN_W, GROUND_H);
  for (let y = 0; y < GROUND_H; y++)
    for (let x = 0; x < CIN_W; x++) {
      const n = nz(x, y, 21);
      const path = y > 12 && y < 34;
      let col: Color;
      if (c === 'night') col = path ? (n > 0.8 ? P.brn3 : P.brn2) : n > 0.85 ? P.grn4 : n > 0.4 ? P.grn2 : P.grn1;
      else if (c === 'winter') col = path ? (n > 0.8 ? P.gray4 : P.gray5) : n > 0.9 ? P.ice2 : n > 0.3 ? P.gray6 : P.white;
      else col = path ? (n > 0.85 ? P.brn2 : P.brn3) : n > 0.88 ? P.amb3 : n > 0.4 ? P.amb2 : P.brn4;
      if (y < 2) col = mix(col, P.ink, 0.35);
      pc.set(x, y, col);
    }
  // detalhes: tufos, montes de neve, ossos
  for (let x = 4; x < CIN_W; x += 13) {
    const r = nz(x, 30, 22);
    const y = r > 0.5 ? 6 + Math.floor(r * 4) : 38 + Math.floor(r * 20);
    if (c === 'night') {
      pc.set(x, y, P.grn5);
      pc.set(x + 1, y - 1, P.grn5);
      pc.set(x - 1, y - 1, P.grn4);
    } else if (c === 'winter') {
      pc.hline(x - 3, x + 3, y, P.white);
      pc.hline(x - 2, x + 2, y - 1, P.white);
      pc.hline(x - 3, x + 3, y + 1, P.gray5);
    } else if (r > 0.7) {
      pc.hline(x - 2, x + 2, y, P.gray6);
      pc.set(x - 3, y - 1, P.gray6);
      pc.set(x + 3, y - 1, P.gray6);
    } else {
      // rachaduras
      for (let i = 0; i < 6; i++) pc.set(x + i, y + (i % 3 === 0 ? 1 : 0), P.brn2);
    }
  }
  return pc;
}

// ------------------------------------------------------------------ primeiro plano (passa rápido)

export const FG_H = 40;

export function cinFore(c: Climate): PixelCanvas {
  const pc = new PixelCanvas(CIN_W, FG_H);
  for (let x = 20; x < CIN_W; x += 90) {
    const r = nz(x, 40, 31);
    if (r < 0.3) continue;
    const xx = x + Math.floor(r * 40);
    if (c === 'night') {
      for (let k = 0; k < 18; k++) pc.set(xx + Math.round(Math.sin(k / 3) * 2), FG_H - k, P.grn0);
      for (let k = 0; k < 14; k++) pc.set(xx + 4 + Math.round(Math.sin(k / 2)), FG_H - k, P.grn0);
    } else if (c === 'winter') {
      for (let y = 0; y < 14; y++) for (let i = -18 + y; i <= 18 - y; i++) pc.set(xx + i, FG_H - y, y > 11 ? P.white : P.gray5);
    } else {
      for (let y = 0; y < 12; y++) for (let i = -12 + y; i <= 10 - Math.floor(y / 2); i++) pc.set(xx + i, FG_H - y, P.brn1);
    }
  }
  return pc;
}

// ------------------------------------------------------------------ marco de chegada

export function cinLandmark(c: Climate): PixelCanvas {
  if (c === 'winter') {
    // portão do cemitério congelado com mausoléus atrás
    const pc = new PixelCanvas(220, 110);
    const b = 109;
    for (const [x, w, h] of [
      [18, 40, 46],
      [160, 44, 52],
    ] as const) {
      pc.rect(x, b - h, w, h, P.gray1);
      for (let i = 0; i <= w / 2; i++) pc.hline(x + i, x + w - i, b - h - i / 2, P.gray1);
      pc.hline(x - 2, x + w + 2, b - h, P.white);
      pc.rect(x + w / 2 - 5, b - 18, 10, 18, P.ink);
    }
    // pilares e grade
    for (const x of [74, 142]) {
      pc.rect(x, b - 60, 8, 60, P.gray2);
      pc.rect(x - 2, b - 64, 12, 4, P.gray3);
      pc.hline(x - 2, x + 9, b - 65, P.white);
    }
    for (let x = 84; x < 142; x += 5) {
      pc.vline(x, b - 50 + Math.round(Math.abs(Math.sin((x - 84) / 18)) * -6), b, P.gray0);
      pc.set(x, b - 51 + Math.round(Math.abs(Math.sin((x - 84) / 18)) * -6), P.gray3);
    }
    pc.hline(84, 141, b - 30, P.gray0);
    return pc;
  }
  if (c === 'ash') {
    // mansão em ruínas no deserto de cinzas, janelas acesas
    const pc = new PixelCanvas(260, 130);
    const b = 129;
    pc.rect(30, b - 70, 200, 70, P.brn0);
    for (let i = 0; i < 40; i++) pc.hline(30 + i * 2, 230 - i * 2, b - 70 - i, P.brn0);
    pc.rect(110, b - 120, 40, 50, P.brn0);
    for (let i = 0; i < 14; i++) pc.hline(110 + i, 150 - i, b - 120 - i, P.brn0);
    pc.rect(60, b - 104, 8, 30, P.brn0);
    pc.rect(196, b - 96, 8, 26, P.brn0);
    for (let wy = 0; wy < 2; wy++)
      for (let wx = 0; wx < 6; wx++) {
        const lit = noise(wx, wy, 41) > 0.35;
        const x = 44 + wx * 30;
        const y = b - 58 + wy * 26;
        pc.rect(x, y, 7, 10, lit ? P.abyss3 : P.ink);
        if (lit) pc.rect(x + 1, y + 1, 5, 3, P.abyss4);
      }
    pc.rect(123, b - 106, 14, 16, P.amb3);
    pc.rect(125, b - 104, 10, 6, P.amb4);
    pc.rect(118, b - 22, 24, 22, P.ink);
    return pc;
  }
  // vila (não usada como destino, mas disponível)
  const pc = new PixelCanvas(160, 80);
  pc.rect(20, 40, 50, 40, P.brn0);
  pc.rect(90, 30, 50, 50, P.brn0);
  pc.rect(40, 55, 6, 8, P.amb3);
  pc.rect(110, 45, 6, 8, P.amb3);
  return pc;
}
