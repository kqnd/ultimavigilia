/**
 * Arte do pacote de conteúdo: servos do Necromante, sobrevivente, objetivos (luas falsas,
 * totens, carrinho funerário, ritualista), minichefes, a Noiva do Inverno, itens no chão e
 * variantes de clima (inverno/cinzas) dos inimigos. Mesmo pipeline de matrizes e primitivas.
 */
import { type ClassArt, composeArt, type Dir, mirror, back } from './characters.js';
import { bayer, type Color, mix, PixelCanvas, SheetBuilder } from './pixel.js';
import { P } from './palette.js';
import type { Climate } from '../shared/config/chapters.js';

type Ramp = readonly [Color, Color, Color];
const GLOW_GREEN = 0xa8d05a;
const GLOW_LIGHT = 0xd8f08a;

function blob(c: PixelCanvas, cx: number, cy: number, rx: number, ry: number, ramp: Ramp): void {
  for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++)
    for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
      const nx = (x + 0.5 - cx) / rx;
      const ny = (y + 0.5 - cy) / ry;
      if (nx * nx + ny * ny > 1) continue;
      const t = nx * 0.55 + ny * 0.8 + (bayer(x, y) - 0.5) * 0.45;
      c.set(x, y, t < -0.42 ? ramp[2] : t < 0.3 ? ramp[1] : ramp[0]);
    }
}

function frameAll(sb: SheetBuilder, key: string, make: (i: number, dir: Dir) => PixelCanvas, extras: Record<string, PixelCanvas> = {}): void {
  for (const dir of ['down', 'up', 'side'] as Dir[]) for (let i = 0; i < 4; i++) sb.add(`${key}_walk_${dir}_${i}`, make(i, dir));
  for (const [k, v] of Object.entries(extras)) sb.add(`${key}_${k}`, v);
}

// ================================================================ servos e sobrevivente

const THRALL_DOWN = mirror([
  '........',
  '.....bbb',
  '....bbbb',
  '....bebb',
  '....bbbb',
  '.....bjb',
  '......bb',
  '...rrbbb',
  '..rr.bkb',
  '..rr.bbk',
  '..r..bkb',
  '..r.bbbb',
  '....b.bb',
  '....bbbb',
  '.....bb.',
]);
const THRALL_SIDE = [
  '................',
  '......bbbb......',
  '.....bbbbbb.....',
  '.....bbbbeb.....',
  '.....bbbbbb.....',
  '......bbjb......',
  '.......bb.......',
  '....rrbbbbb.....',
  '...rr.bkbkbb....',
  '...rr.bbbb.b....',
  '...r..bkbk.b....',
  '......bbbb......',
  '......b..b......',
  '......bbbb......',
  '.......bb.......',
];

const HORDE_DOWN = mirror([
  '.....f..',
  '....fff.',
  '....fFff',
  '....bbbb',
  '....bebb',
  '....bbbb',
  '.....bjb',
  '...b.bbb',
  '..bb.kbk',
  '..b..bbb',
  '.....kbk',
  '.....bbb',
  '....b.bb',
  '.....bb.',
]);
const HORDE_SIDE = [
  '.......f........',
  '......fff.......',
  '......fFff......',
  '.....bbbbbb.....',
  '.....bbbbeb.....',
  '.....bbbbbb.....',
  '......bbjb......',
  '....b..bb.......',
  '...bb.bkbkb.....',
  '...b..bbbb.b....',
  '......bkbk......',
  '......bbbb......',
  '......b..b......',
  '.......bb.......',
];

const SURVIVOR_DOWN = mirror([
  '........',
  '........',
  '.....hhh',
  '....hhhh',
  '....hsss',
  '....sess',
  '....ssss',
  '.....mSS',
  '.....sss',
  '...cccaa',
  '..ccccaa',
  '.sccccaa',
  'l.cccctt',
  'LLccccaa',
  'l..cccaa',
  '...cccaa',
  '...ccaaa',
  '...cccaa',
  '...cc.aa',
  '...cc.cc',
]);
const SURVIVOR_SIDE = [
  '................',
  '................',
  '......hhhh......',
  '.....hhhhhh.....',
  '.....hhhhsss....',
  '.....hhhssess...',
  '......hhssss....',
  '.......mSSs.....',
  '.......sss......',
  '.....cccaaa.....',
  '....ccccaaa.....',
  '....ccccaaas....',
  '....cccctttl....',
  '....ccccaaLLL...',
  '.....cccaa.l....',
  '.....cccaa......',
  '.....ccaaa......',
  '.....cccaa......',
  '.....cc.aa......',
  '.....cc.cc......',
];

const UNIT_ARTS: Record<'thrall' | 'horde' | 'survivor', ClassArt> = {
  thrall: {
    pal: { b: P.gray6, e: GLOW_LIGHT, j: P.gray3, k: P.gray3, r: P.brn3, p: P.gray5, P: P.gray4, q: P.gray4, d: P.gray3 },
    down: THRALL_DOWN,
    side: THRALL_SIDE,
    up: back(THRALL_DOWN, 7, { e: 'b', j: 'b' }),
    legs: 'kid',
    kid: true,
    noShade: 'e',
  },
  horde: {
    pal: { b: mix(P.gray5, GLOW_GREEN, 0.25), e: GLOW_LIGHT, j: P.gray3, k: P.gray3, f: GLOW_GREEN, F: GLOW_LIGHT, p: P.gray5, P: P.gray4, q: P.gray4, d: P.gray3 },
    down: HORDE_DOWN,
    side: HORDE_SIDE,
    up: back(HORDE_DOWN, 7, { e: 'b', j: 'b' }),
    legs: 'kid',
    kid: true,
    noShade: 'efF',
  },
  survivor: {
    pal: { h: P.brn3, s: P.skin2, S: P.skin1, e: P.ink, m: P.red2, c: P.blue4, a: P.gray4, t: P.brn2, l: P.amb3, L: P.amb5, p: P.brn2, P: P.brn1, q: P.brn1, b: P.brn1, d: P.gray1 },
    down: SURVIVOR_DOWN,
    side: SURVIVOR_SIDE,
    up: back(SURVIVOR_DOWN, 9, { s: 'h', e: 'h', m: 'h', S: 'h' }),
    legs: 'adult',
    noShade: 'elL',
  },
};

function unitFrames(sb: SheetBuilder, key: 'thrall' | 'horde' | 'survivor'): void {
  const art = UNIT_ARTS[key];
  for (const dir of ['down', 'up', 'side'] as Dir[]) {
    const fwd = dir === 'side' ? 1 : 0;
    const fy = dir === 'down' ? 1 : dir === 'up' ? -1 : 0;
    for (let i = 0; i < 4; i++) sb.add(`${key}_walk_${dir}_${i}`, composeArt(art, { dir, leg: i, dx: 0, dy: i % 2 ? -1 : 0 }));
    sb.add(`${key}_windup_${dir}`, composeArt(art, { dir, leg: 0, dx: -fwd, dy: -1 - fy, cast: true, glow: GLOW_LIGHT }));
    sb.add(`${key}_attack_${dir}`, composeArt(art, { dir, leg: dir === 'side' ? 0 : 1, dx: fwd * 2, dy: fy }));
  }
  for (let k = 0; k < 3; k++) {
    const full = composeArt(art, { dir: 'down', leg: 0, dx: 0, dy: 0 });
    const cut = new PixelCanvas(32, 32);
    const visible = 8 + k * 8;
    cut.blit(full, 0, 32 - visible, false, 0, 0, 32, visible);
    sb.add(`${key}_rise_${k}`, cut);
  }
}

// ================================================================ objetivos

function falseMoon(f: number): PixelCanvas {
  const c = new PixelCanvas(28, 44);
  // pedestal de pedra
  c.rect(8, 34, 12, 8, P.gray2);
  c.rect(6, 40, 16, 3, P.gray3);
  c.rect(10, 30, 8, 4, P.gray3);
  c.hline(8, 19, 34, P.gray4);
  // lua (crescente clara com halo pulsante)
  const r = 9;
  const cx = 14;
  const cy = 14 - (f % 2);
  for (let y = -r; y <= r; y++)
    for (let x = -r; x <= r; x++) {
      const d = Math.hypot(x, y);
      if (d > r) continue;
      const inner = Math.hypot(x - 4, y - 2) < r - 2;
      if (inner) continue;
      c.set(cx + x, cy + y, d > r - 1.5 ? P.ice1 : bayer(cx + x, cy + y) > 0.75 ? P.ice2 : P.ice3);
    }
  c.ring(cx, cy, r + 2 + (f % 2), 1, P.ice2, 120);
  c.outline(P.outline);
  return c;
}

function abyssTotem(f: number): PixelCanvas {
  const c = new PixelCanvas(26, 50);
  // coluna de ossos empilhados
  for (let i = 0; i < 5; i++) {
    const y = 40 - i * 8;
    blob(c, 13, y, 8 - i * 0.6, 4, [P.abyss0, P.pur2, P.pur3]);
    c.rect(8 + i * 0.3, y - 1, 10 - i * 0.6, 1, P.gray5);
  }
  // crânio no topo com olhos
  blob(c, 13, 8, 7, 6, [P.gray3, P.gray5, P.gray6]);
  c.rect(9, 7, 3, 3, P.ink);
  c.rect(14, 7, 3, 3, P.ink);
  const eye = f % 2 ? P.abyss4 : P.abyss3;
  c.set(10, 8, eye);
  c.set(15, 8, eye);
  for (let i = -2; i <= 2; i++) c.vline(13 + i * 2, 12, 13, P.ink);
  // runa brilhante
  c.vline(13, 20, 30, f % 2 ? P.abyss4 : P.abyss3);
  c.hline(10, 16, 25, f % 2 ? P.abyss4 : P.abyss3);
  c.outline(P.outline);
  return c;
}

function funeralCart(f: number, side: boolean): PixelCanvas {
  const c = new PixelCanvas(44, 34);
  const wood: Ramp = [P.brn1, P.brn2, P.brn3];
  if (side) {
    // carroça de perfil com caixão
    c.rect(4, 14, 34, 9, wood[1]);
    c.hline(4, 37, 14, wood[2]);
    c.hline(4, 37, 22, wood[0]);
    // caixão
    c.rect(8, 5, 26, 9, P.gray1);
    c.rect(9, 6, 24, 7, P.pur1);
    c.vline(21, 6, 12, P.amb3);
    c.hline(18, 24, 8, P.amb3);
    // rodas girando
    for (const wx of [10, 32]) {
      c.ring(wx, 26, 6, 2, P.brn2);
      const a = (f / 4) * Math.PI;
      c.line(wx - Math.cos(a) * 5, 26 - Math.sin(a) * 5, wx + Math.cos(a) * 5, 26 + Math.sin(a) * 5, P.brn3);
      c.set(wx, 26, P.gray4);
    }
    // vela no caixão
    c.vline(30, 2, 5, P.gray6);
    c.set(30, 1, f % 2 ? P.amb4 : P.amb5);
  } else {
    c.rect(8, 10, 28, 16, wood[1]);
    c.rect(11, 4, 22, 14, P.gray1);
    c.rect(12, 5, 20, 12, P.pur1);
    c.vline(22, 6, 15, P.amb3);
    c.hline(18, 26, 9, P.amb3);
    for (const wx of [8, 36]) {
      c.rect(wx - 2, 20 + (f % 2), 4, 10, P.brn2);
      c.hline(wx - 2, wx + 1, 24 + (f % 2), P.gray4);
    }
    c.vline(30, 1, 4, P.gray6);
    c.set(30, 0, f % 2 ? P.amb4 : P.amb5);
  }
  c.outline(P.outline);
  return c;
}

// ================================================================ Noiva do Inverno (chefe do capítulo II)

interface BridePose {
  float: number;
  arms: number;
  phase2: boolean;
  glow: number;
}

function bride(p: BridePose, side: boolean): PixelCanvas {
  const S = 80;
  const c = new PixelCanvas(S, S);
  const cx = side ? 38 : 40;
  const f = p.float;
  const gown: Ramp = p.phase2 ? [P.blue1, P.ice0, P.ice1] : [P.ice0, P.ice1, P.ice2];
  const veil: Ramp = p.phase2 ? [P.ice0, P.ice1, P.ice2] : [P.ice1, P.ice2, P.ice3];
  // vestido longo, esfarrapado na barra (flutua)
  for (let y = 30; y < 72; y++) {
    const k = (y - 30) / 42;
    const w = 9 + k * 17;
    for (let x = -Math.round(w); x <= Math.round(w); x++) {
      const tatter = y > 64 && (Math.abs(x) + y + (p.glow ? 1 : 0)) % 5 === 0;
      if (tatter) continue;
      const t = x / w + (bayer(cx + x, y) - 0.5) * 0.35;
      c.set(cx + x + (side ? Math.round(k * 4) : 0), y + f, t < -0.45 ? gown[2] : t < 0.35 ? gown[1] : gown[0]);
    }
  }
  // corpo e braços
  blob(c, cx, 30 + f, 9, 8, gown);
  const armY = p.arms === 1 ? -10 : p.arms === -1 ? 6 : 0;
  for (const sx of side ? [1] : [-1, 1]) {
    const hx = cx + sx * (13 + (p.arms === -1 ? 6 : 0));
    const hy = 36 + f + armY;
    c.line(cx + sx * 7, 27 + f, hx, hy, P.ice2);
    c.line(cx + sx * 7, 28 + f, hx, hy + 1, P.ice1);
    c.set(hx, hy, P.white);
    if (p.arms !== 0) c.ring(hx, hy, 3, 1, p.phase2 ? P.ice3 : P.ice2, 200);
  }
  // cabeça pálida e véu
  blob(c, cx + (side ? 2 : 0), 16 + f, 6, 7, [P.pale0, P.pale2, P.pale3]);
  for (let y = 8; y < 44; y++) {
    const w = 8 + Math.max(0, y - 14) * 0.45;
    for (const sx of [-1, 1]) {
      const x = cx + (side ? 2 : 0) + sx * Math.round(w);
      c.set(x, y + f, veil[1]);
      if (y % 3 !== 0) c.set(x - sx, y + f, veil[2]);
    }
  }
  // coroa de gelo
  const hx = cx + (side ? 2 : 0);
  for (let i = -3; i <= 3; i++) {
    const h = 5 - Math.abs(i) + (p.phase2 ? 3 : 0) + (i % 2 === 0 ? 2 : 0);
    c.line(hx + i * 2, 9 + f, hx + i * 2, 9 + f - h, i % 2 ? P.ice2 : P.ice3);
  }
  // rosto
  const eye = p.phase2 ? P.ice3 : P.blue3;
  if (side) {
    c.rect(hx + 2, 15 + f, 2, 2, P.ink);
    c.set(hx + 2, 15 + f, eye);
  } else {
    c.rect(hx - 3, 15 + f, 2, 2, P.ink);
    c.rect(hx + 2, 15 + f, 2, 2, P.ink);
    c.set(hx - 3, 15 + f, eye);
    c.set(hx + 2, 15 + f, eye);
    c.hline(hx - 1, hx + 1, 20 + f, P.pale0);
  }
  if (p.phase2) {
    // estilhaços de gelo orbitando
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + p.glow * 0.5;
      const x = cx + Math.cos(a) * 26;
      const y = 36 + f + Math.sin(a) * 10;
      c.line(x, y - 3, x, y + 2, P.ice3);
      c.set(x, y - 4, P.white);
    }
  }
  c.outline(P.outline);
  return c;
}

function brideFrames(sb: SheetBuilder): void {
  for (const ph2 of [false, true]) {
    const k = ph2 ? 'frostBride2' : 'frostBride';
    for (let i = 0; i < 4; i++) {
      const pose: BridePose = { float: Math.round(Math.sin((i / 4) * Math.PI * 2) * 2), arms: 0, phase2: ph2, glow: i % 2 };
      sb.add(`${k}_walk_down_${i}`, bride(pose, false));
      sb.add(`${k}_walk_side_${i}`, bride(pose, true));
    }
    sb.add(`${k}_windup_down`, bride({ float: -2, arms: 1, phase2: ph2, glow: 1 }, false));
    sb.add(`${k}_windup_side`, bride({ float: -2, arms: 1, phase2: ph2, glow: 1 }, true));
    sb.add(`${k}_attack_down`, bride({ float: 1, arms: -1, phase2: ph2, glow: 0 }, false));
    sb.add(`${k}_attack_side`, bride({ float: 1, arms: -1, phase2: ph2, glow: 0 }, true));
  }
}

// ================================================================ itens no chão

function healItem(f: number): PixelCanvas {
  const c = new PixelCanvas(12, 14);
  // frasco de sangue/vinho com rolha
  c.rect(4, 1, 4, 2, P.brn3);
  c.rect(5, 3, 2, 2, P.gray5);
  blob(c, 6, 9, 4.5, 4.5, [P.red2, P.red4, P.red5]);
  c.set(4, 7, P.white);
  if (f % 2) c.set(5, 6, P.pale3);
  c.outline(P.outline);
  return c;
}

function corpsePile(v: number): PixelCanvas {
  const c = new PixelCanvas(18, 9);
  c.hline(2, 12, 6, P.gray4);
  c.hline(5, 15, 4, P.gray5);
  c.set(1, 5, P.gray5);
  c.set(1, 7, P.gray5);
  c.set(16, 3, P.gray5);
  c.set(16, 5, P.gray5);
  blob(c, 8 + v, 3, 3, 2.5, [P.gray3, P.gray5, P.gray6]);
  c.set(7 + v, 3, P.ink);
  c.set(9 + v, 3, P.ink);
  c.outline(P.outline);
  return c;
}

function altar(f: number): PixelCanvas {
  const c = new PixelCanvas(30, 30);
  c.rect(3, 16, 24, 11, P.gray2);
  c.rect(1, 13, 28, 4, P.gray3);
  c.hline(1, 28, 13, P.gray4);
  c.rect(12, 20, 6, 6, P.gray1);
  c.vline(15, 21, 25, P.amb3);
  c.hline(13, 17, 22, P.amb3);
  for (const x of [5, 24]) {
    c.rect(x - 1, 7, 3, 6, P.gray6);
    c.set(x, 6, f % 2 ? P.amb4 : P.amb5);
    c.set(x, 5, P.amb3);
  }
  c.outline(P.outline);
  return c;
}

// ================================================================ variantes de clima

/**
 * Recolore uma arte para o clima: inverno puxa para tons gelados e cria "neve" nos pixels do topo;
 * cinzas puxa para areia queimada, poeira no topo e brasas raras. O contorno fica intacto.
 */
export function climatize(src: PixelCanvas, climate: Climate): PixelCanvas {
  if (climate === 'night') return src;
  const out = src.clone();
  for (let y = 0; y < src.h; y++)
    for (let x = 0; x < src.w; x++) {
      const col = src.get(x, y);
      if (col < 0 || col === P.outline || col === P.ink) continue;
      const top = src.alpha(x, y - 1) === 0 || src.get(x, y - 1) === P.outline;
      if (climate === 'winter') {
        let c2 = mix(col, P.ice2, 0.22);
        if (top) c2 = mix(c2, P.ice3, 0.65);
        out.set(x, y, c2);
      } else {
        let c2 = mix(col, 0x9a7a5a, 0.22);
        if (top) c2 = mix(c2, 0xc9a878, 0.5);
        out.set(x, y, c2);
      }
    }
  return out;
}

/** Copia todos os quadros de uma folha com prefixo de clima e recoloração. */
export function climateSheet(src: { canvas: PixelCanvas; frames: Record<string, { x: number; y: number; w: number; h: number }> }, climate: Climate, prefix: string): SheetBuilder {
  const sb = new SheetBuilder();
  const recolored = climatize(src.canvas, climate);
  for (const [name, f] of Object.entries(src.frames)) {
    const c = new PixelCanvas(f.w, f.h);
    c.blit(recolored, 0, 0, false, f.x, f.y, f.w, f.h);
    sb.add(`${prefix}${name}`, c);
  }
  return sb;
}

/** Recolore um SheetBuilder inteiro (ex.: Acólito Supremo, Pai Ancestral) trocando o nome base. */
export function renameRecolor(src: { canvas: PixelCanvas; frames: Record<string, { x: number; y: number; w: number; h: number }> }, from: string, to: string, map: (c: Color) => Color, sb: SheetBuilder): void {
  for (const [name, f] of Object.entries(src.frames)) {
    if (!name.startsWith(`${from}_`)) continue;
    const c = new PixelCanvas(f.w, f.h);
    c.blit(src.canvas, 0, 0, false, f.x, f.y, f.w, f.h);
    for (let y = 0; y < c.h; y++)
      for (let x = 0; x < c.w; x++) {
        const col = c.get(x, y);
        if (col < 0 || col === P.outline || col === P.ink) continue;
        c.set(x, y, map(col));
      }
    sb.add(`${to}_${name.slice(from.length + 1)}`, c);
  }
}

// ================================================================ montagem

export function buildExtraSheet(): SheetBuilder {
  const sb = new SheetBuilder();
  unitFrames(sb, 'thrall');
  unitFrames(sb, 'horde');
  unitFrames(sb, 'survivor');
  frameAll(sb, 'falseMoon', (i) => falseMoon(i));
  frameAll(sb, 'abyssTotem', (i) => abyssTotem(i));
  frameAll(sb, 'funeralCart', (i, dir) => funeralCart(i, dir === 'side'));
  for (let f = 0; f < 2; f++) sb.add(`pickup_heal_${f}`, healItem(f));
  for (let v = 0; v < 3; v++) sb.add(`corpse_${v}`, corpsePile(v - 1));
  for (let f = 0; f < 2; f++) sb.add(`altar_${f}`, altar(f));
  return sb;
}

export function buildBrideSheet(): SheetBuilder {
  const sb = new SheetBuilder();
  brideFrames(sb);
  return sb;
}

export { GLOW_GREEN };
