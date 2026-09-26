/**
 * Navegação por campo de fluxo (Dijkstra em grade 8-direções sem cortar quinas).
 * Um campo por jogador vivo, recalculado periodicamente. Inimigos seguem o gradiente.
 */
import { TILE } from '../../shared/constants.js';
import { type ArenaMap, isSolidTile } from '../../shared/map.js';

const DIRS: readonly [number, number, number][] = [
  [1, 0, 10], [-1, 0, 10], [0, 1, 10], [0, -1, 10],
  [1, 1, 14], [1, -1, 14], [-1, 1, 14], [-1, -1, 14],
];

export class FlowField {
  readonly dist: Uint16Array;
  constructor(private readonly map: ArenaMap) {
    this.dist = new Uint16Array(map.w * map.h).fill(0xffff);
  }

  /** Recalcula a partir do tile alvo (px). Fila de baldes (custos 10/14). */
  compute(px: number, py: number): void {
    const { w, h } = this.map;
    const dist = this.dist;
    dist.fill(0xffff);
    let tx = Math.floor(px / TILE);
    let ty = Math.floor(py / TILE);
    tx = Math.max(0, Math.min(w - 1, tx));
    ty = Math.max(0, Math.min(h - 1, ty));
    const start = ty * w + tx;
    dist[start] = 0;
    // Dijkstra simples com fila de prioridade em baldes
    const buckets: number[][] = [[start]];
    for (let d = 0; d < buckets.length; d++) {
      const b = buckets[d];
      if (!b) continue;
      for (let bi = 0; bi < b.length; bi++) {
        const i = b[bi] as number;
        if (dist[i] !== d) continue;
        const x = i % w;
        const y = (i / w) | 0;
        for (const [dx, dy, c] of DIRS) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          if (isSolidTile(this.map, nx, ny)) continue;
          if (dx !== 0 && dy !== 0 && (isSolidTile(this.map, x + dx, y) || isSolidTile(this.map, x, y + dy))) continue;
          const ni = ny * w + nx;
          const nd = d + c;
          if (nd < (dist[ni] as number)) {
            dist[ni] = nd;
            (buckets[nd] ??= []).push(ni);
          }
        }
      }
    }
  }

  at(px: number, py: number): number {
    const tx = Math.floor(px / TILE);
    const ty = Math.floor(py / TILE);
    if (tx < 0 || ty < 0 || tx >= this.map.w || ty >= this.map.h) return 0xffff;
    return this.dist[ty * this.map.w + tx] as number;
  }

  /** Direção (unitária) de descida do gradiente a partir de (px,py). null se inalcançável. */
  direction(px: number, py: number): [number, number] | null {
    const { w, h } = this.map;
    const tx = Math.floor(px / TILE);
    const ty = Math.floor(py / TILE);
    if (tx < 0 || ty < 0 || tx >= w || ty >= h) return null;
    const here = this.dist[ty * w + tx] as number;
    if (here === 0xffff) return null;
    let best = here;
    let bx = 0;
    let by = 0;
    for (const [dx, dy] of DIRS) {
      const nx = tx + dx;
      const ny = ty + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      if (dx !== 0 && dy !== 0 && (isSolidTile(this.map, tx + dx, ty) || isSolidTile(this.map, tx, ty + dy))) continue;
      const v = this.dist[ny * w + nx] as number;
      if (v < best) {
        best = v;
        bx = dx;
        by = dy;
      }
    }
    if (bx === 0 && by === 0) return here === 0 ? [0, 0] : null;
    // mira no centro do próximo tile (suaviza curvas)
    const cx = (tx + bx + 0.5) * TILE - px;
    const cy = (ty + by + 0.5) * TILE - py;
    const l = Math.hypot(cx, cy) || 1;
    return [cx / l, cy / l];
  }
}
