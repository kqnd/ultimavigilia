/**
 * Cena principal: desenha a arena, interpola entidades remotas, prediz o jogador local,
 * converte eventos do servidor em efeitos e aplica luz/névoa/oclusão.
 */
import Phaser from 'phaser';
import { placeObjects, type Placed } from '../../art/placement.js';
import type { Climate, MapId } from '../../shared/config/chapters.js';
import { BERSERKER, CLASSES, type ClassId, LAPANHA, VAMPIRE } from '../../shared/config/classes.js';
import { ATK, ENEMIES, ENEMY_TYPES } from '../../shared/config/enemies.js';
import { EVENT_RULES, CHALLENGE_RULES } from '../../shared/config/objectives.js';
import { SHOT_HEIGHT, TICK_MS, TILE } from '../../shared/constants.js';
import { circleFree, lineOfSight } from '../../shared/collision.js';
import { type ArenaMap, cloneMap, getMap, mapByIndex, setBroken, WORLD_H, WORLD_W } from '../../shared/map.js';
import type { InputFrame } from '../../shared/movement.js';
import { ACTIONS, type EnemyTuple, type GameEvent, LOB_KINDS, type MinionTuple, PROJECTILE_KINDS, type ProjTuple, type SnapPlayer, ZONE_KINDS, type ZoneTuple } from '../../shared/protocol.js';
import { audio } from '../audio.js';
import { FlowField } from '../../server/world/nav.js';
import type { Session, Snapshot } from '../session.js';
import { Effects } from './effects.js';
import { LIGHT, projectileGlow, skillLight } from './lightfx.js';
import { reflectionAlpha } from './graphics-quality.js';
import type { InputCapture } from './input.js';
import { Predictor } from './predict.js';
import { drawMarchBeams, drawTelegraph, drawWoundLink, drawZone } from './telegraphs.js';
import { ensureFloor, ensureTextures, pixelOrigin, tf } from './textures.js';
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
  /** Sombras das melancias em arco (no chão, sob o projétil). */
  private lobShadows = new Map<number, Phaser.GameObjects.Image>();
  private ghosts: { img: Phaser.GameObjects.Image; life: number }[] = [];
  private zoneG!: Phaser.GameObjects.Graphics;
  /** Depuração da mira (F9): cursor no mundo, linha da mira, direção enviada e trajetória inicial. */
  aimDebug = false;
  aimDebugText = '';
  private debugG!: Phaser.GameObjects.Graphics;
  private lastAim = { x: 0, y: 0 };
  private shotStarts = new Map<number, { x: number; y: number; vx: number; vy: number; at: number }>();
  private debris: { img: Phaser.GameObjects.Image; until: number }[] = [];
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
    this.debugG = this.add.graphics().setDepth(160000);
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
      const img = pixelOrigin(this.add.image(Math.round(p.x), Math.round(p.y), ...tf(p.key))).setDepth(p.depth).setFlipX(p.flipX);
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
    for (const d of this.debris) d.img.destroy();
    this.debris = [];
    this.shotStarts.clear();
    this.moveTarget = null;
    this.moveClick = null;
    for (const v of this.players.values()) v.destroy();
    for (const image of this.reflections.values()) image.destroy();
    this.reflections.clear();
    this.reflectionG?.clear();
    for (const v of this.enemies.values()) v.destroy();
    for (const v of this.projectiles.values()) v.destroy();
    for (const v of this.traps.values()) v.destroy();
    for (const v of this.lobShadows.values()) v.destroy();
    this.lobShadows.clear();
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
            this.fx.glow(ev.x, ev.y + 4, ev.c === 'crit' ? 0xffd25a : 0xfff0e0, ev.c === 'crit' ? 0.5 : 0.3, { life: ev.c === 'crit' ? 0.18 : 0.1, grow: 1.5, alpha: 0.6, frame: ev.c === 'crit' ? 'glow_star' : 'glow_soft' });
            if (ev.s === myId) {
              this.hitstopUntil = performance.now() + (ev.v >= 30 ? 70 : 40);
              audio.play('hit', ev.x, ev.y, 0.8);
              if (ev.v >= 60) this.fx.shake(2, 80);
            }
          } else {
            const v = this.players.get(ev.ti);
            if (ev.c === 'heal') this.fx.number(ev.x, ev.y, `+${ev.v}`, 0x7fc47a);
            else if (ev.c === 'sac') {
              // sacrifício do Lapanha: número próprio, sem tremor nem clarão de dano
              this.fx.number(ev.x, ev.y, `-${ev.v}`, 0xff9a8a);
              this.fx.burst('p_pulp', ev.x, ev.y + 6, 4, 40, 0.35, { g: 160 });
            } else if (ev.c === 'shd') this.fx.number(ev.x, ev.y, `(${ev.v})`, 0xbfe3ff);
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
            this.fx.pillar(p.x, p.y, 0x9fffa0, 80, 0.9, 0.6);
            this.fx.burst('p_white', p.x, p.y - 8, 12, 50, 0.6, { up: 30 });
          }
          audio.play('revive');
          break;
        }
        case 'say': {
          const pv = this.players.get(ev.pi);
          if (pv) this.fx.bubble(ev.txt, () => (this.players.has(ev.pi) ? { x: pv.x, y: pv.y - 40 } : null), 2.2);
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
            const col = CLASSES[p.cls].color;
            this.fx.ring(p.x, p.y - 10, 6, 44, col, 0.45, 3);
            this.fx.burst('p_ember', p.x, p.y - 10, 14, 80, 0.5, { up: 20 });
            // toda suprema acende: coluna de luz na cor da classe + onda + estrela
            this.fx.pillar(p.x, p.y, col, 130, 1.3, 0.7);
            this.fx.shock(p.x, p.y, 56, col, 0.5);
            this.fx.flare(p.x, p.y - 14, col, 1.2, 0.35);
            this.fx.light(p.x, p.y, 160, 1, 0.6);
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
    skillLight(f, ev, { follow });
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
      // ---- Vampiro: Redemoinho Rubro e explosão do Banquete
      case 'vortexStart':
        f.ring(ev.x, ev.y - 4, ev.r, 6, 0x9c1e2e, 0.25, 2);
        break;
      case 'vortex': {
        f.ring(ev.x, ev.y - 4, 8, ev.r, 0xc83838, 0.22, 2);
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2 + ev.a * 0.7;
          f.particle('p_blood', ev.x + Math.cos(a) * ev.r * 0.8, ev.y - 4 + Math.sin(a) * ev.r * 0.6, -Math.sin(a) * 90, Math.cos(a) * 60, 0.3, { depth: ev.y + 2 });
        }
        audio.play('vortexPulse', ev.x, ev.y, 0.7);
        break;
      }
      case 'feastBurst':
        f.ring(ev.x, ev.y - 6, 6, ev.r, 0xec6a5e, 0.4, 3);
        f.ring(ev.x, ev.y - 6, 2, ev.r * 0.6, 0x9c1e2e, 0.35, 2);
        f.burst('p_blood', ev.x, ev.y - 8, 34, 160, 0.6, { g: 120 });
        f.shake(4, 200);
        break;
      // ---- Acólito Sombrio
      case 'marchPulse':
        f.ring(ev.x, ev.y, 6, ev.r, 0x7dffb0, 0.4, 2);
        f.ring(ev.x, ev.y, 2, ev.r * 0.55, 0x2a1a3a, 0.35, 3);
        f.burst('p_rune', ev.x, ev.y - 6, 14, 90, 0.5, { up: 20 });
        break;
      case 'marchBreak':
        f.burst('p_shadow', ev.x, ev.y, 16, 70, 0.5, { g: 150 });
        f.burst('p_rune', ev.x, ev.y, 6, 50, 0.3);
        f.number(ev.x, ev.y - 26, 'MARCHA INTERROMPIDA', 0x7dffb0);
        audio.play('marchBreak', ev.x, ev.y);
        break;
      // ---- Caçador de Névoa
      case 'mistJump':
        f.burst('p_mist', ev.x, ev.y - 6, 10, 60, 0.6, { up: 10 });
        break;
      case 'mistLand':
        f.ring(ev.x, ev.y, 3, ev.r + 6, 0xd8f6ff, 0.25, 2);
        f.burst('p_mist', ev.x, ev.y, 14, 90, 0.5);
        f.burst('p_dust', ev.x, ev.y, 6, 60, 0.4);
        f.shake(2, 100);
        break;
      // ---- Portador do Ossário
      case 'bash':
        f.arc(ev.x, ev.y - 8, ev.a, 100, ev.r, 0xe2dac4, 0x6d6456, 0.16, 3);
        f.burst('p_dust', ev.x, ev.y, 5, 50, 0.3);
        break;
      case 'shieldBlock':
        f.burst('p_ember', ev.x, ev.y - 10, 5, 90, 0.2, { dir: ev.a, spread: 1.4 });
        f.particle('hit_1', ev.x, ev.y - 10, 0, 0, 0.06, { fade: false, depth: 99000 });
        break;
      case 'shieldBreak': {
        f.burst('p_bone', ev.x, ev.y - 10, 18, 120, 0.7, { g: 240, up: 50 });
        f.ring(ev.x, ev.y - 8, 4, 26, 0xe2dac4, 0.25, 2);
        f.shake(4, 180);
        const img = pixelOrigin(this.add.image(Math.round(ev.x), Math.round(ev.y + 4), ...tf('boneShield_debris'))).setDepth(ev.y - 2);
        this.debris.push({ img, until: performance.now() + ev.r * 1000 });
        if (this.debris.length > 12) this.debris.shift()?.img.destroy();
        break;
      }
      // ---- Lapanha
      case 'melonBoom':
      case 'melonBoomBig': {
        const big = ev.n === 'melonBoomBig';
        const cracked = big && ev.a >= 0.99;
        f.ring(ev.x, ev.y, 3, ev.r, big ? 0xff7a6a : 0xe04848, big ? 0.35 : 0.25, big ? 3 : 2);
        if (big) f.ring(ev.x, ev.y, 2, ev.r * 0.35, 0xfff0e0, 0.25, 2);
        f.burst('p_pulp', ev.x, ev.y - 4, big ? 26 : 12, big ? 150 : 100, 0.5, { g: 260, up: 60 });
        f.burst('p_pulpLight', ev.x, ev.y - 4, big ? 10 : 4, 90, 0.4, { g: 240, up: 40 });
        f.burst('p_seed', ev.x, ev.y - 4, big ? 12 : 5, 110, 0.55, { g: 300, up: 50 });
        f.burst('p_rind', ev.x, ev.y - 2, big ? 8 : 3, 90, 0.6, { g: 300, up: 40 });
        if (big) f.shake(cracked ? 5 : 3, cracked ? 220 : 140);
        break;
      }
      case 'ripeThrow':
        f.burst('p_pulpLight', ev.x, ev.y - 16, 4 + Math.round(ev.a * 6), 50, 0.3, { up: 20 });
        break;
      case 'chargeMax':
        f.ring(ev.x, ev.y, 2, 16, 0xff7a6a, 0.3, 2);
        f.burst('p_pulpLight', ev.x, ev.y, 8, 60, 0.4, { up: 20 });
        break;
      case 'chargeCancel':
        f.burst('p_rind', ev.x, ev.y, 5, 40, 0.4, { g: 200 });
        break;
      case 'peelThrow':
        f.burst('p_rind', ev.x, ev.y, 4, 30, 0.3, { g: 160 });
        break;
      case 'peelBurst':
        f.ring(ev.x, ev.y, 3, ev.r, 0x3f9a3a, 0.3, 2);
        f.burst('p_seed', ev.x, ev.y - 4, 14, 120, 0.5, { g: 280, up: 40 });
        f.burst('p_rind', ev.x, ev.y - 2, 8, 100, 0.5, { g: 280, up: 40 });
        f.burst('p_pulp', ev.x, ev.y - 2, 8, 80, 0.4, { g: 260, up: 30 });
        break;
      case 'slip': {
        // partículas seguem a direção real do escorregão
        const n = ev.r > 0 ? 8 : 3;
        for (let i = 0; i < n; i++) f.particle(i % 2 ? 'p_pulp' : 'p_rind', ev.x, ev.y, Math.cos(ev.a) * (60 + i * 12) + (Math.random() - 0.5) * 30, Math.sin(ev.a) * (60 + i * 12) * 0.7, 0.4, { g: 120 });
        if (ev.r > 0) f.number(ev.x, ev.y - 30, 'ESCORREGOU!', 0xff9a8a);
        break;
      }
      case 'slipEnd':
        f.burst('p_dust', ev.x, ev.y, 5, 40, 0.3);
        break;
      case 'eatStart':
        f.burst('p_pulpLight', ev.x, ev.y - 16, 6, 30, 0.5, { up: 20 });
        break;
      case 'harvest':
        f.ring(ev.x, ev.y - 10, 4, 30, 0x7fc47a, 0.45, 2);
        f.ring(ev.x, ev.y - 10, 2, 20, 0xe04848, 0.35, 1);
        f.burst('p_heal', ev.x, ev.y - 12, 14, 60, 0.7, { up: 40 });
        f.burst('p_seed', ev.x, ev.y - 12, 6, 70, 0.5, { g: 200, up: 50 });
        break;
      case 'harvestEnd':
        f.burst('p_rind', ev.x, ev.y - 10, 5, 40, 0.4, { g: 200 });
        break;
      case 'freeMelon':
        f.number(ev.x, ev.y, 'MELANCIA SEM FIM', 0xf6c257);
        break;
      case 'shieldUp':
        f.ring(ev.x, ev.y, 4, 16, 0xbfe3ff, 0.35, 2);
        break;
      // ---- Ferida Profana, atordoamento, cerco e escolta
      case 'woundMark': {
        const target = ev.o;
        f.bubble('!', () => {
          const pv = this.players.get(target);
          return pv ? { x: pv.x, y: pv.y - 44 } : null;
        }, ev.r / 30);
        break;
      }
      case 'woundHit':
        f.ring(ev.x, ev.y, 3, 18, 0x9a4acb, 0.35, 2);
        f.burst('p_wound', ev.x, ev.y, 12, 60, 0.6, { up: 20 });
        if (ev.r === this.session.myId) {
          f.flash(0x5a1470, 0.25, 160);
          f.number(ev.x, ev.y - 18, ev.a ? 'FERIDA PROFANA' : 'FERIDA RENOVADA', 0xc79aff);
        }
        break;
      case 'woundBreak':
        f.burst('p_rune', ev.x, ev.y, 10, 60, 0.4);
        f.number(ev.x, ev.y - 16, 'FERIDA INTERROMPIDA', 0x7dffb0);
        break;
      case 'stun':
        f.burst('p_star', ev.x, ev.y, 8, 50, 0.5, { up: 20 });
        f.ring(ev.x, ev.y + 8, 2, 14, 0xf6c257, 0.3, 2);
        if (ev.o === this.session.myId) f.shake(3, 120);
        break;
      case 'stunResist':
        f.number(ev.x, ev.y, 'RESISTIU', 0xd8d0b8);
        break;
      // ---- combos entre classes
      case 'comboFreeze':
        f.ring(ev.x, ev.y, 3, 20, 0xd8f6ff, 0.4, 2);
        f.burst('p_frost', ev.x, ev.y, 10, 60, 0.5, { up: 15 });
        f.number(ev.x, ev.y - 16, 'CONGELADO!', 0xd8f6ff);
        audio.play('comboFreeze', ev.x, ev.y, 0.7);
        break;
      case 'comboFollowUp':
        f.burst('p_star', ev.x, ev.y, 8, 55, 0.45, { up: 18 });
        f.ring(ev.x, ev.y + 6, 2, 14, 0xff9a8a, 0.3, 2);
        audio.play('comboFollowUp', ev.x, ev.y, 0.65);
        break;
      case 'comboChain':
        f.ring(ev.x, ev.y, 4, ev.r, 0xcfd4df, 0.2, 2);
        f.burst('p_dust', ev.x, ev.y, 10, 70, 0.4);
        audio.play('comboChain', ev.x, ev.y, 0.6);
        break;
      case 'comboMark':
        f.burst('p_abyss', ev.x, ev.y, 8, 45, 0.5, { up: 20 });
        f.number(ev.x, ev.y - 4, '+ESSÊNCIA', 0xa8d05a);
        audio.play('comboMark', ev.x, ev.y, 0.6);
        break;
      case 'comboExpose':
        f.ring(ev.x, ev.y, 3, 18, 0xffe0a0, 0.4, 2);
        f.burst('p_mist', ev.x, ev.y, 8, 40, 0.4, { up: 12 });
        f.number(ev.x, ev.y - 16, 'EXPOSTO', 0xffe0a0);
        audio.play('comboExpose', ev.x, ev.y, 0.6);
        break;
      case 'siegeStart':
        f.burst('p_rune', ev.x, ev.y - 12, 6, 40, 0.4, { up: 20 });
        break;
      case 'siegeHit':
        f.line(ev.x - Math.cos(ev.a) * ev.r, ev.y - Math.sin(ev.a) * ev.r - 4, ev.x, ev.y, 0xe07cff, 0.25, 2);
        f.ring(ev.x, ev.y, 2, 16, 0xe07cff, 0.3, 2);
        f.burst('p_abyss', ev.x, ev.y, 10, 70, 0.4);
        break;
      case 'siegeBreak':
        f.burst('p_rune', ev.x, ev.y, 8, 60, 0.4);
        f.number(ev.x, ev.y - 14, 'INTERROMPIDO', 0x7dffb0);
        break;
      case 'survivorAlert':
        f.number(ev.x, ev.y, 'SOCORRO!', 0xec6a5e);
        break;
      case 'survivorHeavy':
        f.flash(0x6e1424, 0.12, 100);
        f.burst('p_blood', ev.x, ev.y, 8, 70, 0.4, { g: 200 });
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
      case 'frenzySpin':
        // giro: o arco já vem rodado pelo servidor (um quarto de volta por pulso)
        f.arc(ev.x, ev.y - 10, ev.a, BERSERKER.frenzy.arc, ev.r, 0xffd0a8, 0xa8281e, 0.12, 3, follow(ev.o));
        f.burst('p_ember', ev.x + Math.cos(ev.a) * ev.r * 0.7, ev.y - 8 + Math.sin(ev.a) * ev.r * 0.7, 4, 70, 0.28, { dir: ev.a, spread: 1.8 });
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
        // três anéis saindo em tempos diferentes = onda de choque, não um círculo só.
        // Finos de propósito: a conjuração não pode esconder o próprio boneco no meio da briga.
        f.ring(ev.x, ev.y, 6, ev.r + 40, 0x7a1008, 0.34, 2);
        f.ring(ev.x, ev.y, 4, ev.r + 26, 0xc83838, 0.38, 2);
        f.ring(ev.x, ev.y - 8, 2, ev.r + 12, 0xffd08a, 0.3, 1);
        f.burst('p_blood', ev.x, ev.y - 10, 30, 130, 0.7, { up: 34 });
        f.burst('p_ember', ev.x, ev.y - 6, 22, 100, 0.8, { up: 46 });
        f.number(ev.x, ev.y - 30, 'LOUCURA', 0xff6a4a);
        f.flash(0x8a1408, 0.22, 240);
        f.shake(6, 340);
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
      // ---- Guardião v1.5: Martelo Sísmico, provocação da muralha e reflexo
      case 'quakeWindup':
        f.burst('p_soul', ev.x, ev.y - 14, 6, 30, 0.4, { up: 20 });
        break;
      case 'maceQuake':
        f.ring(ev.x, ev.y, 4, ev.r, 0xb9f5e7, 0.32, 3);
        f.ring(ev.x, ev.y, 2, ev.r * 0.6, 0x75b5ae, 0.26, 2);
        f.burst('p_dust', ev.x, ev.y, 18, 110, 0.5, { up: 30 });
        f.burst('p_silver', ev.x, ev.y, 10, 120, 0.4, { g: 200, up: 40 });
        f.shake(5, 200);
        break;
      case 'bulwarkTaunt':
        f.ring(ev.x, ev.y, 10, ev.r, 0x83c9c2, 0.4, 1);
        f.number(ev.x, ev.y - 40, 'PROVOCAÇÃO', 0x9fe4d8);
        break;
      case 'guardianReflect':
        f.burst('p_silver', ev.x, ev.y, 10, 140, 0.3, { dir: ev.a, spread: 0.8 });
        f.number(ev.x, ev.y - 22, 'REFLETIDO!', 0xd5fff2);
        audio.play('guardianBlockProjectile', ev.x, ev.y);
        break;
      // ---- Maycon
      case 'bottleBurst':
        f.ring(ev.x, ev.y, 2, ev.r, 0xf0b54a, 0.22, 2);
        f.burst('p_glass', ev.x, ev.y - 4, 10, 110, 0.4, { g: 280, up: 40 });
        f.burst('p_booze', ev.x, ev.y - 4, 10, 90, 0.45, { g: 240, up: 30 });
        break;
      case 'chokeBurst':
        f.burst('p_smoke', ev.x, ev.y - 4, 26, 110, 0.9, { up: 10 });
        f.burst('p_smokeDark', ev.x, ev.y - 2, 14, 70, 1.1, { up: 6 });
        if (ev.a > 0) f.burst('p_ember', ev.x, ev.y - 4, 12, 100, 0.6, { up: 30 });
        f.shake(3, 140);
        break;
      case 'chokeFire':
        f.particle('p_ember', ev.x + (Math.random() - 0.5) * ev.r, ev.y + (Math.random() - 0.5) * ev.r * 0.8, 0, -30, 0.5, {});
        break;
      case 'chokeEnd':
        f.burst('p_smoke', ev.x, ev.y, 10, 50, 0.7, { up: 10 });
        break;
      case 'carpetDash':
        f.burst('p_dust', ev.x, ev.y, 8, 50, 0.4);
        f.burst('p_ember', ev.x, ev.y - 4, 8, 90, 0.4, { dir: ev.a + Math.PI, spread: 1.2 });
        break;
      case 'carpetTrail':
        f.particle('p_ember', ev.x + (Math.random() - 0.5) * 20, ev.y - 2, 0, 20, 0.4, { depth: ev.y });
        break;
      case 'carpetHit':
        f.burst('p_dust', ev.x, ev.y, 4, 50, 0.3);
        break;
      case 'drinkStart':
        f.burst('p_booze', ev.x + 6, ev.y - 24, 6, 30, 0.6, { up: 20 });
        break;
      case 'brewBurst':
        f.ring(ev.x, ev.y, 8, ev.r, 0xff7a2a, 0.5, 3);
        f.ring(ev.x, ev.y, 4, ev.r * 0.7, 0xf6c257, 0.4, 2);
        f.burst('p_booze', ev.x, ev.y - 10, 40, 180, 0.8, { up: 40, g: 120 });
        f.burst('p_ember', ev.x, ev.y - 6, 30, 160, 0.8, { up: 50 });
        f.flash(0xff9a3c, 0.2, 200);
        f.shake(6, 300);
        break;
      case 'brewPulse':
        if (Math.random() < 0.6) {
          const ang = Math.random() * Math.PI * 2;
          f.particle(Math.random() < 0.5 ? 'p_ember' : 'p_booze', ev.x + Math.cos(ang) * ev.r, ev.y + Math.sin(ang) * ev.r, 0, -40, 0.5, { depth: ev.y + 60 });
        }
        break;
      case 'brewEnd':
        f.burst('p_smoke', ev.x, ev.y, 14, 60, 0.7, { up: 20 });
        break;
      // ---- Jota
      case 'patchCharge':
        f.burst('p_code', ev.x + Math.cos(ev.a) * 8, ev.y - 14, 5, 40, 0.35, { up: 20 });
        break;
      case 'patchBeam':
        f.line(ev.x, ev.y, ev.x + Math.cos(ev.a) * ev.r, ev.y + Math.sin(ev.a) * ev.r, 0x58d6a8, 0.3, 4);
        f.line(ev.x, ev.y, ev.x + Math.cos(ev.a) * ev.r, ev.y + Math.sin(ev.a) * ev.r, 0xe8fff6, 0.2, 1);
        for (let i = 1; i <= 6; i++) f.burst('p_code', ev.x + Math.cos(ev.a) * ev.r * (i / 6.5), ev.y + Math.sin(ev.a) * ev.r * (i / 6.5), 2, 50, 0.4, { dir: ev.a + Math.PI / 2, spread: 3 });
        break;
      case 'patchHit':
        f.burst('p_code', ev.x, ev.y, 8, 100, 0.4, { dir: ev.a, spread: 1.2 });
        f.burst('p_codeDim', ev.x, ev.y, 6, 70, 0.4, { g: 120 });
        break;
      case 'compact':
        f.ring(ev.x, ev.y, 6, ev.r, 0x7dffd0, 0.4, 3);
        f.ring(ev.x, ev.y, 4, ev.r * 0.6, 0xe8fff6, 0.3, 2);
        f.burst('p_code', ev.x, ev.y - 8, 34, 160, 0.6, { up: 30 });
        f.burst('p_codeDim', ev.x, ev.y - 6, 18, 100, 0.6, { g: 80 });
        f.number(ev.x, ev.y - 34, '/COMPACT', 0x7dffd0, true);
        f.flash(0x58d6a8, 0.14, 160);
        f.shake(4, 200);
        break;
      case 'rewindOut':
        f.ring(ev.x, ev.y, 4, ev.r, 0x7dffd0, 0.35, 2);
        f.burst('p_code', ev.x, ev.y - 8, 20, 130, 0.5, { up: 30 });
        f.burst('p_codeDim', ev.x, ev.y - 6, 12, 90, 0.5);
        f.shake(3, 140);
        break;
      case 'rewindIn':
        f.burst('p_code', ev.x, ev.y - 8, 16, 90, 0.5, { up: 40 });
        f.number(ev.x, ev.y - 34, '/rewind', 0x9affe0);
        f.flash(0x7dffd0, 0.12, 140);
        break;
      case 'batStart':
        f.burst('p_cape', ev.x, ev.y - 6, 16, 60, 0.6, { up: 20 });
        f.burst('p_code', ev.x, ev.y - 10, 12, 50, 0.6, { up: 30 });
        break;
      case 'batTransform':
        f.ring(ev.x, ev.y, 6, ev.r * 1.6, 0x8a9cff, 0.55, 3);
        f.ring(ev.x, ev.y, 4, ev.r, 0x7dffd0, 0.4, 2);
        f.burst('p_cape', ev.x, ev.y - 10, 30, 150, 0.9, { up: 40, g: 60 });
        f.burst('p_fearDark', ev.x, ev.y - 6, 18, 90, 1, { up: 20 });
        f.burst('p_code', ev.x, ev.y - 12, 36, 200, 0.8, { up: 40 });
        f.number(ev.x, ev.y - 44, 'MODO BATMAN', 0xb8c4ff, true);
        f.flash(0x8a9cff, 0.3, 320);
        f.shake(6, 320);
        break;
      case 'batEnd':
        f.burst('p_code', ev.x, ev.y - 10, 18, 80, 0.7, { up: 30 });
        f.burst('p_cape', ev.x, ev.y - 8, 10, 50, 0.7, { up: 10 });
        break;
      case 'fearBurst':
        f.burst('p_fear', ev.x, ev.y - 4, 26, 110, 0.9, { up: 10 });
        f.burst('p_fearDark', ev.x, ev.y - 2, 14, 70, 1.1, { up: 6 });
        f.shake(3, 140);
        break;
      case 'fearEnd':
        f.burst('p_fear', ev.x, ev.y, 10, 50, 0.7, { up: 10 });
        break;
      case 'grappleDash':
        f.burst('p_cape', ev.x, ev.y - 6, 8, 80, 0.4, { dir: ev.a + Math.PI, spread: 1.2 });
        break;
      case 'grappleTrail':
        f.particle('p_cape', ev.x + (Math.random() - 0.5) * 14, ev.y - 6, 0, 16, 0.4, { depth: ev.y });
        break;
      case 'grappleHit':
        f.burst('p_dust', ev.x, ev.y, 4, 50, 0.3);
        break;
      case 'checkpoint':
        f.number(ev.x, ev.y - 60, 'CHECKPOINT', 0xffd25a, true);
        f.flash(0xffd25a, 0.18, 300);
        audio.play('ult', ev.x, ev.y);
        break;
      case 'checkpointRestore':
        f.flash(0xff5a3a, 0.35, 500);
        f.shake(5, 400);
        audio.play('revive');
        break;
      case 'summon':
      case 'teleport':
        f.burst('p_abyss', ev.x, ev.y - 8, 10, 50, 0.5, { up: 30 });
        break;
      default:
        break;
    }
  }

  /** Brilho contínuo das zonas (habilidades de área acendem o chão; telegraphs ganham leitura). */
  private zoneGlow(z: ZoneTuple, now: number): void {
    const [, kindIdx, x, y, r, ttl, , extra] = z;
    const kind = ZONE_KINDS[kindIdx];
    const f = this.fx;
    const breathe = 0.85 + Math.sin(now / 160 + x) * 0.15;
    const ring = (c: number, a: number, flat = 1): void => f.aura(x, y, c, r / 56, a * breathe, 'glow_ring', flat);
    const disc = (c: number, a: number, flat = 1): void => f.aura(x, y, c, (r * 2.2) / 64, a * breathe, 'glow_soft', flat);
    switch (kind) {
      case 'glacial': ring(LIGHT.ice, 0.45); disc(LIGHT.ice, 0.2); break;
      case 'polarity': ring(LIGHT.dog, 0.5); disc(LIGHT.dog, 0.16); break;
      case 'bastion': ring(LIGHT.gold, 0.4); break;
      case 'graveHand': ring(LIGHT.necro, 0.4); disc(LIGHT.necro, 0.14); break;
      case 'rupture': {
        const prog = extra > 0 ? 1 - ttl / extra : 0;
        ring(LIGHT.mage, 0.3 + prog * 0.5);
        disc(LIGHT.mageHi, 0.08 + prog * 0.3);
        break;
      }
      case 'rain': ring(LIGHT.hunter, 0.25); break;
      case 'leapLand': ring(LIGHT.berserker, 0.4); break;
      case 'choke': disc(extra ? LIGHT.mayconFlame : 0x3a4050, extra ? 0.22 : 0.12); ring(extra ? LIGHT.mayconFlame : LIGHT.smoke, 0.18); break;
      case 'brew': {
        const fade = Math.min(1, ttl / 20);
        f.aura(x, y, LIGHT.mayconFlame, r / 56, (0.55 + Math.sin(now / 70) * 0.12) * fade, 'glow_ring', 1);
        f.aura(x, y, LIGHT.maycon, (r * 2.1) / 64, 0.2 * fade, 'glow_soft', 1);
        break;
      }
      case 'fear': disc(LIGHT.fear, 0.16); ring(LIGHT.fear, 0.2); break;
      case 'rune':
      case 'eruption':
      case 'nova':
      case 'moonPulse':
      case 'iceSpike':
        ring(kind === 'nova' || kind === 'iceSpike' || kind === 'moonPulse' ? LIGHT.ice : LIGHT.abyss, 0.3);
        break;
      default:
        break;
    }
  }

  ping(x: number, y: number, from: number): void {
    this.pings.push({ x, y, from, until: performance.now() + 4000 });
    audio.play('telegraph', x, y, 0.8);
  }

  /**
   * Converte um ponto da tela lógica (640×360, já corrigido de CSS/letterbox por `App.toLogical`)
   * para o mundo usando a transformação real da câmera (scroll, zoom e viewport).
   */
  screenToWorld(sx: number, sy: number): { x: number; y: number } {
    const p = this.cameras.main.getWorldPoint(sx, sy);
    return { x: p.x, y: p.y };
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
    this.fx.beginFrame();
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
    const aim = this.screenToWorld(this.input2.mouseX, this.input2.mouseY);
    const ax = Math.round(aim.x * 10) / 10;
    const ay = Math.round(aim.y * 10) / 10;
    this.lastAim = { x: ax, y: ay };
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
        { ghost: (k, gx, gy, fl) => this.ghost(k, gx, gy, fl), particle: (k, px, py) => this.fx.particle(k, px, py, (Math.random() - 0.5) * 20, -20 - Math.random() * 20, 0.6, { depth: py + 1 }), aura: (ax, ay, c, sz, al, fr, sy, rot) => this.fx.aura(ax, ay, c, sz, al, fr, sy, rot), glow: (gx, gy, c, sz, o) => this.fx.glow(gx, gy, c, sz, o) },
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
      if (!this.bard) this.bard = pixelOrigin(this.add.image(Math.round(bd[0]), Math.round(bd[1]), ...tf('bard_play_0')), 2);
      const frame = `bard_play_${Math.floor(performance.now() / 180) % 4}`;
      const [tex, fr] = tf(frame);
      if (this.bard.frame.name !== fr) this.bard.setTexture(tex, fr);
      this.bard.setPosition(Math.round(bd[0]), Math.round(bd[1])).setDepth(bd[1]);
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
        shield: src[16],
        shieldDir: src[17] / 100,
        aimPid: src[18] ?? 0,
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
    for (const re of this.renderedEnemies) if (re.atk === 'march' && re.state === 'windup') drawMarchBeams(this.teleG, re, this.renderedEnemies);
    for (const re of this.renderedEnemies) {
      if (re.atk !== 'wound' || re.state !== 'windup' || !re.aimPid) continue;
      const tp = this.players.get(re.aimPid);
      const W = ATK.shadowAcolyte.wound;
      if (tp) drawWoundLink(this.teleG, re, Math.round(tp.x), Math.round(tp.y), re.stateT >= W.windup - W.lockTicks);
    }
    this.drawRipePreview();

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
        img = pixelOrigin(this.add.image(it[2], it[3], ...tf(it[1] === 1 ? `corpse_${it[0] % 3}` : 'pickup_heal_0')));
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
      // Projéteis vivem no plano do chão (colisão) e são desenhados SHOT_HEIGHT acima — mesma
      // convenção usada pelo servidor ao mirar (ver projectileAim).
      let visualY = y - SHOT_HEIGHT;
      if (LOB_KINDS.has(kind) && p1[7] >= 0) {
        // arco apenas visual (a colisão fica no chão): parábola pela fração do voo + sombra
        const k0 = p0 && p0[7] >= 0 ? p0[7] : p1[7];
        const k = Math.max(0, Math.min(1, (k0 + (p1[7] - k0) * t) / 100));
        const peak = kind === 'bigMelon' || kind === 'chokeBomb' ? LAPANHA.ripe.arcHeight : LAPANHA.melon.arcHeight;
        visualY -= Math.round(4 * peak * k * (1 - k));
        let sh = this.lobShadows.get(id);
        if (!sh) {
          sh = this.add.image(x, y, ...tf(kind === 'bigMelon' ? 'shadow_m' : 'shadow_s')).setAlpha(0.7);
          this.lobShadows.set(id, sh);
        }
        sh.setPosition(Math.round(x), Math.round(y)).setDepth(y - 40);
      }
      img.setPosition(Math.round(x), Math.round(visualY)).setDepth(y + 8);
      const halo = projectileGlow(kind);
      if (halo) {
        // halo contínuo + rastro de luz que fica para trás
        this.fx.aura(x, visualY, halo.c, halo.s, 0.75);
        if (Math.random() < 0.5) this.fx.glow(x, visualY, halo.c, halo.s * 0.55, { life: 0.22, grow: 0.4, alpha: 0.6, frame: 'glow_core' });
      }
      if (kind === 'slipper') img.setRotation(performance.now() / 50);
      else if (kind === 'prompt') img.setTexture(...tf(`proj_prompt_${Math.floor(performance.now() / 90) % 2}`)).setRotation(Math.atan2(p1[5], p1[4]));
      else if (kind === 'batarang') img.setTexture(...tf(`proj_batarang_${Math.floor(performance.now() / 90) % 2}`)).setRotation(performance.now() / 45 + id);
      else if (kind === 'bolt' || kind === 'pierceBolt' || kind === 'bone') img.setRotation(Math.atan2(p1[5], p1[4]));
      else if (kind === 'iceShard') {
        img.setTexture(...tf(`proj_iceShard_${Math.floor(performance.now() / 100) % 2}`)).setRotation(Math.atan2(p1[5], p1[4]));
      } else {
        const [tex, fr] = tf(`proj_${kind}_${Math.floor(performance.now() / 100) % 2}`);
        img.setTexture(tex, fr);
      }
      if (Math.random() < 0.35) {
        const trail = kind === 'missile' || kind === 'empMissile' ? 'p_arc' : kind === 'orb' || kind === 'abyssOrb' ? 'p_abyss' : kind === 'pierceBolt' ? 'p_silver' : kind === 'bone' ? 'p_soul' : kind === 'iceShard' ? 'p_frost' : kind === 'prompt' ? 'p_code' : kind === 'batarang' ? 'p_cape' : kind === 'fearBomb' ? 'p_fear' : null;
        if (trail) this.fx.particle(trail, x, visualY, 0, 0, 0.25, { depth: y });
        else if (kind === 'bigMelon' || kind === 'woundBolt') this.fx.particle(kind === 'bigMelon' ? 'p_pulpLight' : 'p_wound', x, visualY, 0, 0, 0.25, { depth: y });
      }
    }
    for (const [id, img] of this.projectiles) {
      if (!seenP.has(id)) {
        img.destroy();
        this.projectiles.delete(id);
      }
    }
    for (const [id, sh] of this.lobShadows) {
      if (!seenP.has(id)) {
        sh.destroy();
        this.lobShadows.delete(id);
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
      if (kind === 'peel' || kind === 'wetFloor') {
        seenT.add(z[0]);
        let img = this.traps.get(z[0]);
        if (!img) {
          img = pixelOrigin(this.add.image(z[2], z[3], ...tf(kind))).setDepth(-7500);
          img.setPosition(Math.round(z[2]), Math.round(z[3]));
          this.traps.set(z[0], img);
        }
        if (kind === 'peel') {
          // brilho curto só quando armada; pisca nos últimos 1,5 s
          const ready = z[7] === 1;
          img.setTexture(...tf(ready && Math.floor(now / 500) % 3 === 0 ? 'peel_ready' : 'peel'));
          img.setAlpha(z[5] < 45 && Math.floor(now / 120) % 2 ? 0.45 : 1);
        } else img.setAlpha(Math.min(1, z[5] / 20) * 0.9);
        continue;
      }
      if (kind === 'rewind') {
        // sombra azul no ponto para onde o Rewind volta (só o dono vê forte; aliados veem de leve)
        seenT.add(z[0]);
        const mine = z[6] === sess.myId;
        let img = this.traps.get(z[0]);
        if (!img) {
          img = this.add.image(z[2], z[3], ...tf('jota_idle_down_0')).setOrigin(0.5, 30 / 32);
          this.traps.set(z[0], img);
        }
        const st = z[7];
        const bob = Math.round(Math.sin(now / 260) * 1.2);
        img.setPosition(Math.round(z[2]), Math.round(z[3]) + bob).setDepth(z[3] - 1);
        img.setTint(st === 2 ? 0x566a84 : 0x7fe8ff).setTintMode(Phaser.TintModes.FILL);
        img.setAlpha(st === 0 ? 0 : (mine ? (st === 2 ? 0.16 : 0.32) : 0.1) * (0.8 + Math.sin(now / 140) * 0.2));
        if (st === 1 && mine) this.fx.aura(z[2], z[3] - 12, LIGHT.jota, 0.4, 0.2 + Math.sin(now / 200) * 0.06, 'glow_ring', 0.7);
        continue;
      }
      drawZone(this.zoneG, z as ZoneTuple, now);
      this.zoneGlow(z as ZoneTuple, now);
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
    this.drawAimDebug(latest, now);
    this.updateDebris(now);
  }

  /** Melancia Madura em carga (jogador local): ponto de impacto, raio previsto e anel da carga. */
  private drawRipePreview(): void {
    const me = this.rendered.find((p) => p.id === this.session.myId);
    if (!me || me.data.c !== 'lapanha' || me.data.s !== 0 || ACTIONS[me.data.act] !== 'charge' || me.data.ch < 0) return;
    const R = LAPANHA.ripe;
    const frac = Math.min(1, me.data.ch / 100);
    const pw = Math.pow(frac, R.curve);
    const radius = Math.round(R.minRadius + (R.maxRadius - R.minRadius) * pw);
    const dx = this.lastAim.x - me.x;
    const dy = this.lastAim.y - me.y;
    const d = Math.hypot(dx, dy);
    const k = d > R.maxRange ? R.maxRange / d : 1;
    const tx = Math.round(me.x + dx * k);
    const ty = Math.round(me.y + dy * k);
    const g = this.teleG;
    const full = frac >= 1;
    const now = performance.now();
    g.fillStyle(0xe04848, 0.06 + frac * 0.08).fillCircle(tx, ty, radius);
    g.lineStyle(full ? 2 : 1, full && Math.floor(now / 120) % 2 ? 0xffffff : 0xff7a6a, 0.9).strokeCircle(tx, ty, radius);
    g.lineStyle(1, 0xfff0e0, 0.8).strokeCircle(tx, ty, R.centerRadius);
    g.fillStyle(0xfff0e0, 1).fillRect(tx - 1, ty - 1, 3, 3);
    // trajetória em arco (pontilhada) até o impacto
    for (let i = 1; i < 12; i++) {
      const t = i / 12;
      const px = Math.round(me.x + (tx - me.x) * t);
      const py = Math.round(me.y + (ty - me.y) * t - SHOT_HEIGHT - 4 * R.arcHeight * t * (1 - t));
      g.fillStyle(0xff9a8a, 0.35 + frac * 0.5).fillRect(px, py, 2, 2);
    }
  }

  /** Sobreposição de depuração da mira (desligada por padrão; F9 alterna). */
  private drawAimDebug(latest: Snapshot, now: number): void {
    const g = this.debugG;
    g.clear();
    if (!this.aimDebug) {
      this.aimDebugText = '';
      return;
    }
    const me = this.rendered.find((p) => p.id === this.session.myId);
    const cur = this.screenToWorld(this.input2.mouseX, this.input2.mouseY);
    const cam = this.cameras.main;
    // cursor no mundo
    g.lineStyle(1, 0x7fc47a, 1).lineBetween(cur.x - 4, cur.y, cur.x + 4, cur.y).lineBetween(cur.x, cur.y - 4, cur.x, cur.y + 4);
    if (me) {
      const ox = me.x;
      const oy = me.y - SHOT_HEIGHT;
      // linha origem (peito) → cursor
      g.lineStyle(1, 0xf6c257, 0.9).lineBetween(ox, oy, cur.x, cur.y);
      // direção efetivamente enviada (último tick), prolongada
      const a = Math.atan2(this.lastAim.y + SHOT_HEIGHT - me.y, this.lastAim.x - me.x);
      g.lineStyle(1, 0xec6a5e, 0.7).lineBetween(ox, oy, ox + Math.cos(a) * 420, oy + Math.sin(a) * 420);
    }
    // trajetória inicial dos meus projéteis (primeira posição vista + velocidade)
    for (const pr of latest.pr) {
      if (pr[6] !== this.session.myId) continue;
      if (!this.shotStarts.has(pr[0])) this.shotStarts.set(pr[0], { x: pr[2], y: pr[3], vx: pr[4], vy: pr[5], at: now });
    }
    for (const [id, st] of this.shotStarts) {
      if (now - st.at > 1500) {
        this.shotStarts.delete(id);
        continue;
      }
      const l = Math.hypot(st.vx, st.vy) || 1;
      g.lineStyle(1, 0x8fd3f0, 0.9).lineBetween(st.x, st.y - SHOT_HEIGHT, st.x + (st.vx / l) * 480, st.y - SHOT_HEIGHT + (st.vy / l) * 480);
    }
    this.aimDebugText = `cam ${cam.scrollX.toFixed(1)},${cam.scrollY.toFixed(1)} zoom ${cam.zoom.toFixed(2)} | tela ${this.input2.mouseX.toFixed(1)},${this.input2.mouseY.toFixed(1)} | mundo ${cur.x.toFixed(1)},${cur.y.toFixed(1)} | enviado ${this.lastAim.x},${this.lastAim.y}`;
  }

  private updateDebris(now: number): void {
    for (let i = this.debris.length - 1; i >= 0; i--) {
      const d = this.debris[i] as { img: Phaser.GameObjects.Image; until: number };
      const left = d.until - now;
      if (left <= 0) {
        d.img.destroy();
        this.debris.splice(i, 1);
      } else if (left < 600) d.img.setAlpha(Math.floor(left / 150) % 2 ? 0.8 : 0.4);
    }
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
    // estado de perigo do objetivo: seguro (linha fina), ameaçado (âmbar, tracejado) e crítico (vermelho, grosso, piscando)
    const danger = (x: number, y: number, r: number, base: number, d: number, n: number): void => {
      if (d >= 2) {
        const blink = Math.floor(now / 160) % 2;
        g.fillStyle(0xc83838, blink ? 0.12 : 0.05).fillCircle(x, y, r);
        g.lineStyle(3, blink ? 0xff5a4a : 0xc83838, 0.95).strokeCircle(x, y, r);
      } else if (d === 1) {
        g.lineStyle(2, 0xf6c257, 0.85);
        const seg = 16;
        for (let i = 0; i < seg; i += 2) {
          const a0 = (i / seg) * Math.PI * 2 + now / 2000;
          g.beginPath();
          g.arc(x, y, r, a0, a0 + Math.PI / seg, false);
          g.strokePath();
        }
      } else g.lineStyle(1, base, pulse).strokeCircle(x, y, r);
      // um pino por inimigo pressionando (até 10), acima do objetivo
      const pins = Math.min(10, n);
      for (let i = 0; i < pins; i++) g.fillStyle(d >= 2 ? 0xff5a4a : 0xf6c257, 1).fillRect(Math.round(x - pins * 2 + i * 4), Math.round(y - r - 6), 3, 3);
    };
    if (ev && ev.k === 'bonfire' && ev.s === 0) {
      danger(cf.x, cf.y, EVENT_RULES.bonfire.radius, 0xe0902a, ev.d ?? 0, ev.n ?? 0);
      bar(cf.x, cf.y - 44, 34, ev.p, (ev.d ?? 0) >= 2 && Math.floor(now / 160) % 2 ? 0xff5a4a : 0xe0902a);
    }
    if (cg && cg.k === 'fireUntouched' && cg.s === 0) {
      g.lineStyle(1, 0xf6c257, pulse * 0.8).strokeCircle(cf.x, cf.y, CHALLENGE_RULES.fire.radius);
    }
    const altarOn = !!cg && cg.k === 'altar' && cg.x !== undefined && cg.y !== undefined;
    if (altarOn && cg && cg.x !== undefined && cg.y !== undefined) {
      if (!this.altar) this.altar = pixelOrigin(this.add.image(cg.x, cg.y, ...tf('altar_0')));
      this.altar.setTexture(...tf(`altar_${Math.floor(now / 400) % 2}`)).setPosition(cg.x, cg.y + 8).setDepth(cg.y + 8).setAlpha(cg.s === 2 ? 0.45 : 1);
      if (cg.s === 0) {
        danger(cg.x, cg.y, CHALLENGE_RULES.altar.radius, 0x7fc47a, cg.d ?? 0, cg.n ?? 0);
        bar(cg.x, cg.y - 26, 26, cg.p, (cg.d ?? 0) >= 2 && Math.floor(now / 160) % 2 ? 0xff5a4a : 0x7fc47a);
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
        if (k === 'glacial' || k === 'bastion' || k === 'rupture' || k === 'polarity' || k === 'eruption' || k === 'rune' || k === 'leapMark' || k === 'spawnWarn' || k === 'graveHand' || k === 'moonPulse' || k === 'nova' || k === 'iceSpike' || k === 'brew')
          light(z[2], z[3], z[4] > 90 ? 112 : z[4] > 55 ? 72 : 48, 0.6);
      }
    }
    for (const p of this.pings) light(p.x, p.y, 48, 0.7);
    // luzes das habilidades (clarões recortam a escuridão e somem suavemente)
    for (const l of this.fx.activeLights()) {
      const rr = l.r <= 30 ? 24 : l.r <= 60 ? 48 : l.r <= 90 ? 72 : l.r <= 130 ? 112 : 160;
      light(l.x, l.y, rr, l.a * Math.min(1, (l.life / l.max) * 1.6));
    }
    rt.render();
    for (const g of this.glows) g.setAlpha((this.enhancedLighting ? 0.3 : 0.18) + Math.sin(now / 80 + g.x) * 0.03);
  }
}
