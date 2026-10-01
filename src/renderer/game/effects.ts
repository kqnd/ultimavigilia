/**
 * Efeitos visuais locais: partículas em pool, arcos de golpe, anéis de onda, números de dano,
 * balões de fala, tremor de câmera e flash (ambos reduzíveis nas configurações).
 *
 * v1.5 — camada de LUZ. Tudo que é habilidade agora emite luz de verdade:
 * - uma camada aditiva (ADD) desenhada ACIMA da máscara de escuridão, então golpes e magias
 *   acendem a noite em vez de ficarem escurecidos por ela;
 * - texturas suaves geradas em canvas (brilho radial, anel, risco e estrela de quatro pontas)
 *   com filtro linear: o halo é liso mesmo com a arte em pixel;
 * - primitivas compostas: `flare`, `shock`, `sparks`, `rays`, `pillar`, `swirl`, `streak`;
 * - bloom automático em todos os arcos/anéis/cones/linhas (traço largo e translúcido por baixo
 *   do traço nítido) e "rastro" preenchido nos arcos de golpe;
 * - faíscas luminosas automáticas nas explosões de partículas que brilham (brasa, magia, almas…);
 * - luzes dinâmicas temporárias que a cena carimba na máscara de escuridão.
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

/** Sprite de luz (aditivo) com vida, movimento e curva de escala/alfa. */
interface Glow {
  img: Phaser.GameObjects.Image;
  life: number;
  max: number;
  s0: number;
  s1: number;
  /** Escala vertical relativa (achatamento em perspectiva). */
  sy: number;
  a0: number;
  vx: number;
  vy: number;
  g: number;
  drag: number;
  spin: number;
  /** Risco alinhado à velocidade (faíscas). */
  stretch: number;
  /** Fração inicial da vida em que o brilho ainda está acendendo. */
  fadeIn: number;
  follow?: (() => { x: number; y: number } | null) | undefined;
  ox: number;
  oy: number;
  /** Órbita (swirl): raio, ângulo, velocidade angular e queda do raio. */
  orbit?: { r: number; a: number; w: number; shrink: number; cx: number; cy: number; flat: number };
}

/** Luz temporária carimbada na máscara de escuridão pela cena. */
export interface FxLight {
  x: number;
  y: number;
  r: number;
  a: number;
  life: number;
  max: number;
}

export interface FxSettings {
  shake: number;
  flashes: number;
  damageNumbers: boolean;
  /** Intensidade da camada de luz (0–1). */
  glow?: number;
}

export interface GlowOpts {
  life?: number;
  /** Escala final (multiplica `size`); padrão 1. */
  grow?: number;
  alpha?: number;
  vx?: number;
  vy?: number;
  g?: number;
  drag?: number;
  rot?: number;
  spin?: number;
  sy?: number;
  fadeIn?: number;
  follow?: () => { x: number; y: number } | null;
  frame?: GlowFrame;
}

export type GlowFrame = 'glow_soft' | 'glow_core' | 'glow_ring' | 'glow_streak' | 'glow_star';

const MAX_PARTICLES = 700;
const MAX_GLOWS = 520;
/** Acima da escuridão (150000) e abaixo do flash de tela (200000). */
const LIGHT_DEPTH = 150500;

/** Partículas que "brilham": a explosão delas ganha faíscas de luz desta cor. */
const GLOW_OF: Record<string, number> = {
  p_ember: 0xffa13a, p_cinder: 0xff8a2a, p_mag: 0x5fe8ff, p_arc: 0x8f7bff, p_soul: 0xb4f05a, p_heal: 0xff6f6a,
  p_rune: 0x6dffb0, p_abyss: 0xd860ff, p_frost: 0x8fdcff, p_ice: 0xbdf0ff, p_blood: 0xff2a3a, p_silver: 0xdbe8ff,
  p_star: 0xffd25a, p_pulpLight: 0xff8a7a, p_wound: 0xb07aff, p_booze: 0xffb43a, p_white: 0xffffff, p_glass: 0xb8ff9a,
};

/** Texturas de luz (canvas 2D liso, filtro linear). */
function ensureGlowTextures(scene: Phaser.Scene): void {
  const make = (key: string, w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void): void => {
    if (scene.textures.exists(key)) return;
    const cv = document.createElement('canvas');
    cv.width = w;
    cv.height = h;
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    draw(ctx);
    scene.textures.addCanvas(key, cv)?.setFilter(Phaser.Textures.FilterMode.LINEAR);
  };
  const radial = (ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, stops: [number, number][]): void => {
    const gr = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    for (const [o, a] of stops) gr.addColorStop(o, `rgba(255,255,255,${a})`);
    ctx.fillStyle = gr;
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
  };
  make('glow_soft', 64, 64, (c) => radial(c, 32, 32, 32, [[0, 1], [0.18, 0.7], [0.45, 0.24], [0.75, 0.06], [1, 0]]));
  make('glow_core', 32, 32, (c) => radial(c, 16, 16, 16, [[0, 1], [0.35, 0.85], [0.7, 0.2], [1, 0]]));
  make('glow_ring', 128, 128, (c) => radial(c, 64, 64, 64, [[0, 0], [0.62, 0], [0.8, 0.35], [0.88, 1], [0.93, 0.45], [1, 0]]));
  make('glow_streak', 64, 16, (c) => {
    c.save();
    c.scale(1, 0.25);
    radial(c, 32, 32, 32, [[0, 1], [0.3, 0.6], [0.7, 0.12], [1, 0]]);
    c.restore();
  });
  make('glow_star', 64, 64, (c) => {
    for (const rot of [0, Math.PI / 2]) {
      c.save();
      c.translate(32, 32);
      c.rotate(rot);
      c.scale(1, 0.09);
      radial(c, 0, 0, 32, [[0, 1], [0.4, 0.5], [1, 0]]);
      c.restore();
    }
    radial(c, 32, 32, 12, [[0, 1], [0.5, 0.5], [1, 0]]);
  });
}

/** Setor de anel preenchido (rastro luminoso de golpes). */
function fillSector(g: Phaser.GameObjects.Graphics, x: number, y: number, r0: number, r1: number, a0: number, a1: number, color: number, alpha: number): void {
  if (a1 <= a0 || alpha <= 0) return;
  const n = Math.max(3, Math.ceil(((a1 - a0) / Math.PI) * 14));
  g.fillStyle(color, alpha);
  g.beginPath();
  for (let i = 0; i <= n; i++) {
    const a = a0 + ((a1 - a0) * i) / n;
    if (i === 0) g.moveTo(x + Math.cos(a) * r1, y + Math.sin(a) * r1);
    else g.lineTo(x + Math.cos(a) * r1, y + Math.sin(a) * r1);
  }
  for (let i = n; i >= 0; i--) {
    const a = a0 + ((a1 - a0) * i) / n;
    g.lineTo(x + Math.cos(a) * r0, y + Math.sin(a) * r0);
  }
  g.closePath();
  g.fillPath();
}

export class Effects {
  private pool: Phaser.GameObjects.Image[] = [];
  private live: Particle[] = [];
  private transients: Transient[] = [];
  private floats: Floating[] = [];
  private floatPool: Phaser.GameObjects.BitmapText[] = [];
  private glowPool: Phaser.GameObjects.Image[] = [];
  private glows: Glow[] = [];
  /** Brilhos de um quadro só (auras), reciclados a cada `beginFrame`. */
  private auraPool: Phaser.GameObjects.Image[] = [];
  private auraUsed = 0;
  private lights: FxLight[] = [];
  /** Janela da câmera (mundo) para culling manual de partículas e luzes fora da tela. */
  private view = { x0: -1e9, y0: -1e9, x1: 1e9, y1: 1e9 };
  readonly g: Phaser.GameObjects.Graphics;
  /** Camada aditiva acima da escuridão: bloom dos traços. */
  readonly lg: Phaser.GameObjects.Graphics;
  private flashRect: Phaser.GameObjects.Rectangle;
  settings: FxSettings = { shake: 1, flashes: 1, damageNumbers: true, glow: 1 };

  constructor(private readonly scene: Phaser.Scene) {
    ensureGlowTextures(scene);
    this.g = scene.add.graphics().setDepth(90000);
    this.lg = scene.add.graphics().setDepth(LIGHT_DEPTH - 1).setBlendMode(Phaser.BlendModes.ADD);
    this.flashRect = scene.add.rectangle(0, 0, 640, 360, 0xffffff, 0).setOrigin(0, 0).setScrollFactor(0).setDepth(200000);
  }

  get particleCount(): number {
    return this.live.length + this.glows.length;
  }

  private get glowK(): number {
    return Math.max(0, Math.min(1, this.settings.glow ?? 1));
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
    for (const gl of this.glows) {
      gl.img.setVisible(false);
      this.glowPool.push(gl.img);
    }
    this.glows = [];
    this.lights = [];
    this.beginFrame();
    this.g.clear();
    this.lg.clear();
  }

  /** Define a janela visível (scroll + tamanho). Partículas e halos fora dela deixam de ser desenhados. */
  setView(x: number, y: number, w: number, h: number): void {
    const v = this.view;
    v.x0 = x - 12;
    v.y0 = y - 12;
    v.x1 = x + w + 12;
    v.y1 = y + h + 12;
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
    const glowColor = GLOW_OF[frame];
    for (let i = 0; i < n; i++) {
      const a = opts.dir !== undefined ? opts.dir + (Math.random() - 0.5) * (opts.spread ?? 1.2) : Math.random() * Math.PI * 2;
      const s = speed * (0.4 + Math.random() * 0.8);
      const vx = Math.cos(a) * s;
      const vy = Math.sin(a) * s - (opts.up ?? 0);
      const l = life * (0.6 + Math.random() * 0.6);
      this.particle(frame, x, y, vx, vy, l, {
        ...(opts.g !== undefined ? { g: opts.g } : {}),
        ...(opts.depth !== undefined ? { depth: opts.depth } : {}),
      });
      // metade das partículas luminosas ganha um halo aditivo que acompanha o mesmo movimento
      if (glowColor !== undefined && i % 2 === 0) {
        this.glow(x, y, glowColor, 0.22 + Math.random() * 0.12, { life: l * 0.9, vx, vy, g: opts.g ?? 0, drag: 0.92, alpha: 0.75, grow: 0.4, frame: 'glow_core' });
      }
    }
  }

  // ---------------------------------------------------------------- luz (camada aditiva)

  /**
   * Sprite de luz. `size` é a escala inicial da textura (glow_soft = 64px ⇒ size 1 = 64px de
   * diâmetro). Cresce até `size * grow` e apaga ao longo da vida.
   */
  glow(x: number, y: number, color: number, size: number, o: GlowOpts = {}): void {
    const k = this.glowK;
    if (k <= 0 || this.glows.length >= MAX_GLOWS) return;
    const frame = o.frame ?? 'glow_soft';
    let img = this.glowPool.pop();
    if (!img) img = this.scene.add.image(0, 0, frame).setBlendMode(Phaser.BlendModes.ADD);
    else img.setTexture(frame);
    img.setPosition(x, y).setVisible(true).setDepth(LIGHT_DEPTH).setTint(color).setRotation(o.rot ?? 0).setScale(size, size * (o.sy ?? 1));
    const life = o.life ?? 0.35;
    this.glows.push({
      img, life, max: life, s0: size, s1: size * (o.grow ?? 1), sy: o.sy ?? 1, a0: (o.alpha ?? 1) * k,
      vx: o.vx ?? 0, vy: o.vy ?? 0, g: o.g ?? 0, drag: o.drag ?? 1, spin: o.spin ?? 0, stretch: 0,
      fadeIn: o.fadeIn ?? 0, follow: o.follow, ox: 0, oy: 0,
    });
    if (o.follow) {
      const p = o.follow();
      const gl = this.glows[this.glows.length - 1] as Glow;
      if (p) {
        gl.ox = x - p.x;
        gl.oy = y - p.y;
      }
    }
  }

  /** Clarão: núcleo branco + halo colorido grande (impactos, estouros). */
  flare(x: number, y: number, color: number, size = 1, life = 0.3): void {
    this.glow(x, y, color, size * 1.1, { life: life * 1.2, grow: 1.6, alpha: 0.85 });
    this.glow(x, y, 0xffffff, size * 0.45, { life: life * 0.7, grow: 1.2, alpha: 0.9, frame: 'glow_core' });
    this.glow(x, y, color, size * 0.7, { life: life * 0.8, grow: 1.3, alpha: 0.9, frame: 'glow_star', rot: Math.random() * 0.6 });
  }

  /** Onda de choque luminosa (anel suave que expande em perspectiva). */
  shock(x: number, y: number, r: number, color: number, life = 0.4, alpha = 0.9, flat = 0.55): void {
    // glow_ring tem 128px com o pico do anel em ~0.88 do raio ⇒ escala para o raio desejado
    const s = r / 56;
    this.glow(x, y, color, s * 0.15, { life, grow: 1 / 0.15, alpha, sy: flat, frame: 'glow_ring' });
  }

  /** Faíscas: riscos luminosos esticados na direção do movimento. */
  sparks(x: number, y: number, n: number, color: number, speed = 120, life = 0.4, o: { dir?: number; spread?: number; g?: number; up?: number; size?: number } = {}): void {
    const k = this.glowK;
    if (k <= 0) return;
    for (let i = 0; i < n && this.glows.length < MAX_GLOWS; i++) {
      const a = o.dir !== undefined ? o.dir + (Math.random() - 0.5) * (o.spread ?? 1.2) : Math.random() * Math.PI * 2;
      const s = speed * (0.45 + Math.random() * 0.8);
      const sz = (o.size ?? 1) * (0.14 + Math.random() * 0.1);
      this.glow(x, y, i % 4 === 0 ? 0xffffff : color, sz, {
        life: life * (0.6 + Math.random() * 0.6), vx: Math.cos(a) * s, vy: Math.sin(a) * s - (o.up ?? 0), g: o.g ?? 0, drag: 0.9, frame: 'glow_streak', grow: 0.5, alpha: 0.95,
      });
      (this.glows[this.glows.length - 1] as Glow).stretch = 1;
    }
  }

  /** Raios de luz saindo do centro (estrela de impacto grande). */
  rays(x: number, y: number, n: number, color: number, len = 40, life = 0.35, rot = Math.random() * Math.PI): void {
    for (let i = 0; i < n; i++) {
      const a = rot + (i / n) * Math.PI * 2;
      const l = len * (0.6 + ((i * 7) % 5) / 8);
      const cx = x + Math.cos(a) * l * 0.5;
      const cy = y + Math.sin(a) * l * 0.5 * 0.7;
      this.glow(cx, cy, color, l / 64, { life, grow: 1.4, alpha: 0.7, rot: Math.atan2(Math.sin(a) * 0.7, Math.cos(a)), sy: 0.6, frame: 'glow_streak' });
    }
  }

  /** Coluna de luz vertical (supremas, ressurreição, checkpoint). */
  pillar(x: number, y: number, color: number, height = 90, width = 1, life = 0.6): void {
    this.glow(x, y - height / 2, color, height / 64, { life, grow: 1.05, alpha: 0.75, rot: Math.PI / 2, sy: 1.6 * width, frame: 'glow_streak', fadeIn: 0.15 });
    this.glow(x, y - height / 2, 0xffffff, height / 80, { life: life * 0.7, grow: 1, alpha: 0.6, rot: Math.PI / 2, sy: 0.6 * width, frame: 'glow_streak', fadeIn: 0.1 });
    this.glow(x, y, color, 0.9 * width, { life, grow: 1.5, alpha: 0.6, sy: 0.45 });
  }

  /** Faíscas em espiral (carga para dentro, ou explosão girando para fora). */
  swirl(x: number, y: number, n: number, color: number, r = 30, life = 0.6, inward = true, flat = 0.6): void {
    const k = this.glowK;
    if (k <= 0) return;
    const base = Math.random() * Math.PI * 2;
    for (let i = 0; i < n && this.glows.length < MAX_GLOWS; i++) {
      const a = base + (i / n) * Math.PI * 2;
      this.glow(x, y, i % 3 === 0 ? 0xffffff : color, 0.16 + Math.random() * 0.08, { life: life * (0.8 + Math.random() * 0.4), frame: 'glow_core', alpha: 0.9, fadeIn: 0.1 });
      const gl = this.glows[this.glows.length - 1] as Glow;
      gl.orbit = { r: inward ? r : r * 0.15, a, w: (inward ? 7 : 5) * (i % 2 ? 1 : -1), shrink: inward ? -r / life : r / life, cx: x, cy: y, flat };
    }
  }

  /** Risco de luz orientado (rastro de investidas, cortes). */
  streak(x: number, y: number, a: number, color: number, len = 40, life = 0.25, thick = 1): void {
    this.glow(x, y, color, len / 64, { life, grow: 1.15, alpha: 0.85, rot: a, sy: thick, frame: 'glow_streak' });
  }

  /** Luz temporária que recorta a escuridão (a cena carimba). */
  light(x: number, y: number, r: number, a = 1, life = 0.35): void {
    if (this.lights.length > 48) this.lights.shift();
    this.lights.push({ x, y, r, a, life, max: life });
  }

  /** Luzes ativas com o alfa atual (decaimento suave). */
  activeLights(): readonly FxLight[] {
    return this.lights;
  }

  /** Brilho de um quadro só (auras de estados contínuos). Chame a cada quadro enquanto durar. */
  aura(x: number, y: number, color: number, size: number, alpha: number, frame: GlowFrame = 'glow_soft', sy = 1, rot = 0): void {
    const k = this.glowK;
    if (k <= 0) return;
    let img = this.auraPool[this.auraUsed];
    if (!img) {
      img = this.scene.add.image(0, 0, frame).setBlendMode(Phaser.BlendModes.ADD).setDepth(LIGHT_DEPTH);
      this.auraPool.push(img);
    } else if (img.texture.key !== frame) img.setTexture(frame);
    this.auraUsed++;
    img.setPosition(x, y).setVisible(true).setTint(color).setAlpha(alpha * k).setScale(size, size * sy).setRotation(rot);
  }

  /** Recicla as auras do quadro anterior (chamado no início do quadro da cena). */
  beginFrame(): void {
    for (let i = 0; i < this.auraUsed; i++) this.auraPool[i]?.setVisible(false);
    this.auraUsed = 0;
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
    t.setText(text).setTint(color).setVisible(true).setAlpha(1).setDepth(158000).setScale(big ? 2 : 1);
    placeText(t, x, y, 0.5, 1);
    this.floats.push({ t, vy: -34 - Math.random() * 10, life: 0.8, max: 0.8 });
  }

  /** Balão de fala pixelado que segue um alvo. */
  bubble(text: string, follow: () => { x: number; y: number } | null, life = 2.6): void {
    const t = this.scene.add.bitmapText(0, 0, FONT, text, 11).setTint(0x0b0a12).setDepth(158501);
    const bg = this.scene.add.graphics().setDepth(158500);
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
    const v = this.view;
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
      if (p.drag !== 1) {
        const dk = Math.pow(p.drag, s * 30);
        p.vx *= dk;
        p.vy *= dk;
      }
      p.img.x += p.vx * s;
      p.img.y += p.vy * s;
      const inView = p.img.x >= v.x0 && p.img.x <= v.x1 && p.img.y >= v.y0 && p.img.y <= v.y1;
      if (inView !== p.img.visible) p.img.setVisible(inView);
      if (p.fade) p.img.setAlpha(Math.ceil((p.life / p.max) * 4) / 4);
    }
    // luz: curvas suaves (não em degraus, ao contrário das partículas de pixel)
    for (let i = this.glows.length - 1; i >= 0; i--) {
      const gl = this.glows[i] as Glow;
      gl.life -= s;
      if (gl.life <= 0) {
        gl.img.setVisible(false);
        this.glowPool.push(gl.img);
        this.glows.splice(i, 1);
        continue;
      }
      const k = 1 - gl.life / gl.max;
      const img = gl.img;
      if (gl.orbit) {
        const o = gl.orbit;
        o.a += o.w * s;
        o.r = Math.max(0, o.r + o.shrink * s);
        img.setPosition(o.cx + Math.cos(o.a) * o.r, o.cy + Math.sin(o.a) * o.r * o.flat);
      } else {
        gl.vy += gl.g * s;
        if (gl.drag !== 1) {
          const dk = Math.pow(gl.drag, s * 30);
          gl.vx *= dk;
          gl.vy *= dk;
        }
        if (gl.follow) {
          const p = gl.follow();
          if (p) img.setPosition(p.x + gl.ox, p.y + gl.oy);
        } else {
          img.x += gl.vx * s;
          img.y += gl.vy * s;
        }
      }
      const ease = 1 - Math.pow(1 - k, 3);
      const sc = gl.s0 + (gl.s1 - gl.s0) * ease;
      // culling: halo totalmente fora da tela não precisa de escala/alfa nem de desenho (raio conservador, cobre rotação)
      const half = img.width * 0.5 * sc * (gl.stretch ? 1 + Math.hypot(gl.vx, gl.vy) / 90 : Math.max(1, gl.sy)) + 4;
      const gvis = img.x + half >= v.x0 && img.x - half <= v.x1 && img.y + half >= v.y0 && img.y - half <= v.y1;
      if (gvis !== img.visible) img.setVisible(gvis);
      if (!gvis) continue;
      if (gl.stretch) {
        const sp = Math.hypot(gl.vx, gl.vy);
        img.setRotation(Math.atan2(gl.vy, gl.vx)).setScale(sc * (1 + sp / 90), sc * 0.55);
      } else {
        if (gl.spin) img.rotation += gl.spin * s;
        img.setScale(sc, sc * gl.sy);
      }
      const fin = gl.fadeIn > 0 && k < gl.fadeIn ? k / gl.fadeIn : 1;
      img.setAlpha(gl.a0 * fin * Math.pow(1 - k, 1.6));
    }
    for (let i = this.lights.length - 1; i >= 0; i--) {
      const l = this.lights[i] as FxLight;
      l.life -= s;
      if (l.life <= 0) this.lights.splice(i, 1);
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
    const lg = this.lg;
    const gk = this.glowK;
    g.clear();
    lg.clear();
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
      // bloom: some liso (sem degraus) por cima da escuridão
      const bloom = gk * (1 - k) * (1 - k);
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
          if (bloom > 0) {
            // rastro preenchido (a lâmina "deixa luz no ar") + halo largo + fio quente na ponta
            fillSector(lg, t.x, t.y, t.r1 * 0.5, t.r1 + 1, tail, a1, t.color2, 0.22 * bloom);
            fillSector(lg, t.x, t.y, t.r1 * 0.78, t.r1 + 2, Math.max(tail, a1 - t.arc * 0.35), a1, t.color, 0.3 * bloom);
            lg.lineStyle(t.width * 4 + 4, t.color2, 0.16 * bloom);
            lg.beginPath();
            lg.arc(t.x, t.y, t.r1, tail, a1, false);
            lg.strokePath();
            lg.lineStyle(t.width + 1, t.color, 0.55 * bloom);
            lg.beginPath();
            lg.arc(t.x, t.y, t.r1, tail, a1, false);
            lg.strokePath();
            lg.lineStyle(2, 0xffffff, 0.7 * bloom);
            lg.beginPath();
            lg.arc(t.x, t.y, t.r1 + 1, Math.max(tail, a1 - 0.3), a1, false);
            lg.strokePath();
          }
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
          if (bloom > 0) {
            lg.lineStyle(t.width * 5 + 4, t.color, 0.12 * bloom);
            lg.strokeCircle(t.x, t.y, r);
            lg.lineStyle(t.width * 2 + 1, t.color, 0.32 * bloom);
            lg.strokeCircle(t.x, t.y, r);
            lg.lineStyle(1, 0xffffff, 0.5 * bloom);
            lg.strokeCircle(t.x, t.y, r);
          }
          break;
        }
        case 'cone': {
          const r = t.r0 + (t.r1 - t.r0) * k;
          g.lineStyle(t.width, t.color, alpha);
          g.beginPath();
          g.arc(t.x, t.y, r, t.a - t.arc / 2, t.a + t.arc / 2, false);
          g.strokePath();
          if (bloom > 0) {
            lg.lineStyle(t.width * 4 + 2, t.color, 0.16 * bloom);
            lg.beginPath();
            lg.arc(t.x, t.y, r, t.a - t.arc / 2, t.a + t.arc / 2, false);
            lg.strokePath();
            fillSector(lg, t.x, t.y, Math.max(0, r - 10), r, t.a - t.arc / 2, t.a + t.arc / 2, t.color, 0.12 * bloom);
          }
          break;
        }
        case 'line':
          g.lineStyle(t.width, t.color, alpha);
          g.lineBetween(t.x, t.y, t.x2 ?? t.x, t.y2 ?? t.y);
          if (bloom > 0) {
            lg.lineStyle(t.width * 4 + 2, t.color, 0.18 * bloom);
            lg.lineBetween(t.x, t.y, t.x2 ?? t.x, t.y2 ?? t.y);
            lg.lineStyle(1, 0xffffff, 0.55 * bloom);
            lg.lineBetween(t.x, t.y, t.x2 ?? t.x, t.y2 ?? t.y);
          }
          break;
        default:
          break;
      }
    }
  }
}
