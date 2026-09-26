/**
 * Efeitos visuais locais: partículas em pool, arcos de golpe, anéis de onda, números de dano,
 * balões de fala, tremor de câmera e flash (ambos reduzíveis nas configurações).
 */
import Phaser from 'phaser';
import { FONT, placeText, tf } from './textures.js';

interface Particle {
  img: Phaser.GameObjects.Image;
  vx: number;
  vy: number;
  g: number;
  life: number;
  max: number;
  fade: boolean;
  drag: number;
}

interface Transient {
  kind: 'arc' | 'ring' | 'cone' | 'burst' | 'line';
  x: number;
  y: number;
  a: number;
  arc: number;
  r0: number;
  r1: number;
  life: number;
  max: number;
  color: number;
  color2: number;
  width: number;
  follow?: () => { x: number; y: number } | null;
  x2?: number;
  y2?: number;
}

interface Floating {
  t: Phaser.GameObjects.BitmapText;
  y?: number;
  vy: number;
  life: number;
  max: number;
}

export interface FxSettings {
  shake: number;
  flashes: number;
  damageNumbers: boolean;
}

const MAX_PARTICLES = 700;

export class Effects {
  private pool: Phaser.GameObjects.Image[] = [];
  private live: Particle[] = [];
  private transients: Transient[] = [];
  private floats: Floating[] = [];
  private floatPool: Phaser.GameObjects.BitmapText[] = [];
  readonly g: Phaser.GameObjects.Graphics;
  private flashRect: Phaser.GameObjects.Rectangle;
  settings: FxSettings = { shake: 1, flashes: 1, damageNumbers: true };

  constructor(private readonly scene: Phaser.Scene) {
    this.g = scene.add.graphics().setDepth(90000);
    this.flashRect = scene.add.rectangle(0, 0, 640, 360, 0xffffff, 0).setOrigin(0, 0).setScrollFactor(0).setDepth(200000);
  }

  get particleCount(): number {
    return this.live.length;
  }

  clear(): void {
    for (const p of this.live) {
      p.img.setVisible(false);
      this.pool.push(p.img);
    }
    this.live = [];
    this.transients = [];
    for (const f of this.floats) {
      f.t.setVisible(false);
      this.floatPool.push(f.t);
    }
    this.floats = [];
    this.g.clear();
  }

  // ---------------------------------------------------------------- partículas

  particle(frame: string, x: number, y: number, vx: number, vy: number, life: number, opts: { g?: number; fade?: boolean; drag?: number; depth?: number; tint?: number } = {}): void {
    if (this.live.length >= MAX_PARTICLES) return;
    const [tex, fr] = tf(frame);
    let img = this.pool.pop();
    if (!img) img = this.scene.add.image(0, 0, tex, fr);
    else img.setTexture(tex, fr);
    img.setPosition(x, y).setVisible(true).setAlpha(1).setDepth(opts.depth ?? y + 40).setAngle(0);
    if (opts.tint !== undefined) img.setTint(opts.tint);
    else img.clearTint();
    this.live.push({ img, vx, vy, g: opts.g ?? 0, life, max: life, fade: opts.fade ?? true, drag: opts.drag ?? 0.92 });
  }

  burst(frame: string, x: number, y: number, n: number, speed: number, life = 0.5, opts: { g?: number; up?: number; depth?: number; spread?: number; dir?: number } = {}): void {
    for (let i = 0; i < n; i++) {
      const a = opts.dir !== undefined ? opts.dir + (Math.random() - 0.5) * (opts.spread ?? 1.2) : Math.random() * Math.PI * 2;
      const s = speed * (0.4 + Math.random() * 0.8);
      this.particle(frame, x, y, Math.cos(a) * s, Math.sin(a) * s - (opts.up ?? 0), life * (0.6 + Math.random() * 0.6), {
        ...(opts.g !== undefined ? { g: opts.g } : {}),
        ...(opts.depth !== undefined ? { depth: opts.depth } : {}),
      });
    }
  }

  // ---------------------------------------------------------------- formas transitórias

  arc(x: number, y: number, a: number, arcDeg: number, radius: number, color: number, color2: number, life = 0.16, width = 3, follow?: () => { x: number; y: number } | null): void {
    this.transients.push({ kind: 'arc', x, y, a, arc: (arcDeg * Math.PI) / 180, r0: radius * 0.45, r1: radius, life, max: life, color, color2, width, ...(follow ? { follow } : {}) });
  }

  ring(x: number, y: number, r0: number, r1: number, color: number, life = 0.35, width = 2): void {
    this.transients.push({ kind: 'ring', x, y, a: 0, arc: Math.PI * 2, r0, r1, life, max: life, color, color2: color, width });
  }

  cone(x: number, y: number, a: number, arcDeg: number, r1: number, color: number, life = 0.3): void {
    for (let k = 0; k < 3; k++) {
      this.transients.push({ kind: 'cone', x, y, a, arc: (arcDeg * Math.PI) / 180, r0: 6 + k * 6, r1: r1 * (0.55 + k * 0.22), life: life + k * 0.06, max: life + k * 0.06, color, color2: color, width: 2 });
    }
  }

  line(x: number, y: number, x2: number, y2: number, color: number, life = 0.2, width = 2): void {
    this.transients.push({ kind: 'line', x, y, x2, y2, a: 0, arc: 0, r0: 0, r1: 0, life, max: life, color, color2: color, width });
  }

  // ---------------------------------------------------------------- textos

  number(x: number, y: number, text: string, color: number, big = false): void {
    if (!this.settings.damageNumbers && color !== 0x7fc47a) return;
    let t = this.floatPool.pop();
    if (!t) t = this.scene.add.bitmapText(0, 0, FONT, '', 11);
    t.setText(text).setTint(color).setVisible(true).setAlpha(1).setDepth(95000).setScale(big ? 2 : 1);
    placeText(t, x, y, 0.5, 1);
    this.floats.push({ t, vy: -34 - Math.random() * 10, life: 0.8, max: 0.8 });
  }

  /** Balão de fala pixelado que segue um alvo. */
  bubble(text: string, follow: () => { x: number; y: number } | null, life = 2.6): void {
    const t = this.scene.add.bitmapText(0, 0, FONT, text, 11).setTint(0x0b0a12).setDepth(96000);
    const bg = this.scene.add.graphics().setDepth(95999);
    let left = life;
    const upd = (_t: number, dt: number): void => {
      left -= dt / 1000;
      const pos = follow();
      if (!pos || left <= 0) {
        t.destroy();
        bg.destroy();
        this.scene.events.off('update', upd);
        return;
      }
      const w = t.width + 6;
      const x = Math.round(pos.x);
      const y = Math.round(pos.y);
      placeText(t, x, y - 3, 0.5, 1);
      bg.clear();
      bg.fillStyle(0x0b0a12, 1).fillRect(x - w / 2 - 1, y - 16, w + 2, 15);
      bg.fillStyle(0xeef1f7, 1).fillRect(x - w / 2, y - 15, w, 13);
      bg.fillStyle(0xeef1f7, 1).fillRect(x - 2, y - 2, 4, 2).fillRect(x - 1, y, 2, 2);
      const a = Math.min(1, left * 3);
      t.setAlpha(a);
      bg.setAlpha(a);
    };
    this.scene.events.on('update', upd);
  }

  // ---------------------------------------------------------------- câmera

  shake(intensity: number, ms = 120): void {
    const s = this.settings.shake;
    if (s <= 0) return;
    this.scene.cameras.main.shake(ms, (intensity / 360) * s);
  }

  flash(color: number, strength = 0.35, ms = 90): void {
    const s = this.settings.flashes;
    if (s <= 0) return;
    this.flashRect.setFillStyle(color, strength * s);
    this.scene.tweens.killTweensOf(this.flashRect);
    this.scene.tweens.add({ targets: this.flashRect, fillAlpha: 0, duration: ms, ease: 'Stepped', easeParams: [3] });
  }

  // ---------------------------------------------------------------- atualização

  update(dt: number): void {
    const s = dt / 1000;
    for (let i = this.live.length - 1; i >= 0; i--) {
      const p = this.live[i] as Particle;
      p.life -= s;
      if (p.life <= 0) {
        p.img.setVisible(false);
        this.pool.push(p.img);
        this.live.splice(i, 1);
        continue;
      }
      p.vy += p.g * s;
      p.vx *= Math.pow(p.drag, s * 30);
      p.vy *= Math.pow(p.drag, s * 30);
      p.img.x += p.vx * s;
      p.img.y += p.vy * s;
      if (p.fade) p.img.setAlpha(Math.ceil((p.life / p.max) * 4) / 4);
    }
    for (let i = this.floats.length - 1; i >= 0; i--) {
      const f = this.floats[i] as Floating;
      f.life -= s;
      f.y = (f.y ?? f.t.y) + f.vy * s;
      f.t.y = Math.round(f.y);
      f.vy *= 0.9;
      f.t.setAlpha(f.life < 0.3 ? Math.ceil((f.life / 0.3) * 3) / 3 : 1);
      if (f.life <= 0) {
        f.t.setVisible(false);
        this.floatPool.push(f.t);
        this.floats.splice(i, 1);
      }
    }
    const g = this.g;
    g.clear();
    for (let i = this.transients.length - 1; i >= 0; i--) {
      const t = this.transients[i] as Transient;
      t.life -= s;
      if (t.life <= 0) {
        this.transients.splice(i, 1);
        continue;
      }
      const k = 1 - t.life / t.max; // 0→1
      if (t.follow) {
        const p = t.follow();
        if (p) {
          t.x = p.x;
          t.y = p.y;
        }
      }
      const alpha = t.life / t.max > 0.5 ? 1 : 0.55;
      switch (t.kind) {
        case 'arc': {
          // arco de golpe: varre de a-arc/2 até a+arc/2 nos primeiros 40% da vida
          const sweep = Math.min(1, k / 0.4);
          const a0 = t.a - t.arc / 2;
          const a1 = a0 + t.arc * sweep;
          const tail = Math.max(a0, a1 - t.arc * 0.7);
          g.lineStyle(t.width + 2, t.color2, alpha * 0.8);
          g.beginPath();
          g.arc(t.x, t.y, t.r1 - 2, tail, a1, false);
          g.strokePath();
          g.lineStyle(t.width, t.color, alpha);
          g.beginPath();
          g.arc(t.x, t.y, t.r1, tail, a1, false);
          g.strokePath();
          g.lineStyle(1, 0xffffff, alpha);
          g.beginPath();
          g.arc(t.x, t.y, t.r1 + 1, Math.max(tail, a1 - 0.35), a1, false);
          g.strokePath();
          break;
        }
        case 'ring': {
          const r = t.r0 + (t.r1 - t.r0) * (1 - Math.pow(1 - k, 2));
          g.lineStyle(t.width, t.color, alpha);
          g.strokeCircle(t.x, t.y, r);
          if (t.width > 1) {
            g.lineStyle(1, 0xffffff, alpha * 0.8);
            g.strokeCircle(t.x, t.y, r - t.width);
          }
          break;
        }
        case 'cone': {
          const r = t.r0 + (t.r1 - t.r0) * k;
          g.lineStyle(t.width, t.color, alpha);
          g.beginPath();
          g.arc(t.x, t.y, r, t.a - t.arc / 2, t.a + t.arc / 2, false);
          g.strokePath();
          break;
        }
        case 'line':
          g.lineStyle(t.width, t.color, alpha);
          g.lineBetween(t.x, t.y, t.x2 ?? t.x, t.y2 ?? t.y);
          break;
        default:
          break;
      }
    }
  }
}
