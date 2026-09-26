/**
 * Cena principal: desenha a arena, interpola entidades remotas, prediz o jogador local,
 * converte eventos do servidor em efeitos e aplica luz/névoa/oclusão.
 */
import Phaser from 'phaser';
import { placeObjects, type Placed } from '../../art/placement.js';
import type { Climate, MapId } from '../../shared/config/chapters.js';
import { BERSERKER, CLASSES, type ClassId, VAMPIRE } from '../../shared/config/classes.js';
import { ENEMIES, ENEMY_TYPES } from '../../shared/config/enemies.js';
import { EVENT_RULES, CHALLENGE_RULES } from '../../shared/config/objectives.js';
import { TICK_MS, TILE } from '../../shared/constants.js';
import { circleFree, lineOfSight } from '../../shared/collision.js';
import { type ArenaMap, cloneMap, getMap, mapByIndex, setBroken, WORLD_H, WORLD_W } from '../../shared/map.js';
import type { InputFrame } from '../../shared/movement.js';
import { ACTIONS, type EnemyTuple, type GameEvent, type MinionTuple, PROJECTILE_KINDS, type ProjTuple, type SnapPlayer, ZONE_KINDS, type ZoneTuple } from '../../shared/protocol.js';
import { audio } from '../audio.js';
import { FlowField } from '../../server/world/nav.js';
import type { Session, Snapshot } from '../session.js';
import { Effects } from './effects.js';
import { reflectionAlpha } from './graphics-quality.js';
import type { InputCapture } from './input.js';
import { Predictor } from './predict.js';
import { drawTelegraph, drawZone } from './telegraphs.js';
import { ensureFloor, ensureTextures, tf } from './textures.js';
import { affixOf, enemyAttackName, enemyStateName, EnemyView, isBossType, MinionView, PlayerView, type RenderEnemy } from './views.js';

const INTERP_TICKS = 3.2;

/** Escuridão, névoa e brilho do fogo por clima. */
const CLIMATE_LOOK: Record<Climate, { dark: number; alpha: number; fogTint: number; fogAlpha: number; fireTint: number }> = {
  night: { dark: 0x04050d, alpha: 0.64, fogTint: 0xffffff, fogAlpha: 0.16, fireTint: 0xe0902a },
  winter: { dark: 0x0a1426, alpha: 0.55, fogTint: 0xeef6ff, fogAlpha: 0.2, fireTint: 0x8fd3f0 },
  ash: { dark: 0x160806, alpha: 0.6, fogTint: 0xd0885a, fogAlpha: 0.18, fireTint: 0xb04ae0 },
};

interface BreakView {
  i: number;
  img: Phaser.GameObjects.Image;
  key: string;
  /** 0 intacto, 1 rachado, 2 destruído. */
  st: number;
}

interface SnapIndex {
  p: Map<number, SnapPlayer>;
  e: Map<number, EnemyTuple>;
  pr: Map<number, ProjTuple>;
  m: Map<number, MinionTuple>;
}
const indexCache = new WeakMap<Snapshot, SnapIndex>();
function idx(s: Snapshot): SnapIndex {
  let v = indexCache.get(s);
  if (!v) {
    v = { p: new Map(s.p.map((p) => [p.id, p])), e: new Map(s.e.map((e) => [e[0], e])), pr: new Map(s.pr.map((p) => [p[0], p])), m: new Map((s.m ?? []).map((m) => [m[0], m])) };
    indexCache.set(s, v);
  }
  return v;
}

export interface RenderedPlayer {
  id: number;
  cls: ClassId;
  x: number;
  y: number;
  data: SnapPlayer;
}

export class GameScene extends Phaser.Scene {
  session!: Session;
  input2!: InputCapture;
  readonly predictor = new Predictor();
  fx!: Effects;
  mode: 'menu' | 'match' = 'menu';
  /** Mapa ativo (clone mutável compartilhado com o preditor). */
  private map: ArenaMap = cloneMap(getMap('village'));
  mapId: MapId = 'village';
  private floorImg: Phaser.GameObjects.Image | null = null;
  private mapImages: Phaser.GameObjects.Image[] = [];
  private objects: { p: Placed; img: Phaser.GameObjects.Image; bounds: Phaser.Geom.Rectangle }[] = [];
  private animated: { p: Placed; img: Phaser.GameObjects.Image }[] = [];
  private breaks = new Map<number, BreakView>();
  private minions = new Map<number, MinionView>();
  survivorPosition(): { x: number; y: number } | null {
    const survivor = [...this.minions.values()].find((m) => m.kind === 'survivor');
    return survivor ? { x: survivor.x, y: survivor.y } : null;
  }
  private pickups = new Map<number, Phaser.GameObjects.Image>();
  private altar: Phaser.GameObjects.Image | null = null;
  private bard: Phaser.GameObjects.Image | null = null;
  private storm = 0;
  brightness = 0;
  enhancedLighting = false;
  private moodFilter: Phaser.Filters.ColorMatrix | null = null;
  private vignetteFilter: Phaser.Filters.Vignette | null = null;
  private reflectionG!: Phaser.GameObjects.Graphics;
  private reflections = new Map<number, Phaser.GameObjects.Image>();
  private players = new Map<number, PlayerView>();
  private enemies = new Map<number, EnemyView>();
  private projectiles = new Map<number, Phaser.GameObjects.Image>();
  private traps = new Map<number, Phaser.GameObjects.Image>();
  private ghosts: { img: Phaser.GameObjects.Image; life: number }[] = [];
  private zoneG!: Phaser.GameObjects.Graphics;
  private teleG!: Phaser.GameObjects.Graphics;
  private dark!: Phaser.GameObjects.RenderTexture;
  private glows: Phaser.GameObjects.Image[] = [];
  private fog!: Phaser.GameObjects.TileSprite;
  private acc = 0;
  private camX = 0;
  private camY = 0;
  private cameraFollowId = -1;
  private cameraFollowX = 0;
  private cameraFollowY = 0;
  private menuT = 0;
  private hitstopUntil = 0;
  rendered: RenderedPlayer[] = [];
  renderedEnemies: RenderEnemy[] = [];
  spectateId = 0;
  localClass: ClassId = 'hunter';
  pings: { x: number; y: number; from: number; until: number }[] = [];
  private moveTarget: { x: number; y: number; field: FlowField; at: number; lastX: number; lastY: number; stuck: number } | null = null;
  private moveClick: { x: number; y: number; at: number; valid: boolean } | null = null;
  fpsSamples: number[] = [];
  onLocalEvent: ((ev: GameEvent) => void) | null = null;

  constructor() {
    super('game');
  }

  create(): void {
    ensureTextures(this);
    this.cameras.main.setBounds(0, 0, WORLD_W, WORLD_H);
    this.cameras.main.setRoundPixels(true);
    this.fog = this.add.tileSprite(0, 0, 704, 424, 'fog').setOrigin(0, 0).setScrollFactor(0).setDepth(-9000).setAlpha(0.16);
    this.zoneG = this.add.graphics().setDepth(-8000);
    this.reflectionG = this.add.graphics().setDepth(-8500);
    this.teleG = this.add.graphics().setDepth(-7000);
    this.dark = this.add.renderTexture(0, 0, 640, 360).setOrigin(0, 0).setScrollFactor(0).setDepth(150000);
    this.fx = new Effects(this);
    this.setMap('village', true);
    this.camX = this.map.campfire.x - 320;
    this.camY = this.map.campfire.y - 180;
    this.scale.on('resize', () => undefined);
  }

  /** Filtros WebGL reais sobre o mundo; o HUD continua em outra cena, sem pós-processamento. */
  setEnhancedLighting(enabled: boolean): void {
    this.enhancedLighting = enabled;
    if (enabled && !this.moodFilter) {
      this.moodFilter = this.cameras.main.filters.internal.addColorMatrix();
      this.moodFilter.colorMatrix.contrast(0.14).saturate(0.12, true);
      this.vignetteFilter = this.cameras.main.filters.external.addVignette(0.5, 0.5, 0.8, 0.11, 0x071019);
    }
    this.moodFilter?.setActive(enabled);
    this.vignetteFilter?.setActive(enabled);
    if (!enabled) {
      this.reflectionG?.clear();
      for (const image of this.reflections.values()) image.setVisible(false);
    }
  }

  get climate(): Climate {
    return this.map.climate;
  }

  /** Troca o mapa desenhado (chão, objetos, luzes) e o mapa de colisão do preditor. */
  setMap(id: MapId, force = false): void {
    if (!force && id === this.mapId) return;
    this.moveTarget = null;
    this.moveClick = null;
    this.mapId = id;
    this.map = cloneMap(getMap(id));
    this.predictor.map = this.map;
    for (const img of this.mapImages) img.destroy();
    for (const g of this.glows) g.destroy();
    this.floorImg?.destroy();
    this.mapImages = [];
    this.objects = [];
    this.animated = [];
    this.glows = [];
    this.breaks.clear();
    this.floorImg = this.add.image(0, 0, ensureFloor(this, id)).setOrigin(0, 0).setDepth(-10000);
    const look = CLIMATE_LOOK[this.map.climate];
    for (const p of placeObjects(this.map)) {
      const img = this.add.image(Math.round(p.x), Math.round(p.y), ...tf(p.key)).setOrigin(0.5, 1).setDepth(p.depth).setFlipX(p.flipX);
      this.mapImages.push(img);
      const bounds = img.getBounds();
      if (p.tall) this.objects.push({ p, img, bounds });
      if (p.animated) this.animated.push({ p, img });
      if (p.breakIdx !== undefined) this.breaks.set(p.breakIdx, { i: p.breakIdx, img, key: p.key, st: 0 });
      if (p.key.startsWith('fire') || p.key.startsWith('torch')) {
        const fire = p.key.startsWith('fire');
        const r = fire ? 160 : 72;
        const glow = this.add.image(p.x, p.y - (fire ? 20 : 34), `light_${r}`).setBlendMode(Phaser.BlendModes.ADD).setTint(fire ? look.fireTint : 0xe0902a).setAlpha(0.22).setDepth(140000);
        this.glows.push(glow);
      }
    }
    this.fog.setTint(look.fogTint);
    this.fx?.clear();
  }

  /** Aplica o estado autoritativo de caixas/barris (destruídos ou rachados). */
  private applyBreaks(bk: [number, number][]): void {
    const state = new Map<number, number>();
    for (const [i, hp] of bk) state.set(i, hp <= 0 ? 2 : hp < 50 ? 1 : 0);
    for (const v of this.breaks.values()) {
      const st = state.get(v.i) ?? 0;
      if (st === v.st) continue;
      if ((st === 2) !== (v.st === 2)) setBroken(this.map, v.i, st === 2);
      v.st = st;
      v.img.setVisible(st !== 2);
      if (st !== 2) v.img.setTexture(...tf(st === 1 ? `${v.key}_d` : v.key));
    }
  }

  // ---------------------------------------------------------------- ciclo da partida

  startMatch(): void {
    this.clearEntities();
    this.mode = 'match';
    this.predictor.active = false;
    this.acc = 0;
    this.cameraFollowId = -1;
  }

  toMenu(): void {
    this.clearEntities();
    this.mode = 'menu';
    this.predictor.active = false;
    this.storm = 0;
    this.setMap('village');
    audio.stopBard();
  }

  clearEntities(): void {
    this.moveTarget = null;
    this.moveClick = null;
    for (const v of this.players.values()) v.destroy();
    for (const image of this.reflections.values()) image.destroy();
    this.reflections.clear();
    this.reflectionG?.clear();
    for (const v of this.enemies.values()) v.destroy();
    for (const v of this.projectiles.values()) v.destroy();
    for (const v of this.traps.values()) v.destroy();
    for (const v of this.minions.values()) v.destroy();
    for (const v of this.pickups.values()) v.destroy();
    this.altar?.destroy();
    this.altar = null;
    this.bard?.destroy();
    this.bard = null;
    this.minions.clear();
    this.pickups.clear();
    this.players.clear();
    this.enemies.clear();
    this.projectiles.clear();
    this.traps.clear();
    this.fx?.clear();
    this.rendered = [];
    this.renderedEnemies = [];
    this.pings = [];
  }

  /** Reconciliação chamada a cada snapshot. */
  onSnapshot(s: Snapshot): void {
    if (this.mode !== 'match') return;
    const mapId = mapByIndex(s.w.mp);
    if (mapId !== this.mapId) {
      this.setMap(mapId);
      this.predictor.active = false;
    }
    this.applyBreaks(s.bk ?? []);
    this.storm = s.w.st;
    const me = s.p.find((p) => p.id === this.session.myId);
    if (!me) return;
    this.localClass = me.c;
    if (!this.predictor.active || s.full || this.predictor.cls !== me.c) {
      this.predictor.reset(me.x, me.y, me.c);
    }
    if (s.you && me.s === 0) this.predictor.reconcile(s.you);
    else if (s.you) this.predictor.reset(s.you.x, s.you.y, me.c);
  }

  // ---------------------------------------------------------------- eventos → efeitos

  onEvents(evs: GameEvent[]): void {
    if (this.mode !== 'match') return;
    const myId = this.session.myId;
    for (const ev of evs) {
      switch (ev.k) {
        case 'dmg': {
          if (ev.tg === 'e') {
            const v = this.enemies.get(ev.ti);
            v?.hitFlash();
            const col = ev.c === 'crit' ? 0xf6c257 : 0xeef1f7;
            this.fx.number(ev.x + (Math.random() - 0.5) * 8, ev.y, String(ev.v), col, ev.c === 'crit' && ev.v >= 60);
            this.fx.burst('p_blood', ev.x, ev.y + 6, 3, 50, 0.35, { g: 180 });
            this.fx.particle('hit_0', ev.x, ev.y + 4, 0, 0, 0.06, { fade: false, depth: 99000 });
            if (ev.s === myId) {
              this.hitstopUntil = performance.now() + (ev.v >= 30 ? 70 : 40);
              audio.play('hit', ev.x, ev.y, 0.8);
              if (ev.v >= 60) this.fx.shake(2, 80);
            }
          } else {
            const v = this.players.get(ev.ti);
            if (ev.c === 'heal') this.fx.number(ev.x, ev.y, `+${ev.v}`, 0x7fc47a);
            else if (ev.c === 'blk') this.fx.number(ev.x, ev.y, 'BLOQUEIO', 0x8fd3f0);
            else if (ev.c === 'par') this.fx.number(ev.x, ev.y, 'APARO!', 0xf6c257);
            else {
              v?.hitFlash();
              this.fx.number(ev.x, ev.y, String(ev.v), 0xec6a5e);
              this.fx.burst('p_blood', ev.x, ev.y + 8, 5, 60, 0.4, { g: 200 });
              if (ev.ti === myId) {
                this.fx.shake(3, 110);
                this.fx.flash(0xc83838, 0.22, 120);
                audio.play('playerHit');
              }
            }
          }
          break;
        }
        case 'die': {
          const t = ENEMY_TYPES[ev.et] ?? 'shambler';
          const big = isBossType(t);
          const mini = !!ENEMIES[t].miniboss;
          this.fx.burst('p_blood', ev.x, ev.y - 6, big ? 40 : 10, big ? 140 : 80, 0.6, { g: 220, up: 40 });
          this.fx.burst('p_bone', ev.x, ev.y - 6, big ? 12 : 3, 70, 0.7, { g: 240, up: 60 });
          this.fx.burst('p_abyss', ev.x, ev.y - 10, big ? 30 : mini ? 16 : 6, 40, 0.8, { up: 30 });
          if (t === 'falseMoon') {
            this.fx.ring(ev.x, ev.y - 20, 6, 50, 0x8fd3f0, 0.5, 3);
            this.fx.burst('p_frost', ev.x, ev.y - 20, 20, 90, 0.7);
            audio.play('rupture', ev.x, ev.y, 0.6);
          } else if (t === 'abyssTotem') {
            this.fx.ring(ev.x, ev.y - 20, 6, 50, 0xe07cff, 0.5, 3);
            audio.play('rupture', ev.x, ev.y, 0.6);
          }
          if (mini) this.fx.shake(4, 250);
          const view = this.enemies.get(ev.ei);
          if (view) this.corpse(view);
          audio.play('enemyDie', ev.x, ev.y);
          if (big) {
            this.fx.shake(8, 500);
            this.fx.flash(0xffffff, 0.5, 300);
            audio.play('explosion');
          }
          break;
        }
        case 'fx':
          this.namedFx(ev);
          break;
        case 'sfx':
          audio.play(ev.n, ev.x, ev.y);
          if (ev.n === 'dodge') this.fx.burst('p_dust', ev.x, ev.y, 4, 30, 0.3);
          break;
        case 'down':
          audio.play('down');
          if (ev.pi === myId) this.fx.flash(0x440d1a, 0.5, 400);
          break;
        case 'revived':
        case 'respawn': {
          const p = this.players.get(ev.pi);
          if (p) {
            this.fx.ring(p.x, p.y - 8, 4, 30, 0x7fc47a, 0.5);
            this.fx.burst('p_white', p.x, p.y - 8, 12, 50, 0.6, { up: 30 });
          }
          audio.play('revive');
          break;
        }
        case 'shout': {
          const v = this.enemies.get(ev.ei);
          if (v) this.fx.bubble(ev.txt, () => (this.enemies.has(ev.ei) ? { x: v.x, y: v.y - 40 } : null));
          break;
        }
        case 'ult': {
          const p = this.players.get(ev.pi);
          if (p) {
            this.fx.ring(p.x, p.y - 10, 6, 44, CLASSES[p.cls].color, 0.45, 3);
            this.fx.burst('p_ember', p.x, p.y - 10, 14, 80, 0.5, { up: 20 });
          }
          audio.play('ult', p?.x, p?.y);
          if (ev.pi === myId) this.fx.shake(2, 150);
          break;
        }
        case 'break':
          this.fx.burst('p_wood', ev.x, ev.y - 6, 12, 80, 0.6, { g: 240, up: 50 });
          this.fx.burst('p_dust', ev.x, ev.y - 2, 6, 40, 0.4);
          audio.play('break', ev.x, ev.y);
          break;
        case 'pickup': {
          this.fx.burst('p_heal', ev.x, ev.y - 8, 10, 50, 0.6, { up: 40 });
          this.fx.ring(ev.x, ev.y - 6, 2, 16, 0x7fc47a, 0.3, 1);
          const p = this.players.get(ev.pi);
          this.fx.number(p?.x ?? ev.x, (p?.y ?? ev.y) - 34, `+${ev.v}`, 0x7fc47a);
          audio.play('pickup', ev.x, ev.y);
          break;
        }
        case 'boss':
          if (ev.ph === 2) {
            this.fx.shake(6, 700);
            this.fx.flash(0x9a2cc0, 0.4, 400);
          }
          break;
        default:
          break;
      }
      this.onLocalEvent?.(ev);
    }
  }

  private corpse(v: EnemyView): void {
    const img = this.add.image(v.body.x, v.body.y, v.body.texture.key, v.body.frame.name).setOrigin(v.body.originX, v.body.originY).setFlipX(v.body.flipX).setDepth(v.body.depth).setTint(0x5a1470).setTintMode(Phaser.TintModes.FILL);
    this.tweens.add({ targets: img, alpha: 0, y: img.y + 6, duration: 450, ease: 'Stepped', easeParams: [5], onComplete: () => img.destroy() });
  }

  private namedFx(ev: Extract<GameEvent, { k: 'fx' }>): void {
    const f = this.fx;
    const follow = (id: number) => (): { x: number; y: number } | null => {
      const p = this.players.get(id);
      return p ? { x: p.x, y: p.y - 10 } : null;
    };
    switch (ev.n) {
      case 'guardianGuard':
        f.ring(ev.x, ev.y - 10, 4, 22, 0xa7e9d9, 0.25, 2);
        f.burst('p_soul', ev.x, ev.y - 10, 6, 35, 0.35);
        break;
      case 'guardianBlockPhysical':
        f.burst('p_silver', ev.x, ev.y, 7, 70, 0.25, { dir: ev.a, spread: 1.4 });
        f.particle('hit_0', ev.x, ev.y, 0, 0, 0.08, { fade: false });
        break;
      case 'guardianBlockProjectile':
        f.ring(ev.x, ev.y, 2, 15, 0x9fe4d8, 0.2, 2);
        f.burst('p_soul', ev.x, ev.y, 5, 65, 0.25, { dir: ev.a, spread: 1.7 });
        break;
      case 'guardianBreak':
        f.ring(ev.x, ev.y, 22, 42, 0xb6f2df, 0.32, 3);
        f.burst('p_silver', ev.x, ev.y, 24, 140, 0.55, { g: 160 });
        f.burst('p_soul', ev.x, ev.y, 14, 100, 0.5);
        f.shake(4, 150);
        break;
      case 'guardianDash':
        f.ring(ev.x, ev.y, 3, 24, 0x9fe4d8, 0.2, 2);
        break;
      case 'guardianTrail':
        f.burst('p_soul', ev.x, ev.y - 8, 2, 22, 0.28);
        break;
      case 'guardianImpact':
        f.ring(ev.x, ev.y, 3, Math.min(34, ev.r), 0xb9f5e7, 0.24, 3);
        f.burst('p_silver', ev.x, ev.y, 9, 85, 0.3);
        f.number(ev.x, ev.y - 22, 'PROVOCADO', 0x9fe4d8);
        break;
      case 'guardianCounter':
        f.arc(ev.x, ev.y - 9, ev.a, 190, ev.r, 0xd5fff2, 0x75b5ae, 0.22, 3);
        break;
      case 'guardianPlant':
        f.ring(ev.x, ev.y, 5, ev.r, 0x79b7aa, 0.55, 2);
        f.burst('p_soul', ev.x, ev.y - 12, 8, 35, 0.7, { up: 15 });
        break;
      case 'guardianCharge':
        if (ev.a > 0.06) f.burst('p_soul', ev.x, ev.y - 10, Math.min(4, 1 + Math.floor(ev.a * 3)), 25 + ev.a * 30, 0.42, { up: 18 });
        break;
      case 'guardianBurst':
        f.ring(ev.x, ev.y, 4, ev.r, ev.a > 0.5 ? 0xd5fff2 : 0x8cc7bb, 0.4, ev.a > 0.5 ? 4 : 2);
        f.burst('p_soul', ev.x, ev.y - 8, 12 + Math.round(ev.a * 22), 75 + ev.a * 70, 0.55, { up: 20 });
        f.burst('p_silver', ev.x, ev.y, 6 + Math.round(ev.a * 12), 90, 0.42);
        f.shake(2 + ev.a * 3, 160);
        break;
      case 'mace':
        f.arc(ev.x, ev.y - 8, ev.a, 110, ev.r, 0xcfd4df, 0x565b70, 0.18, 3, follow(ev.o));
        f.burst('p_dust', ev.x + Math.cos(ev.a) * 24, ev.y + Math.sin(ev.a) * 24, 5, 40, 0.4);
        audio.play('swing', ev.x, ev.y, 0.6);
        break;
      case 'claw1':
      case 'claw2':
        f.arc(ev.x, ev.y - 10, ev.a + (ev.n === 'claw1' ? -0.2 : 0.2), 90, ev.r, 0xec6a5e, 0x9c1e2e, 0.12, 2, follow(ev.o));
        break;
      case 'biteWindup':
        f.cone(ev.x, ev.y - 8, ev.a, VAMPIRE.bite.arc, ev.r, 0x9c1e2e, 0.2);
        break;
      case 'bite':
        f.arc(ev.x, ev.y - 10, ev.a, VAMPIRE.bite.arc, ev.r, 0xffd0d0, 0xc83838, 0.16, 3, follow(ev.o));
        f.burst('p_blood', ev.x + Math.cos(ev.a) * ev.r * 0.6, ev.y - 6 + Math.sin(ev.a) * ev.r * 0.6, 12, 80, 0.45, { g: 150, dir: ev.a, spread: 1.2 });
        audio.play('bite', ev.x, ev.y);
        break;
      case 'shout':
      case 'shoutBig': {
        const big = ev.n === 'shoutBig';
        f.cone(ev.x, ev.y, ev.a, big ? 70 : 62, ev.r, big ? 0xd2fbff : 0x6fe3ef, big ? 0.35 : 0.25);
        f.burst('p_mag', ev.x + Math.cos(ev.a) * 12, ev.y + Math.sin(ev.a) * 12, big ? 16 : 6, big ? 160 : 110, 0.3, { dir: ev.a, spread: 1 });
        if (big) f.shake(3, 150);
        break;
      }
      case 'pulse':
        f.ring(ev.x, ev.y, 6, ev.r, 0x6fe3ef, 0.3, 3);
        f.ring(ev.x, ev.y, 2, ev.r * 0.7, 0xd2fbff, 0.25, 1);
        f.shake(2, 100);
        break;
      case 'endScream':
        f.ring(ev.x, ev.y, 10, ev.r, 0xd2fbff, 0.45, 4);
        f.ring(ev.x, ev.y, 4, ev.r * 0.75, 0x6fe3ef, 0.4, 2);
        f.burst('p_mag', ev.x, ev.y, 24, 200, 0.4);
        f.shake(6, 220);
        f.flash(0x6fe3ef, 0.18, 120);
        break;
      case 'taunt':
        f.ring(ev.x, ev.y, 10, ev.r, 0xc83838, 0.4, 2);
        break;
      case 'fury':
        f.ring(ev.x, ev.y - 10, 4, ev.r, 0xf6c257, 0.35, 3);
        f.burst('p_ember', ev.x, ev.y - 10, 20, 90, 0.6, { up: 40 });
        break;
      case 'feast':
        f.ring(ev.x, ev.y - 10, ev.r, 4, 0xc83838, 0.4, 2);
        f.burst('p_blood', ev.x, ev.y - 10, 16, 80, 0.6, { up: 20 });
        break;
      case 'recoil':
      case 'mist':
        f.burst(ev.n === 'mist' ? 'p_blood' : 'p_dust', ev.x, ev.y, 10, 50, 0.5);
        break;
      case 'blinkOut':
      case 'blinkIn':
        f.burst('p_arc', ev.x, ev.y - 10, 14, 70, 0.4);
        f.ring(ev.x, ev.y - 10, 2, 14, 0x8f86ff, 0.2, 2);
        break;
      case 'rupture':
        f.ring(ev.x, ev.y, 10, ev.r, 0xc7c2ff, 0.4, 4);
        f.ring(ev.x, ev.y, 4, ev.r * 0.6, 0x8f86ff, 0.35, 3);
        f.burst('p_arc', ev.x, ev.y, 40, 220, 0.6);
        f.shake(7, 300);
        f.flash(0xc7c2ff, 0.35, 160);
        audio.play('rupture', ev.x, ev.y);
        break;
      case 'arcaneBurst':
        f.ring(ev.x, ev.y, 3, ev.r, 0x8f86ff, 0.25, 2);
        f.burst('p_arc', ev.x, ev.y, 12, 100, 0.4);
        break;
      case 'trapSnap':
        f.burst('p_silver', ev.x, ev.y, 10, 60, 0.4);
        audio.play('trapSnap', ev.x, ev.y);
        break;
      case 'rainVolley':
        for (let i = 0; i < 6; i++) {
          const a = Math.random() * Math.PI * 2;
          const d = Math.random() * ev.r;
          const x = ev.x + Math.cos(a) * d;
          const y = ev.y + Math.sin(a) * d * 0.8;
          f.line(x - 8, y - 40, x, y, 0xf2f6ff, 0.12, 1);
          f.particle('hit_1', x, y, 0, 0, 0.08, { fade: false });
        }
        audio.play('crossbow', ev.x, ev.y, 0.5);
        break;
      case 'block':
        f.burst('p_white', ev.x, ev.y, 6, 80, 0.2, { dir: ev.a, spread: 1.6 });
        f.particle('hit_0', ev.x, ev.y, 0, 0, 0.08, { fade: false, depth: 99000 });
        break;
      case 'parry':
        f.particle('hit_0', ev.x, ev.y, 0, 0, 0.12, { fade: false, depth: 99000 });
        f.ring(ev.x, ev.y, 2, 22, 0xf6c257, 0.25, 2);
        f.burst('p_ember', ev.x, ev.y, 14, 120, 0.35);
        f.flash(0xfff0ae, 0.25, 80);
        this.hitstopUntil = performance.now() + 90;
        break;
      case 'guardBreak':
        f.burst('p_silver', ev.x, ev.y, 16, 110, 0.5, { g: 200 });
        f.shake(4, 160);
        break;
      case 'projHit':
      case 'projPop':
        f.particle('hit_1', ev.x, ev.y, 0, 0, 0.08, { fade: false });
        f.burst(ev.o === PROJECTILE_KINDS.indexOf('slipper') ? 'p_ember' : 'p_abyss', ev.x, ev.y, 6, 60, 0.3);
        break;
      case 'projWall':
        f.burst('p_dust', ev.x, ev.y, 3, 30, 0.3);
        break;
      case 'interrupt':
        f.number(ev.x, ev.y - 6, 'INTERROMPIDO', 0x6fe3ef);
        break;
      case 'land':
        f.ring(ev.x, ev.y, 6, ev.r, 0xc83838, 0.25, 2);
        f.burst('p_dust', ev.x, ev.y, 10, 60, 0.4);
        audio.play('land', ev.x, ev.y);
        break;
      case 'bossLand':
        f.ring(ev.x, ev.y, 8, ev.r, 0xec6a5e, 0.35, 3);
        f.burst('p_dust', ev.x, ev.y, 30, 120, 0.6);
        f.shake(7, 260);
        break;
      case 'bossClaw':
        f.arc(ev.x, ev.y - 20, ev.a, 150, ev.r, 0xffffff, 0xec6a5e, 0.18, 4);
        break;
      case 'crescent':
        f.arc(ev.x, ev.y - 12, 0, 360, ev.r, 0xd8f6ff, 0x7da0cf, 0.3, 4);
        break;
      case 'sweep':
        f.arc(ev.x, ev.y - 20, ev.a, 120, ev.r, 0xe07cff, 0x5a1470, 0.25, 5);
        f.shake(4, 180);
        break;
      case 'slam':
        f.ring(ev.x, ev.y, 4, ev.r, 0xf6c257, 0.2, 2);
        f.burst('p_dust', ev.x, ev.y, 10, 60, 0.4);
        f.shake(3, 140);
        break;
      case 'howl':
        f.ring(ev.x, ev.y - 20, 10, ev.r, 0x8fd3f0, 0.6, 3);
        f.shake(5, 500);
        break;
      case 'abyssBurst':
        f.ring(ev.x, ev.y - 20, 10, ev.r, 0xe07cff, 0.6, 4);
        f.burst('p_abyss', ev.x, ev.y - 20, 40, 160, 0.8);
        break;
      case 'runeBlast':
      case 'eruptionBlast':
        f.ring(ev.x, ev.y, 4, ev.r, 0xe07cff, 0.25, 2);
        f.burst('p_abyss', ev.x, ev.y, ev.n === 'eruptionBlast' ? 18 : 8, 100, 0.5, { up: 40 });
        audio.play('runeBlast', ev.x, ev.y);
        break;
      // ---- Berserker
      case 'axe1':
      case 'axe2':
      case 'axe3': {
        const heavy = ev.n === 'axe3';
        const arc = heavy ? BERSERKER.combo[2].arc : 120;
        f.arc(ev.x, ev.y - 10, ev.a, arc, ev.r, heavy ? 0xffffff : 0xffd8b0, 0xd9512c, heavy ? 0.22 : 0.14, heavy ? 4 : 3, follow(ev.o));
        audio.play(heavy ? 'axeHeavy' : 'swing', ev.x, ev.y, 0.8);
        if (heavy) f.burst('p_ember', ev.x + Math.cos(ev.a) * ev.r * 0.7, ev.y - 6 + Math.sin(ev.a) * ev.r * 0.7, 8, 90, 0.35, { dir: ev.a, spread: 1.4 });
        break;
      }
      case 'frenzySlash':
        f.arc(ev.x, ev.y - 10, ev.a + (Math.random() - 0.5) * 0.8, BERSERKER.frenzy.arc, ev.r, 0xffb08a, 0xa8281e, 0.1, 2, follow(ev.o));
        audio.play('frenzy', ev.x, ev.y, 0.6);
        break;
      case 'leapLand':
        f.ring(ev.x, ev.y, 6, ev.r, 0xd9512c, 0.35, 3);
        f.ring(ev.x, ev.y, 2, ev.r * 0.6, 0xf6c257, 0.25, 2);
        f.burst('p_dust', ev.x, ev.y, 22, 110, 0.5, { up: 20 });
        f.burst('p_ember', ev.x, ev.y, 10, 90, 0.4);
        f.shake(5, 200);
        audio.play('land', ev.x, ev.y);
        break;
      case 'madness':
        f.ring(ev.x, ev.y - 10, 4, ev.r + 20, 0xc83838, 0.45, 3);
        f.burst('p_blood', ev.x, ev.y - 10, 24, 110, 0.6, { up: 30 });
        f.flash(0x7a1010, 0.18, 160);
        f.shake(3, 200);
        break;
      case 'exhausted':
        f.number(ev.x, ev.y - 8, 'EXAUSTO', 0x9aa0b4);
        f.burst('p_dust', ev.x, ev.y + 12, 8, 30, 0.6, { up: 10 });
        break;
      // ---- Necromante
      case 'raise':
        f.burst('p_soul', ev.x, ev.y - 4, 12, 50, 0.7, { up: 40 });
        f.burst('p_dust', ev.x, ev.y, 8, 40, 0.5);
        f.ring(ev.x, ev.y, 2, 16, 0xa8d05a, 0.35, 1);
        break;
      case 'survivor':
        f.ring(ev.x, ev.y, 4, 24, 0x7fc47a, 0.5, 2);
        break;
      case 'raiseCast':
        f.ring(ev.x, ev.y, 18, 4, 0xa8d05a, 0.4, 2);
        f.burst('p_soul', ev.x, ev.y - 6, 10, 40, 0.6, { up: 30 });
        audio.play('raise', ev.x, ev.y);
        break;
      case 'armyCall':
        f.ring(ev.x, ev.y - 10, 30, 4, 0xa8d05a, 0.5, 2);
        f.burst('p_soul', ev.x, ev.y - 10, 16, 40, 0.8, { up: 20 });
        break;
      case 'army':
        f.ring(ev.x, ev.y, 6, ev.r * 2, 0xa8d05a, 0.5, 3);
        f.ring(ev.x, ev.y, 4, ev.r, 0x5a1470, 0.4, 2);
        f.burst('p_soul', ev.x, ev.y - 10, 40, 140, 0.8, { up: 30 });
        f.flash(0xa8d05a, 0.14, 160);
        f.shake(4, 250);
        audio.play('army', ev.x, ev.y);
        break;
      case 'boneBlast':
        f.ring(ev.x, ev.y, 4, ev.r, 0xd6ddc0, 0.3, 2);
        f.burst('p_bone', ev.x, ev.y, 10, 100, 0.5, { g: 200, up: 40 });
        f.burst('p_soul', ev.x, ev.y, 6, 60, 0.5);
        audio.play('runeBlast', ev.x, ev.y, 0.5);
        break;
      case 'minionHit':
        f.burst('p_bone', ev.x, ev.y, 3, 50, 0.3, { g: 200 });
        break;
      case 'minionFade':
        f.burst('p_soul', ev.x, ev.y, 8, 40, 0.6, { up: 30 });
        break;
      case 'minionAttack':
        f.arc(ev.x, ev.y, ev.a, 80, ev.r + 6, 0xd6ddc0, 0x5f7a3a, 0.1, 1);
        break;
      case 'essence': {
        const p = this.players.get(ev.o);
        for (let i = 0; i < 4 + ev.r * 2; i++) {
          const a = Math.random() * Math.PI * 2;
          f.particle('p_soul', ev.x + Math.cos(a) * 14, ev.y + Math.sin(a) * 10, -Math.cos(a) * 30, -Math.sin(a) * 30 - 10, 0.5, { depth: 99000 });
        }
        if (ev.o === this.session.myId && p) audio.play('essence', ev.x, ev.y, 0.5);
        break;
      }
      // ---- caçador (bifurcações)
      case 'trapBlast':
        f.ring(ev.x, ev.y, 4, ev.r, 0xf6c257, 0.3, 2);
        f.burst('p_ember', ev.x, ev.y, 18, 120, 0.5, { up: 30 });
        f.shake(3, 150);
        audio.play('explosion', ev.x, ev.y, 0.5);
        break;
      case 'ricochet':
        f.burst('p_silver', ev.x, ev.y, 5, 60, 0.25, { dir: ev.a, spread: 0.8 });
        break;
      // ---- mapa, afixos, objetivos
      case 'breakHit':
        f.burst('p_wood', ev.x, ev.y - 6, 4, 50, 0.4, { g: 220, up: 30 });
        audio.play('breakHit', ev.x, ev.y, 0.6);
        break;
      case 'bloodyHeal':
        f.burst('p_blood', ev.x, ev.y, 6, 30, 0.5, { up: 20 });
        break;
      case 'exposed':
        f.ring(ev.x, ev.y, 10, ev.r, 0xffe0a0, 0.5, 3);
        f.flash(0xffe0a0, 0.18, 150);
        f.shake(4, 250);
        audio.play('rupture', ev.x, ev.y, 0.7);
        break;
      case 'moonBlast':
        f.ring(ev.x, ev.y, 4, ev.r, 0x8fd3f0, 0.35, 3);
        f.burst('p_frost', ev.x, ev.y, 14, 100, 0.5);
        audio.play('runeBlast', ev.x, ev.y, 0.6);
        break;
      case 'frostBlast':
        f.ring(ev.x, ev.y, 4, ev.r, 0xd8f6ff, 0.35, 3);
        f.burst('p_frost', ev.x, ev.y, 18, 120, 0.5, { up: 30 });
        f.burst('p_snowbig', ev.x, ev.y, 6, 80, 0.5, { g: 150 });
        audio.play('ice', ev.x, ev.y);
        break;
      case 'fireHurt':
        f.burst('p_abyss', ev.x + (Math.random() - 0.5) * 16, ev.y, 4, 30, 0.5, { up: 20 });
        break;
      case 'ritualDone':
        f.ring(ev.x, ev.y, 6, ev.r * 2, 0xe07cff, 0.6, 3);
        f.burst('p_abyss', ev.x, ev.y - 10, 30, 140, 0.7, { up: 40 });
        f.flash(0x5a1470, 0.3, 300);
        f.shake(5, 300);
        break;
      case 'survivorSafe':
        f.ring(ev.x, ev.y - 8, 4, 30, 0x7fc47a, 0.6, 2);
        f.burst('p_heal', ev.x, ev.y - 8, 16, 60, 0.7, { up: 40 });
        break;
      case 'cartArrive':
        f.ring(ev.x, ev.y, 8, ev.r, 0x5a1470, 0.5, 3);
        f.burst('p_wood', ev.x, ev.y - 8, 20, 120, 0.6, { g: 220, up: 60 });
        f.shake(5, 300);
        break;
      case 'summon':
      case 'teleport':
        f.burst('p_abyss', ev.x, ev.y - 8, 10, 50, 0.5, { up: 30 });
        break;
      default:
        break;
    }
  }

  ping(x: number, y: number, from: number): void {
    this.pings.push({ x, y, from, until: performance.now() + 4000 });
    audio.play('telegraph', x, y, 0.8);
  }

  /** Destino do clique direito; o servidor continua autoritativo sobre o movimento. */
  setMoveTarget(x: number, y: number): void {
    if (this.mode !== 'match' || !this.predictor.active) return;
    const radius = CLASSES[this.predictor.cls].radius;
    let point = { x, y };
    if (!circleFree(this.map, x, y, radius)) {
      let found = false;
      for (let ring = 1; ring <= 5 && !found; ring++) for (let a = 0; a < 16; a++) {
        const angle = a * Math.PI / 8;
        const nx = x + Math.cos(angle) * ring * TILE;
        const ny = y + Math.sin(angle) * ring * TILE;
        if (circleFree(this.map, nx, ny, radius)) {
          point = { x: nx, y: ny };
          found = true;
          break;
        }
      }
      if (!found) {
        this.moveTarget = null;
        this.moveClick = { x, y, at: performance.now(), valid: false };
        return;
      }
    }
    const field = new FlowField(this.map);
    field.compute(point.x, point.y);
    const current = this.predictor.state;
    const valid = field.at(current.x, current.y) !== 0xffff;
    this.moveTarget = valid ? { ...point, field, at: performance.now(), lastX: current.x, lastY: current.y, stuck: 0 } : null;
    this.moveClick = { x: point.x, y: point.y, at: performance.now(), valid };
  }

  private ghost(frame: string, x: number, y: number, flip: boolean): void {
    const [tex, fr] = tf(frame);
    const img = this.add.image(x, y, tex, fr).setOrigin(0.5, 30 / 32).setFlipX(flip).setDepth(y - 1).setAlpha(0.45).setTint(0x7da0cf).setTintMode(Phaser.TintModes.FILL);
    this.ghosts.push({ img, life: 0.2 });
  }

  // ---------------------------------------------------------------- atualização por quadro

  override update(_time: number, dtRaw: number): void {
    const dt = Math.min(dtRaw, 100);
    this.fpsSamples.push(dtRaw);
    if (this.fpsSamples.length > 120) this.fpsSamples.shift();
    for (const a of this.animated) {
      const fire = a.p.animated !== 'torch';
      const n = fire ? 6 : 4;
      const f = Math.floor(performance.now() / (fire ? 110 : 140) + a.p.x) % n;
      const [tex, fr] = tf(`${a.p.animated}_${f}`);
      if (a.img.frame.name !== fr) a.img.setTexture(tex, fr);
    }
    if (this.mode === 'match') this.updateMatch(dt);
    else this.updateMenu(dt);
    // fantasmas
    for (let i = this.ghosts.length - 1; i >= 0; i--) {
      const g = this.ghosts[i] as { img: Phaser.GameObjects.Image; life: number };
      g.life -= dt / 1000;
      g.img.setAlpha(Math.max(0, g.life / 0.2) * 0.45);
      if (g.life <= 0) {
        g.img.destroy();
        this.ghosts.splice(i, 1);
      }
    }
    this.fx.update(dt);
    this.ambientParticles(dt);
    this.updateLighting();
    this.drawLightReflections();
    const cam = this.cameras.main;
    this.fog.tilePositionX = cam.scrollX * 1 + performance.now() / 90;
    this.fog.tilePositionY = cam.scrollY * 1 + performance.now() / 260;
    audio.setListener(cam.scrollX + 320, cam.scrollY + 180);
    const fireD = Math.hypot(cam.scrollX + 320 - this.map.campfire.x, cam.scrollY + 180 - this.map.campfire.y);
    audio.crackle(Math.max(0, 1 - fireD / 300));
    audio.setStorm(this.mode === 'match' && this.storm > 0);
  }

  private updateMenu(dt: number): void {
    this.menuT += dt / 1000;
    const cx = this.map.campfire.x + Math.cos(this.menuT * 0.05) * 420;
    const cy = this.map.campfire.y + Math.sin(this.menuT * 0.07) * 180;
    this.camX += (cx - 320 - this.camX) * 0.02;
    this.camY += (cy - 180 - this.camY) * 0.02;
    this.setCameraScroll();
    this.zoneG.clear();
    this.teleG.clear();
  }

  private localFrame(): InputFrame {
    const s = this.input2.sample();
    if (s.mx !== 0 || s.my !== 0) this.moveTarget = null;
    else if (this.moveTarget && this.predictor.active) {
      const p = this.predictor.state;
      const t = this.moveTarget;
      const d = Math.hypot(t.x - p.x, t.y - p.y);
      if (d < 6) this.moveTarget = null;
      else {
        const direct = d < TILE * 1.5 && lineOfSight(this.map, p.x, p.y, t.x, t.y);
        const dir = direct ? [(t.x - p.x) / d, (t.y - p.y) / d] : t.field.direction(p.x, p.y);
        if (dir && (dir[0] !== 0 || dir[1] !== 0)) {
          s.mx = dir[0];
          s.my = dir[1];
        }
        if (Math.hypot(p.x - t.lastX, p.y - t.lastY) < 0.2) t.stuck++;
        else t.stuck = 0;
        t.lastX = p.x;
        t.lastY = p.y;
        if (t.stuck > 45 || !dir) this.moveTarget = null;
      }
    }
    const cam = this.cameras.main;
    const ax = Math.round(cam.scrollX + this.input2.mouseX);
    const ay = Math.round(cam.scrollY + this.input2.mouseY);
    this.predictor.seq++;
    return { seq: this.predictor.seq, mx: s.mx, my: s.my, ax, ay, held: s.held, pressed: s.pressed };
  }

  private updateMatch(dt: number): void {
    const sess = this.session;
    const latest = sess.latest();
    if (!latest) return;
    const myLatest = idx(latest).p.get(sess.myId);
    const alive = myLatest?.s === 0;
    // passos fixos de 30 Hz: entrada + predição
    this.acc += dt;
    let steps = 0;
    while (this.acc >= TICK_MS && steps < 4) {
      this.acc -= TICK_MS;
      steps++;
      if (sess.paused || latest.w.intro) continue;
      const f = this.localFrame();
      sess.send({ t: 'in', i: [[f.seq, f.mx, f.my, f.ax, f.ay, f.held, f.pressed]] });
      if (this.predictor.active && alive) this.predictor.step(f);
    }
    if (steps === 4) this.acc = 0;
    const alpha = this.acc / TICK_MS;

    // interpolação das entidades remotas
    const renderTick = sess.serverTickNow() - INTERP_TICKS;
    let a = latest;
    let b = latest;
    for (let i = sess.snaps.length - 1; i >= 0; i--) {
      const s = sess.snaps[i] as Snapshot;
      if (s.tick <= renderTick) {
        a = s;
        b = sess.snaps[i + 1] ?? s;
        break;
      }
      a = s;
      b = s;
    }
    const span = b.tick - a.tick;
    const t = span > 0 ? Math.max(0, Math.min(1, (renderTick - a.tick) / span)) : 0;
    const ia = idx(a);
    const ib = idx(b);
    const hitstop = performance.now() < this.hitstopUntil;

    // jogadores
    const seen = new Set<number>();
    this.rendered = [];
    const nowTick = sess.serverTickNow();
    for (const pd of latest.p) {
      seen.add(pd.id);
      let v = this.players.get(pd.id);
      if (!v) {
        v = new PlayerView(this, pd.id, pd.c, sess.nameOf(pd.id), pd.id === sess.myId);
        this.players.set(pd.id, v);
      }
      let x: number;
      let y: number;
      let data = pd;
      let at = pd.at;
      if (pd.id === sess.myId && this.predictor.active && pd.s === 0) {
        const r = this.predictor.render(alpha, dt);
        x = r.x;
        y = r.y;
        at = pd.at + (ACTIONS[pd.act] !== 'idle' ? nowTick - latest.tick : 0);
      } else {
        const p0 = ia.p.get(pd.id) ?? pd;
        const p1 = ib.p.get(pd.id) ?? p0;
        x = p0.x + (p1.x - p0.x) * t;
        y = p0.y + (p1.y - p0.y) * t;
        data = t < 0.5 ? p0 : p1;
        at = data.at + (data.act ? (renderTick - (t < 0.5 ? a.tick : b.tick)) : 0);
      }
      const moving = Math.hypot(x - v.x, y - v.y) > 0.25 * (dt / 16);
      v.update(
        { data, x, y, at: Math.max(0, at), moving, serverTick: nowTick, watched: pd.id === this.spectateId },
        dt,
        { ghost: (k, gx, gy, fl) => this.ghost(k, gx, gy, fl), particle: (k, px, py) => this.fx.particle(k, px, py, (Math.random() - 0.5) * 20, -20 - Math.random() * 20, 0.6, { depth: py + 1 }) },
        hitstop && pd.id === sess.myId,
      );
      this.rendered.push({ id: pd.id, cls: pd.c, x, y, data });
    }
    for (const [id, v] of this.players) {
      if (!seen.has(id)) {
        v.destroy();
        this.players.delete(id);
        this.reflections.get(id)?.destroy();
        this.reflections.delete(id);
      }
    }
    this.updatePlayerReflections();

    // Bardo não é entidade de combate; a posição vem somente do servidor.
    const bd = latest.w.bd;
    if (bd) {
      if (!this.bard) this.bard = this.add.image(bd[0], bd[1], ...tf('bard_play_0')).setOrigin(0.5, 34 / 36);
      const frame = `bard_play_${Math.floor(performance.now() / 180) % 4}`;
      const [tex, fr] = tf(frame);
      if (this.bard.frame.name !== fr) this.bard.setTexture(tex, fr);
      this.bard.setPosition(bd[0], bd[1]).setDepth(bd[1]);
    } else if (this.bard) {
      this.bard.destroy();
      this.bard = null;
    }
    const listener = this.rendered.find((p) => p.id === sess.myId);
    audio.setBard(bd ? { x: bd[0], y: bd[1] } : null, listener?.x ?? 0, listener?.y ?? 0, !!bd && !!listener && latest.w.ph !== 'victory' && latest.w.ph !== 'defeat' && !sess.paused && !latest.w.intro && !document.hidden && document.hasFocus());

    // inimigos
    const seenE = new Set<number>();
    this.renderedEnemies = [];
    this.teleG.clear();
    let telegraphs = 0;
    for (const e1 of b.e) {
      const id = e1[0];
      seenE.add(id);
      const e0 = ia.e.get(id) ?? e1;
      let v = this.enemies.get(id);
      if (!v) {
        v = new EnemyView(this, id, e1[1], this.map.climate);
        this.enemies.set(id, v);
      }
      const x = e0[2] + (e1[2] - e0[2]) * t;
      const y = e0[3] + (e1[3] - e0[3]) * t;
      const src = t < 0.5 ? e0 : e1;
      const re: RenderEnemy = {
        id,
        type: v.type,
        x,
        y,
        hp: src[4],
        mhp: src[5],
        state: enemyStateName(src[6]),
        atk: enemyAttackName(src[7]),
        stateT: src[8] + (src[6] === e1[6] ? (renderTick - (t < 0.5 ? a.tick : b.tick)) : 0),
        facing: src[9] / 100,
        tx: src[10],
        ty: src[11],
        flags: src[12],
        affix: affixOf(src[13]),
        marks: src[14],
        markBy: src[15],
        moving: Math.hypot(x - v.x, y - v.y) > 0.1,
      };
      v.update(re, dt, sess.myId, hitstop);
      this.renderedEnemies.push(re);
      if (drawTelegraph(this.teleG, re, v.body.width * 0.3)) telegraphs++;
    }
    for (const [id, v] of this.enemies) {
      if (!seenE.has(id)) {
        v.destroy();
        this.enemies.delete(id);
      }
    }
    void telegraphs;

    // servos do Necromante, horda e sobrevivente
    const seenM = new Set<number>();
    for (const m1 of b.m ?? []) {
      const id = m1[0];
      seenM.add(id);
      const m0 = ia.m.get(id) ?? m1;
      let v = this.minions.get(id);
      if (!v) {
        v = new MinionView(this, id, m1[1]);
        this.minions.set(id, v);
      }
      const x = m0[2] + (m1[2] - m0[2]) * t;
      const y = m0[3] + (m1[3] - m0[3]) * t;
      v.update(t < 0.5 ? m0 : m1, x, y, dt, Math.hypot(x - v.x, y - v.y) > 0.1);
    }
    for (const [id, v] of this.minions) {
      if (!seenM.has(id)) {
        v.destroy();
        this.minions.delete(id);
      }
    }

    // itens (cura) e cadáveres (Necromante)
    const seenI = new Set<number>();
    const now0 = performance.now();
    for (const it of latest.it ?? []) {
      seenI.add(it[0]);
      let img = this.pickups.get(it[0]);
      if (!img) {
        img = this.add.image(it[2], it[3], ...tf(it[1] === 1 ? `corpse_${it[0] % 3}` : 'pickup_heal_0')).setOrigin(0.5, 1);
        if (it[1] === 1) img.setDepth(-7600).setAlpha(0.9);
        this.pickups.set(it[0], img);
        if (it[1] === 0) this.fx.burst('p_heal', it[2], it[3] - 6, 6, 40, 0.5, { up: 30 });
      }
      if (it[1] === 0) {
        const bob = Math.round(Math.sin(now0 / 250 + it[0]) * 2);
        img.setTexture(...tf(`pickup_heal_${Math.floor(now0 / 300) % 2}`)).setPosition(it[2], it[3] + bob).setDepth(it[3]);
      }
    }
    for (const [id, img] of this.pickups) {
      if (!seenI.has(id)) {
        img.destroy();
        this.pickups.delete(id);
      }
    }

    // projéteis
    const seenP = new Set<number>();
    for (const p1 of b.pr) {
      const id = p1[0];
      seenP.add(id);
      const p0 = ia.pr.get(id);
      const kind = PROJECTILE_KINDS[p1[1]] ?? 'bolt';
      let img = this.projectiles.get(id);
      if (!img) {
        const frame = kind === 'bolt' || kind === 'pierceBolt' || kind === 'slipper' || kind === 'bone' ? `proj_${kind}` : `proj_${kind}_0`;
        img = this.add.image(p1[2], p1[3], ...tf(frame));
        this.projectiles.set(id, img);
      }
      let x = p1[2];
      let y = p1[3];
      if (p0) {
        x = p0[2] + (p1[2] - p0[2]) * t;
        y = p0[3] + (p1[3] - p0[3]) * t;
      } else {
        // recém-criado: recua ao longo da velocidade para alinhar com a interpolação
        const back = Math.max(0, b.tick - renderTick) / 30;
        x -= p1[4] * back;
        y -= p1[5] * back;
      }
      // Projéteis dos jogadores já saem da altura da arma no servidor.
      // Deslocá-los novamente para cima fazia a trajetória visual passar acima da mira.
      const visualY = p1[6] > 0 ? y : y - 6;
      img.setPosition(Math.round(x), Math.round(visualY)).setDepth(y + 8);
      if (kind === 'slipper') img.setRotation(performance.now() / 50);
      else if (kind === 'bolt' || kind === 'pierceBolt' || kind === 'bone') img.setRotation(Math.atan2(p1[5], p1[4]));
      else if (kind === 'iceShard') {
        img.setTexture(...tf(`proj_iceShard_${Math.floor(performance.now() / 100) % 2}`)).setRotation(Math.atan2(p1[5], p1[4]));
      } else {
        const [tex, fr] = tf(`proj_${kind}_${Math.floor(performance.now() / 100) % 2}`);
        img.setTexture(tex, fr);
      }
      if (Math.random() < 0.35) {
        const trail = kind === 'missile' || kind === 'empMissile' ? 'p_arc' : kind === 'orb' || kind === 'abyssOrb' ? 'p_abyss' : kind === 'pierceBolt' ? 'p_silver' : kind === 'bone' ? 'p_soul' : kind === 'iceShard' ? 'p_frost' : null;
        if (trail) this.fx.particle(trail, x, visualY, 0, 0, 0.25, { depth: y });
      }
    }
    for (const [id, img] of this.projectiles) {
      if (!seenP.has(id)) {
        img.destroy();
        this.projectiles.delete(id);
      }
    }

    // zonas
    this.zoneG.clear();
    const now = performance.now();
    const seenT = new Set<number>();
    for (const z of latest.z) {
      const kind = ZONE_KINDS[z[1]];
      if (kind === 'trap') {
        seenT.add(z[0]);
        let img = this.traps.get(z[0]);
        if (!img) {
          img = this.add.image(z[2], z[3], ...tf('trap')).setDepth(-7500);
          this.traps.set(z[0], img);
        }
        img.setAlpha(z[6] === sess.myId ? 1 : 0.8);
        continue;
      }
      drawZone(this.zoneG, z as ZoneTuple, now);
    }
    for (const [id, img] of this.traps) {
      if (!seenT.has(id)) {
        img.destroy();
        this.traps.delete(id);
      }
    }
    // pings
    this.pings = this.pings.filter((p) => p.until > now);
    for (const p of this.pings) {
      const k = (now / 500) % 1;
      this.zoneG.lineStyle(2, 0xf6c257, 1 - k).strokeCircle(p.x, p.y, 6 + k * 20);
    }
    this.drawMoveClick(now);

    this.drawObjectives(latest, now);

    this.updateCamera(dt);
    this.updateOcclusion();
  }

  private drawMoveClick(now: number): void {
    const mark = this.moveTarget ?? this.moveClick;
    if (!mark || (!this.moveTarget && now - mark.at > 650)) return;
    const x = Math.round(mark.x);
    const y = Math.round(mark.y);
    const fresh = Math.max(0, 1 - (now - mark.at) / 350);
    const color = 'valid' in mark && !mark.valid ? 0xec6a5e : 0x8fd3f0;
    const g = this.zoneG;
    const size = Math.round(7 + fresh * 8);
    g.lineStyle(1, color, 0.45 + fresh * 0.5);
    g.strokeRect(x - size, y - size / 2, size * 2, size);
    g.fillStyle(color, 0.7 + fresh * 0.3);
    g.fillRect(x - 2, y - 2, 4, 4);
    g.fillRect(x - size - 2, y - 1, 3, 3);
    g.fillRect(x + size, y - 1, 3, 3);
    g.fillRect(x - 1, y - size / 2 - 3, 3, 3);
    g.fillRect(x - 1, y + size / 2, 3, 3);
  }

  /** Marcadores de objetivos no mapa: vida da fogueira, altar, área proibida. */
  private drawObjectives(s: Snapshot, now: number): void {
    const g = this.zoneG;
    const cf = this.map.campfire;
    const ev = s.w.ev;
    const cg = s.w.cg;
    const pulse = 0.35 + Math.sin(now / 220) * 0.15;
    // barra pixelada acima de um ponto
    const bar = (x: number, y: number, w: number, p: number, col: number): void => {
      g.fillStyle(0x0b0a12, 1).fillRect(Math.round(x - w / 2 - 1), Math.round(y - 1), w + 2, 4);
      g.fillStyle(0x440d1a, 1).fillRect(Math.round(x - w / 2), Math.round(y), w, 2);
      g.fillStyle(col, 1).fillRect(Math.round(x - w / 2), Math.round(y), Math.max(0, Math.round((w * p) / 100)), 2);
    };
    if (ev && ev.k === 'bonfire' && ev.s === 0) {
      g.lineStyle(1, 0xe0902a, pulse).strokeCircle(cf.x, cf.y, EVENT_RULES.bonfire.radius);
      bar(cf.x, cf.y - 44, 34, ev.p, 0xe0902a);
    }
    if (cg && cg.k === 'fireUntouched' && cg.s === 0) {
      g.lineStyle(1, 0xf6c257, pulse * 0.8).strokeCircle(cf.x, cf.y, CHALLENGE_RULES.fire.radius);
    }
    const altarOn = !!cg && cg.k === 'altar' && cg.x !== undefined && cg.y !== undefined;
    if (altarOn && cg && cg.x !== undefined && cg.y !== undefined) {
      if (!this.altar) this.altar = this.add.image(cg.x, cg.y, ...tf('altar_0')).setOrigin(0.5, 1);
      this.altar.setTexture(...tf(`altar_${Math.floor(now / 400) % 2}`)).setPosition(cg.x, cg.y + 8).setDepth(cg.y + 8).setAlpha(cg.s === 2 ? 0.45 : 1);
      if (cg.s === 0) {
        g.lineStyle(1, 0x7fc47a, pulse).strokeCircle(cg.x, cg.y, CHALLENGE_RULES.altar.radius);
        bar(cg.x, cg.y - 26, 26, cg.p, 0x7fc47a);
      }
    } else if (this.altar) {
      this.altar.destroy();
      this.altar = null;
    }
  }

  private updateCamera(dt: number): void {
    const sess = this.session;
    const intro = sess.latest()?.w.intro;
    const cam = this.cameras.main;
    if (intro) {
      const close = Math.max(0, intro.d - intro.t - intro.reveal);
      const zoom = 1 + 0.32 * Math.min(1, close / 18);
      cam.setZoom(zoom);
      const tx = intro.x - 320 / zoom;
      const ty = intro.y - 180 / zoom;
      const k = 1 - Math.exp(-dt / 180);
      this.camX += (tx - this.camX) * k;
      this.camY += (ty - this.camY) * k;
      this.setCameraScroll();
      return;
    }
    if (cam.zoom !== 1) cam.setZoom(1);
    const me = this.rendered.find((p) => p.id === sess.myId);
    let target = me;
    if (me && me.data.s !== 0) {
      const alive = this.rendered.filter((p) => p.data.s === 0 && p.id !== sess.myId);
      if (alive.length) {
        let s = alive.find((p) => p.id === this.spectateId);
        if (!s) {
          s = alive[0];
          this.spectateId = s?.id ?? 0;
        }
        target = s;
      }
    } else this.spectateId = 0;
    if (!target) return;
    // Um spawn/teleporte de objetivo pode deixar o jogador longe do alvo antigo.
    // Nesse caso, a câmera deve acompanhá-lo imediatamente (a máscara de luz é
    // atualizada logo depois, usando o mesmo scroll), sem atravessar o mapa.
    const jumped = target.id !== this.cameraFollowId
      || Math.hypot(target.x - this.cameraFollowX, target.y - this.cameraFollowY) > 180;
    if (jumped) {
      this.camX = target.x - 320;
      this.camY = target.y - 190;
      this.cameraFollowId = target.id;
    }
    this.cameraFollowX = target.x;
    this.cameraFollowY = target.y;
    // leve antecipação na direção da mira
    const lookX = me && me.data.s === 0 ? (this.input2.mouseX - 320) * 0.12 : 0;
    const lookY = me && me.data.s === 0 ? (this.input2.mouseY - 180) * 0.12 : 0;
    const tx = target.x - 320 + lookX;
    const ty = target.y - 190 + lookY;
    const k = 1 - Math.exp(-dt / 70);
    this.camX += (tx - this.camX) * k;
    this.camY += (ty - this.camY) * k;
    if (Math.hypot(tx - this.camX, ty - this.camY) > 500) {
      this.camX = tx;
      this.camY = ty;
    }
    this.setCameraScroll();
  }

  private setCameraScroll(): void {
    const cam = this.cameras.main;
    // O Phaser só limita o scroll às bordas no preRender, depois de updateLighting.
    // Limitar aqui mantém a máscara de luz na mesma posição usada para desenhar o mundo.
    this.camX = cam.clampX(this.camX);
    this.camY = cam.clampY(this.camY);
    cam.setScroll(this.camX, this.camY);
  }

  cycleSpectate(): void {
    const alive = this.rendered.filter((p) => p.data.s === 0 && p.id !== this.session.myId);
    if (!alive.length) return;
    const i = alive.findIndex((p) => p.id === this.spectateId);
    this.spectateId = (alive[(i + 1) % alive.length] as RenderedPlayer).id;
  }

  private updateOcclusion(): void {
    const me = this.rendered.find((p) => p.id === this.session.myId);
    const focus = me ? [me] : [];
    for (const o of this.objects) {
      let hide = false;
      for (const p of focus) {
        if (p.y < o.p.y - 4 && o.bounds.contains(p.x, p.y - 10)) hide = true;
      }
      const target = hide ? 0.4 : 1;
      const a = o.img.alpha;
      if (a !== target) o.img.setAlpha(target > a ? Math.min(target, a + 0.15) : Math.max(target, a - 0.15));
    }
  }

  private ambientParticles(dt: number): void {
    const cam = this.cameras.main;
    const s = dt / 1000;
    const climate = this.map.climate;
    const storm = this.storm > 0 && this.mode === 'match';
    // brasas da fogueira
    const ember = climate === 'winter' ? 'p_frost' : climate === 'ash' ? 'p_abyss' : 'p_ember';
    if (Math.random() < s * 14) this.fx.particle(ember, this.map.campfire.x + (Math.random() - 0.5) * 20, this.map.campfire.y - 20, (Math.random() - 0.5) * 20, -30 - Math.random() * 30, 1.4, { g: -10, depth: 100000 });
    for (const t of this.map.torches) {
      if (Math.abs(t.x - cam.scrollX - 320) > 360 || Math.abs(t.y - cam.scrollY - 180) > 220) continue;
      if (Math.random() < s * 2.5) this.fx.particle('p_ember', t.x + (Math.random() - 0.5) * 4, t.y - 44, (Math.random() - 0.5) * 8, -20, 0.8, { g: -5, depth: 100000 });
    }
    const top = (): { x: number; y: number } => ({ x: cam.scrollX - 60 + Math.random() * 760, y: cam.scrollY - 10 });
    if (climate === 'night') {
      // folhas caindo
      if (Math.random() < s * 1.5) {
        const p = top();
        this.fx.particle('p_leaf', p.x, p.y, 12 + Math.random() * 10, 18 + Math.random() * 10, 9, { depth: 100000, drag: 1 });
      }
    } else if (climate === 'winter') {
      // neve; a nevasca sopra forte na horizontal
      const rate = storm ? 90 : 22;
      let n = rate * s;
      while (n > 0) {
        if (Math.random() < n) {
          const p = top();
          const big = Math.random() < 0.18;
          const vx = storm ? 70 + Math.random() * 50 : -6 + Math.random() * 12;
          if (storm) p.x -= 200;
          this.fx.particle(big ? 'p_snowbig' : 'p_snow', p.x, p.y, vx, 24 + Math.random() * 18 + (big ? 8 : 0), 14, { depth: 100000, drag: 1, fade: false });
        }
        n -= 1;
      }
    } else {
      // cinzas caem de lado; fagulhas sobem das fendas
      const rate = storm ? 80 : 16;
      let n = rate * s;
      while (n > 0) {
        if (Math.random() < n) {
          const p = top();
          if (storm) p.x -= 240;
          this.fx.particle('p_ash', p.x, p.y, storm ? 90 + Math.random() * 60 : 14 + Math.random() * 10, 18 + Math.random() * 14, 14, { depth: 100000, drag: 1, fade: false });
        }
        n -= 1;
      }
      if (Math.random() < s * 5) {
        const x = cam.scrollX + Math.random() * 640;
        const y = cam.scrollY + 360 + 4;
        this.fx.particle('p_cinder', x, y, (Math.random() - 0.5) * 10, -40 - Math.random() * 30, 6, { g: -4, depth: 100000 });
      }
    }
  }

  private updatePlayerReflections(): void {
    for (const p of this.rendered) {
      const alpha = this.enhancedLighting && p.data.s === 0 ? reflectionAlpha(this.map, p.x, p.y + 8) : 0;
      let image = this.reflections.get(p.id);
      if (alpha <= 0) {
        image?.setVisible(false);
        continue;
      }
      const view = this.players.get(p.id);
      if (!view) continue;
      if (!image) {
        image = this.add.image(p.x, p.y + 2, view.body.texture.key, view.body.frame.name).setOrigin(0.5, 0).setFlipY(true);
        this.reflections.set(p.id, image);
      }
      if (image.texture.key !== view.body.texture.key || image.frame.name !== view.body.frame.name) image.setTexture(view.body.texture.key, view.body.frame.name);
      image.setPosition(Math.round(p.x), Math.round(p.y + 3)).setDepth(Math.round(p.y) - 1).setFlipX(view.body.flipX).setScale(1, 0.45).setAlpha(alpha).setVisible(true);
      image.setTint(this.map.climate === 'winter' ? 0xaed9ed : this.map.climate === 'ash' ? 0xc4a3a0 : 0xe0b892);
    }
  }

  /** Riscos de luz em pedra úmida/gelo/mármore, quantizados em pixels e limitados à câmera. */
  private drawLightReflections(): void {
    const g = this.reflectionG;
    g.clear();
    if (!this.enhancedLighting || this.mode !== 'match') return;
    const cam = this.cameras.main;
    const color = this.map.climate === 'winter' ? 0xb7e3ef : this.map.climate === 'ash' ? 0xbf80d0 : 0xf6c257;
    const lights = [this.map.campfire, ...this.map.torches, ...this.map.lights];
    let drawn = 0;
    for (const source of lights) {
      if (drawn >= 24) break;
      if (source.x < cam.scrollX - 60 || source.x > cam.scrollX + 700 || source.y < cam.scrollY - 70 || source.y > cam.scrollY + 380) continue;
      const alpha = reflectionAlpha(this.map, source.x, source.y + 28);
      if (alpha <= 0) continue;
      drawn++;
      for (let row = 0; row < 5; row++) {
        const shimmer = Math.round(Math.sin(performance.now() / 430 + source.x * 0.17 + row * 1.9) * 2);
        const width = (row % 2 ? 19 : 30) - row * 2;
        g.fillStyle(color, alpha * (0.85 - row * 0.11));
        g.fillRect(Math.round(source.x - width / 2 + shimmer), Math.round(source.y + 20 + row * 4), width, 1);
      }
    }
  }

  private updateLighting(): void {
    const cam = this.cameras.main;
    const rt = this.dark;
    const now = performance.now();
    const look = CLIMATE_LOOK[this.map.climate];
    const storm = this.storm > 0 && this.mode === 'match';
    rt.clear();
    rt.fill(look.dark, Math.max(0.08, Math.min(0.8, look.alpha + (storm ? 0.08 : 0) - (this.mode === 'match' ? 0 : 0.02) - this.brightness * 0.5 - (this.enhancedLighting ? 0.055 : 0))));
    this.fog.setAlpha(Math.max(0.04, look.fogAlpha + (storm ? 0.16 : 0) - this.brightness * 0.08));
    const E = Phaser.BlendModes.ERASE;
    const light = (x: number, y: number, r: 24 | 48 | 72 | 112 | 160, alpha = 1): void => {
      const sx = Math.round(x - cam.scrollX);
      const sy = Math.round(y - cam.scrollY);
      if (sx < -r || sy < -r || sx > 640 + r || sy > 360 + r) return;
      rt.stamp(`light_${r}`, undefined, sx, sy, { blendMode: E, alpha });
    };
    const flick = 0.92 + Math.sin(now / 90) * 0.04 + Math.sin(now / 37) * 0.03;
    light(this.map.campfire.x, this.map.campfire.y - 10, 160, flick);
    light(this.map.campfire.x, this.map.campfire.y - 10, 112, flick);
    for (const t of this.map.torches) light(t.x, t.y - 30, 72, 0.9 + Math.sin(now / 70 + t.x) * 0.08);
    for (const l of this.map.lights) light(l.x, l.y, 48, 0.6);
    for (const p of this.rendered) {
      light(p.x, p.y - 10, p.id === this.session.myId ? 112 : 72, p.data.s === 0 ? 0.75 : 0.4);
      light(p.x, p.y - 12, 24, 0.9);
    }
    // inimigos recebem um contorno de luz fraco para serem legíveis na escuridão
    for (const e of this.renderedEnemies) {
      const def = ENEMIES[e.type];
      const r = def.tier === 'boss' ? 72 : def.miniboss || def.objective || e.type === 'werewolf' || e.type === 'father' ? 48 : 24;
      light(e.x, e.y - 10, r, e.type === 'falseMoon' ? 0.9 : 0.55);
    }
    for (const m of this.minions.values()) {
      if (m.kind === 'survivor') {
        light(m.x, m.y - 10, 112, 1);
        light(m.x, m.y - 12, 24, 1);
      } else light(m.x, m.y - 10, 24, 0.6);
    }
    if (this.bard) light(this.bard.x, this.bard.y - 13, 24, 0.35);
    for (const img of this.pickups.values()) light(img.x, img.y - 6, 24, 0.7);
    if (this.altar) light(this.altar.x, this.altar.y - 12, 48, 0.7);
    for (const img of this.projectiles.values()) light(img.x, img.y, 24, 0.8);
    for (const e of this.renderedEnemies) if ((e.type === 'acolyte' || e.type === 'highAcolyte' || e.type === 'ritualist') && e.state === 'windup') light(e.x, e.y - 10, 24, 0.7);
    const latest = this.session?.latest();
    if (this.mode === 'match' && latest) {
      for (const z of latest.z) {
        const k = ZONE_KINDS[z[1]];
        if (k === 'glacial' || k === 'bastion' || k === 'rupture' || k === 'polarity' || k === 'eruption' || k === 'rune' || k === 'leapMark' || k === 'spawnWarn' || k === 'graveHand' || k === 'moonPulse' || k === 'nova' || k === 'iceSpike')
          light(z[2], z[3], z[4] > 90 ? 112 : z[4] > 55 ? 72 : 48, 0.6);
      }
    }
    for (const p of this.pings) light(p.x, p.y, 48, 0.7);
    rt.render();
    for (const g of this.glows) g.setAlpha((this.enhancedLighting ? 0.3 : 0.18) + Math.sin(now / 80 + g.x) * 0.03);
  }
}
