/**
 * Geometria das arenas. Servidor (colisão, navegação, spawns) e cliente (renderização, predição)
 * usam exatamente estes dados. A construção é determinística; cada partida trabalha sobre um
 * CLONE (`cloneMap`) porque caixas e barris podem ser destruídos.
 *
 * Três mapas do mesmo tamanho (64×40 tiles de 32 px), um por capítulo:
 *  - village: a vila amaldiçoada (praça, cemitério, ruínas, casas);
 *  - frozen:  o cemitério congelado (labirinto de sebes geladas em anéis, mausoléus, neve funda);
 *  - abyss:   a mansão no deserto de cinzas (salões internos, pátio, fissuras, areia movediça).
 */
import type { Climate, MapId } from './config/chapters.js';
import { MAP_IDS } from './config/chapters.js';
import { TILE } from './constants.js';
import { hash2 } from './math.js';

export const MAP_W = 64;
export const MAP_H = 40;
export const WORLD_W = MAP_W * TILE;
export const WORLD_H = MAP_H * TILE;

export enum Floor {
  Grass = 0,
  Cobble = 1,
  Dirt = 2,
  Soil = 3,
  Snow = 4,
  DeepSnow = 5,
  FrozenStone = 6,
  Sand = 7,
  Quicksand = 8,
  Marble = 9,
  AshRock = 10,
}

/** Chãos que desaceleram jogadores (inimigos adaptados ao clima ignoram). */
export const SLOW_FLOORS: ReadonlySet<Floor> = new Set([Floor.DeepSnow, Floor.Quicksand]);

export enum Obst {
  None = 0,
  Border = 1,
  House = 2,
  Ruin = 3,
  Tree = 4,
  Tomb = 5,
  Fence = 6,
  Crypt = 7,
  Fire = 8,
  Well = 9,
  Torch = 10,
  Crate = 11,
  Barrel = 12,
  Hedge = 13,
  Wall = 14,
  Pillar = 15,
  Obelisk = 16,
  Fissure = 17,
  Statue = 18,
}

/** Obstáculos baixos: bloqueiam movimento, mas projéteis passam por cima. */
export const LOW_OBSTACLES: ReadonlySet<Obst> = new Set([
  Obst.Tomb,
  Obst.Fence,
  Obst.Fire,
  Obst.Well,
  Obst.Torch,
  Obst.Crate,
  Obst.Barrel,
  Obst.Fissure,
]);

/** Objetos destrutíveis. */
export const BREAKABLE_OBST: ReadonlySet<Obst> = new Set([Obst.Crate, Obst.Barrel]);

export interface MapObject {
  kind: Obst;
  /** Coordenadas em tiles. */
  tx: number;
  ty: number;
  tw: number;
  th: number;
  variant: number;
}

export interface SpawnGate {
  id: number;
  name: string;
  x: number;
  y: number;
}

export interface Pt {
  x: number;
  y: number;
}

export interface Breakable {
  i: number;
  tx: number;
  ty: number;
  kind: Obst.Crate | Obst.Barrel;
}

export interface ArenaMap {
  id: MapId;
  climate: Climate;
  w: number;
  h: number;
  floor: Uint8Array;
  obst: Uint8Array;
  objects: MapObject[];
  spawns: SpawnGate[];
  /** Fogueira/braseiro central (px). */
  campfire: Pt;
  torches: Pt[];
  /** Pontos de nascimento/retorno dos jogadores (px). */
  starts: Pt[];
  /** Caixas e barris (índices estáveis). */
  breakables: Breakable[];
  /** Índice do quebrável por tile (-1 = nenhum). */
  breakIdx: Int16Array;
  /** Pontos de objetivos (chefes, eventos, desafios). */
  points: {
    boss: Pt;
    moons: Pt[];
    totems: Pt[];
    ritual: Pt[];
    altar: Pt[];
  };
  /** Luzes extras de ambientação (portas de cripta, janelas). */
  lights: Pt[];
}

const idx = (x: number, y: number): number => y * MAP_W + x;
const px = (t: number): number => (t + 0.5) * TILE;

class Builder {
  floor = new Uint8Array(MAP_W * MAP_H);
  obst = new Uint8Array(MAP_W * MAP_H);
  objects: MapObject[] = [];
  torches: Pt[] = [];
  gates: SpawnGate[] = [];
  lights: Pt[] = [];

  inb(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < MAP_W && y < MAP_H;
  }
  setF(x: number, y: number, f: Floor): void {
    if (this.inb(x, y)) this.floor[idx(x, y)] = f;
  }
  getF(x: number, y: number): Floor {
    return this.inb(x, y) ? (this.floor[idx(x, y)] as Floor) : Floor.Grass;
  }
  setO(x: number, y: number, o: Obst): void {
    if (this.inb(x, y)) this.obst[idx(x, y)] = o;
  }
  getO(x: number, y: number): Obst {
    return this.inb(x, y) ? (this.obst[idx(x, y)] as Obst) : Obst.Border;
  }
  rectF(x0: number, y0: number, x1: number, y1: number, f: Floor): void {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) this.setF(x, y, f);
  }
  /** Mancha arredondada e irregular de chão (neve funda, areia movediça). */
  blobF(cx: number, cy: number, r: number, f: Floor, only?: Floor): void {
    for (let y = Math.floor(cy - r - 1); y <= Math.ceil(cy + r + 1); y++)
      for (let x = Math.floor(cx - r - 1); x <= Math.ceil(cx + r + 1); x++) {
        const d = Math.hypot((x - cx) * 1, (y - cy) * 1.15);
        const rough = ((hash2(x, y, 57) % 100) / 100 - 0.5) * 1.2;
        if (d <= r + rough && (only === undefined || this.getF(x, y) === only)) this.setF(x, y, f);
      }
  }
  rectO(x0: number, y0: number, x1: number, y1: number, o: Obst): void {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) this.setO(x, y, o);
  }
  clearO(x0: number, y0: number, x1: number, y1: number): void {
    this.rectO(x0, y0, x1, y1, Obst.None);
    this.objects = this.objects.filter((o) => o.tx + o.tw - 1 < x0 || o.tx > x1 || o.ty + o.th - 1 < y0 || o.ty > y1);
  }
  object(kind: Obst, tx: number, ty: number, tw = 1, th = 1, variant = 0): void {
    this.rectO(tx, ty, tx + tw - 1, ty + th - 1, kind);
    this.objects.push({ kind, tx, ty, tw, th, variant });
  }
  /** Objeto de 1 tile só se o tile estiver livre. */
  put(kind: Obst, tx: number, ty: number, variant = 0): void {
    if (this.getO(tx, ty) === Obst.None) this.object(kind, tx, ty, 1, 1, variant);
  }
  isRoad(x: number, y: number): boolean {
    const f = this.floor[idx(x, y)];
    return f === Floor.Dirt || f === Floor.Cobble || f === Floor.FrozenStone || f === Floor.Marble;
  }
  torch(x: number, y: number): void {
    this.object(Obst.Torch, x, y);
    this.torches.push({ x: px(x), y: px(y) });
  }
  border(): void {
    for (let x = 0; x < MAP_W; x++) {
      this.setO(x, 0, Obst.Border);
      this.setO(x, MAP_H - 1, Obst.Border);
    }
    for (let y = 0; y < MAP_H; y++) {
      this.setO(0, y, Obst.Border);
      this.setO(MAP_W - 1, y, Obst.Border);
    }
    for (let x = 1; x < MAP_W - 1; x++) for (const y of [1, MAP_H - 2]) if (hash2(x, y, 7) % 3 !== 0 && !this.isRoad(x, y)) this.setO(x, y, Obst.Border);
    for (let y = 1; y < MAP_H - 1; y++) for (const x of [1, MAP_W - 2]) if (hash2(x, y, 9) % 3 !== 0 && !this.isRoad(x, y)) this.setO(x, y, Obst.Border);
  }
  gate(name: string, tx: number, ty: number, clear: [number, number, number, number], floor: Floor): void {
    this.clearO(clear[0], clear[1], clear[2], clear[3]);
    this.rectF(clear[0], clear[1], clear[2], clear[3], floor);
    this.gates.push({ id: this.gates.length, name, x: px(tx), y: px(ty) });
  }
  /** Tiles livres inalcançáveis a partir de (sx,sy) viram borda (evita inimigos presos). */
  connect(sx: number, sy: number): void {
    const reach = new Uint8Array(MAP_W * MAP_H);
    const q: number[] = [idx(sx, sy)];
    reach[idx(sx, sy)] = 1;
    while (q.length) {
      const i = q.pop() as number;
      const x = i % MAP_W;
      const y = (i / MAP_W) | 0;
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const) {
        const nx = x + dx;
        const ny = y + dy;
        if (!this.inb(nx, ny)) continue;
        const ni = idx(nx, ny);
        if (reach[ni] || this.obst[ni] !== Obst.None) continue;
        reach[ni] = 1;
        q.push(ni);
      }
    }
    for (let i = 0; i < reach.length; i++) if (!reach[i] && this.obst[i] === Obst.None) this.obst[i] = Obst.Border;
  }
  finish(id: MapId, climate: Climate, campfire: Pt, points: ArenaMap['points']): ArenaMap {
    const starts: Pt[] = [];
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2 + Math.PI / 6;
      starts.push({ x: campfire.x + Math.cos(a) * 64, y: campfire.y + Math.sin(a) * 58 });
    }
    const breakables: Breakable[] = [];
    const breakIdx = new Int16Array(MAP_W * MAP_H).fill(-1);
    for (const o of this.objects) {
      if (o.kind !== Obst.Crate && o.kind !== Obst.Barrel) continue;
      if (this.getO(o.tx, o.ty) !== o.kind) continue;
      breakIdx[idx(o.tx, o.ty)] = breakables.length;
      breakables.push({ i: breakables.length, tx: o.tx, ty: o.ty, kind: o.kind });
    }
    return {
      id,
      climate,
      w: MAP_W,
      h: MAP_H,
      floor: this.floor,
      obst: this.obst,
      objects: this.objects,
      spawns: this.gates,
      campfire,
      torches: this.torches,
      starts,
      breakables,
      breakIdx,
      points,
      lights: this.lights,
    };
  }
}

// ================================================================ Capítulo I — Vila

function buildVillage(): ArenaMap {
  const b = new Builder();
  // estradas de terra (ligam os portões à praça)
  b.rectF(30, 0, 33, 13, Floor.Dirt);
  b.rectF(30, 26, 33, 39, Floor.Dirt);
  b.rectF(0, 18, 21, 21, Floor.Dirt);
  b.rectF(42, 25, 63, 28, Floor.Dirt);
  b.rectF(8, 7, 9, 23, Floor.Dirt);
  b.rectF(9, 8, 17, 9, Floor.Dirt);
  b.rectF(42, 17, 52, 18, Floor.Dirt);
  b.rectF(51, 17, 54, 24, Floor.Dirt);
  // praça central de pedra (cantos recortados)
  b.rectF(21, 13, 42, 26, Floor.Cobble);
  for (const [cx, cy] of [
    [21, 13],
    [42, 13],
    [21, 26],
    [42, 26],
  ] as const)
    b.setF(cx, cy, Floor.Grass);
  // cemitério
  b.rectF(44, 3, 61, 16, Floor.Soil);
  b.border();
  // portões
  b.gate('Estrada Norte', 31, 1, [30, 0, 33, 2], Floor.Dirt);
  b.gate('Estrada Sul', 32, 38, [30, 37, 33, 39], Floor.Dirt);
  b.gate('Estrada Oeste', 1, 19, [0, 18, 2, 21], Floor.Dirt);
  b.gate('Estrada Leste', 62, 26, [61, 25, 63, 28], Floor.Dirt);
  b.gate('Mata do Sudoeste', 2, 36, [1, 35, 3, 38], Floor.Dirt);
  b.gate('Mata do Nordeste', 42, 2, [41, 1, 43, 3], Floor.Dirt);
  // vila a oeste
  b.object(Obst.House, 2, 3, 5, 4, 0);
  b.object(Obst.House, 11, 3, 5, 4, 1);
  b.object(Obst.House, 2, 10, 5, 4, 2);
  b.object(Obst.House, 11, 11, 6, 4, 3);
  b.object(Obst.House, 3, 24, 5, 4, 1);
  b.object(Obst.House, 11, 24, 5, 3, 0);
  b.object(Obst.House, 15, 30, 4, 3, 2);
  for (const [x, y, k] of [
    [7, 8, Obst.Crate], [10, 7, Obst.Barrel], [16, 10, Obst.Barrel], [17, 15, Obst.Crate], [8, 28, Obst.Crate],
    [9, 27, Obst.Barrel], [6, 15, Obst.Barrel], [18, 23, Obst.Crate], [11, 16, Obst.Crate],
  ] as const)
    b.object(k, x, y);
  b.object(Obst.Well, 13, 18);
  // ruínas da capela (norte)
  const ruin = (x: number, y: number): void => b.object(Obst.Ruin, x, y, 1, 1, hash2(x, y, 3) % 4);
  for (let x = 20; x <= 28; x++) {
    if (x !== 23 && x !== 24) ruin(x, 3);
    if (x !== 25 && x !== 26 && x !== 21) ruin(x, 10);
  }
  for (let y = 4; y <= 9; y++) {
    if (y !== 6 && y !== 7) ruin(20, y);
    if (y !== 5) ruin(28, y);
  }
  b.rectF(21, 4, 27, 9, Floor.Cobble);
  b.object(Obst.Crate, 22, 5);
  b.object(Obst.Barrel, 26, 8);
  for (const [x, y] of [
    [36, 5],
    [37, 5],
    [38, 5],
    [36, 6],
    [38, 7],
    [39, 8],
    [35, 9],
  ] as const)
    ruin(x, y);
  // cemitério: cerca, túmulos, cripta
  for (let y = 3; y <= 16; y++) if (y < 8 || y > 10) b.object(Obst.Fence, 44, y, 1, 1, 0);
  for (let x = 44; x <= 60; x++) if (x < 51 || x > 54) b.object(Obst.Fence, x, 16, 1, 1, 1);
  b.object(Obst.Crypt, 53, 3, 5, 4, 0);
  for (let ty = 9; ty <= 14; ty += 2) {
    for (let tx = 46; tx <= 59; tx += 3) {
      if (tx >= 51 && tx <= 54) continue;
      b.object(Obst.Tomb, tx, ty, 1, 1, hash2(tx, ty, 11) % 3);
    }
  }
  for (const [x, y] of [
    [47, 4],
    [49, 6],
    [59, 5],
    [60, 8],
  ] as const)
    b.object(Obst.Tomb, x, y, 1, 1, hash2(x, y, 5) % 3);
  b.gates.push({ id: b.gates.length, name: 'Cripta', x: 55.5 * TILE, y: 7.5 * TILE });
  b.lights.push({ x: 55.5 * TILE, y: 7 * TILE });
  // praça: fogueira, poço, tochas
  b.object(Obst.Fire, 31, 19, 2, 2, 0);
  b.object(Obst.Well, 25, 15);
  for (const [x, y] of [
    [22, 14],
    [41, 14],
    [22, 25],
    [41, 25],
    [29, 12],
    [34, 12],
    [43, 24],
    [12, 17],
    [50, 18],
  ] as const)
    b.torch(x, y);
  b.object(Obst.Crate, 38, 16);
  b.object(Obst.Barrel, 39, 16);
  b.object(Obst.Crate, 24, 23);
  // floresta ao sul e muros quebrados
  const treeSpots: [number, number][] = [
    [5, 31], [8, 34], [12, 36], [6, 16], [18, 34], [22, 30], [24, 35], [26, 29],
    [37, 30], [39, 34], [36, 36], [44, 31], [47, 35], [51, 30], [55, 33], [58, 36],
    [59, 30], [48, 22], [57, 21], [60, 18], [17, 19], [38, 22], [3, 20], [26, 20],
    [19, 7], [45, 8], [58, 12], [41, 7], [23, 32], [28, 36], [14, 29], [53, 36],
  ];
  for (const [x, y] of treeSpots) if (b.getO(x, y) === Obst.None && !b.isRoad(x, y)) b.object(Obst.Tree, x, y, 1, 1, hash2(x, y, 13) % 3);
  for (const [x, y] of [
    [42, 33], [43, 33], [43, 34], [20, 33], [20, 34], [21, 34], [34, 33], [35, 33],
  ] as const)
    ruin(x, y);
  for (let x = 48; x <= 56; x++) if (x !== 52) b.object(Obst.Fence, x, 32, 1, 1, 1);
  b.object(Obst.Crate, 57, 34);
  b.object(Obst.Barrel, 49, 34);
  b.object(Obst.Crate, 45, 21);
  b.object(Obst.Barrel, 29, 31);
  b.connect(31, 17);
  const campfire = { x: 32 * TILE, y: 20 * TILE };
  return b.finish('village', 'night', campfire, {
    boss: { x: 32 * TILE, y: 9 * TILE },
    moons: [
      { x: px(23), y: px(16) },
      { x: px(40), y: px(17) },
      { x: px(32), y: px(25) },
    ],
    totems: [],
    ritual: [
      { x: px(24), y: px(6) },
      { x: px(56), y: px(12) },
      { x: px(46), y: px(30) },
    ],
    altar: [
      { x: px(24), y: px(7) },
      { x: px(52), y: px(12) },
      { x: px(12), y: px(20) },
    ],
  });
}

// ================================================================ Capítulo II — Cemitério Congelado

function buildFrozen(): ArenaMap {
  const b = new Builder();
  b.rectF(0, 0, MAP_W - 1, MAP_H - 1, Floor.Snow);
  // neve funda em montes arredondados
  for (const [x, y, r] of [
    [16, 9, 2.6], [47, 9, 2.4], [16, 30, 2.8], [48, 31, 2.5], [6, 25, 2.2], [58, 17, 2.4],
    [26, 33, 1.8], [38, 7, 1.8], [8, 5, 1.6], [54, 36, 1.8], [36, 33, 1.6], [28, 8, 1.7],
  ] as const)
    b.blobF(x, y, r, Floor.DeepSnow);
  // pátio central de pedra congelada
  b.rectF(25, 15, 39, 25, Floor.FrozenStone);
  // caminhos de pedra dos portões ao pátio
  b.rectF(31, 1, 33, 15, Floor.FrozenStone);
  b.rectF(31, 25, 33, 38, Floor.FrozenStone);
  b.rectF(1, 19, 25, 21, Floor.FrozenStone);
  b.rectF(39, 19, 62, 21, Floor.FrozenStone);
  b.border();
  b.gate('Portão Norte', 32, 1, [31, 0, 33, 2], Floor.FrozenStone);
  b.gate('Portão Sul', 32, 38, [31, 37, 33, 39], Floor.FrozenStone);
  b.gate('Portão Oeste', 1, 20, [0, 19, 2, 21], Floor.FrozenStone);
  b.gate('Portão Leste', 62, 20, [61, 19, 63, 21], Floor.FrozenStone);
  b.gate('Ossuário Noroeste', 3, 3, [2, 2, 4, 4], Floor.Snow);
  b.gate('Ossuário Sudeste', 60, 36, [59, 35, 61, 37], Floor.Snow);

  // labirinto: dois anéis de sebes geladas com aberturas desencontradas + raios
  const hedge = (x: number, y: number): void => {
    if (b.getO(x, y) === Obst.None) b.object(Obst.Hedge, x, y, 1, 1, hash2(x, y, 61) % 3);
  };
  const ringA = { x0: 21, y0: 11, x1: 43, y1: 29 };
  const ringB = { x0: 11, y0: 5, x1: 53, y1: 35 };
  const gapA = (x: number, y: number): boolean =>
    // norte e sul (desencontrados), cantos
    (y === ringA.y0 && x >= 26 && x <= 28) || (y === ringA.y1 && x >= 36 && x <= 38) ||
    (x === ringA.x0 && y >= 22 && y <= 24) || (x === ringA.x1 && y >= 15 && y <= 17) ||
    (x === ringA.x0 && y >= 12 && y <= 13) || (x === ringA.x1 && y >= 27 && y <= 28);
  const gapB = (x: number, y: number): boolean =>
    (x === ringB.x0 && y >= 19 && y <= 21) || (x === ringB.x1 && y >= 19 && y <= 21) ||
    (y === ringB.y0 && x >= 31 && x <= 33) || (y === ringB.y1 && x >= 31 && x <= 33) ||
    (y === ringB.y0 && x >= 17 && x <= 18) || (y === ringB.y1 && x >= 46 && x <= 47) ||
    (y === ringB.y0 && x >= 45 && x <= 46) || (y === ringB.y1 && x >= 17 && x <= 18);
  for (let x = ringA.x0; x <= ringA.x1; x++)
    for (const y of [ringA.y0, ringA.y1]) if (!gapA(x, y)) hedge(x, y);
  for (let y = ringA.y0; y <= ringA.y1; y++)
    for (const x of [ringA.x0, ringA.x1]) if (!gapA(x, y)) hedge(x, y);
  for (let x = ringB.x0; x <= ringB.x1; x++)
    for (const y of [ringB.y0, ringB.y1]) if (!gapB(x, y)) hedge(x, y);
  for (let y = ringB.y0; y <= ringB.y1; y++)
    for (const x of [ringB.x0, ringB.x1]) if (!gapB(x, y)) hedge(x, y);
  // raios entre os anéis formam câmaras (com passagens)
  for (let y = ringB.y0 + 1; y < ringA.y0; y++) if (y !== 8) hedge(24, y);
  for (let y = ringB.y0 + 1; y < ringA.y0; y++) if (y !== 7) hedge(40, y);
  for (let y = ringA.y1 + 1; y < ringB.y1; y++) if (y !== 32) hedge(26, y);
  for (let y = ringA.y1 + 1; y < ringB.y1; y++) if (y !== 31) hedge(42, y);
  for (let x = ringB.x0 + 1; x < ringA.x0; x++) if (x !== 15) hedge(x, 14);
  for (let x = ringA.x1 + 1; x < ringB.x1; x++) if (x !== 48) hedge(x, 26);
  // mausoléus nos cantos externos
  b.object(Obst.Crypt, 4, 8, 5, 4, 1);
  b.object(Obst.Crypt, 55, 27, 5, 4, 1);
  b.object(Obst.Crypt, 55, 6, 5, 4, 1);
  b.lights.push({ x: 6.5 * TILE, y: 12 * TILE }, { x: 57.5 * TILE, y: 31 * TILE }, { x: 57.5 * TILE, y: 10 * TILE });
  // fileiras de túmulos entre os anéis e fora
  for (let x = 13; x <= 51; x += 3)
    for (const y of [8, 32]) if (x < 30 || x > 34) b.put(Obst.Tomb, x, y, hash2(x, y, 71) % 3);
  for (let y = 16; y <= 25; y += 3) for (const x of [14, 17, 47, 50]) b.put(Obst.Tomb, x, y, hash2(x, y, 72) % 3);
  // pátio: braseiro, estátuas, tochas
  b.object(Obst.Fire, 31, 19, 2, 2, 1);
  for (const [x, y] of [
    [26, 16],
    [38, 16],
    [26, 24],
    [38, 24],
  ] as const)
    b.object(Obst.Statue, x, y, 1, 1, 0);
  for (const [x, y] of [
    [30, 14],
    [34, 14],
    [30, 26],
    [34, 26],
    [12, 20],
    [52, 20],
    [32, 4],
    [32, 36],
  ] as const)
    b.torch(x, y);
  // caixas e barris
  for (const [x, y, k] of [
    [23, 13, Obst.Crate], [41, 13, Obst.Barrel], [23, 27, Obst.Barrel], [41, 27, Obst.Crate],
    [15, 10, Obst.Crate], [49, 10, Obst.Barrel], [15, 30, Obst.Barrel], [49, 30, Obst.Crate],
    [29, 17, Obst.Crate], [35, 23, Obst.Barrel], [7, 24, Obst.Crate], [58, 15, Obst.Barrel],
    [20, 36, Obst.Crate], [44, 3, Obst.Barrel],
  ] as const)
    b.put(k, x, y);
  // pinheiros nevados fora do labirinto
  for (const [x, y] of [
    [5, 16], [7, 29], [9, 34], [4, 22], [58, 22], [60, 12], [56, 34], [50, 2],
    [14, 2], [22, 37], [44, 37], [60, 3], [3, 30], [36, 2], [27, 2], [38, 37],
  ] as const)
    b.put(Obst.Tree, x, y, hash2(x, y, 73) % 3);
  b.connect(32, 18);
  const campfire = { x: 32 * TILE, y: 20 * TILE };
  return b.finish('frozen', 'winter', campfire, {
    boss: { x: 32 * TILE, y: 15 * TILE },
    moons: [],
    totems: [],
    ritual: [
      { x: px(7), y: px(18) },
      { x: px(57), y: px(24) },
      { x: px(46), y: px(8) },
    ],
    altar: [
      { x: px(18), y: px(10) },
      { x: px(46), y: px(30) },
      { x: px(8), y: px(30) },
    ],
  });
}

// ================================================================ Capítulo III — Mansão / Abismo

function buildAbyss(): ArenaMap {
  const b = new Builder();
  b.rectF(0, 0, MAP_W - 1, MAP_H - 1, Floor.Sand);
  // areia movediça e afloramentos de rocha em manchas arredondadas
  for (const [x, y, r] of [
    [13, 21, 2.2], [51, 21, 2.2], [20, 30, 2.4], [44, 30, 2.4], [6, 33, 2], [58, 33, 2], [32, 35, 1.8],
  ] as const)
    b.blobF(x, y, r, Floor.Quicksand);
  for (const [x, y, r] of [
    [4, 9, 2], [60, 9, 2], [9, 26, 1.6], [55, 27, 1.6], [26, 36, 1.5], [40, 36, 1.5],
  ] as const)
    b.blobF(x, y, r, Floor.AshRock);
  // mansão: piso de mármore e paredes com salões internos
  const m = { x0: 14, y0: 2, x1: 50, y1: 14 };
  b.rectF(m.x0, m.y0, m.x1, m.y1, Floor.Marble);
  // pátio em frente à mansão
  b.rectF(22, 15, 42, 27, Floor.AshRock);
  b.rectF(24, 16, 40, 26, Floor.Marble);
  b.border();
  const wall = (x: number, y: number): void => {
    if (b.getO(x, y) === Obst.None) b.object(Obst.Wall, x, y, 1, 1, hash2(x, y, 91) % 3);
  };
  const door = (x: number, y: number): boolean =>
    // portas da fachada sul
    (y === m.y1 && ((x >= 19 && x <= 21) || (x >= 31 && x <= 33) || (x >= 43 && x <= 45))) ||
    // portas laterais
    (x === m.x0 && y >= 7 && y <= 9) || (x === m.x1 && y >= 7 && y <= 9);
  for (let x = m.x0; x <= m.x1; x++)
    for (const y of [m.y0, m.y1]) if (!door(x, y)) wall(x, y);
  for (let y = m.y0; y <= m.y1; y++)
    for (const x of [m.x0, m.x1]) if (!door(x, y)) wall(x, y);
  // paredes internas: três salões com passagens
  for (let y = m.y0 + 1; y < m.y1; y++) if (y !== 5 && y !== 6 && y !== 11) wall(26, y);
  for (let y = m.y0 + 1; y < m.y1; y++) if (y !== 5 && y !== 10 && y !== 11) wall(38, y);
  for (let x = 27; x <= 37; x++) if (x < 31 || x > 33) wall(x, 8);
  // colunas nos salões
  for (const [x, y] of [
    [18, 5], [22, 5], [18, 11], [22, 11], [42, 5], [46, 5], [42, 11], [46, 11], [29, 11], [35, 11],
  ] as const)
    b.object(Obst.Pillar, x, y, 1, 1, 0);
  // portal do porão (portão dentro da mansão)
  b.gates.push({ id: 0, name: 'Porão da Mansão', x: px(32), y: px(4) });
  b.lights.push({ x: px(32), y: px(4) });
  b.gate('Dunas Oeste', 1, 24, [0, 23, 2, 25], Floor.Sand);
  b.gate('Dunas Leste', 62, 24, [61, 23, 63, 25], Floor.Sand);
  b.gate('Poço Sul', 32, 38, [31, 37, 33, 39], Floor.Sand);
  b.gate('Ossada Sudoeste', 5, 37, [4, 36, 6, 38], Floor.Sand);
  b.gate('Ossada Sudeste', 58, 37, [57, 36, 59, 38], Floor.Sand);
  b.gates.forEach((g, i) => (g.id = i));
  // pátio: braseiro do abismo, estátuas, obeliscos
  b.object(Obst.Fire, 31, 19, 2, 2, 2);
  for (const [x, y] of [
    [24, 17],
    [40, 17],
    [24, 25],
    [40, 25],
  ] as const)
    b.object(Obst.Statue, x, y, 1, 1, 1);
  for (const [x, y] of [
    [10, 20], [54, 20], [16, 30], [48, 30], [8, 12], [56, 12], [28, 33], [36, 33],
  ] as const)
    b.object(Obst.Obelisk, x, y, 1, 1, hash2(x, y, 92) % 2);
  // fissuras do abismo (baixas: bloqueiam o passo, não os tiros)
  const fissure = (pts: [number, number][]): void => {
    for (const [x, y] of pts) if (b.getO(x, y) === Obst.None) b.object(Obst.Fissure, x, y, 1, 1, hash2(x, y, 93) % 3);
  };
  fissure([[12, 26], [13, 26], [14, 27], [15, 27], [16, 28], [17, 28]]);
  fissure([[46, 28], [47, 28], [48, 27], [49, 27], [50, 26], [51, 26]]);
  fissure([[22, 32], [23, 33], [24, 33], [25, 34]]);
  fissure([[39, 34], [40, 33], [41, 33], [42, 32]]);
  // tochas
  for (const [x, y] of [
    [23, 15], [41, 15], [23, 27], [41, 27], [20, 13], [44, 13], [32, 9], [8, 24], [56, 24],
  ] as const)
    b.torch(x, y);
  // caixas e barris (móveis da mansão e carga no deserto)
  for (const [x, y] of [
    [16, 3], [24, 3], [40, 3], [48, 3], [28, 6], [36, 6], [16, 13], [48, 13],
    [27, 21], [37, 21], [12, 33], [52, 33], [20, 22], [44, 22], [5, 16], [59, 16],
  ] as const)
    b.put(hash2(x, y, 94) % 2 ? Obst.Crate : Obst.Barrel, x, y);
  // árvores mortas e ossadas no deserto
  for (const [x, y] of [
    [6, 20], [58, 20], [10, 35], [54, 35], [18, 36], [46, 36], [4, 30], [60, 30], [12, 17], [52, 17],
  ] as const)
    b.put(Obst.Tree, x, y, hash2(x, y, 95) % 3);
  b.connect(32, 22);
  const campfire = { x: 32 * TILE, y: 20 * TILE };
  return b.finish('abyss', 'ash', campfire, {
    boss: { x: 32 * TILE, y: 12 * TILE },
    moons: [],
    totems: [
      { x: px(18), y: px(22) },
      { x: px(46), y: px(22) },
      { x: px(32), y: px(31) },
    ],
    ritual: [
      { x: px(20), y: px(8) },
      { x: px(44), y: px(8) },
      { x: px(32), y: px(34) },
    ],
    altar: [
      { x: px(32), y: px(11) },
      { x: px(12), y: px(30) },
      { x: px(52), y: px(30) },
    ],
  });
}

const BUILDERS: Record<MapId, () => ArenaMap> = { village: buildVillage, frozen: buildFrozen, abyss: buildAbyss };
const cache = new Map<MapId, ArenaMap>();

/** Mapa original (somente leitura, compartilhado). Use `cloneMap` para uma cópia mutável. */
export function getMap(id: MapId): ArenaMap {
  let m = cache.get(id);
  if (!m) {
    m = BUILDERS[id]();
    cache.set(id, m);
  }
  return m;
}

/** Retorna a arena do capítulo I (compatibilidade). */
export function getArena(): ArenaMap {
  return getMap('village');
}

export const mapIndex = (id: MapId): number => MAP_IDS.indexOf(id);
export const mapByIndex = (i: number): MapId => MAP_IDS[i] ?? 'village';

/** Cópia com obstáculos mutáveis (caixas/barris destrutíveis). O resto é compartilhado. */
export function cloneMap(m: ArenaMap): ArenaMap {
  return { ...m, obst: new Uint8Array(m.obst) };
}

export function obstAt(map: ArenaMap, tx: number, ty: number): Obst {
  if (tx < 0 || ty < 0 || tx >= map.w || ty >= map.h) return Obst.Border;
  return map.obst[ty * map.w + tx] as Obst;
}

export function floorAt(map: ArenaMap, tx: number, ty: number): Floor {
  if (tx < 0 || ty < 0 || tx >= map.w || ty >= map.h) return Floor.Grass;
  return map.floor[ty * map.w + tx] as Floor;
}

export function isSolidTile(map: ArenaMap, tx: number, ty: number): boolean {
  return obstAt(map, tx, ty) !== Obst.None;
}

/** Bloqueia projéteis/linha de visão (obstáculos baixos não bloqueiam). */
export function blocksShot(map: ArenaMap, tx: number, ty: number): boolean {
  const o = obstAt(map, tx, ty);
  return o !== Obst.None && !LOW_OBSTACLES.has(o);
}

/** Chão lento sob a posição (px). */
export function onSlowFloor(map: ArenaMap, x: number, y: number): boolean {
  return SLOW_FLOORS.has(floorAt(map, Math.floor(x / TILE), Math.floor(y / TILE)));
}

/** Quebrável ainda de pé no tile, ou -1. */
export function breakableAt(map: ArenaMap, tx: number, ty: number): number {
  if (tx < 0 || ty < 0 || tx >= map.w || ty >= map.h) return -1;
  const i = map.breakIdx[ty * map.w + tx] as number;
  if (i < 0) return -1;
  return BREAKABLE_OBST.has(obstAt(map, tx, ty)) ? i : -1;
}

/** Aplica o estado de quebráveis (índices destruídos) a um clone. */
export function setBroken(map: ArenaMap, i: number, broken: boolean): void {
  const b = map.breakables[i];
  if (!b) return;
  map.obst[b.ty * map.w + b.tx] = broken ? Obst.None : b.kind;
}
