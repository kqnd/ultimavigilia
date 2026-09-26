/**
 * Sprites das sete classes, gerados a partir de matrizes de pixels.
 * Vistas: frente (down), costas (up) e perfil (side, virado para a direita; o cliente espelha).
 * Frames: idle ×2, walk ×4, atk ×2, cast, hurt, dash por direção + caído.
 */
import type { ClassId } from '../shared/config/classes.js';
import { type Color, mix, PixelCanvas, SheetBuilder } from './pixel.js';
import { P } from './palette.js';

export const CHAR_FRAME = 32;
export type Dir = 'down' | 'up' | 'side';
export { mirror, back, autoShade };
export const DIRS: readonly Dir[] = ['down', 'up', 'side'];

/** Espelha meias-linhas (8 chars) formando linhas simétricas de 16. */
function mirror(half: readonly string[]): string[] {
  return half.map((r) => {
    const h = r.padEnd(8, '.').slice(0, 8);
    return h + [...h].reverse().join('');
  });
}

/** Deriva a vista de costas trocando rosto por cabelo/capuz nas primeiras linhas. */
function back(rows: readonly string[], headRows: number, map: Record<string, string>): string[] {
  return rows.map((r, i) => (i < headRows ? [...r].map((ch) => map[ch] ?? ch).join('') : r));
}

export type LegStyle = 'adult' | 'robe' | 'kid' | 'heavy';

export interface ClassArt {
  pal: Record<string, Color>;
  down: string[];
  side: string[];
  up: string[];
  legs: LegStyle;
  kid?: boolean;
  /** Letras que não recebem sombreamento automático (olhos, brilhos). */
  noShade?: string;
}

// ---------------------------------------------------------------- pernas

const LEGS: Record<LegStyle, { down: string[][]; side: string[][] }> = {
  adult: {
    down: [
      ['.....pp..pp.....', '.....pp..pp.....', '.....pp..pp.....', '.....pP..pP.....', '.....bb..bb.....', '....bbb..bbb....'],
      ['.....pp..pp.....', '.....pp..pp.....', '.....pp..pP.....', '.....pP..bb.....', '.....bb.bbb.....', '....bbb.........'],
      ['.....pp..pp.....', '.....pp..pp.....', '.....pp..pp.....', '.....pP..pP.....', '.....bb..bb.....', '....bbb..bbb....'],
      ['.....pp..pp.....', '.....pp..pp.....', '.....pP..pp.....', '.....bb..pP.....', '.....bbb.bb.....', '.........bbb....'],
    ],
    side: [
      ['.......ppp......', '......qpp.p.....', '.....qq...pp....', '.....qq....pp...', '....dd......bb..', '....dd......bbb.'],
      ['.......ppp......', '.......ppq......', '.......ppq......', '.......pp.q.....', '.......bbdd.....', '.......bbbb.....'],
      ['.......ppp......', '......ppq.q.....', '.....pp...qq....', '.....pp....qq...', '....bb......dd..', '....bb......ddd.'],
      ['.......ppp......', '.......qpp......', '.......qpp......', '......q.pp......', '.....ddbb.......', '.....ddbbb......'],
    ],
  },
  heavy: {
    down: [
      ['....mmm..mmm....', '....mmm..mmm....', '....mMm..mMm....', '....mmm..mmm....', '...bbbb..bbbb...', '...bbbb..bbbb...'],
      ['....mmm..mmm....', '....mmm..mmm....', '....mMm..mmm....', '....mmm..bbbb...', '...bbbb..bbbb...', '...bbbb.........'],
      ['....mmm..mmm....', '....mmm..mmm....', '....mMm..mMm....', '....mmm..mmm....', '...bbbb..bbbb...', '...bbbb..bbbb...'],
      ['....mmm..mmm....', '....mmm..mmm....', '....mmm..mMm....', '...bbbb..mmm....', '...bbbb..bbbb...', '.........bbbb...'],
    ],
    side: [
      ['......mmmm......', '.....qqmmmm.....', '....qqq..mmm....', '....qqq...mmm...', '...ddd.....bbb..', '...dddd....bbbb.'],
      ['......mmmm......', '......mmmq......', '......mmmq......', '......mmmqq.....', '......bbbdd.....', '......bbbbd.....'],
      ['......mmmm......', '.....mmqqqq.....', '....mmm..qqq....', '....mmm...qqq...', '...bbb.....ddd..', '...bbbb....dddd.'],
      ['......mmmm......', '......qmmm......', '......qmmm......', '.....qqmmm......', '.....ddbbb......', '.....dbbbb......'],
    ],
  },
  robe: {
    down: [
      ['....rrrrrrrr....', '....rrrrrrrr....', '...rrrrrrrrrr...', '...rrRrrrrRrr...', '...rrrrrrrrrr...', '....bb....bb....'],
      ['....rrrrrrrr....', '....rrrrrrrr....', '...rrrrrrrrrr...', '...rrRrrrrRrr...', '...rrrrrrrrrrr..', '....bb.....bb...'],
      ['....rrrrrrrr....', '....rrrrrrrr....', '...rrrrrrrrrr...', '...rrRrrrrRrr...', '...rrrrrrrrrr...', '....bb....bb....'],
      ['....rrrrrrrr....', '....rrrrrrrr....', '...rrrrrrrrrr...', '...rrRrrrrRrr...', '..rrrrrrrrrrr...', '...bb.....bb....'],
    ],
    side: [
      ['.....rrrrrr.....', '.....rrrrrrr....', '....rrrrrrrr....', '....rrRrrrrrr...', '...rrrrrrrrrr...', '....dd....bbb...'],
      ['.....rrrrrr.....', '.....rrrrrr.....', '....rrrrrrr.....', '....rrRrrrrr....', '....rrrrrrrr....', '......ddbb......'],
      ['.....rrrrrr.....', '.....rrrrrrr....', '....rrrrrrrr....', '....rrRrrrrrr...', '...rrrrrrrrrr...', '....bb....ddd...'],
      ['.....rrrrrr.....', '.....rrrrrr.....', '....rrrrrrr.....', '....rrRrrrrr....', '....rrrrrrrr....', '......bbdd......'],
    ],
  },
  kid: {
    down: [
      ['......s..s......', '......s..s......', '.....bb..bb.....'],
      ['......s..s......', '......s..bb.....', '.....bb.........'],
      ['......s..s......', '......s..s......', '.....bb..bb.....'],
      ['......s..s......', '.....bb..s......', '.........bb.....'],
    ],
    side: [
      ['......s..s......', '.....s....s.....', '....dd.....bb...'],
      ['.......ss.......', '.......ss.......', '.......bbd......'],
      ['......s..s......', '.....s....s.....', '....bb.....dd...'],
      ['.......ss.......', '.......ss.......', '......dbb.......'],
    ],
  },
};

// ---------------------------------------------------------------- classes

const HUNTER_DOWN = mirror([
  '........',
  '.......h',
  '......hh',
  '.....hhh',
  '....hhhh',
  '...hhhhh',
  '...hhHHH',
  '...hHsss',
  '...hHses',
  '...hHsss',
  '....hHss',
  '....aaaa',
  '..ccaaaa',
  '.cccccaa',
  '.ccccccc',
  '.cccccct',
  '.sccgttt',
  '..cccccc',
  '..cccCcc',
  '..ccc.Cc',
]);

const HUNTER_SIDE = [
  '................',
  '........h.......',
  '.......hhh......',
  '......hhhhh.....',
  '.....hhhhhhh....',
  '.....hhhhhhhh...',
  '....hhhhhhHHH...',
  '....hhhhhHssss..',
  '....hhhhhHsses..',
  '....hhhhhHssss..',
  '.....hhhhHsss...',
  '.....aaaaaaa....',
  '....ccccaaac....',
  '....ccccccccc...',
  '....cccccccccc..',
  '....ccccccccss..',
  '....ttttgttt....',
  '....cccccccc....',
  '...ccccCcccc....',
  '...cccc..ccc....',
];

const MAGE_DOWN = mirror([
  '.......h',
  '......hh',
  '.....hhh',
  '.....hhh',
  '....hhhh',
  '...hhhhh',
  '...hhHHH',
  '...hHSSS',
  '...hHSyS',
  '...hHwww',
  '....hwww',
  '...rrwww',
  '..rrrrww',
  '.rrrrrrw',
  '.rrrrrrr',
  '.rrrgrrr',
  '.srrrrrr',
  '..rrrttt',
  '..rrrrrr',
  '..rrgrrr',
]);

const MAGE_SIDE = [
  '.......hh.......',
  '......hhhh......',
  '.....hhhhhh.....',
  '.....hhhhhhh....',
  '....hhhhhhhhh...',
  '....hhhhhhhhhh..',
  '....hhhhhhHHHH..',
  '....hhhhhhHSSS..',
  '....hhhhhhHSyS..',
  '....hhhhhhHwww..',
  '.....hhhhhwwww..',
  '.....rrrrrwww...',
  '....rrrrrrrw....',
  '....rrrrrrrrr...',
  '....rrrrrrrrrr..',
  '....rrgrrrrrss..',
  '....rrrrrrrr....',
  '....rrrtttrr....',
  '...rrrrrrrrr....',
  '...rrrrgrrrrr...',
];

const TANK_DOWN = mirror([
  '.......a',
  '......aa',
  '.....mmm',
  '....mmmm',
  '....mmmm',
  '....mmmm',
  '....mvvv',
  '....mmmv',
  '....mmmm',
  '....Mmmm',
  '.nnnMMMM',
  'nnnnnccc',
  'nnnnmccc',
  '.mmmmcgg',
  '.mmmmccg',
  '.mmmmccc',
  '.uumtttt',
  '..mmcccc',
  '..mmcccc',
  '...mcccc',
]);

const TANK_SIDE = [
  '................',
  '.......aaa......',
  '......mmmaa.....',
  '.....mmmmmma....',
  '.....mmmmmmm....',
  '.....mmmmmmm....',
  '.....mmmmvvv....',
  '.....mmmmmmv....',
  '.....mmmmmmm....',
  '.....Mmmmmmm....',
  '...nnnnnMMM.....',
  '..nnnnnnnccc....',
  '..nnnnnnmcccc...',
  '...mmmmmmcccc...',
  '...mmmmmmcgcc...',
  '...mmmmmmcccuu..',
  '...mmtttttttuu..',
  '...mmmcccccc....',
  '...mmmcccccc....',
  '...mmmcccccc....',
];

const VAMP_DOWN = mirror([
  '........',
  '........',
  '.....hhh',
  '....hhhh',
  '...hhhhh',
  '...hhhhh',
  '...hhhsh',
  '...hssss',
  'K..hsyss',
  'KK..sSss',
  'KaK..sss',
  'KaaKcccv',
  'kaaKcccv',
  'kaakcccv',
  'kaakcccv',
  'kaakcccc',
  'kaaksccc',
  'kaakcccc',
  'kaakcccc',
  'kkakcccc',
  'kkk.....',
  'kk......',
]);

const VAMP_SIDE = [
  '................',
  '................',
  '.......hhhh.....',
  '......hhhhhh....',
  '.....hhhhhhhh...',
  '.....hhhhhhhs...',
  '..K..hhhhhssss..',
  '..KK.hhhhsssss..',
  '..KaKhhhhsssy...',
  '..KaKKhhsssss...',
  '..KaaKk.sssw....',
  '..kaakkccvv.....',
  '.kaakccccvvv....',
  '.kaakcccccvv....',
  '.kaakcccccsss...',
  'kaaakccccc.sy...',
  'kaaakcccccc.....',
  'kaaakcccccc.....',
  'kkaakcccccc.....',
  'kkkakcccccc.....',
  '.kkkk...........',
  '.kkk............',
];

// Berserker: cabelo selvagem, barba, manto de pele nos ombros, peito nu pintado de sangue.
const BERS_DOWN = mirror([
  '.....h..',
  '...h.hh.',
  '..hhhhhh',
  '..hhhhhh',
  '.hhhhhhh',
  '..hHssss',
  '..hsssss',
  '..hsesss',
  '..hsrsss',
  '...bbbbb',
  '..fbbbbs',
  'fffffsss',
  'fFffssrs',
  '.ssfsssr',
  '.ss.ssss',
  '.ss.tttt',
  '.sk.cccc',
  '...ccccc',
  '..cccccc',
  '..cc.ccc',
]);

const BERS_SIDE = [
  '........h.......',
  '......h.hh......',
  '.....hhhhhh.....',
  '.....hhhhhhh....',
  '....hhhhhhhhh...',
  '....hhhhhHsss...',
  '....hhhhhssss...',
  '....hhhhsseess..',
  '.....hhhssrss...',
  '.....hhhbbbbb...',
  '......fbbbbb....',
  '....ffffffsss...',
  '...fFfffssrss...',
  '....fffssssr....',
  '.....sssssssk...',
  '.....tttttttk...',
  '.....cccccc.....',
  '.....cccccc.....',
  '....ccc.cccc....',
  '....cc...ccc....',
];

// Necromante: capuz puído, rosto na sombra com olhos verde-amarelados, broche de crânio, manto rasgado.
const NECRO_DOWN = mirror([
  '.......h',
  '......hh',
  '.....hhh',
  '....hhhh',
  '...hhhhh',
  '...hhHHH',
  '..hhHSSS',
  '..hhHSyS',
  '...hHSSS',
  '...hhHjj',
  '..rrhhww',
  '.rrrrrwg',
  '.rrrrrrr',
  'srrrrRrr',
  '.rrrrrrr',
  '.rrrkkkk',
  '..rrrrrr',
  '..rRrrrr',
  '..rrr.rr',
  '..r.rr.r',
]);

const NECRO_SIDE = [
  '.......hh.......',
  '......hhhh......',
  '.....hhhhhh.....',
  '.....hhhhhhh....',
  '....hhhhhhhhh...',
  '....hhhhhhHHH...',
  '....hhhhhHSSSS..',
  '....hhhhhHSSyS..',
  '....hhhhhhHSSS..',
  '.....hhhhhHjj...',
  '.....rrrhhww....',
  '....rrrrrrwg....',
  '....rrrrrrrrr...',
  '....rrrrrRrrss..',
  '....rrrrrrrr....',
  '....rrkkkkrr....',
  '...rrrrrrrrr....',
  '...rrRrrrrrr....',
  '...rrr.rrr.r....',
  '...r..rr..r.....',
];

const DOG_DOWN = mirror([
  '..y..h.h',
  '..hhhhhh',
  '.hhhhhhh',
  '.yhhhhhh',
  '.hhHHHHs',
  '.hhsesss',
  '..hsssss',
  '...ssssm',
  '....cccc',
  '...ccccc',
  '..sccgcc',
  '..sccccc',
  '....cccc',
  '....pppp',
]);

const DOG_SIDE = [
  '.......y.h......',
  '.....hhhhh.h....',
  '....yhhhhhhh....',
  '....hhhhhhhhh...',
  '....hhhhhhHHHs..',
  '....hhhhhhsess..',
  '.....hhhhsssss..',
  '......hhsssssm..',
  '.......cccc.....',
  '......cccccc....',
  '......cccccss...',
  '......cgcccc....',
  '......cccc......',
  '......pppp......',
];

// Lapanha: jovem de Salvador, cabelo curto encaracolado, bandana verde com listra vermelha,
// sorriso largo, regata clara com faixa verde, bermuda verde-casca e cesto de melancias no quadril.
const LAP_DOWN = [
  '................',
  '.....hhhhhh.....',
  '....hhhhhhhh....',
  '...hhhhhhhhhh...',
  '...gggggggggg...',
  '...gRggggggRgg..',
  '...hssssssssh.g.',
  '...ssessssess...',
  '....ssssssss....',
  '....sMwwwwMs....',
  '.....ssssss.....',
  '..sssbcccccsss..',
  '..ssccbcccccss..',
  '..sscGGbGGccss..',
  '..ssccccbcccss..',
  '..s.cccccbcc.s..',
  '..s.rrrrrrbKKs..',
  '....oooooKkRKk..',
  '....ooooo.kkkk..',
  '....ooo..ooo....',
];

const LAP_SIDE = [
  '................',
  '.......hhhh.....',
  '.....hhhhhhhh...',
  '....hhhhhhhhhh..',
  '....gggggggggg..',
  '..gRgggggggggg..',
  '..g.hhhhhssssS..',
  '....hhhhsssess..',
  '....hhhhssssss..',
  '.....hhhssssMw..',
  '......sssssss...',
  '....kkccccccss..',
  '...kKKccccccss..',
  '...kKRcGGGGcss..',
  '...kkkccccccs...',
  '....k.ccccccs...',
  '......rrrrrr....',
  '......oooooo....',
  '......oooooo....',
  '......ooo.oo....',
];

/** Comemoração (vitória): braços para cima, sorriso aberto. */
const LAP_CHEER = [
  '..ss........ss..',
  '..ss.hhhhhh.ss..',
  '..s.hhhhhhhh.s..',
  '..shhhhhhhhhhs..',
  '..sggggggggggs..',
  '..sgRggggggRgs..',
  '..shssssssssh.g.',
  '..sssessssesss..',
  '..s.ssssssss.s..',
  '..s.sMwwwwMs.s..',
  '...s.sMMMMs.s...',
  '....sbcccccs....',
  '....ccbccccc....',
  '....cGGbGGcc....',
  '....ccccbccc....',
  '....cccccbcc....',
  '....rrrrrrbKK...',
  '....oooooKkRKk..',
  '....ooooo.kkkk..',
  '....ooo..ooo....',
];

const LAP_PAL: Record<string, Color> = {
  h: 0x1c1512, g: 0x3f9a3a, R: 0xd23a3a, s: 0x8f5b3d, S: 0x6f4330, e: P.ink, M: 0x6a1c1c, w: 0xf4efe4,
  c: 0xe6dfcb, G: 0x3f9a3a, b: 0x6b4a2f, r: 0xc23434, o: 0x2f6e3a, k: 0xb8894a, K: 0x3f9a3a,
  p: 0x8f5b3d, P: 0x6f4330, q: 0x6f4330, d: 0x4a3322,
};

const ARTS: Record<ClassId, ClassArt> = {
  hunter: {
    pal: { h: P.grn4, H: P.grn2, s: P.skin2, S: P.skin1, e: P.ink, a: P.red3, c: P.brn3, C: P.brn2, t: P.brn1, g: P.sil1, p: P.gray2, P: P.gray1, q: P.gray1, b: P.brn2, d: P.brn1 },
    down: HUNTER_DOWN,
    side: HUNTER_SIDE,
    up: back(HUNTER_DOWN, 11, { s: 'h', S: 'H', e: 'h', H: 'h' }),
    legs: 'adult',
    noShade: 'e',
  },
  mage: {
    pal: { h: P.pur3, H: P.pur1, S: P.pur1, y: P.arc3, w: P.gray6, r: P.pur4, R: P.pur2, g: P.mag2, t: P.amb2, s: P.skin2, b: P.gray1, d: P.gray0 },
    down: MAGE_DOWN,
    side: MAGE_SIDE,
    up: back(MAGE_DOWN, 11, { S: 'h', y: 'h', w: 'h', H: 'h' }),
    legs: 'robe',
    noShade: 'yg',
  },
  tank: {
    pal: { a: P.red3, m: P.gray4, M: P.gray3, v: P.ink, n: P.gray5, c: P.blue4, g: P.amb4, u: P.gray2, t: P.brn1, b: P.gray2, q: P.gray3, d: P.gray1 },
    down: TANK_DOWN,
    side: TANK_SIDE,
    up: back(TANK_DOWN, 10, { v: 'm' }),
    legs: 'heavy',
    noShade: 'v',
  },
  vampire: {
    pal: { h: P.gray0, s: P.pale2, S: P.pale1, y: P.red4, w: P.white, k: P.pur1, K: P.pur3, a: P.red2, c: P.gray1, v: P.red3, p: P.gray0, P: P.ink, q: P.ink, b: P.ink, d: P.ink },
    down: VAMP_DOWN,
    side: VAMP_SIDE,
    up: back(VAMP_DOWN, 11, { s: 'h', S: 'h', y: 'h' }),
    legs: 'adult',
    noShade: 'yw',
  },
  berserker: {
    pal: { h: P.red3, H: P.red2, s: P.skin2, S: P.skin1, e: P.ink, r: P.red4, b: P.brn3, f: P.gray4, F: P.gray3, t: P.brn1, k: P.skin1, c: P.brn2, p: P.brn2, P: P.brn1, q: P.brn1, d: P.gray1 },
    down: BERS_DOWN,
    side: BERS_SIDE,
    up: back(BERS_DOWN, 10, { s: 'h', e: 'h', r: 'h', b: 'h', H: 'h' }),
    legs: 'adult',
    noShade: 'er',
  },
  necromancer: {
    pal: { h: mix(P.grn4, P.gray3, 0.5), H: P.grn2, S: P.ink, y: 0xc8e86a, j: P.gray5, w: P.gray6, g: 0xa8d05a, r: mix(P.pur3, P.grn3, 0.45), R: P.pur2, k: P.brn3, s: P.gray5, b: P.gray1, d: P.gray0 },
    down: NECRO_DOWN,
    side: NECRO_SIDE,
    up: back(NECRO_DOWN, 11, { S: 'h', y: 'h', j: 'h', H: 'h' }),
    legs: 'robe',
    noShade: 'yg',
  },
  dog: {
    pal: { h: P.gray1, H: P.ink, y: P.mag2, s: P.skin2, S: P.skin1, e: P.white, m: P.red2, c: P.amb3, g: P.mag1, p: P.blue4, b: P.red3, d: P.red2 },
    down: DOG_DOWN,
    side: DOG_SIDE,
    up: back(DOG_DOWN, 8, { s: 'h', e: 'h', m: 'h', H: 'h' }),
    legs: 'kid',
    kid: true,
    noShade: 'eym',
  },
  lapanha: {
    pal: LAP_PAL,
    down: LAP_DOWN,
    side: LAP_SIDE,
    up: back(LAP_DOWN, 11, { s: 'h', e: 'h', M: 'h', w: 'h', S: 'h' }),
    legs: 'adult',
    noShade: 'ewMR',
  },
};

/** Quadros extras do Lapanha: comer a melancia (Safra) e comemorar (vitória). */
function lapanhaExtras(sb: SheetBuilder): void {
  const art = ARTS.lapanha;
  // comer: fatia de melancia na boca (vermelha com sementes, casca branca e verde), mãos segurando
  for (let k = 0; k < 2; k++) {
    const c = composeArt(art, { dir: 'down', leg: 0, dx: 0, dy: k }, 'lapanha');
    const y = 12 + k;
    c.rect(12, y - 1, 8, 1, P.outline);
    c.rect(11, y, 10, 3, P.outline);
    c.rect(12, y, 8, 1, 0xe04848);
    if (k === 1) {
      // mordida: falta um pedaço no topo
      c.set(15, y, P.outline);
      c.set(16, y, P.outline);
    }
    c.set(14, y, P.ink);
    c.set(18, y, P.ink);
    c.rect(12, y + 1, 8, 1, 0xf0ead8);
    c.rect(13, y + 2, 6, 1, 0x3f9a3a);
    c.set(11, y + 1, LAP_PAL.s as Color);
    c.set(20, y + 1, LAP_PAL.s as Color);
    sb.add(`lapanha_eat_${k}`, c);
  }
  const cheerArt: ClassArt = { ...art, down: LAP_CHEER };
  for (let k = 0; k < 2; k++) sb.add(`lapanha_cheer_${k}`, composeArt(cheerArt, { dir: 'down', leg: k * 2, dx: 0, dy: -k }, 'lapanha'));
}

// ---------------------------------------------------------------- montagem

function autoShade(c: PixelCanvas, skip: Set<Color>): void {
  const src = c.clone();
  for (let y = 0; y < c.h; y++) {
    for (let x = 0; x < c.w; x++) {
      const col = src.get(x, y);
      if (col < 0 || skip.has(col)) continue;
      const right = src.alpha(x + 1, y) === 0;
      const bottom = src.alpha(x, y + 1) === 0;
      const left = src.alpha(x - 1, y) === 0;
      const top = src.alpha(x, y - 1) === 0;
      if (right || bottom) c.set(x, y, mix(col, P.ink, 0.32));
      else if (left || top) c.set(x, y, mix(col, P.white, 0.16));
    }
  }
}

export interface FrameOpts {
  dir: Dir;
  leg: number;
  dx: number;
  dy: number;
  cast?: boolean;
  shout?: boolean;
  /** Cor do brilho das mãos em cast (sobrepõe padrão da classe). */
  glow?: Color;
}

function compose(cls: ClassId, o: FrameOpts): PixelCanvas {
  return composeArt(ARTS[cls], o, cls);
}

export function composeArt(art: ClassArt, o: FrameOpts, cls: ClassId | null = null): PixelCanvas {
  const c = new PixelCanvas(CHAR_FRAME, CHAR_FRAME);
  const legs = LEGS[art.legs];
  const legRows = (o.dir === 'side' ? legs.side : legs.down)[o.leg % 4] as string[];
  const kid = art.kid === true;
  const legY = kid ? 27 : 24;
  const upperY = kid ? 13 : 4;
  const pal = { ...art.pal };
  // pernas escuras 'q/d' = perna de trás; se a classe não define, usa as normais
  pal.q ??= pal.p ?? P.gray1;
  pal.d ??= pal.b ?? P.gray0;
  pal.P ??= pal.p ?? P.gray1;
  pal.R ??= pal.r ?? P.gray1;
  pal.M ??= pal.m ?? P.gray3;
  c.matrix(legRows, pal, 8, legY);
  const upper = o.dir === 'side' ? art.side : o.dir === 'up' ? art.up : art.down;
  c.matrix(upper, pal, 8 + o.dx, upperY + o.dy);
  if (o.shout && o.dir !== 'up') {
    // boca aberta em grito
    const mx = o.dir === 'side' ? 8 + o.dx + 13 : 8 + o.dx + 7;
    const my = upperY + o.dy + 7;
    c.rect(mx, my, 2, 2, P.red1);
    c.set(mx, my, P.white);
  }
  const skip = new Set<Color>([...(art.noShade ?? '')].map((ch) => pal[ch] ?? -2));
  autoShade(c, skip);
  if (o.cast) {
    // brilho nas mãos (habilidade)
    const glow = o.glow ?? (cls === 'mage' ? P.arc3 : cls === 'dog' ? P.mag2 : cls === 'vampire' ? P.red5 : cls === 'hunter' ? P.sil2 : cls === 'necromancer' ? 0xa8d05a : cls === 'berserker' ? P.red5 : cls === 'lapanha' ? 0xff7a6a : P.amb4);
    const hy = upperY + o.dy + (kid ? 9 : 12);
    if (o.dir === 'side') {
      c.set(8 + o.dx + 14, hy, glow);
      c.set(8 + o.dx + 15, hy - 1, glow);
    } else {
      c.set(8 + o.dx, hy, glow);
      c.set(8 + o.dx + 15, hy, glow);
      c.set(8 + o.dx - 1, hy - 1, glow);
      c.set(8 + o.dx + 16, hy - 1, glow);
    }
  }
  c.outline(P.outline);
  return c;
}

/** Folha de sprites completa de uma classe. */
export function buildClassSheet(cls: ClassId): SheetBuilder {
  const sb = new SheetBuilder();
  for (const dir of DIRS) {
    const fwd = dir === 'side' ? 1 : 0;
    const fwdY = dir === 'down' ? 1 : dir === 'up' ? -1 : 0;
    sb.add(`${cls}_idle_${dir}_0`, compose(cls, { dir, leg: 0, dx: 0, dy: 0 }));
    sb.add(`${cls}_idle_${dir}_1`, compose(cls, { dir, leg: 0, dx: 0, dy: 1 }));
    for (let i = 0; i < 4; i++) sb.add(`${cls}_walk_${dir}_${i}`, compose(cls, { dir, leg: i, dx: 0, dy: i % 2 === 1 ? -1 : 0 }));
    sb.add(`${cls}_atk_${dir}_0`, compose(cls, { dir, leg: 0, dx: -fwd, dy: -fwdY, shout: false }));
    sb.add(`${cls}_atk_${dir}_1`, compose(cls, { dir, leg: dir === 'side' ? 0 : 1, dx: fwd * 2, dy: fwdY, shout: cls === 'dog' }));
    sb.add(`${cls}_cast_${dir}`, compose(cls, { dir, leg: 0, dx: 0, dy: -1, cast: true, shout: cls === 'dog' }));
    sb.add(`${cls}_hurt_${dir}`, compose(cls, { dir, leg: 2, dx: -fwd, dy: 1 }));
    sb.add(`${cls}_dash_${dir}`, compose(cls, { dir, leg: dir === 'side' ? 0 : 1, dx: fwd * 2, dy: fwdY }));
  }
  // queda: joelhos cedem (tronco afunda sobre as pernas) → tomba de lado → caído
  sb.add(`${cls}_fall_0`, compose(cls, { dir: 'down', leg: 2, dx: 0, dy: 3 }));
  const tilt = compose(cls, { dir: 'side', leg: 2, dx: 1, dy: 5 });
  const fall1 = new PixelCanvas(CHAR_FRAME, CHAR_FRAME);
  // inclina o quadro lateral em degraus de 2 linhas (cisalhamento pixel a pixel, sem reamostragem)
  for (let yy = 0; yy < CHAR_FRAME; yy++) fall1.blit(tilt, Math.floor((CHAR_FRAME - yy) / 5) - 2, yy, false, 0, yy, CHAR_FRAME, 1);
  sb.add(`${cls}_fall_1`, fall1);
  // caído: vista frontal girada
  const lying = compose(cls, { dir: 'down', leg: 0, dx: 0, dy: 0 }).rot90();
  const down = new PixelCanvas(CHAR_FRAME, CHAR_FRAME);
  down.blit(lying, 0, 6);
  sb.add(`${cls}_down`, down);
  if (cls === 'lapanha') lapanhaExtras(sb);
  return sb;
}

// ---------------------------------------------------------------- armas (apontando para a direita)

export function buildWeapons(): SheetBuilder {
  const sb = new SheetBuilder();
  const w = (name: string, rows: string[], pal: Record<string, Color>): void => {
    const c = new PixelCanvas(rows[0]?.length ?? 1, rows.length);
    c.matrix(rows, pal, 0, 0);
    c.outline(P.outline);
    const o = new PixelCanvas(c.w + 2, c.h + 2);
    o.blit(c, 1, 1);
    o.outline(P.outline);
    sb.add(name, c);
  };
  w('crossbow', ['..........m...', '.........mm...', 'wwwwwwwwwwwwmm', 'bbbbbbbbbwwww.', '...ll....mm...', '...l......m...'], { w: P.brn4, b: P.brn2, m: P.sil1, l: P.brn3 });
  w('staff', ['...............yy.', 'bbbbbbbbbbbbbbgyyy', '...............yy.'], { b: P.brn3, g: P.amb3, y: P.arc3 });
  w('mace', ['........mmm.', '.......mMmMm', 'hhhhhhhmmmmm', '.......mMmMm', '........mmm.'], { h: P.brn3, m: P.gray5, M: P.gray3 });
  w('sword', ['..g...........', 'hhgnnnnnnnnnnw', 'hhgnnnnnnnnnnw', '..g...........'], { h: P.brn2, g: P.amb3, n: P.gray5, w: P.white });
  w('shield', ['.mmmmmmmm.', 'mccccccccm', 'mccggggccm', 'mcccggcccm', 'mcccggcccm', 'mccggggccm', 'mccccccccm', 'mccccccccm', '.mccccccm.', '..mccccm..', '...mmmm...'], { m: P.gray5, c: P.blue3, g: P.amb4 });
  w('claw', ['y.y.y', '.yyy.', '..y..'], { y: P.red5 });
  w('axe', ['.........mm.', '........mMMm', 'hhhhhhhhmMMm', 'hhhhhhhhmMMm', '........mMMm', '.........mm.'], { h: P.brn3, m: P.gray5, M: P.gray3 });
  w('boneStaff', ['..............ww.', 'bbbbbbbbbbbbbwgw.', 'bbbbbbbbbbbbbwww.', '..............ww.'], { b: P.gray5, w: P.gray6, g: 0xa8d05a });
  // melancias na mão do Lapanha: pequena (básico) e crescendo na carga do Q (4 tamanhos, rachada no máximo)
  const melonPal = { G: 0x4fb04a, g: 0x24602a, k: 0x7a1f1f, w: P.amb5 };
  w('melonHeld', ['.gGgG.', 'gGgGgG', 'GgGgGg', 'gGgGgG', '.gGgG.'], melonPal);
  w('melonQ_0', ['..gGgG..', '.gGgGgG.', 'gGgGgGgG', 'GgGgGgGg', 'gGgGgGgG', '.gGgGgG.', '..gGgG..'], melonPal);
  w('melonQ_1', ['...gGgG...', '.gGgGgGgG.', '.GgGgGgGg.', 'gGgGgGgGgG', 'GgGgGgGgGg', 'gGgGgGgGgG', '.GgGgGgGg.', '.gGgGgGgG.', '...gGgG...'], melonPal);
  w('melonQ_2', ['....gGgG....', '..gGgGgGgG..', '.gGgGgGgGgG.', '.GgGgGgGgGg.', 'gGgGgGgGgGgG', 'GgGgGgGgGgGg', 'gGgGgGgGgGgG', '.GgGgGgGgGg.', '.gGgGgGgGgG.', '..GgGgGgGg..', '....GgGg....'], melonPal);
  w('melonQ_3', ['....gGgG....', '..gGgGkGgG..', '.gGgGgkgGgG.', '.GgGgGgkGgw.', 'gGgGkGgGgGgG', 'GgGgGkGgGgGg', 'gGgkGgGgkGgG', '.GgGgGgGkGg.', '.gGgGgGgGgG.', '..GgGgGgGg..', '....GgGg....'], melonPal);
  return sb;
}

export const CLASS_WEAPON: Record<ClassId, string | null> = {
  hunter: 'crossbow',
  mage: 'staff',
  tank: 'mace',
  vampire: null,
  berserker: 'axe',
  dog: null,
  necromancer: 'boneStaff',
  lapanha: 'melonHeld',
};
