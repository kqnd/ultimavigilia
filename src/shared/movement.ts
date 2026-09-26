/**
 * Passo de movimento do jogador compartilhado entre servidor (autoridade) e cliente (predição).
 * Somente o que é função pura do input fica aqui: caminhada, esquiva e deslocamentos forçados.
 */
import { DT } from './constants.js';
import { moveCircle } from './collision.js';
import { type ArenaMap, onSlowFloor } from './map.js';

export const BTN = {
  attack: 1,
  dodge: 2,
  q: 4,
  e: 8,
  r: 16,
  interact: 32,
} as const;
export type ButtonName = keyof typeof BTN;

export interface InputFrame {
  seq: number;
  /** Vetor de movimento, cada eixo em [-1, 1]. */
  mx: number;
  my: number;
  /** Ponto mirado em coordenadas de mundo. */
  ax: number;
  ay: number;
  /** Botões segurados (bitmask BTN). */
  held: number;
  /** Botões pressionados neste frame (bordas). */
  pressed: number;
}

export interface MoveState {
  x: number;
  y: number;
  /** Deslocamento forçado (esquiva, investidas): velocidade px/s e ticks restantes. */
  fvx: number;
  fvy: number;
  ft: number;
  stamina: number;
  dodgeCd: number;
}

export interface MoveParams {
  radius: number;
  speed: number;
  /** Multiplicador de velocidade atual (lentidão, bloqueio, ataque). */
  moveMul: number;
  /** Pode iniciar esquiva (não está travado em ação). */
  canDodge: boolean;
  dodgeCost: number;
  dodgeSpeed: number;
  dodgeTicks: number;
  dodgeCooldown: number;
  /** Multiplicador em chão lento (neve funda / areia movediça). 1 = sem efeito. */
  slowFloorMul?: number;
}

export interface StepResult {
  dodged: boolean;
}

export function normalizeMove(mx: number, my: number): [number, number] {
  const l = Math.hypot(mx, my);
  if (l > 1) return [mx / l, my / l];
  return [mx, my];
}

export function stepMovement(s: MoveState, input: InputFrame, p: MoveParams, map: ArenaMap): StepResult {
  let dodged = false;
  if (s.dodgeCd > 0) s.dodgeCd--;
  const [mx, my] = normalizeMove(input.mx, input.my);
  if (s.ft <= 0 && p.canDodge && (input.pressed & BTN.dodge) !== 0 && s.dodgeCd <= 0 && s.stamina >= p.dodgeCost) {
    let dx = mx;
    let dy = my;
    if (dx === 0 && dy === 0) {
      const a = Math.atan2(input.ay - s.y, input.ax - s.x);
      dx = Math.cos(a);
      dy = Math.sin(a);
    }
    const l = Math.hypot(dx, dy) || 1;
    s.fvx = (dx / l) * p.dodgeSpeed;
    s.fvy = (dy / l) * p.dodgeSpeed;
    s.ft = p.dodgeTicks;
    s.stamina -= p.dodgeCost;
    s.dodgeCd = p.dodgeTicks + p.dodgeCooldown;
    dodged = true;
  }
  const pos = { x: s.x, y: s.y };
  if (s.ft > 0) {
    moveCircle(map, pos, p.radius, s.fvx * DT, s.fvy * DT);
    s.ft--;
    if (s.ft <= 0) {
      s.fvx = 0;
      s.fvy = 0;
    }
  } else {
    const floorMul = p.slowFloorMul !== undefined && p.slowFloorMul !== 1 && onSlowFloor(map, s.x, s.y) ? p.slowFloorMul : 1;
    const sp = p.speed * p.moveMul * floorMul * DT;
    if (mx !== 0 || my !== 0) moveCircle(map, pos, p.radius, mx * sp, my * sp);
  }
  s.x = pos.x;
  s.y = pos.y;
  return { dodged };
}
