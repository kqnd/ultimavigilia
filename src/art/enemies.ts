/**
 * Inimigos e chefes. Comuns usam matrizes (mesmo pipeline dos jogadores); criaturas grandes
 * usam primitivas sombreadas com dithering ordenado, parametrizadas por pose para animar.
 */
import { back, type ClassArt, composeArt, type Dir, mirror } from './characters.js';
import { buildBrideSheet, buildExtraSheet, renameRecolor } from './extra.js';
import { buildSpecialFrames } from './specials.js';
import { bayer, type Color, mix, PixelCanvas, SheetBuilder } from './pixel.js';
import { P } from './palette.js';

// ---------------------------------------------------------------- utilidades de volume

type Ramp = readonly [Color, Color, Color];

/** Elipse com luz vinda de cima/esquerda, em 3 tons com dithering. */
function blob(c: PixelCanvas, cx: number, cy: number, rx: number, ry: number, ramp: Ramp, lx = -0.55, ly = -0.8): void {
  for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
    for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
      const nx = (x + 0.5 - cx) / rx;
      const ny = (y + 0.5 - cy) / ry;
      const d = nx * nx + ny * ny;
      if (d > 1) continue;
      const light = -(nx * lx + ny * ly) * -1;
      const t = light + (bayer(x, y) - 0.5) * 0.45;
      c.set(x, y, t > 0.42 ? ramp[2] : t > -0.3 ? ramp[1] : ramp[0]);
    }
  }
}

/** Membro grosso entre dois pontos. */
function limb(c: PixelCanvas, x0: number, y0: number, x1: number, y1: number, w: number, ramp: Ramp): void {
  const steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0)));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    blob(c, x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, w / 2, w / 2, ramp);
  }
}

function tri(c: PixelCanvas, ax: number, ay: number, bx: number, by: number, cx: number, cy: number, col: Color): void {
  const minX = Math.floor(Math.min(ax, bx, cx));
  const maxX = Math.ceil(Math.max(ax, bx, cx));
  const minY = Math.floor(Math.min(ay, by, cy));
  const maxY = Math.ceil(Math.max(ay, by, cy));
  const s = (px: number, py: number, qx: number, qy: number, rx: number, ry: number): number => (px - rx) * (qy - ry) - (qx - rx) * (py - ry);
  for (let y = minY; y <= maxY; y++)
    for (let x = minX; x <= maxX; x++) {
      const px = x + 0.5;
      const py = y + 0.5;
      const d1 = s(px, py, ax, ay, bx, by);
      const d2 = s(px, py, bx, by, cx, cy);
      const d3 = s(px, py, cx, cy, ax, ay);
      const neg = d1 < 0 || d2 < 0 || d3 < 0;
      const pos = d1 > 0 || d2 > 0 || d3 > 0;
      if (!(neg && pos)) c.set(x, y, col);
    }
}

function finish(c: PixelCanvas): PixelCanvas {
  c.outline(P.outline);
  return c;
}

// ---------------------------------------------------------------- comuns por matriz

const SHAMBLER_DOWN = mirror([
  '........',
  '........',
  '........',
  '.....hhh',
  '....hhss',
  '....ssss',
  '....syss',
  '....ssss',
  '....sSmm',
  '.....sss',
  '..cccccc',
  '.scccccc',
  '.sccCccc',
  '.sccccCc',
  'ss.ccccc',
  's..ccCcc',
  '...ctccc',
  '...cccc.',
  '....c.cc',
  '........',
]);
const SHAMBLER_SIDE = [
  '................',
  '................',
  '................',
  '.......hhh......',
  '......hhsss.....',
  '......hsssss....',
  '......ssssys....',
  '.......sssss....',
  '.......sSmm.....',
  '......cccc......',
  '.....ccccccsssss',
  '.....cccccc.....',
  '.....ccCccccssss',
  '.....cccccc.....',
  '.....ccccCc.....',
  '.....cctccc.....',
  '.....cccccc.....',
  '......cc.cc.....',
  '................',
  '................',
];
const RUNNER_DOWN = mirror([
  '........',
  '........',
  '........',
  '........',
  '......hh',
  '....hhss',
  '....ssss',
  '....syys',
  '....sSss',
  '.....smm',
  '...ccccc',
  '..sccccc',
  '.s.cCccc',
  's..ccccc',
  '...ccccc',
  '...ctttt',
  '...ccccc',
  '....cc.c',
  '........',
  '........',
]);
const RUNNER_SIDE = [
  '................',
  '................',
  '................',
  '................',
  '................',
  '..........hh....',
  '........hhsss...',
  '........ssssyy..',
  '........sssSmm..',
  '.....cccccc.....',
  '....ccccccc.....',
  '...scccccc......',
  '..ss.cccCc......',
  '.....cccc.......',
  '.....ctcc.......',
  '.....cccc.......',
  '.....cccc.......',
  '......c.cc......',
  '................',
  '................',
];
const ACOLYTE_DOWN = mirror([
  '........',
  '........',
  '......hh',
  '.....hhh',
  '....hhhh',
  '...hhhhh',
  '...hhHHH',
  '...hHHyH',
  '...hHHHH',
  '....hHHH',
  '...rrrrr',
  '..rrrrgr',
  '.rrrrrgr',
  '.rrrrrrr',
  '.urrrrrr',
  '.urrrrrr',
  '..rrrttt',
  '..rrrrrr',
  '..rrrrrr',
  '..rrrrrr',
]);
const ACOLYTE_SIDE = [
  '................',
  '................',
  '.......hh.......',
  '......hhhh......',
  '.....hhhhhh.....',
  '....hhhhhhhhh...',
  '....hhhhhhHHHH..',
  '....hhhhhhHHyH..',
  '....hhhhhhHHHH..',
  '.....hhhhhHHH...',
  '.....rrrrrrr....',
  '....rrrrrrrr....',
  '....rrrrrrrrr...',
  '....rrrrrrrrr...',
  '....rrrrrrrruu..',
  '....rrrrrrrr....',
  '....rrrtttrr....',
  '...rrrrrrrrr....',
  '...rrrrrrrrr....',
  '...rrrrrrrrrr...',
];

const ZOMBIE_SKIN = mix(P.grn5, P.gray4, 0.45);
const ARTS: Record<'shambler' | 'runner' | 'acolyte', ClassArt> = {
  shambler: {
    pal: { h: P.gray1, s: ZOMBIE_SKIN, S: mix(ZOMBIE_SKIN, P.ink, 0.35), y: P.amb4, m: P.red0, c: P.blue2, C: P.blue1, t: P.brn1, p: P.gray2, P: P.gray1, b: P.gray1 },
    down: SHAMBLER_DOWN,
    side: SHAMBLER_SIDE,
    up: back(SHAMBLER_DOWN, 10, { s: 'h', S: 'h', y: 'h', m: 'h' }),
    legs: 'adult',
    noShade: 'ym',
  },
  runner: {
    pal: { h: P.gray0, s: mix(ZOMBIE_SKIN, P.pale2, 0.4), S: ZOMBIE_SKIN, y: P.red4, m: P.red0, c: P.red1, C: P.red0, t: P.gray1, p: P.gray1, P: P.gray0, b: P.ink },
    down: RUNNER_DOWN,
    side: RUNNER_SIDE,
    up: back(RUNNER_DOWN, 10, { s: 'h', S: 'h', y: 'h', m: 'h' }),
    legs: 'adult',
    noShade: 'ym',
  },
  acolyte: {
    pal: { h: P.red2, H: P.red0, y: P.abyss4, r: P.pur2, R: P.pur1, g: P.abyss3, u: P.abyss4, t: P.amb1, s: P.pale1, b: P.gray0, d: P.ink },
    down: ACOLYTE_DOWN,
    side: ACOLYTE_SIDE,
    up: back(ACOLYTE_DOWN, 10, { H: 'h', y: 'h' }),
    legs: 'robe',
    noShade: 'yug',
  },
};

function commonFrames(sb: SheetBuilder, type: 'shambler' | 'runner' | 'acolyte'): void {
  const art = ARTS[type];
  const glow = type === 'acolyte' ? P.abyss4 : P.red5;
  for (const dir of ['down', 'up', 'side'] as Dir[]) {
    const fwd = dir === 'side' ? 1 : 0;
    const fy = dir === 'down' ? 1 : dir === 'up' ? -1 : 0;
    for (let i = 0; i < 4; i++) sb.add(`${type}_walk_${dir}_${i}`, composeArt(art, { dir, leg: i, dx: 0, dy: i % 2 ? -1 : 0 }));
    sb.add(`${type}_windup_${dir}`, composeArt(art, { dir, leg: 0, dx: -fwd, dy: -1 - fy, cast: true, glow }));
    sb.add(`${type}_attack_${dir}`, composeArt(art, { dir, leg: dir === 'side' ? 0 : 1, dx: fwd * 2, dy: fy }));
    sb.add(`${type}_hurt_${dir}`, composeArt(art, { dir, leg: 2, dx: -fwd, dy: 1 }));
  }
  // surgindo da terra: metade de baixo recortada
  for (let k = 0; k < 3; k++) {
    const full = composeArt(art, { dir: 'down', leg: 0, dx: 0, dy: 0 });
    const cut = new PixelCanvas(32, 32);
    const visible = 10 + k * 8;
    cut.blit(full, 0, 32 - visible, false, 0, 0, 32, visible);
    sb.add(`${type}_rise_${k}`, cut);
  }
}

// ---------------------------------------------------------------- lobisomem

interface WolfPose {
  crouch: number;
  leg: number; // fase 0..3
  arm: number; // -1 recolhido, 0 normal, 1 golpe
  jaw: number;
  stretch: number; // salto
}

const FUR: Ramp = [P.gray1, P.gray2, P.gray3];
const FUR_BOSS: Ramp = [P.blue1, P.blue2, P.blue4];

function wolfSide(size: number, pose: WolfPose, fur: Ramp, eye: Color, scale = 1): PixelCanvas {
  const c = new PixelCanvas(size, size);
  const s = scale;
  const oy = size - 40 * s;
  const cr = pose.crouch * s;
  const X = (v: number): number => v * s;
  const Y = (v: number): number => oy + v * s + cr;
  const lp = (pose.leg * Math.PI) / 2;
  // cauda
  blob(c, X(7), Y(21), X(4), X(2.5), fur);
  // perna de trás (longe)
  const back1 = Math.sin(lp) * 4;
  limb(c, X(14), Y(26), X(12 - back1), Y(32), X(4), [fur[0], fur[0], fur[1]]);
  limb(c, X(12 - back1), Y(32), X(14 - back1), Y(38) - cr, X(3), [fur[0], fur[0], fur[1]]);
  // braço de trás
  const ax = pose.arm * 6;
  limb(c, X(24), Y(20), X(27 + ax), Y(29 - pose.arm * 4), X(3.5), [fur[0], fur[0], fur[1]]);
  // tronco curvado
  blob(c, X(17 + pose.stretch * 2), Y(21), X(9 + pose.stretch * 2), X(7), fur);
  blob(c, X(23 + pose.stretch * 2), Y(18), X(7), X(6.5), fur);
  // peito claro
  blob(c, X(25 + pose.stretch * 2), Y(21), X(3.5), X(3.5), [fur[1], fur[2], mix(fur[2], P.white, 0.25)]);
  // perna da frente (perto)
  const f1 = Math.sin(lp + Math.PI) * 4;
  limb(c, X(16), Y(27), X(14 - f1), Y(33), X(4.5), fur);
  limb(c, X(14 - f1), Y(33), X(17 - f1), Y(38) - cr, X(3.5), fur);
  c.rect(X(17 - f1), Y(38) - cr - 1, X(3), 1, P.gray6);
  // cabeça
  const hx = 29 + pose.stretch * 3;
  blob(c, X(hx), Y(13), X(5.5), X(5), fur);
  // focinho
  blob(c, X(hx + 5), Y(15), X(4), X(2.4), fur);
  c.set(X(hx + 8.5), Y(14), P.ink);
  if (s > 1) c.set(X(hx + 8.5) + 1, Y(14), P.ink);
  // mandíbula
  if (pose.jaw > 0) {
    blob(c, X(hx + 4), Y(18 + pose.jaw), X(3.5), X(1.6), [fur[0], fur[0], fur[1]]);
    c.rect(X(hx + 2), Y(16.5), X(6), X(1 + pose.jaw * 0.6), P.red1);
    for (let i = 0; i < 3 * s; i++) c.set(X(hx + 3) + i * 2, Y(16.5), P.white);
  } else {
    for (let i = 0; i < 2 * s; i++) c.set(X(hx + 4) + i * 2, Y(17), P.white);
  }
  // orelhas
  tri(c, X(hx - 3), Y(10), X(hx - 1), Y(3), X(hx + 1), Y(10), fur[1]);
  tri(c, X(hx), Y(10), X(hx + 2), Y(4), X(hx + 3.5), Y(10), fur[2]);
  // olho
  c.set(X(hx + 2), Y(11.5), eye);
  if (s > 1) c.rect(X(hx + 2), Y(11.5), 2, 2, eye);
  // braço da frente com garras
  limb(c, X(25), Y(20), X(29 + ax), Y(28 - pose.arm * 5), X(4), fur);
  const hx2 = X(29 + ax);
  const hy2 = Y(28 - pose.arm * 5);
  for (let i = 0; i < 3; i++) c.line(hx2 + i * s - s, hy2 + 2 * s, hx2 + i * s, hy2 + 4 * s, P.gray6);
  // juba
  for (let i = 0; i < 6; i++) tri(c, X(18 + i * 2.2), Y(15 - (i % 2)), X(19 + i * 2.2), Y(9.5 + (i % 3)), X(21 + i * 2.2), Y(15), fur[2]);
  return finish(c);
}

function wolfFront(size: number, pose: WolfPose, fur: Ramp, eye: Color, backView: boolean, scale = 1): PixelCanvas {
  const c = new PixelCanvas(size, size);
  const s = scale;
  const cx = size / 2;
  const oy = size - 40 * s;
  const cr = pose.crouch * s;
  const Y = (v: number): number => oy + v * s + cr;
  const lp = (pose.leg * Math.PI) / 2;
  const la = Math.sin(lp) * 2 * s;
  // pernas
  limb(c, cx - 5 * s, Y(27), cx - 6 * s, Y(37) - cr - la, 4 * s, fur);
  limb(c, cx + 5 * s, Y(27), cx + 6 * s, Y(37) - cr + la, 4 * s, fur);
  if (backView) blob(c, cx, Y(30), 3 * s, 4 * s, fur);
  // tronco
  blob(c, cx, Y(22), 10 * s, 8 * s, fur);
  if (!backView) blob(c, cx, Y(23), 5 * s, 5 * s, [fur[1], fur[2], mix(fur[2], P.white, 0.25)]);
  // braços
  const ay = pose.arm * 6 * s;
  limb(c, cx - 9 * s, Y(18), cx - 12 * s, Y(29) - ay, 4 * s, fur);
  limb(c, cx + 9 * s, Y(18), cx + 12 * s, Y(29) - ay, 4 * s, fur);
  for (const sx of [-1, 1]) for (let i = 0; i < 3; i++) c.line(cx + sx * 12 * s - s + i * s, Y(31) - ay, cx + sx * 12 * s - s + i * s, Y(33) - ay, P.gray6);
  // cabeça
  blob(c, cx, Y(12), 6.5 * s, 5.5 * s, fur);
  tri(c, cx - 7 * s, Y(10), cx - 5 * s, Y(2), cx - 2 * s, Y(9), fur[1]);
  tri(c, cx + 2 * s, Y(9), cx + 5 * s, Y(2), cx + 7 * s, Y(10), fur[2]);
  if (!backView) {
    blob(c, cx, Y(16), 3.5 * s, 2.6 * s, [fur[1], fur[2], mix(fur[2], P.white, 0.2)]);
    c.rect(cx - s, Y(15), 2 * s, s, P.ink);
    c.rect(cx - 4 * s, Y(11), s * 2, s, eye);
    c.rect(cx + 2 * s, Y(11), s * 2, s, eye);
    if (pose.jaw > 0) {
      c.rect(cx - 2 * s, Y(18), 4 * s, s * 2, P.red1);
      c.set(cx - 2 * s, Y(18), P.white);
      c.set(cx + 2 * s - 1, Y(18), P.white);
    }
  }
  return finish(c);
}

function werewolfFrames(sb: SheetBuilder, key: string, size: number, fur: Ramp, eye: Color, scale: number): void {
  const base: WolfPose = { crouch: 0, leg: 0, arm: 0, jaw: 0, stretch: 0 };
  for (let i = 0; i < 4; i++) {
    const p = { ...base, leg: i, crouch: i % 2 };
    sb.add(`${key}_walk_side_${i}`, wolfSide(size, p, fur, eye, scale));
    sb.add(`${key}_walk_down_${i}`, wolfFront(size, p, fur, eye, false, scale));
    sb.add(`${key}_walk_up_${i}`, wolfFront(size, p, fur, eye, true, scale));
  }
  sb.add(`${key}_windup_side`, wolfSide(size, { ...base, crouch: 3, arm: -1, jaw: 1 }, fur, eye, scale));
  sb.add(`${key}_windup_down`, wolfFront(size, { ...base, crouch: 3, arm: 1, jaw: 1 }, fur, eye, false, scale));
  sb.add(`${key}_windup_up`, wolfFront(size, { ...base, crouch: 3, arm: 1 }, fur, eye, true, scale));
  sb.add(`${key}_attack_side`, wolfSide(size, { ...base, arm: 1, jaw: 2, stretch: 1 }, fur, eye, scale));
  sb.add(`${key}_attack_down`, wolfFront(size, { ...base, arm: -1, jaw: 2 }, fur, eye, false, scale));
  sb.add(`${key}_attack_up`, wolfFront(size, { ...base, arm: -1 }, fur, eye, true, scale));
  sb.add(`${key}_air_side`, wolfSide(size, { ...base, crouch: -2, arm: 1, jaw: 2, stretch: 1, leg: 1 }, fur, eye, scale));
  sb.add(`${key}_hurt_side`, wolfSide(size, { ...base, crouch: 1, arm: -1 }, fur, eye, scale));
  sb.add(`${key}_hurt_down`, wolfFront(size, { ...base, crouch: 1, arm: -1 }, fur, eye, false, scale));
  sb.add(`${key}_hurt_up`, wolfFront(size, { ...base, crouch: 1 }, fur, eye, true, scale));
}

// ---------------------------------------------------------------- pai de família amaldiçoado

interface DadPose {
  leg: number;
  armUp: number; // 0 normal, 1 erguido (preparo), -1 abaixado (golpe)
  bounce: number;
  throwing: boolean;
}

const DAD_SKIN = mix(P.skin2, P.gray4, 0.35);
const DAD_SKIN_R: Ramp = [mix(DAD_SKIN, P.ink, 0.35), DAD_SKIN, mix(DAD_SKIN, P.white, 0.2)];
const SHIRT: Ramp = [P.gray4, P.gray5, P.gray6];
const SHORTS: Ramp = [P.blue2, P.blue3, P.blue4];

function slipper(c: PixelCanvas, x: number, y: number, vertical: boolean): void {
  if (vertical) {
    c.rect(x, y, 3, 6, P.amb3);
    c.rect(x, y + 1, 3, 1, P.blue4);
    c.set(x + 1, y + 2, P.blue4);
  } else {
    c.rect(x, y, 6, 3, P.amb3);
    c.rect(x + 1, y, 1, 3, P.blue4);
    c.set(x + 2, y + 1, P.blue4);
  }
}

function dadSide(p: DadPose): PixelCanvas {
  const c = new PixelCanvas(40, 40);
  const b = p.bounce;
  const lp = (p.leg * Math.PI) / 2;
  const s1 = Math.sin(lp) * 3;
  // pernas finas
  limb(c, 17, 30 + b, 16 - s1, 37, 2.6, DAD_SKIN_R);
  limb(c, 22, 30 + b, 23 + s1, 37, 2.6, DAD_SKIN_R);
  // chinelos
  slipper(c, 14 - s1, 37, false);
  slipper(c, 21 + s1, 37, false);
  // bermuda
  blob(c, 19.5, 28 + b, 7, 4, SHORTS);
  // barriga
  blob(c, 21, 20 + b, 10, 9, SHIRT);
  // manchas de suor
  c.set(26, 17 + b, P.amb4);
  c.set(27, 18 + b, P.amb3);
  c.set(24, 23 + b, P.amb3);
  // cabeça (careca + bigode)
  blob(c, 22, 8 + b, 5.5, 5.5, DAD_SKIN_R);
  c.hline(17, 20, 5 + b, P.gray1);
  c.hline(17, 19, 6 + b, P.gray1);
  c.rect(24, 11 + b, 4, 1, P.gray0);
  c.set(26, 8 + b, P.red4);
  c.set(27, 8 + b, P.red5);
  // braço
  if (p.armUp > 0) {
    limb(c, 24, 15 + b, 25, 4 + b, 3, DAD_SKIN_R);
    slipper(c, 24, -1 + b + 2, true);
  } else if (p.armUp < 0) {
    limb(c, 24, 15 + b, 33, 20 + b, 3, DAD_SKIN_R);
    if (!p.throwing) slipper(c, 32, 19 + b, false);
  } else {
    limb(c, 24, 15 + b, 27, 23 + b, 3, DAD_SKIN_R);
    slipper(c, 26, 22 + b, true);
  }
  return finish(c);
}

function dadFront(p: DadPose, backView: boolean): PixelCanvas {
  const c = new PixelCanvas(40, 40);
  const b = p.bounce;
  const la = Math.sin((p.leg * Math.PI) / 2) * 1.5;
  limb(c, 16, 30 + b, 15, 36 - la, 2.6, DAD_SKIN_R);
  limb(c, 24, 30 + b, 25, 36 + la, 2.6, DAD_SKIN_R);
  slipper(c, 13, 36 - la, true);
  slipper(c, 24, 36 + la, true);
  blob(c, 20, 28 + b, 8, 4, SHORTS);
  blob(c, 20, 20 + b, 11, 9, SHIRT);
  if (!backView) {
    c.set(15, 17 + b, P.amb4);
    c.set(24, 22 + b, P.amb3);
    c.set(20, 25 + b, P.gray3);
  }
  // braços
  const ay = p.armUp * 9;
  limb(c, 10, 15 + b, 8, 25 + b - ay, 3, DAD_SKIN_R);
  limb(c, 30, 15 + b, 32, 25 + b - ay, 3, DAD_SKIN_R);
  if (p.armUp > 0) slipper(c, 31, 12 + b - 6, true);
  else if (!p.throwing) slipper(c, 31, 24 + b, true);
  blob(c, 20, 8 + b, 6, 6, DAD_SKIN_R);
  if (!backView) {
    c.rect(17, 12 + b, 7, 1, P.gray0);
    c.set(17, 13 + b, P.gray0);
    c.set(23, 13 + b, P.gray0);
    c.set(18, 8 + b, P.red4);
    c.set(22, 8 + b, P.red4);
    c.hline(17, 19, 7 + b, P.gray1);
    c.hline(21, 23, 7 + b, P.gray1);
  } else {
    c.hline(15, 25, 8 + b, P.gray1);
    c.hline(16, 24, 9 + b, P.gray1);
  }
  return finish(c);
}

function fatherFrames(sb: SheetBuilder): void {
  const base: DadPose = { leg: 0, armUp: 0, bounce: 0, throwing: false };
  for (let i = 0; i < 4; i++) {
    const p = { ...base, leg: i, bounce: i % 2 };
    sb.add(`father_walk_side_${i}`, dadSide(p));
    sb.add(`father_walk_down_${i}`, dadFront(p, false));
    sb.add(`father_walk_up_${i}`, dadFront(p, true));
  }
  sb.add('father_windup_side', dadSide({ ...base, armUp: 1 }));
  sb.add('father_windup_down', dadFront({ ...base, armUp: 1 }, false));
  sb.add('father_windup_up', dadFront({ ...base, armUp: 1 }, true));
  sb.add('father_attack_side', dadSide({ ...base, armUp: -1, bounce: 1, throwing: true }));
  sb.add('father_attack_down', dadFront({ ...base, armUp: -1, bounce: 1, throwing: true }, false));
  sb.add('father_attack_up', dadFront({ ...base, armUp: -1, bounce: 1, throwing: true }, true));
  sb.add('father_hurt_side', dadSide({ ...base, bounce: 1 }));
  sb.add('father_hurt_down', dadFront({ ...base, bounce: 1 }, false));
  sb.add('father_hurt_up', dadFront({ ...base, bounce: 1 }, true));
}

// ---------------------------------------------------------------- Patriarca do Abismo

interface PatPose {
  float: number;
  arms: number; // 0 repouso, 1 erguidos, -1 varredura
  phase2: boolean;
  glow: number;
}

const ROBE: Ramp = [P.abyss0, P.pur1, P.pur2];
const BONE: Ramp = [P.gray3, P.gray5, P.gray6];

function patriarch(p: PatPose, side: boolean): PixelCanvas {
  const S = 96;
  const c = new PixelCanvas(S, S);
  const cx = side ? 44 : 48;
  const f = p.float;
  // manto em farrapos até o chão
  for (let y = 40; y < 92; y++) {
    const w = 12 + (y - 40) * 0.45;
    for (let x = Math.floor(cx - w); x <= Math.ceil(cx + w); x++) {
      const tatter = y > 82 && (Math.floor(x / 3) + y) % 4 === 0;
      if (tatter) continue;
      const nx = (x - cx) / w;
      const t = -nx * 0.7 + (bayer(x, y) - 0.5) * 0.5 - (y - 40) / 120;
      c.set(x, y + f, t > 0.35 ? ROBE[2] : t > -0.35 ? ROBE[1] : ROBE[0]);
    }
  }
  if (p.phase2) {
    // tórax aberto com costelas e brilho do abismo
    blob(c, cx, 52 + f, 9, 11, [P.abyss1, P.abyss2, P.abyss3]);
    for (let i = 0; i < 4; i++) c.hline(cx - 8 + i, cx + 8 - i, 45 + i * 4 + f, P.gray5);
    c.vline(cx, 43 + f, 61 + f, P.gray5);
    blob(c, cx, 53 + f, 3, 3, [P.abyss3, P.abyss4, P.white]);
  }
  // ombros / capuz
  blob(c, cx, 36 + f, 20, 10, ROBE);
  // braços longos
  const armY = p.arms > 0 ? -18 : p.arms < 0 ? 6 : 0;
  const armX = p.arms < 0 ? 12 : 0;
  for (const sx of side ? [1] : [-1, 1]) {
    limb(c, cx + sx * 16, 38 + f, cx + sx * (24 + armX), 60 + f + armY, 7, ROBE);
    const hx = cx + sx * (24 + armX);
    const hy = 62 + f + armY;
    for (let i = -2; i <= 2; i++) c.line(hx + i * 2, hy, hx + i * 3, hy + 9, BONE[1]);
  }
  if (p.phase2 && !side) {
    // braços extras sombrios
    for (const sx of [-1, 1]) {
      limb(c, cx + sx * 14, 46 + f, cx + sx * 34, 40 + f - p.glow * 3, 4, [P.abyss0, P.abyss1, P.abyss2]);
    }
  }
  // cabeça: crânio com coroa de chifres
  blob(c, cx + (side ? 3 : 0), 22 + f, 9, 10, BONE);
  const hx = cx + (side ? 3 : 0);
  for (let i = -3; i <= 3; i++) {
    const h = 10 - Math.abs(i) * 2 + (p.phase2 ? 4 : 0);
    c.line(hx + i * 3, 14 + f, hx + i * 4, 14 + f - h, i % 2 ? BONE[0] : BONE[1]);
  }
  // capuz sobre o crânio
  for (let y = 12; y < 30; y++) {
    const w = 11 - Math.max(0, 16 - y) * 0.6;
    c.set(hx - Math.round(w), y + f, ROBE[1]);
    c.set(hx + Math.round(w), y + f, ROBE[0]);
    c.set(hx - Math.round(w) + 1, y + f, ROBE[1]);
    c.set(hx + Math.round(w) - 1, y + f, ROBE[0]);
  }
  // rosto
  const eye = p.phase2 ? P.abyss4 : P.red4;
  if (side) {
    c.rect(hx + 3, 21 + f, 4, 3, P.ink);
    c.rect(hx + 4, 22 + f, 2, 1, eye);
    c.rect(hx + 2, 27 + f, 6, 2, P.ink);
  } else {
    c.rect(hx - 6, 20 + f, 4, 4, P.ink);
    c.rect(hx + 2, 20 + f, 4, 4, P.ink);
    c.rect(hx - 5, 21 + f, 2, 2, eye);
    c.rect(hx + 3, 21 + f, 2, 2, eye);
    if (p.phase2) {
      c.rect(hx - 1, 16 + f, 2, 2, eye);
      c.set(hx - 8, 18 + f, eye);
      c.set(hx + 7, 18 + f, eye);
    }
    for (let i = -4; i <= 4; i += 2) c.vline(hx + i, 27 + f, 29 + f, P.ink);
  }
  return finish(c);
}

function patriarchFrames(sb: SheetBuilder): void {
  for (const ph2 of [false, true]) {
    const k = ph2 ? 'patriarch2' : 'patriarch';
    for (let i = 0; i < 4; i++) {
      const pose: PatPose = { float: Math.round(Math.sin((i / 4) * Math.PI * 2) * 2), arms: 0, phase2: ph2, glow: i % 2 };
      sb.add(`${k}_walk_down_${i}`, patriarch(pose, false));
      sb.add(`${k}_walk_side_${i}`, patriarch(pose, true));
    }
    sb.add(`${k}_windup_down`, patriarch({ float: -2, arms: 1, phase2: ph2, glow: 1 }, false));
    sb.add(`${k}_windup_side`, patriarch({ float: -2, arms: 1, phase2: ph2, glow: 1 }, true));
    sb.add(`${k}_attack_down`, patriarch({ float: 1, arms: -1, phase2: ph2, glow: 0 }, false));
    sb.add(`${k}_attack_side`, patriarch({ float: 1, arms: -1, phase2: ph2, glow: 0 }, true));
  }
}

// ---------------------------------------------------------------- folhas

export function buildEnemySheets(): Record<string, SheetBuilder> {
  const commons = new SheetBuilder();
  commonFrames(commons, 'shambler');
  commonFrames(commons, 'runner');
  commonFrames(commons, 'acolyte');
  buildSpecialFrames(commons);
  const elites = new SheetBuilder();
  werewolfFrames(elites, 'werewolf', 40, FUR, P.amb4, 1);
  fatherFrames(elites);
  // minichefes: Lobisomem Alfa (maior, pelagem de sangue seco), Acólito Supremo (gelo),
  // Pai Ancestral (cinzento) e o Acólito Ritualista (evento)
  const minis = new SheetBuilder();
  werewolfFrames(minis, 'alphaWolf', 56, [P.red0, P.brn2, P.red2], P.red5, 1.4);
  const builtCommons = commons.build(512);
  const builtElites = elites.build(512);
  renameRecolor(builtCommons, 'acolyte', 'highAcolyte', (c) => mix(c, P.ice1, 0.45), minis);
  renameRecolor(builtCommons, 'acolyte', 'ritualist', (c) => mix(c, 0x7fa84a, 0.35), minis);
  renameRecolor(builtElites, 'father', 'elderFather', (c) => mix(c, 0x8a7a6a, 0.45), minis);
  const devourer = new SheetBuilder();
  werewolfFrames(devourer, 'moonDevourer', 80, FUR_BOSS, P.amb5, 2);
  // fase 2: olhos vermelhos e pelagem ensanguentada
  const d2 = new SheetBuilder();
  werewolfFrames(d2, 'moonDevourer2', 80, [P.red0, P.blue2, P.red3], P.red5, 2);
  const pat = new SheetBuilder();
  patriarchFrames(pat);
  return { enemies_common: commons, enemies_elite: elites, enemies_mini: minis, boss_devourer: devourer, boss_devourer2: d2, boss_patriarch: pat, boss_bride: buildBrideSheet(), units: buildExtraSheet() };
}
