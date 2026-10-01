/**
 * Pós-processamento da cena (Phaser 4: sistema de Filters). Um único filtro de passada única
 * ("FilterVigil") faz: color grading por clima, vinheta suave, bloom barato, aberração cromática
 * curtíssima em impactos, ondas de choque (supremas), calor sobre zonas de fogo e tela de dano/baixa vida.
 *
 * Identidade pixel art: todo deslocamento de UV é quantizado em texels da tela lógica (640×360) e a
 * amostragem cai sempre no centro do texel, então nada borra. Qualquer falha (compilação do shader,
 * contexto WebGL, erro no render) desliga o filtro em silêncio e o jogo segue sem ele.
 */
import Phaser from 'phaser';
import type { Climate } from '../../shared/config/chapters.js';

export type GraphicsQuality = 'low' | 'medium' | 'high';

export const GRAPHICS_QUALITIES: readonly GraphicsQuality[] = ['low', 'medium', 'high'];

export const GRAPHICS_QUALITY_LABEL: Record<GraphicsQuality, string> = { low: 'Baixa', medium: 'Média', high: 'Alta' };

const NODE = 'FilterVigil';

export const VIGIL_FRAGMENT = [
  '#pragma phaserTemplate(shaderName)',
  '#ifdef GL_FRAGMENT_PRECISION_HIGH',
  'precision highp float;',
  '#else',
  'precision mediump float;',
  '#endif',
  'uniform sampler2D uMainSampler;',
  'uniform vec2 uRes;',
  'uniform float uTime;',
  'uniform vec4 uGrade;', // rgb = multiplicador de cor, a = saturação
  'uniform vec4 uMisc;', // x = vinheta, y = contraste, z = bloom, w = aberração (texels nas bordas)
  'uniform vec4 uHeat;', // xy = centro (uv), z = raio (altura da tela = 1), w = amplitude (texels)
  'uniform vec4 uRipple;', // xy = centro (uv), z = raio atual, w = amplitude (texels)
  'uniform vec2 uHurt;', // x = intensidade 0..1, y = pulso 0..1
  'varying vec2 outTexCoord;',
  'vec3 tap (vec2 uv) { return texture2D(uMainSampler, (floor(uv * uRes) + 0.5) / uRes).rgb; }',
  'void main ()',
  '{',
  '    vec2 px = 1.0 / uRes;',
  '    vec2 uv = outTexCoord;',
  '    float aspect = uRes.x / uRes.y;',
  '    vec2 off = vec2(0.0);',
  '    if (uHeat.w > 0.0)',
  '    {',
  '        vec2 d = (uv - uHeat.xy) * vec2(aspect, 1.0);',
  '        float f = 1.0 - smoothstep(0.0, uHeat.z, length(d));',
  '        off.x += sin(uv.y * uRes.y * 0.45 + uTime * 5.0) * f * uHeat.w;',
  '        off.y += sin(uv.x * uRes.x * 0.3 + uTime * 3.5) * f * uHeat.w * 0.5;',
  '    }',
  '    if (uRipple.w > 0.0)',
  '    {',
  '        vec2 d = (uv - uRipple.xy) * vec2(aspect, 1.0);',
  '        float r = length(d);',
  '        float ring = exp(-pow((r - uRipple.z) * 22.0, 2.0));',
  '        off += (d / max(r, 0.0001)) * ring * uRipple.w * vec2(1.0, aspect);',
  '    }',
  '    off = floor(off + 0.5);',
  '    vec2 base = uv + off * px;',
  '    vec3 c;',
  '    if (uMisc.w > 0.0)',
  '    {',
  '        float edge = length((uv - 0.5) * vec2(1.0, 0.9)) * 1.6;',
  '        vec2 ca = vec2(floor(uMisc.w * edge + 0.5), 0.0) * px;',
  '        c = vec3(tap(base + ca).r, tap(base).g, tap(base - ca).b);',
  '    }',
  '    else c = tap(base);',
  '    if (uMisc.z > 0.0)',
  '    {',
  '        vec3 b = tap(base + px * vec2(2.0, 2.0)) + tap(base + px * vec2(-2.0, 2.0)) + tap(base + px * vec2(2.0, -2.0)) + tap(base + px * vec2(-2.0, -2.0));',
  '        b *= 0.25;',
  '        c += max(b - 0.55, 0.0) * uMisc.z;',
  '    }',
  '    float luma = dot(c, vec3(0.299, 0.587, 0.114));',
  '    c = mix(vec3(luma), c, uGrade.a * (1.0 - uHurt.x * 0.35));',
  '    c *= uGrade.rgb;',
  '    c = (c - 0.5) * uMisc.y + 0.5;',
  '    float d = length((uv - 0.5) * vec2(1.0, 0.82));',
  '    float v = smoothstep(0.42, 0.98, d);',
  '    c *= 1.0 - v * uMisc.x;',
  '    float h = smoothstep(0.3, 0.95, d) * uHurt.x * (0.55 + 0.45 * uHurt.y);',
  '    c = mix(c, vec3(0.62, 0.02, 0.05), h * 0.75);',
  '    gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);',
  '}',
].join('\n');

interface Grade {
  tint: [number, number, number];
  sat: number;
  contrast: number;
  vignette: number;
}

/** Color grading por clima/capítulo: sutil, só inclina a paleta. */
export const CLIMATE_GRADE: Record<Climate, Grade> = {
  night: { tint: [0.985, 1.0, 1.06], sat: 1.06, contrast: 1.06, vignette: 0.28 },
  winter: { tint: [0.96, 1.02, 1.09], sat: 0.96, contrast: 1.05, vignette: 0.26 },
  ash: { tint: [1.08, 0.985, 0.95], sat: 1.1, contrast: 1.08, vignette: 0.3 },
};

interface VigilController extends Phaser.Filters.Controller {
  p: {
    res: [number, number];
    time: number;
    grade: [number, number, number, number];
    misc: [number, number, number, number];
    heat: [number, number, number, number];
    ripple: [number, number, number, number];
    hurt: [number, number];
  };
}

type Renderer = Phaser.Renderer.WebGL.WebGLRenderer;

/** Compila só o fragment shader para validar antes de registrar o nó (evita crash no render). */
function compiles(gl: WebGLRenderingContext, source: string): boolean {
  const sh = gl.createShader(gl.FRAGMENT_SHADER);
  if (!sh) return false;
  gl.shaderSource(sh, source.replace('#pragma phaserTemplate(shaderName)', ''));
  gl.compileShader(sh);
  const ok = !!gl.getShaderParameter(sh, gl.COMPILE_STATUS);
  gl.deleteShader(sh);
  return ok;
}

let registered = false;
let broken = false;

/** Registra o RenderNode do filtro no renderer. Retorna false (sem lançar) se não for possível. */
export function registerVigilNode(renderer: Phaser.Renderer.Canvas.CanvasRenderer | Phaser.Renderer.WebGL.WebGLRenderer): boolean {
  if (broken) return false;
  if (registered) return true;
  try {
    const gl = (renderer as Renderer).gl;
    const nodes = (renderer as Renderer).renderNodes;
    if (!gl || !nodes || !compiles(gl, VIGIL_FRAGMENT)) throw new Error('shader inválido');
    const Base = Phaser.Renderer.WebGL.RenderNodes.BaseFilterShader;
    const node = new Base(NODE, nodes, undefined, VIGIL_FRAGMENT);
    node.setupUniforms = function (controller: Phaser.Filters.Controller, ctx: Phaser.Renderer.WebGL.DrawingContext): void {
      const q = (controller as VigilController).p;
      const pm = (node as unknown as { programManager: { setUniform(n: string, v: unknown): void } }).programManager;
      pm.setUniform('uRes', [ctx.width, ctx.height]);
      pm.setUniform('uTime', q.time);
      pm.setUniform('uGrade', q.grade);
      pm.setUniform('uMisc', q.misc);
      pm.setUniform('uHeat', q.heat);
      pm.setUniform('uRipple', q.ripple);
      pm.setUniform('uHurt', q.hurt);
    };
    // erro durante o render: desliga o filtro para sempre e devolve a imagem sem processar
    const run = node.run.bind(node) as (...a: unknown[]) => unknown;
    (node as unknown as { run: (...a: unknown[]) => unknown }).run = (controller: unknown, input: unknown, ...rest: unknown[]): unknown => {
      if (broken) return input;
      try {
        return run(controller, input, ...rest);
      } catch {
        broken = true;
        (controller as Phaser.Filters.Controller).active = false;
        return input;
      }
    };
    nodes.addNode(NODE, node);
    registered = true;
    return true;
  } catch {
    broken = true;
    return false;
  }
}

/**
 * Pós-FX da câmera principal. `configure` aplica qualidade + acessibilidade; `update` roda a cada quadro
 * (só faz algo se o filtro estiver ligado).
 */
export class PostFx {
  private ctl: VigilController | null = null;
  quality: GraphicsQuality = 'medium';
  reduceMotion = false;
  highContrast = false;
  private climate: Climate = 'night';
  private time = 0;
  private caAmt = 0;
  private caLeft = 0;
  private caTotal = 1;
  private rippleT = 0;
  private rippleDur = 1;
  private rippleMax = 0.5;
  private rippleAmp = 0;
  private rippleX = 0.5;
  private rippleY = 0.5;
  private heat = { x: 0.5, y: 0.5, r: 0.2, a: 0 };
  private heatNext = { x: 0.5, y: 0.5, r: 0.2, a: 0 };
  private hurt = 0;

  constructor(private readonly scene: Phaser.Scene) {}

  get active(): boolean {
    return !!this.ctl && this.ctl.active;
  }

  configure(quality: GraphicsQuality, reduceMotion: boolean, highContrast: boolean): void {
    this.quality = quality;
    this.reduceMotion = reduceMotion;
    this.highContrast = highContrast;
    const want = quality !== 'low' && !broken;
    if (want && !this.ctl) this.create();
    if (this.ctl) this.ctl.setActive(want && !broken);
    if (!want) this.caAmt = this.rippleAmp = this.heat.a = this.heatNext.a = 0;
  }

  setClimate(c: Climate): void {
    this.climate = c;
  }

  private create(): void {
    try {
      const renderer = this.scene.game.renderer;
      if (!(this.scene.game.config.renderType === Phaser.WEBGL || renderer.type === Phaser.WEBGL) || !registerVigilNode(renderer)) return;
      const ctl = new Phaser.Filters.Controller(this.scene.cameras.main, NODE) as VigilController;
      ctl.p = { res: [640, 360], time: 0, grade: [1, 1, 1, 1], misc: [0, 1, 0, 0], heat: [0.5, 0.5, 0.2, 0], ripple: [0.5, 0.5, 0, 0], hurt: [0, 0] };
      this.scene.cameras.main.filters.external.add(ctl);
      this.ctl = ctl;
    } catch {
      broken = true;
      this.ctl = null;
    }
  }

  /** Aberração cromática curtíssima (impacto forte, suprema). `amount` em texels nas bordas. */
  aberration(amount: number, ms = 140): void {
    if (!this.active || this.reduceMotion || this.highContrast) return;
    this.caAmt = Math.min(3, Math.max(this.caAmt, amount));
    this.caTotal = ms;
    this.caLeft = ms;
  }

  /** Onda de choque a partir de um ponto da tela lógica (0..640, 0..360). */
  ripple(sx: number, sy: number, maxRadius = 0.55, amp = 2, ms = 520): void {
    if (!this.active || this.reduceMotion || this.highContrast) return;
    this.rippleX = sx / 640;
    this.rippleY = 1 - sy / 360;
    this.rippleMax = maxRadius;
    this.rippleAmp = amp;
    this.rippleDur = ms;
    this.rippleT = ms;
  }

  /** Calor sobre uma zona de fogo: chamado a cada quadro; vale a de maior amplitude. */
  heatSource(sx: number, sy: number, radius: number, amp: number): void {
    if (this.quality !== 'high' || this.reduceMotion || this.highContrast) return;
    if (amp > this.heatNext.a) this.heatNext = { x: sx / 640, y: 1 - sy / 360, r: radius, a: amp };
  }

  /** Intensidade 0..1 de dano/baixa vida (vermelho nas bordas + dessaturação). */
  setHurt(v: number): void {
    this.hurt = Math.max(0, Math.min(1, v));
  }

  update(dtMs: number): void {
    const ctl = this.ctl;
    if (!ctl || !ctl.active) {
      this.heatNext.a = 0;
      return;
    }
    const dt = Math.min(dtMs, 100);
    this.time += this.reduceMotion ? 0 : dt / 1000;
    this.caLeft = Math.max(0, this.caLeft - dt);
    this.rippleT = Math.max(0, this.rippleT - dt);
    const p = ctl.p;
    const hc = this.highContrast;
    const g = CLIMATE_GRADE[this.climate];
    const k = hc ? 0 : 1;
    p.time = this.time;
    p.grade = [1 + (g.tint[0] - 1) * k, 1 + (g.tint[1] - 1) * k, 1 + (g.tint[2] - 1) * k, 1 + (g.sat - 1) * k];
    const ca = this.caLeft > 0 ? this.caAmt * (this.caLeft / this.caTotal) : 0;
    p.misc = [hc ? 0 : g.vignette, hc ? 1 : g.contrast, hc || this.quality !== 'high' ? 0 : 0.5, ca];
    const rk = this.rippleT > 0 ? 1 - this.rippleT / this.rippleDur : 1;
    p.ripple = [this.rippleX, this.rippleY, rk * this.rippleMax, this.rippleT > 0 ? this.rippleAmp * (1 - rk) : 0];
    // o calor suaviza entre quadros: some sozinho se ninguém o reafirmar
    this.heat.a += (this.heatNext.a - this.heat.a) * Math.min(1, dt / 120);
    if (this.heatNext.a > 0) {
      this.heat.x = this.heatNext.x;
      this.heat.y = this.heatNext.y;
      this.heat.r = this.heatNext.r;
    }
    this.heatNext.a = 0;
    p.heat = [this.heat.x, this.heat.y, this.heat.r, this.heat.a > 0.05 ? this.heat.a : 0];
    const pulse = this.reduceMotion ? 0.5 : 0.5 + 0.5 * Math.sin(this.time * 5);
    p.hurt = [this.hurt, pulse];
  }
}
