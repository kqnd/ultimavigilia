import { SHOT_HEIGHT, SHOT_MUZZLE } from '../../../shared/constants.js';
import type { DenyReason } from '../../../shared/protocol.js';
import type { Action, Enemy, Player, Projectile, Slot, Zone } from '../types.js';
import type { EnemyHit, HitOpts, HitResult, World } from '../world.js';

export interface Kit {
  /** Tenta iniciar a ação do slot. Retorna null se iniciou, ou o motivo da negação. */
  start(w: World, p: Player, slot: Slot): DenyReason | null;
  /** Chamado a cada tick enquanto há uma ação em curso. */
  tickAction(w: World, p: Player, a: Action): void;
  tickPassive?(w: World, p: Player): void;
  /** Intercepta golpes recebidos (bloqueio/aparo). null = segue fluxo normal. */
  onIncoming?(w: World, p: Player, h: EnemyHit): HitResult | null;
  onDealt?(w: World, p: Player, e: Enemy, dmg: number, o: HitOpts): void;
  zoneTick?(w: World, z: Zone, owner: Player | null): void;
  zoneExpire?(w: World, z: Zone, owner: Player): void;
  zoneTrigger?(w: World, z: Zone, e: Enemy, owner: Player | null): void;
  /** Uso de Q/E durante a recarga (ex.: esmagar a casca do Lapanha). true = iniciou. */
  startDuringCooldown?(w: World, p: Player, slot: 'q' | 'e'): boolean;
  /** Projétil do jogador encostou num inimigo. true = tratado pelo kit. */
  projectileHit?(w: World, pr: Projectile, e: Enemy): boolean;
  /** Projétil do jogador terminou o voo (alcance/parede). true = tratado pelo kit. */
  projectileEnd?(w: World, pr: Projectile): boolean;
}

/** Primeiro tick da janela ativa. */
export const firstActive = (a: Action): boolean => a.t === a.wu + 1;
export const inActive = (a: Action): boolean => a.t > a.wu && a.t <= a.wu + a.ac;

/**
 * Direção e saída de um projétil de jogador.
 *
 * Convenção única (servidor e cliente): projéteis vivem no plano do chão (mesmo plano dos pés,
 * da colisão com paredes e do acerto em inimigos) e são DESENHADOS `SHOT_HEIGHT` px acima.
 * O cursor aponta para um ponto nessa altura, então o alvo no chão é (aimX, aimY + SHOT_HEIGHT).
 * Assim a trajetória desenhada, prolongada, passa exatamente pelo ponto clicado.
 */
export function projectileAim(p: Player, muzzle = SHOT_MUZZLE): { dir: number; x: number; y: number } {
  const dx = p.aimX - p.x;
  const dy = p.aimY + SHOT_HEIGHT - p.y;
  const dir = Math.hypot(dx, dy) < 1 ? p.aim : Math.atan2(dy, dx);
  return { dir, x: p.x + Math.cos(dir) * muzzle, y: p.y + Math.sin(dir) * muzzle };
}

/** Ponto mirado limitado a um alcance máximo. */
export function clampTarget(p: Player, maxRange: number): { x: number; y: number } {
  const dx = p.aimX - p.x;
  const dy = p.aimY - p.y;
  const d = Math.hypot(dx, dy);
  if (d <= maxRange) return { x: p.aimX, y: p.aimY };
  return { x: p.x + (dx / d) * maxRange, y: p.y + (dy / d) * maxRange };
}

/** Inicia deslocamento forçado (px em N ticks) numa direção. */
export function dash(p: Player, dir: number, distance: number, ticks: number): void {
  const speed = distance / (ticks / 30);
  p.move.fvx = Math.cos(dir) * speed;
  p.move.fvy = Math.sin(dir) * speed;
  p.move.ft = ticks;
}
