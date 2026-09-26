/**
 * Inimigos anti-kite (v1.2): Acólito Sombrio, Caçador de Névoa e Portador do Ossário,
 * mais o escudo de ossos (4 estágios de rachadura, frente e lado) e seus destroços.
 * Mesmas matrizes/paletas e mesmo compositor dos demais personagens (32×32, contorno escuro).
 */
import { back, type ClassArt, composeArt, type Dir, mirror } from './characters.js';
import { P } from './palette.js';
import { PixelCanvas, type SheetBuilder } from './pixel.js';

export type SpecialType = 'shadowAcolyte' | 'mistStalker' | 'ossuaryBearer';

const SHADOW_DOWN = mirror([
  '.......h',
  '......hh',
  '......hh',
  '.....hhh',
  '....hhhh',
  '....hHHH',
  '...hhHyH',
  '...hHHHH',
  '...hhHHH',
  '..hrrrrr',
  '..rrgrrr',
  '.rrrrgrr',
  '.rrrrrrr',
  'urrrrrrr',
  'urrrrrrr',
  '.rrrrttt',
  '.rrrrrrr',
  '.rrrrrrr',
  '..rrrrrr',
  '..rrrrrr',
]);
const SHADOW_SIDE = [
  '.........h......',
  '........hh......',
  '........hhh.....',
  '.......hhhh.....',
  '......hhhhhh....',
  '.....hhhhhHHH...',
  '.....hhhhHHyH...',
  '.....hhhhhHHH...',
  '......hhhhHH....',
  '.....rrrrrrr....',
  '....rrrrgrrr....',
  '....rrrrrgrrr...',
  '....rrrrrrrrr...',
  '....rrrrrrrruu..',
  '....rrrrrrrr....',
  '....rrrtttrr....',
  '...rrrrrrrrr....',
  '...rrrrrrrrr....',
  '...rrrrrrrrr....',
  '...rrrrrrrrrr...',
];

const STALKER_DOWN = mirror([
  '........',
  '........',
  '........',
  '......hh',
  '....hhhh',
  '...hhhhh',
  '...hhSSS',
  '...hSeSS',
  '...hhSSS',
  '...ccccc',
  '..cccccc',
  '.ccCcccc',
  '.cc.cccc',
  'ss..cCcc',
  's...cccc',
  'k...ctcc',
  'k...cccc',
  '.....ccc',
  '........',
  '........',
]);
const STALKER_SIDE = [
  '................',
  '................',
  '................',
  '.........hhh....',
  '.......hhhhhh...',
  '......hhhhhSSS..',
  '......hhhhSSeS..',
  '.......hhhhSSS..',
  '.....ccccccc....',
  '....cccccccc....',
  '....ccccCccc....',
  '...ccccccc......',
  '...cccccc.sss...',
  '....cccc....ss..',
  '....ctcc.....kk.',
  '....cccc........',
  '....cccc........',
  '.....ccc........',
  '................',
  '................',
];

const BEARER_DOWN = mirror([
  '........',
  '........',
  '.....www',
  '....wwww',
  '....wWww',
  '....wEWw',
  '....wwww',
  '..oooooo',
  '.oooaaaa',
  '.ooaaAaa',
  '.saaaaaa',
  '.saaAaaa',
  '.saaaaaa',
  '.saaaaaa',
  '.s.aaaaa',
  '...atttt',
  '...aaaaa',
  '...aaaaa',
  '...aa.aa',
  '........',
]);
const BEARER_SIDE = [
  '................',
  '................',
  '.......wwww.....',
  '......wwwwww....',
  '......wwwWww....',
  '......wwwEWw....',
  '......wwwwww....',
  '....oooooo......',
  '...oooaaaaa.....',
  '...ooaaaAaaa....',
  '....aaaaaaass...',
  '....aaaAaaass...',
  '....aaaaaaa.....',
  '....aaaaaaa.....',
  '....aaaaaaa.....',
  '....atttttt.....',
  '....aaaaaaa.....',
  '....aaaaaaa.....',
  '....aaa.aaa.....',
  '................',
];

const SPECIAL_ARTS: Record<SpecialType, ClassArt> = {
  shadowAcolyte: {
    pal: { h: 0x1a1428, H: P.ink, y: 0x7dffb0, r: 0x241a33, R: 0x181122, g: 0x3fbf8f, u: 0x7dffb0, t: P.abyss2, b: P.gray0 },
    down: SHADOW_DOWN,
    side: SHADOW_SIDE,
    up: back(SHADOW_DOWN, 9, { H: 'h', y: 'h' }),
    legs: 'robe',
    noShade: 'yug',
  },
  mistStalker: {
    pal: { h: 0x5b6680, S: 0x2b3142, e: P.ice3, c: 0x46506a, C: 0x39415a, s: 0x8a93a8, k: P.white, t: P.gray2, p: 0x39415a, b: P.gray0 },
    down: STALKER_DOWN,
    side: STALKER_SIDE,
    up: back(STALKER_DOWN, 9, { S: 'h', e: 'h' }),
    legs: 'adult',
    noShade: 'ek',
  },
  ossuaryBearer: {
    pal: { w: 0xd8d0b8, W: 0xa89f86, E: 0xff8a3a, o: 0xcfc6ab, a: 0x4a4038, A: 0x3a322c, s: 0x6d6a5a, t: P.red2, m: 0x3a322c, M: 0x2a241f, b: P.gray0 },
    down: BEARER_DOWN,
    side: BEARER_SIDE,
    up: back(BEARER_DOWN, 7, { W: 'w', E: 'w' }),
    legs: 'heavy',
    noShade: 'E',
  },
};

const GLOW: Record<SpecialType, number> = { shadowAcolyte: 0x7dffb0, mistStalker: P.ice3, ossuaryBearer: 0xff8a3a };

function specialFrames(sb: SheetBuilder, type: SpecialType): void {
  const art = SPECIAL_ARTS[type];
  const glow = GLOW[type];
  for (const dir of ['down', 'up', 'side'] as Dir[]) {
    const fwd = dir === 'side' ? 1 : 0;
    const fy = dir === 'down' ? 1 : dir === 'up' ? -1 : 0;
    for (let i = 0; i < 4; i++) sb.add(`${type}_walk_${dir}_${i}`, composeArt(art, { dir, leg: i, dx: 0, dy: i % 2 ? -1 : 0 }));
    sb.add(`${type}_windup_${dir}`, composeArt(art, { dir, leg: 0, dx: -fwd, dy: -1 - fy, cast: true, glow }));
    sb.add(`${type}_attack_${dir}`, composeArt(art, { dir, leg: dir === 'side' ? 0 : 1, dx: fwd * 2, dy: fy }));
    sb.add(`${type}_hurt_${dir}`, composeArt(art, { dir, leg: 2, dx: -fwd, dy: 1 }));
  }
  // salto (Caçador): corpo esticado de lado; recuperação: agachado ofegante
  sb.add(`${type}_air_side`, composeArt(art, { dir: 'side', leg: 0, dx: 2, dy: -2 }));
  for (let k = 0; k < 3; k++) {
    const full = composeArt(art, { dir: 'down', leg: 0, dx: 0, dy: 0 });
    const cut = new PixelCanvas(32, 32);
    const visible = 10 + k * 8;
    cut.blit(full, 0, 32 - visible, false, 0, 0, 32, visible);
    sb.add(`${type}_rise_${k}`, cut);
  }
}

// ---------------------------------------------------------------- escudo de ossos

const SHIELD_FRONT = [
  '..oooooo..',
  '.owwwwwwo.',
  'owwWwwWwwo',
  'owwwwwwwwo',
  'oWWWWWWWWo',
  'owwwkkwwwo',
  'owwkeekwwo',
  'owwkkkkwwo',
  'oWWWkkWWWo',
  'owwwwwwwwo',
  'owwWwwWwwo',
  'oWWWWWWWWo',
  '.owwwwwwo.',
  '.owwwwwwo.',
  '..owwwwo..',
  '...oooo...',
];
const SHIELD_SIDE = [
  '.oo.',
  'owwo',
  'owWo',
  'owwo',
  'oWWo',
  'owwo',
  'owko',
  'owko',
  'oWWo',
  'owwo',
  'owWo',
  'oWWo',
  'owwo',
  'owwo',
  '.oo.',
  '....',
];
const SHIELD_PAL = { o: P.ink, w: 0xe2dac4, W: 0xb3a88f, k: 0x6d6456, e: 0xff8a3a };

/** Rachaduras progressivas (0 intacto → 3 quase quebrando) em zigue-zague de 1 px. */
function crack(c: PixelCanvas, stage: number, w: number): void {
  const col = 0x3a322c;
  const paths: [number, number][][] = [
    [[2, 2], [3, 3], [3, 4], [4, 5]],
    [[w - 3, 9], [w - 4, 10], [w - 4, 11], [w - 5, 12]],
    [[2, 8], [3, 9], [2, 10], [3, 11], [4, 12], [4, 13]],
  ];
  for (let i = 0; i < stage && i < paths.length; i++) for (const [x, y] of paths[i] ?? []) if (c.get(x, y) !== -1) c.set(x, y, col);
}

function shield(stage: number, side: boolean): PixelCanvas {
  const rows = side ? SHIELD_SIDE : SHIELD_FRONT;
  const c = new PixelCanvas(rows[0]?.length ?? 10, rows.length);
  c.matrix(rows, SHIELD_PAL, 0, 0);
  crack(c, stage, c.w);
  return c;
}

function shieldDebris(): PixelCanvas {
  const c = new PixelCanvas(16, 7);
  const bone = 0xd8d0b8;
  const dark = 0xa89f86;
  c.rect(1, 3, 5, 2, bone);
  c.rect(7, 4, 4, 2, dark);
  c.rect(11, 2, 3, 2, bone);
  c.set(6, 2, bone);
  c.set(9, 1, dark);
  c.rect(4, 5, 2, 1, dark);
  c.outline(P.ink);
  return c;
}

export function buildSpecialFrames(sb: SheetBuilder): void {
  specialFrames(sb, 'shadowAcolyte');
  specialFrames(sb, 'mistStalker');
  specialFrames(sb, 'ossuaryBearer');
  for (let s = 0; s < 4; s++) {
    sb.add(`boneShield_front_${s}`, shield(s, false));
    sb.add(`boneShield_side_${s}`, shield(s, true));
  }
  sb.add('boneShield_debris', shieldDebris());
}
