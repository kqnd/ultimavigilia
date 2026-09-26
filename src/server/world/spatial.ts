/** Broad-phase: hash espacial uniforme para consultas de vizinhança de inimigos. */
export interface HasPos {
  id: number;
  x: number;
  y: number;
  r: number;
}

export class SpatialHash<T extends HasPos> {
  private cells = new Map<number, T[]>();
  private pool: T[][] = [];
  constructor(private readonly cell = 64) {}

  private key(cx: number, cy: number): number {
    return (cy + 64) * 1024 + (cx + 64);
  }

  clear(): void {
    for (const arr of this.cells.values()) {
      arr.length = 0;
      this.pool.push(arr);
    }
    this.cells.clear();
  }

  insert(o: T): void {
    const k = this.key(Math.floor(o.x / this.cell), Math.floor(o.y / this.cell));
    let arr = this.cells.get(k);
    if (!arr) {
      arr = this.pool.pop() ?? [];
      this.cells.set(k, arr);
    }
    arr.push(o);
  }

  /** Chama fn para cada objeto cujo círculo possa intersectar o círculo (x,y,r). */
  query(x: number, y: number, r: number, fn: (o: T) => void): void {
    const pad = r + 32;
    const cx0 = Math.floor((x - pad) / this.cell);
    const cx1 = Math.floor((x + pad) / this.cell);
    const cy0 = Math.floor((y - pad) / this.cell);
    const cy1 = Math.floor((y + pad) / this.cell);
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const arr = this.cells.get(this.key(cx, cy));
        if (!arr) continue;
        for (let i = 0; i < arr.length; i++) {
          const o = arr[i] as T;
          const rr = r + o.r;
          const dx = o.x - x;
          const dy = o.y - y;
          if (dx * dx + dy * dy <= rr * rr) fn(o);
        }
      }
    }
  }
}
