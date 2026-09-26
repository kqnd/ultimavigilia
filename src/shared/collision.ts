/**
 * Sistema único de colisão (círculo × grade de tiles). Usado pelo servidor na simulação
 * e pelo cliente na predição do movimento local.
 */
import { TILE } from './constants.js';
import { type ArenaMap, blocksShot, isSolidTile } from './map.js';

export interface Vec {
  x: number;
  y: number;
}

/** Empurra um círculo para fora de todos os tiles sólidos que ele sobrepõe. */
export function resolveCircle(map: ArenaMap, p: Vec, r: number): boolean {
  let hit = false;
  const worldW = map.w * TILE;
  const worldH = map.h * TILE;
  for (let iter = 0; iter < 3; iter++) {
    let moved = false;
    const tx0 = Math.floor((p.x - r) / TILE);
    const tx1 = Math.floor((p.x + r) / TILE);
    const ty0 = Math.floor((p.y - r) / TILE);
    const ty1 = Math.floor((p.y + r) / TILE);
    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        if (!isSolidTile(map, tx, ty)) continue;
        const rx0 = tx * TILE;
        const ry0 = ty * TILE;
        const cx = p.x < rx0 ? rx0 : p.x > rx0 + TILE ? rx0 + TILE : p.x;
        const cy = p.y < ry0 ? ry0 : p.y > ry0 + TILE ? ry0 + TILE : p.y;
        const dx = p.x - cx;
        const dy = p.y - cy;
        const d2 = dx * dx + dy * dy;
        if (d2 >= r * r) continue;
        if (d2 > 1e-9) {
          const d = Math.sqrt(d2);
          const push = r - d;
          p.x += (dx / d) * push;
          p.y += (dy / d) * push;
        } else {
          // centro dentro do tile: sai pelo lado mais próximo
          const left = p.x - rx0;
          const right = rx0 + TILE - p.x;
          const top = p.y - ry0;
          const bottom = ry0 + TILE - p.y;
          const m = Math.min(left, right, top, bottom);
          if (m === left) p.x = rx0 - r;
          else if (m === right) p.x = rx0 + TILE + r;
          else if (m === top) p.y = ry0 - r;
          else p.y = ry0 + TILE + r;
        }
        hit = true;
        moved = true;
      }
    }
    if (!moved) break;
  }
  if (p.x < r) p.x = r;
  if (p.y < r) p.y = r;
  if (p.x > worldW - r) p.x = worldW - r;
  if (p.y > worldH - r) p.y = worldH - r;
  return hit;
}

/** Move um círculo com sub-passos (sem atravessar paredes) e deslizamento por eixo. */
export function moveCircle(map: ArenaMap, p: Vec, r: number, dx: number, dy: number): boolean {
  const len = Math.max(Math.abs(dx), Math.abs(dy));
  const steps = Math.max(1, Math.ceil(len / (r * 0.5)));
  const sx = dx / steps;
  const sy = dy / steps;
  let hit = false;
  for (let i = 0; i < steps; i++) {
    p.x += sx;
    if (resolveCircle(map, p, r)) hit = true;
    p.y += sy;
    if (resolveCircle(map, p, r)) hit = true;
  }
  return hit;
}

/** O círculo cabe nesta posição sem sobrepor sólidos? */
export function circleFree(map: ArenaMap, x: number, y: number, r: number): boolean {
  const tx0 = Math.floor((x - r) / TILE);
  const tx1 = Math.floor((x + r) / TILE);
  const ty0 = Math.floor((y - r) / TILE);
  const ty1 = Math.floor((y + r) / TILE);
  if (x < r || y < r || x > map.w * TILE - r || y > map.h * TILE - r) return false;
  for (let ty = ty0; ty <= ty1; ty++) {
    for (let tx = tx0; tx <= tx1; tx++) {
      if (!isSolidTile(map, tx, ty)) continue;
      const rx0 = tx * TILE;
      const ry0 = ty * TILE;
      const cx = x < rx0 ? rx0 : x > rx0 + TILE ? rx0 + TILE : x;
      const cy = y < ry0 ? ry0 : y > ry0 + TILE ? ry0 + TILE : y;
      if ((x - cx) ** 2 + (y - cy) ** 2 < r * r) return false;
    }
  }
  return true;
}

/**
 * Caminha de (x0,y0) até (x1,y1) e retorna o ponto livre mais distante antes de encontrar
 * uma parede. Usado para validar destinos de teleporte/deslocamentos (não atravessa paredes).
 */
export function sweepFree(map: ArenaMap, x0: number, y0: number, x1: number, y1: number, r: number): Vec {
  const d = Math.hypot(x1 - x0, y1 - y0);
  const steps = Math.max(1, Math.ceil(d / 4));
  let last: Vec = { x: x0, y: y0 };
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const x = x0 + (x1 - x0) * t;
    const y = y0 + (y1 - y0) * t;
    if (!circleFree(map, x, y, r)) break;
    last = { x, y };
  }
  return last;
}

/** Linha de visão (tiles altos bloqueiam; obstáculos baixos não). DDA em grade. */
export function lineOfSight(map: ArenaMap, x0: number, y0: number, x1: number, y1: number): boolean {
  let tx = Math.floor(x0 / TILE);
  let ty = Math.floor(y0 / TILE);
  const ex = Math.floor(x1 / TILE);
  const ey = Math.floor(y1 / TILE);
  const dx = x1 - x0;
  const dy = y1 - y0;
  const stepX = dx > 0 ? 1 : -1;
  const stepY = dy > 0 ? 1 : -1;
  const tDeltaX = dx !== 0 ? Math.abs(TILE / dx) : Infinity;
  const tDeltaY = dy !== 0 ? Math.abs(TILE / dy) : Infinity;
  let tMaxX = dx !== 0 ? ((stepX > 0 ? (tx + 1) * TILE - x0 : x0 - tx * TILE) / Math.abs(dx)) : Infinity;
  let tMaxY = dy !== 0 ? ((stepY > 0 ? (ty + 1) * TILE - y0 : y0 - ty * TILE) / Math.abs(dy)) : Infinity;
  for (let guard = 0; guard < 256; guard++) {
    if (tx === ex && ty === ey) return true;
    if (tMaxX < tMaxY) {
      tMaxX += tDeltaX;
      tx += stepX;
    } else {
      tMaxY += tDeltaY;
      ty += stepY;
    }
    if (tx === ex && ty === ey) return true;
    if (blocksShot(map, tx, ty)) return false;
  }
  return true;
}
