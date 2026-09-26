/**
 * Predição do movimento local + reconciliação com o estado autoritativo.
 * Usa exatamente a mesma função de movimento e a mesma colisão do servidor.
 */
import { CLIMATE_EFFECTS } from '../../shared/config/chapters.js';
import { CLASSES, type ClassId } from '../../shared/config/classes.js';
import { type ArenaMap, cloneMap, getArena } from '../../shared/map.js';
import { type InputFrame, type MoveParams, type MoveState, stepMovement } from '../../shared/movement.js';
import type { SnapYou } from '../../shared/protocol.js';

export class Predictor {
  /** Cópia local do mapa ativo (a cena troca ao mudar de capítulo e aplica quebráveis destruídos). */
  map: ArenaMap = cloneMap(getArena());
  state: MoveState = { x: 0, y: 0, fvx: 0, fvy: 0, ft: 0, stamina: 100, dodgeCd: 0 };
  prev = { x: 0, y: 0 };
  pending: InputFrame[] = [];
  seq = 0;
  cls: ClassId = 'hunter';
  mm = 1;
  canDodge = true;
  speed = 100;
  /** Deslocamento visual que decai após correções (evita "teleportes"). */
  smoothX = 0;
  smoothY = 0;
  active = false;
  lastDodgeLocal = -1;
  corrections = 0;

  reset(x: number, y: number, cls: ClassId): void {
    this.state = { x, y, fvx: 0, fvy: 0, ft: 0, stamina: CLASSES[cls].stamina, dodgeCd: 0 };
    this.prev = { x, y };
    this.pending = [];
    this.cls = cls;
    this.smoothX = 0;
    this.smoothY = 0;
    this.speed = CLASSES[cls].speed;
    this.active = true;
  }

  params(): MoveParams {
    const d = CLASSES[this.cls].dodge;
    return {
      radius: CLASSES[this.cls].radius,
      speed: this.speed,
      moveMul: this.mm,
      canDodge: this.canDodge,
      dodgeCost: d.cost,
      dodgeSpeed: d.speed,
      dodgeTicks: d.ticks,
      dodgeCooldown: d.cooldown,
      slowFloorMul: CLIMATE_EFFECTS.slowFloorMul,
    };
  }

  /** Aplica um input localmente (chamado a cada tick de 30 Hz). */
  step(f: InputFrame): boolean {
    this.prev = { x: this.state.x, y: this.state.y };
    const r = stepMovement(this.state, f, this.params(), this.map);
    this.pending.push(f);
    if (this.pending.length > 90) this.pending.shift();
    return r.dodged;
  }

  /** Reconcilia com o estado confirmado pelo servidor e reaplica inputs pendentes. */
  reconcile(you: SnapYou): void {
    const before = { x: this.state.x, y: this.state.y };
    this.mm = you.mm;
    this.canDodge = you.cdg === 1;
    this.speed = you.sp;
    this.state = { x: you.x, y: you.y, fvx: you.fvx, fvy: you.fvy, ft: you.ft, stamina: you.st, dodgeCd: you.dcd };
    this.pending = this.pending.filter((f) => f.seq > you.ack);
    const p = this.params();
    for (const f of this.pending) stepMovement(this.state, f, p, this.map);
    const ex = before.x - this.state.x;
    const ey = before.y - this.state.y;
    const err = Math.hypot(ex, ey);
    if (err > 0.5) this.corrections++;
    if (err > 80) {
      // teleporte legítimo (ex.: Passo Etéreo) ou grande divergência: sem suavização
      this.smoothX = 0;
      this.smoothY = 0;
      this.prev = { x: this.state.x, y: this.state.y };
    } else {
      this.smoothX += ex;
      this.smoothY += ey;
      this.prev.x -= ex;
      this.prev.y -= ey;
    }
  }

  /** Posição para desenhar (interpolada entre ticks + suavização de correção). */
  render(alpha: number, dtMs: number): { x: number; y: number } {
    const k = Math.exp(-dtMs / 90);
    this.smoothX *= k;
    this.smoothY *= k;
    if (Math.abs(this.smoothX) < 0.05) this.smoothX = 0;
    if (Math.abs(this.smoothY) < 0.05) this.smoothY = 0;
    return {
      x: this.prev.x + (this.state.x - this.prev.x) * alpha + this.smoothX,
      y: this.prev.y + (this.state.y - this.prev.y) * alpha + this.smoothY,
    };
  }
}
