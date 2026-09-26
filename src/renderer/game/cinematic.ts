/**
 * Cinemática de viagem entre capítulos: barras de cinema, panorama em parallax que muda de
 * clima (a vila noturna vira nevasca; a neve vira deserto de cinzas), o grupo caminhando e o
 * cartão de título do capítulo. Puramente visual: o servidor já trocou o mapa e segura a próxima
 * onda por `TRAVEL_SECONDS`.
 */
import Phaser from 'phaser';
import { CIN_GROUND_Y, CIN_HORIZON, CIN_W, cinFar, cinFore, cinGround, cinLandmark, cinMid, cinSky, FAR_H, FG_H, MID_H } from '../../art/cinematic.js';
import { type ChapterDef, type Climate, ROUTE, type Route } from '../../shared/config/chapters.js';
import type { ClassId } from '../../shared/config/classes.js';
import { audio } from '../audio.js';
import { FONT, placeText, tf, toCanvas } from './textures.js';

export interface TravelData {
  from: Climate;
  to: Climate;
  chapter: ChapterDef;
  route: Route | null;
  party: { cls: ClassId; name: string; local: boolean }[];
  /** Segundos de cinemática disponíveis (o restante da fase de viagem). */
  seconds: number;
}

const ROMAN = ['', 'I', 'II', 'III'];
const BAR = 38;

interface Layer {
  from: Phaser.GameObjects.TileSprite | Phaser.GameObjects.Image;
  to: Phaser.GameObjects.TileSprite | Phaser.GameObjects.Image;
  speed: number;
}

interface Flake {
  img: Phaser.GameObjects.Image;
  vx: number;
  vy: number;
  climate: Climate;
}

function ensure(scene: Phaser.Scene, key: string, make: () => HTMLCanvasElement): string {
  if (!scene.textures.exists(key)) scene.textures.addCanvas(key, make());
  return key;
}

export class TravelScene extends Phaser.Scene {
  private data0: TravelData | null = null;
  private t = 0;
  private dur = 8.5;
  private layers: Layer[] = [];
  private walkers: { body: Phaser.GameObjects.Image; shadow: Phaser.GameObjects.Image; cls: ClassId; phase: number }[] = [];
  private flakes: Flake[] = [];
  private black!: Phaser.GameObjects.Rectangle;
  private barTop!: Phaser.GameObjects.Rectangle;
  private barBot!: Phaser.GameObjects.Rectangle;
  private landmark: Phaser.GameObjects.Image | null = null;
  private card: Phaser.GameObjects.GameObject[] = [];
  private cardG!: Phaser.GameObjects.Graphics;
  private finishing = false;
  running = false;

  constructor() {
    super('travel');
  }

  create(): void {
    this.scene.setVisible(false);
  }

  /** Inicia (ou reinicia) a cinemática. */
  play(d: TravelData): void {
    this.clearAll();
    this.data0 = d;
    this.t = 0;
    this.dur = Math.max(2.5, d.seconds - 0.2);
    this.finishing = false;
    this.running = true;
    this.scene.setVisible(true);
    this.cameras.main.setBackgroundColor('#07070d');

    const tex = (kind: string, c: Climate, make: () => HTMLCanvasElement): string => ensure(this, `cin_${kind}_${c}`, make);
    const build = (c: Climate): Record<string, string> => ({
      sky: tex('sky', c, () => toCanvas(cinSky(c))),
      far: tex('far', c, () => toCanvas(cinFar(c))),
      mid: tex('mid', c, () => toCanvas(cinMid(c))),
      ground: tex('ground', c, () => toCanvas(cinGround(c))),
      fore: tex('fore', c, () => toCanvas(cinFore(c))),
      land: tex('land', c, () => toCanvas(cinLandmark(c))),
    });
    const A = build(d.from);
    const B = build(d.to);
    const pair = (kFrom: string, kTo: string, y: number, h: number, speed: number, depth: number, tile = true): Layer => {
      const mk = (k: string): Phaser.GameObjects.TileSprite | Phaser.GameObjects.Image =>
        tile ? this.add.tileSprite(0, y, CIN_W, h, k).setOrigin(0, 0).setDepth(depth) : this.add.image(0, y, k).setOrigin(0, 0).setDepth(depth);
      const L = { from: mk(kFrom), to: mk(kTo), speed };
      L.to.setAlpha(0);
      L.to.setDepth(depth + 0.5);
      return L;
    };
    this.layers = [
      pair(A.sky as string, B.sky as string, 0, 360, 0, 0, false),
      pair(A.far as string, B.far as string, CIN_HORIZON + 24 - FAR_H, FAR_H, 12, 10),
      pair(A.mid as string, B.mid as string, CIN_GROUND_Y + 2 - MID_H, MID_H, 38, 20),
      pair(A.ground as string, B.ground as string, CIN_GROUND_Y, 360 - CIN_GROUND_Y, 80, 30),
      pair(A.fore as string, B.fore as string, 360 - BAR - FG_H + 6, FG_H, 150, 60),
    ];
    // marco do destino: surge no plano distante no fim do trajeto
    this.landmark = this.add.image(CIN_W + 40, CIN_GROUND_Y + 4, B.land as string).setOrigin(0, 1).setDepth(25).setAlpha(0);

    // o grupo, em fila, caminhando para a direita (escala 2, pixel inteiro)
    const n = d.party.length;
    d.party.forEach((p, i) => {
      const x = 330 - (n - 1) * 20 + i * 40 - (i % 2) * 6;
      const y = CIN_GROUND_Y + 30 + (i % 2) * 8;
      const shadow = this.add.image(x, y, ...tf('shadow_m')).setScale(2).setDepth(40 + y / 1000).setAlpha(0.8);
      const body = this.add.image(x, y, ...tf(`${p.cls}_walk_side_0`)).setOrigin(0.5, 30 / 32).setScale(2).setDepth(41 + y / 1000);
      this.walkers.push({ body, shadow, cls: p.cls, phase: i * 1.3 });
    });

    // barras de cinema, cartão e escurecimento
    this.cardG = this.add.graphics().setDepth(90);
    this.barTop = this.add.rectangle(0, -BAR, CIN_W, BAR, 0x000000).setOrigin(0, 0).setDepth(80);
    this.barBot = this.add.rectangle(0, 360, CIN_W, BAR, 0x000000).setOrigin(0, 0).setDepth(80);
    this.tweens.add({ targets: this.barTop, y: 0, duration: 700, ease: 'Cubic.easeOut' });
    this.tweens.add({ targets: this.barBot, y: 360 - BAR, duration: 700, ease: 'Cubic.easeOut' });
    this.black = this.add.rectangle(0, 0, CIN_W, 360, 0x000000).setOrigin(0, 0).setDepth(100).setAlpha(1);
    this.tweens.add({ targets: this.black, alpha: 0, duration: 900, delay: 150 });
    audio.play('chapter');
  }

  /** Termina: escurece e devolve a cena do jogo (chamado quando a onda começa). */
  finish(): void {
    if (!this.running || this.finishing) return;
    this.finishing = true;
    this.tweens.killTweensOf(this.black);
    this.tweens.add({
      targets: this.black,
      alpha: 1,
      duration: 250,
      onComplete: () => {
        this.clearAll();
        this.running = false;
        this.scene.setVisible(false);
      },
    });
  }

  private clearAll(): void {
    this.tweens.killAll();
    for (const L of this.layers) {
      L.from.destroy();
      L.to.destroy();
    }
    for (const w of this.walkers) {
      w.body.destroy();
      w.shadow.destroy();
    }
    for (const f of this.flakes) f.img.destroy();
    for (const o of this.card) o.destroy();
    this.landmark?.destroy();
    this.cardG?.destroy();
    this.black?.destroy();
    this.barTop?.destroy();
    this.barBot?.destroy();
    this.layers = [];
    this.walkers = [];
    this.flakes = [];
    this.card = [];
    this.landmark = null;
  }

  private text(s: string, x: number, y: number, color: number, scale: number, alpha: number): void {
    const shadow = this.add.bitmapText(0, 0, FONT, s, 11).setScale(scale).setTint(0x07070d).setDepth(91).setAlpha(alpha);
    const t = this.add.bitmapText(0, 0, FONT, s, 11).setScale(scale).setTint(color).setDepth(92).setAlpha(alpha);
    placeText(t, x, y, 0.5, 0);
    shadow.setPosition(t.x + scale, t.y + scale);
    this.card.push(shadow, t);
  }

  /** Cartão do capítulo, no mesmo idioma visual dos banners do HUD (ouro sobre sombra). */
  private drawCard(a: number): void {
    const d = this.data0;
    if (!d) return;
    const g = this.cardG;
    g.clear();
    if (this.card.length) {
      for (const o of this.card) (o as Phaser.GameObjects.BitmapText).setAlpha(a);
    }
    if (a <= 0) return;
    const ch = d.chapter;
    const y0 = BAR + 18;
    g.fillStyle(0x0b0a12, 0.55 * a).fillRect(120, y0 - 6, 400, d.route ? 100 : 86);
    g.fillStyle(0xe0902a, a).fillRect(150, y0 + 12, 340, 1);
    g.fillStyle(0xe0902a, a).fillRect(150, y0 + 48, 340, 1);
    g.fillStyle(0xf6c257, a).fillRect(318, y0 + 10, 4, 4).fillRect(318, y0 + 46, 4, 4);
    if (this.card.length) return;
    this.text(`CAPÍTULO ${ROMAN[ch.n] ?? ch.n}`, 320, y0, 0xa3a9bb, 1, a);
    this.text(ch.name.toUpperCase(), 320, y0 + 18, 0xf6c257, 2, a);
    this.text(ch.subtitle, 320, y0 + 52, 0xcfd4df, 1, a);
    const adapt = ch.enemies.label ? `A horda se adapta ao clima: ${ch.enemies.label} (${ch.enemies.onHit === 'chill' ? 'golpes congelam' : 'golpes queimam'})` : '';
    if (adapt) this.text(adapt, 320, y0 + 64, 0x8fd3f0, 1, a);
    if (d.route) {
      const r = d.route === 'risk' ? ROUTE.risk : ROUTE.safe;
      this.text(`Rota escolhida: ${r.name}`, 320, y0 + (adapt ? 78 : 66), d.route === 'risk' ? 0xec6a5e : 0x7fc47a, 1, a);
    }
  }

  override update(_time: number, dtRaw: number): void {
    if (!this.running || !this.data0) return;
    const dt = Math.min(dtRaw, 100) / 1000;
    this.t += dt;
    const t = this.t;
    const d = this.data0;
    // transição de clima no meio do caminho
    const mixK = Phaser.Math.Clamp((t - 2.2) / 2.4, 0, 1);
    const pace = this.finishing ? 0.4 : 1;
    for (const L of this.layers) {
      if (L.from instanceof Phaser.GameObjects.TileSprite) L.from.tilePositionX += L.speed * dt * pace;
      if (L.to instanceof Phaser.GameObjects.TileSprite) L.to.tilePositionX += L.speed * dt * pace;
      L.to.setAlpha(mixK);
      L.from.setAlpha(1 - mixK * 0.999);
    }
    // marco do destino entra pela direita no último terço
    if (this.landmark) {
      const k = Phaser.Math.Clamp((t - this.dur * 0.55) / (this.dur * 0.45), 0, 1);
      this.landmark.setAlpha(Math.min(1, k * 3));
      this.landmark.x = Math.round(CIN_W + 20 - k * (CIN_W * 0.62));
    }
    // grupo: ciclo de caminhada em pixel inteiro
    for (const w of this.walkers) {
      const f = Math.floor(t * 8 + w.phase) % 4;
      const [tex, fr] = tf(`${w.cls}_walk_side_${f}`);
      if (w.body.frame.name !== fr) w.body.setTexture(tex, fr);
    }
    // clima: partículas de um clima dão lugar às do outro
    const spawn = (c: Climate, rate: number): void => {
      let n = rate * dt;
      while (n > 0) {
        if (Math.random() < n) {
          const x = Math.random() * (CIN_W + 200) - 100;
          const frame = c === 'winter' ? (Math.random() < 0.2 ? 'p_snowbig' : 'p_snow') : c === 'ash' ? (Math.random() < 0.15 ? 'p_cinder' : 'p_ash') : 'p_leaf';
          const img = this.add.image(x, BAR - 4, ...tf(frame)).setScale(2).setDepth(70);
          const vx = c === 'winter' ? -60 - Math.random() * 60 : c === 'ash' ? -90 - Math.random() * 50 : -30 - Math.random() * 20;
          const vy = c === 'winter' ? 50 + Math.random() * 40 : c === 'ash' ? 30 + Math.random() * 20 : 25 + Math.random() * 15;
          this.flakes.push({ img, vx, vy, climate: c });
        }
        n -= 1;
      }
    };
    const rate = (c: Climate): number => (c === 'night' ? 6 : 70);
    spawn(d.from, rate(d.from) * (1 - mixK));
    spawn(d.to, rate(d.to) * mixK);
    for (let i = this.flakes.length - 1; i >= 0; i--) {
      const f = this.flakes[i] as Flake;
      f.img.x += f.vx * dt;
      f.img.y += f.vy * dt;
      if (f.img.y > 360 - BAR + 4 || f.img.x < -20) {
        f.img.destroy();
        this.flakes.splice(i, 1);
      }
    }
    // cartão do capítulo
    const cardA = Phaser.Math.Clamp((t - 2.6) / 0.6, 0, 1) * Phaser.Math.Clamp((this.dur - 0.5 - t) / 0.6, 0, 1);
    this.drawCard(cardA);
    // escurece no fim, pronto para revelar o novo mapa
    if (!this.finishing && t > this.dur - 0.6) this.black.setAlpha(Phaser.Math.Clamp((t - (this.dur - 0.6)) / 0.6, 0, 1));
  }
}
