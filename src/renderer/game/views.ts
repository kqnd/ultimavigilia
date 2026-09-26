/** Representação visual de jogadores, inimigos e servos (sem lógica de jogo). */
import Phaser from 'phaser';
import { CLASS_WEAPON } from '../../art/characters.js';
import { AFFIX_IDS, AFFIXES, type AffixId } from '../../shared/config/affixes.js';
import type { Climate } from '../../shared/config/chapters.js';
import { ATK, ENEMIES, ENEMY_TYPES, type EnemyType } from '../../shared/config/enemies.js';
import { BERSERKER, CLASSES, type ClassId, DOG, HUNTER, MAGE, NECRO, TANK, VAMPIRE } from '../../shared/config/classes.js';
import { EVENT_RULES } from '../../shared/config/objectives.js';
import { ACTIONS, ENEMY_ATTACKS, ENEMY_FLAGS, ENEMY_STATES, MINION_KINDS, MINION_STATES, type MinionTuple, PLAYER_FLAGS, type SnapPlayer } from '../../shared/protocol.js';
import { FONT, frameSheet, placeText, tf } from './textures.js';

export type Facing = 'down' | 'up' | 'side';

export function facingOf(angle: number): { dir: Facing; flip: boolean } {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  if (Math.abs(c) >= 0.62) return { dir: 'side', flip: c < 0 };
  return { dir: s > 0 ? 'down' : 'up', flip: false };
}

function setFrame(img: Phaser.GameObjects.Image, frame: string, fallback?: string): void {
  let f = frame;
  if (!frameSheet.has(f) && fallback) f = fallback;
  const [tex, fr] = tf(f);
  if (img.texture.key !== tex || img.frame.name !== fr) img.setTexture(tex, fr);
}

/** Tempos (ticks) de antecipação/ativo por ação para animar armas. */
function actionTiming(cls: ClassId, act: string): { wu: number; ac: number; arc: number } | null {
  switch (cls) {
    case 'berserker':
      if (act === 'basic1' || act === 'basic2' || act === 'basic3') {
        const c = BERSERKER.combo[Number(act.slice(-1)) - 1] ?? BERSERKER.combo[0];
        return { wu: c.windup, ac: c.active, arc: c.arc };
      }
      if (act === 'q') return { wu: BERSERKER.frenzy.windup, ac: BERSERKER.frenzy.gap, arc: BERSERKER.frenzy.arc };
      return null;
    case 'tank':
      if (act === 'basic1') return { wu: TANK.mace.windup, ac: TANK.mace.active, arc: TANK.mace.arc };
      return null;
    case 'vampire':
      if (act === 'basic1' || act === 'basic2') return { wu: VAMPIRE.claws.windup, ac: VAMPIRE.claws.active, arc: VAMPIRE.claws.arc };
      if (act === 'q') return { wu: VAMPIRE.bite.windup, ac: VAMPIRE.bite.active, arc: VAMPIRE.bite.arc };
      return null;
    case 'hunter':
      if (act === 'basic1') return { wu: HUNTER.bolt.windup, ac: 1, arc: 0 };
      return null;
    case 'mage':
      if (act === 'basic1') return { wu: MAGE.missile.windup, ac: 1, arc: 0 };
      return null;
    case 'dog':
      if (act === 'basic1') return { wu: DOG.shout.windup, ac: 1, arc: 0 };
      return null;
    case 'necromancer':
      if (act === 'basic1') return { wu: NECRO.bone.windup, ac: 1, arc: 0 };
      return null;
  }
}

export interface RenderPlayer {
  data: SnapPlayer;
  x: number;
  y: number;
  /** Ticks decorridos na ação, extrapolados até agora. */
  at: number;
  moving: boolean;
  serverTick: number;
  /** Este jogador está sendo observado pelo local (espectador). */
  watched?: boolean;
}

/** Apelido legível: texto com contorno escuro e fundo translúcido. */
class NameTag {
  readonly text: Phaser.GameObjects.BitmapText;
  readonly shadows: Phaser.GameObjects.BitmapText[];
  constructor(scene: Phaser.Scene, name: string, color: number) {
    this.shadows = [0, 1, 2, 3].map(() => scene.add.bitmapText(0, 0, FONT, name, 11).setTint(0x07070d).setDepth(94001));
    this.text = scene.add.bitmapText(0, 0, FONT, name, 11).setTint(color).setDepth(94002);
  }
  place(x: number, y: number, alpha: number): { w: number; h: number; left: number; top: number } {
    placeText(this.text, x, y, 0.5, 1);
    const offs = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const;
    this.shadows.forEach((s, i) => {
      const o = offs[i] as readonly [number, number];
      s.setPosition(this.text.x + o[0], this.text.y + o[1]).setAlpha(alpha);
    });
    this.text.setAlpha(alpha);
    return { w: this.text.width, h: this.text.height, left: this.text.x, top: this.text.y };
  }
  destroy(): void {
    this.text.destroy();
    for (const s of this.shadows) s.destroy();
  }
}

export class PlayerView {
  readonly shadow: Phaser.GameObjects.Image;
  readonly body: Phaser.GameObjects.Image;
  readonly weapon: Phaser.GameObjects.Image | null;
  readonly shield: Phaser.GameObjects.Image | null;
  private readonly tag: NameTag;
  readonly bars: Phaser.GameObjects.Graphics;
  private readonly back: Phaser.GameObjects.Graphics;
  private readonly aura: Phaser.GameObjects.Graphics | null;
  private walkT = 0;
  private flashT = 0;
  private ghostT = 0;
  private fallT = 0;
  private prevStatus = 0;
  lastHp = -1;
  x = 0;
  y = 0;

  constructor(
    scene: Phaser.Scene,
    readonly id: number,
    readonly cls: ClassId,
    name: string,
    readonly local: boolean,
  ) {
    this.shadow = scene.add.image(0, 0, ...tf('shadow_m')).setOrigin(0.5, 0.5);
    this.body = scene.add.image(0, 0, ...tf(`${cls}_idle_down_0`)).setOrigin(0.5, 30 / 32);
    const w = CLASS_WEAPON[cls];
    this.weapon = w ? scene.add.image(0, 0, ...tf(w)).setOrigin(0.25, 0.5) : null;
    this.shield = cls === 'tank' ? scene.add.image(0, 0, ...tf('shield')).setOrigin(0.5, 0.6) : null;
    this.back = scene.add.graphics().setDepth(94000);
    this.aura = cls === 'tank' ? scene.add.graphics() : null;
    this.tag = new NameTag(scene, name, local ? 0xf6c257 : CLASSES[cls].color);
    this.bars = scene.add.graphics().setDepth(94003);
  }

  hitFlash(): void {
    this.flashT = 0.1;
  }

  destroy(): void {
    this.shadow.destroy();
    this.body.destroy();
    this.weapon?.destroy();
    this.shield?.destroy();
    this.tag.destroy();
    this.back.destroy();
    this.aura?.destroy();
    this.bars.destroy();
  }

  update(r: RenderPlayer, dt: number, fx: { ghost: (key: string, x: number, y: number, flip: boolean) => void; particle: (frame: string, x: number, y: number) => void }, hitstop: boolean): void {
    const d = r.data;
    const s = dt / 1000;
    this.x = r.x;
    this.y = r.y;
    const x = Math.round(r.x);
    const y = Math.round(r.y);
    const aim = d.a / 1000;
    const act = ACTIONS[d.act] ?? 'idle';
    const { dir, flip } = facingOf(act !== 'idle' && d.ad !== 0 ? d.ad / 1000 : aim);
    const cls = this.cls;
    const dodging = r.serverTick - d.dg < CLASSES[cls].dodge.ticks + 1;
    let frame = `${cls}_idle_${dir}_${Math.floor(performance.now() / 500) % 2}`;
    if (!hitstop) this.walkT += s * (r.moving ? 9 : 0);
    // queda animada: 2 quadros de transição (~0,2 s) antes de ficar deitado
    if (d.s !== 0 && this.prevStatus === 0) this.fallT = 0.24;
    this.prevStatus = d.s;
    if (this.fallT > 0) this.fallT -= s;
    const airborne = (d.f & PLAYER_FLAGS.airborne) !== 0;
    if (d.s === 1 || d.s === 2) frame = this.fallT > 0.12 ? `${cls}_fall_0` : this.fallT > 0 ? `${cls}_fall_1` : `${cls}_down`;
    else if (act === 'hurt' || act === 'guardBreak') frame = `${cls}_hurt_${dir}`;
    else if (dodging || airborne) frame = `${cls}_dash_${dir}`;
    else if (act.startsWith('basic')) {
      const t = actionTiming(cls, act);
      frame = `${cls}_atk_${dir}_${t && r.at < t.wu ? 0 : 1}`;
    } else if (act === 'q' && cls === 'berserker') {
      frame = `${cls}_atk_${dir}_${Math.floor(r.at / 3) % 2}`;
    } else if (act === 'q' || act === 'e' || act === 'r' || act === 'cast') {
      const dash = act === 'e' && (cls === 'vampire' || cls === 'hunter');
      frame = dash ? `${cls}_dash_${dir}` : `${cls}_cast_${dir}`;
    } else if (r.moving) frame = `${cls}_walk_${dir}_${Math.floor(this.walkT) % 4}`;
    setFrame(this.body, frame);
    // Salto Brutal: sobe em arco
    let lift = 0;
    if (airborne) lift = Math.round(Math.sin(Math.min(1, r.at / BERSERKER.leap.ticks) * Math.PI) * 22);
    this.body.setFlipX(flip && d.s === 0);
    this.body.setPosition(x, y - lift);
    this.body.setDepth(y);
    this.shadow.setPosition(x, y).setDepth(y - 40).setScale(lift ? Math.max(0.5, 1 - lift / 40) : 1);

    // estados visuais
    let alpha = 1;
    if (d.s === 2) alpha = 0.35;
    else if (d.f & PLAYER_FLAGS.invuln && !airborne) alpha = Math.floor(performance.now() / 50) % 2 ? 0.55 : 0.9;
    if (d.cn === 0) alpha *= 0.5;
    this.body.setAlpha(alpha);
    const now = performance.now();
    if (this.aura) {
      const aura = this.aura;
      aura.clear().setDepth(y - 1);
      if (d.s === 0 && (d.f & PLAYER_FLAGS.blocking)) {
        const stamina = d.st / Math.max(1, d.mst);
        const pulse = Math.floor(now / 120) % 2;
        aura.lineStyle(3, 0x42646a, 0.24).strokeEllipse(x, y - 11, 47, 36);
        aura.lineStyle(1, pulse ? 0x9fe4d8 : 0xb9f5e7, 0.9).strokeEllipse(x, y - 11, 43, 33);
        for (let i = 0; i < 5; i++) {
          const a = now / 700 + i * Math.PI * 2 / 5;
          const sx = Math.round(x + Math.cos(a) * 22);
          const sy = Math.round(y - 11 + Math.sin(a) * 16);
          aura.fillStyle(i % 2 ? 0x72b8b6 : 0xd5fff2, 0.9).fillRect(sx, sy, 3, 3);
        }
        if (stamina < 0.6) for (let i = 0; i < (stamina < 0.25 ? 4 : 2); i++) {
          const a = i * 1.7 + 0.5;
          const sx = x + Math.cos(a) * 21;
          const sy = y - 11 + Math.sin(a) * 16;
          aura.lineStyle(1, 0x25343d, 1).lineBetween(sx - 3, sy - 3, sx + 2, sy + 4);
        }
      }
      if (d.s === 0 && act === 'r') {
        const charge = d.k / 100;
        const grow = Math.min(1, r.at / 16);
        const radius = TANK.bastion.radius * grow;
        aura.lineStyle(2, 0x83c9c2, 0.55).strokeEllipse(x, y, radius * 2, radius * 0.9);
        aura.lineStyle(1, 0xd5fff2, 0.3 + charge * 0.35).strokeEllipse(x, y, radius * 1.8, radius * 0.8);
        for (let i = 0; i < 12; i++) {
          const a = i * Math.PI / 6 + Math.floor(now / 280) * 0.05;
          const sx = Math.round(x + Math.cos(a) * radius);
          const sy = Math.round(y + Math.sin(a) * radius * 0.45);
          aura.fillStyle(i % 3 ? 0x79b7aa : 0xd5fff2, 0.5 + charge * 0.4).fillRect(sx, sy, 3 + Math.round(charge * 2), 2);
        }
        for (let i = 0; i < 2 + Math.floor(charge * 5); i++) {
          const a = now / 900 + i * 2.4;
          aura.fillStyle(0xb8f3de, 0.45 + charge * 0.35).fillRect(Math.round(x + Math.cos(a) * (12 + i * 4)), Math.round(y - 15 + Math.sin(a) * 9), 2, 3);
        }
      }
    }
    if (this.flashT > 0) {
      this.flashT -= s;
      this.body.setTint(0xffffff).setTintMode(Phaser.TintModes.FILL);
    } else if (d.f & PLAYER_FLAGS.madness) {
      this.body.setTint(Math.floor(now / 90) % 2 ? 0xff7a6a : 0xffc0b0).setTintMode(Phaser.TintModes.MULTIPLY);
    } else if (d.f & PLAYER_FLAGS.feast) {
      this.body.setTint(Math.floor(now / 150) % 2 ? 0xff9a9a : 0xffffff).setTintMode(Phaser.TintModes.MULTIPLY);
    } else if (d.f & PLAYER_FLAGS.exhausted) {
      this.body.setTint(0x9a9aaa).setTintMode(Phaser.TintModes.MULTIPLY);
    } else if (d.f & PLAYER_FLAGS.chill) {
      this.body.setTint(0xb8e4ff).setTintMode(Phaser.TintModes.MULTIPLY);
    } else if (d.f & PLAYER_FLAGS.burn) {
      this.body.setTint(Math.floor(now / 120) % 2 ? 0xffc080 : 0xffffff).setTintMode(Phaser.TintModes.MULTIPLY);
    } else this.body.clearTint();
    // partículas de estado
    if (d.s === 0 && Math.random() < s * 8) {
      if (d.f & PLAYER_FLAGS.madness || d.f & PLAYER_FLAGS.rage) fx.particle('p_blood', x + (Math.random() - 0.5) * 12, y - 12 - Math.random() * 10);
      else if (d.f & PLAYER_FLAGS.burn) fx.particle('p_cinder', x + (Math.random() - 0.5) * 10, y - 8);
      else if (d.f & PLAYER_FLAGS.chill) fx.particle('p_frost', x + (Math.random() - 0.5) * 12, y - 10 - Math.random() * 10);
    }

    // rastro fantasma durante esquiva/deslocamentos
    this.ghostT -= s;
    if ((dodging || airborne || (act === 'e' && (cls === 'vampire' || cls === 'hunter' || cls === 'tank') && r.at < 12)) && this.ghostT <= 0 && d.s === 0) {
      this.ghostT = 0.035;
      fx.ghost(this.body.frame.name, x, y - lift, this.body.flipX);
    }

    // arma
    if (this.weapon) {
      const w = this.weapon;
      w.setVisible(d.s === 0);
      let ang = aim;
      let dist = 5;
      const t = actionTiming(cls, act);
      if (t && t.arc > 0) {
        const swingSide = act === 'basic2' || (act === 'q' && Math.floor(r.at / 4) % 2 === 1) ? -1 : 1;
        const half = ((t.arc * Math.PI) / 180) * 0.5;
        const base = d.ad / 1000;
        const at = act === 'q' && cls === 'berserker' ? r.at % 8 : r.at;
        if (at < t.wu) ang = base - swingSide * (half + 0.4) * Math.min(1, at / Math.max(1, t.wu));
        else if (at < t.wu + t.ac + 1) {
          const k = (at - t.wu) / (t.ac + 1);
          ang = base - swingSide * half + swingSide * half * 2 * k;
        } else ang = base + swingSide * half * 0.8;
        dist = 6;
      } else if (t && r.at >= t.wu && r.at < t.wu + 3) dist = 2;
      if ((cls === 'mage' || cls === 'necromancer') && (act === 'q' || act === 'e' || act === 'r' || act === 'cast')) ang = -Math.PI / 2 + (flip ? -0.3 : 0.3);
      if (cls === 'berserker' && act === 'r') ang = -Math.PI / 2;
      const hx = x + Math.cos(ang) * dist;
      const hy = y - lift - 12 + Math.sin(ang) * dist * 0.7;
      w.setPosition(Math.round(hx), Math.round(hy));
      w.setRotation(ang);
      w.setFlipY(Math.cos(ang) < 0);
      const behind = Math.sin(ang) < -0.35;
      w.setDepth(y + (behind ? -1 : 1));
      if (cls === 'mage') w.setTint(d.f & PLAYER_FLAGS.empowered ? (Math.floor(now / 90) % 2 ? 0xffffff : 0xc7c2ff) : 0xffffff);
      else if (cls === 'berserker') w.setTint(d.f & PLAYER_FLAGS.madness && Math.floor(now / 90) % 2 ? 0xff8a7a : 0xffffff);
    }
    if (this.shield) {
      const sh = this.shield;
      sh.setVisible(d.s === 0);
      const blocking = (d.f & PLAYER_FLAGS.blocking) !== 0;
      if (blocking) {
        sh.setPosition(Math.round(x + Math.cos(aim) * 10), Math.round(y - 11 + Math.sin(aim) * 7));
        sh.setDepth(y + (Math.sin(aim) < -0.3 ? -1 : 2));
        sh.setScale(Math.abs(Math.cos(aim)) > 0.7 ? 0.5 : 1, 1);
        sh.setAlpha(1);
      } else if (act === 'e' && r.at < TANK.charge.ticks) {
        sh.setPosition(Math.round(x + Math.cos(aim) * 13), Math.round(y - 11 + Math.sin(aim) * 7));
        sh.setDepth(y + 2).setScale(1.1).setAlpha(1);
      } else if (act === 'r') {
        sh.setPosition(x + 1, y - 1).setDepth(y + 2).setScale(1.1).setAlpha(1);
      } else {
        const side = dir === 'side' ? (flip ? 1 : -1) : -1;
        sh.setPosition(x + side * 8, y - 11);
        sh.setDepth(dir === 'up' ? y + 1 : y - 1);
        sh.setScale(dir === 'side' ? 0.45 : 0.8, 0.8);
      }
    }

    // apelido e barras (sempre visíveis, inclusive o do jogador local, com contorno e fundo)
    const headTop = d.s !== 0 ? y - 16 : (cls === 'dog' ? y - 22 : y - 30) - lift;
    const showBar = !this.local && d.s === 0;
    const nameY = showBar ? headTop - 1 : headTop + 3;
    const g = this.bars;
    const bk = this.back;
    g.clear();
    bk.clear();
    const box = this.tag.place(x, nameY, d.cn ? 1 : 0.5);
    bk.fillStyle(0x07070d, 0.5).fillRect(box.left - 2, box.top + 1, box.w + 4, box.h - 2);
    if (this.local) bk.fillStyle(0xf6c257, 1).fillTriangle(x - 2, box.top - 3, x + 2, box.top - 3, x, box.top - 1);
    if (r.watched) bk.lineStyle(1, 0xf6c257, 1).strokeRect(box.left - 3, box.top, box.w + 6, box.h);
    if (showBar) {
      const w = 18;
      g.fillStyle(0x0b0a12, 1).fillRect(x - w / 2 - 1, headTop + 1, w + 2, 4);
      g.fillStyle(0x6e1424, 1).fillRect(x - w / 2, headTop + 2, w, 2);
      g.fillStyle(0xc83838, 1).fillRect(x - w / 2, headTop + 2, Math.round((w * d.hp) / Math.max(1, d.mhp)), 2);
    }
    // Essência do Necromante: pequenas almas orbitando
    if (cls === 'necromancer' && d.s === 0 && d.k > 0) {
      for (let i = 0; i < d.k; i++) {
        const a = now / 600 + (i / Math.max(1, d.k)) * Math.PI * 2;
        g.fillStyle(i % 2 ? 0xd8f08a : 0xa8d05a, 1).fillRect(Math.round(x + Math.cos(a) * 11), Math.round(y - 12 + Math.sin(a) * 4), 2, 2);
      }
    }
    if (d.s === 1) {
      // caído: anel de reviver + tempo de sangramento
      const prog = d.rv / 100;
      g.lineStyle(3, 0x0b0a12, 1).strokeCircle(x, y - 6, 12);
      g.lineStyle(2, 0x3e5c47, 1).strokeCircle(x, y - 6, 12);
      if (prog > 0) {
        g.lineStyle(2, 0x7fc47a, 1);
        g.beginPath();
        g.arc(x, y - 6, 12, -Math.PI / 2, -Math.PI / 2 + prog * Math.PI * 2, false);
        g.strokePath();
      }
      const bleed = Math.max(0, d.bl / (22 * 30));
      g.fillStyle(0x0b0a12, 1).fillRect(x - 11, y + 8, 22, 3);
      g.fillStyle(0xc83838, 1).fillRect(x - 10, y + 9, Math.round(20 * bleed), 1);
    }
  }
}

// ---------------------------------------------------------------- inimigos

const SHADOW: Record<EnemyType, string> = {
  shambler: 'shadow_m',
  runner: 'shadow_m',
  acolyte: 'shadow_m',
  werewolf: 'shadow_l',
  father: 'shadow_l',
  moonDevourer: 'shadow_xl',
  patriarch: 'shadow_xl',
  frostBride: 'shadow_xl',
  alphaWolf: 'shadow_l',
  highAcolyte: 'shadow_m',
  elderFather: 'shadow_l',
  falseMoon: 'shadow_m',
  abyssTotem: 'shadow_m',
  funeralCart: 'shadow_l',
  ritualist: 'shadow_m',
};

export const isBossType = (t: EnemyType): boolean => ENEMIES[t].tier === 'boss';

export interface RenderEnemy {
  id: number;
  type: EnemyType;
  x: number;
  y: number;
  hp: number;
  mhp: number;
  state: string;
  atk: string;
  stateT: number;
  facing: number;
  tx: number;
  ty: number;
  flags: number;
  affix: AffixId | null;
  marks: number;
  markBy: number;
  moving: boolean;
}

export class EnemyView {
  readonly shadow: Phaser.GameObjects.Image;
  readonly body: Phaser.GameObjects.Image;
  readonly bar: Phaser.GameObjects.Graphics;
  private label: Phaser.GameObjects.BitmapText | null = null;
  private walkT = Math.random() * 4;
  private flashT = 0;
  x = 0;
  y = 0;
  r: RenderEnemy | null = null;
  readonly type: EnemyType;
  /** Prefixo da variante de clima (w_ inverno, a_ cinzas). */
  private readonly prefix: string;

  constructor(
    private readonly scene: Phaser.Scene,
    readonly id: number,
    typeIdx: number,
    climate: Climate,
  ) {
    this.type = ENEMY_TYPES[typeIdx] ?? 'shambler';
    const p = climate === 'winter' ? 'w_' : climate === 'ash' ? 'a_' : '';
    this.prefix = p && frameSheet.has(`${p}${this.type}_walk_down_0`) ? p : '';
    this.shadow = scene.add.image(0, 0, ...tf(SHADOW[this.type])).setOrigin(0.5, 0.5);
    const [tex, fr] = tf(`${this.prefix}${this.type}_walk_down_0`);
    const h = this.scene.textures.getFrame(tex, fr)?.height ?? 32;
    this.body = scene.add.image(0, 0, tex, fr).setOrigin(0.5, (h - 2) / h);
    this.bar = scene.add.graphics().setDepth(93000);
  }

  hitFlash(): void {
    this.flashT = 0.08;
  }

  destroy(): void {
    this.shadow.destroy();
    this.body.destroy();
    this.bar.destroy();
    this.label?.destroy();
  }

  update(r: RenderEnemy, dt: number, myId: number, hitstop: boolean): void {
    this.r = r;
    this.x = r.x;
    this.y = r.y;
    const s = dt / 1000;
    const x = Math.round(r.x);
    const y = Math.round(r.y);
    const def = ENEMIES[this.type];
    const isBoss = isBossType(this.type);
    const objective = !!def.objective;
    const phase2 = (r.flags & ENEMY_FLAGS.phase2) !== 0;
    let key = `${this.prefix}${this.type}`;
    if (phase2 && (this.type === 'moonDevourer' || this.type === 'patriarch' || this.type === 'frostBride')) key = `${this.type}2`;
    const f = facingOf(r.facing);
    let dir: Facing = f.dir;
    if ((this.type === 'patriarch' || this.type === 'frostBride') && dir === 'up') dir = 'down';
    const animated = r.moving || objective;
    let frame = `${key}_walk_${dir}_${Math.floor(this.walkT) % 4}`;
    if (!hitstop && animated) this.walkT += s * (this.type === 'runner' ? 12 : this.type === 'shambler' ? 5 : objective ? 4 : 8);
    let shakeX = 0;
    switch (r.state) {
      case 'spawn':
        if (!isBoss && !objective && this.type !== 'werewolf' && this.type !== 'father' && !def.miniboss) frame = `${key}_rise_${Math.min(2, Math.floor(r.stateT / 6))}`;
        break;
      case 'windup':
      case 'roar':
        if (!objective || this.type === 'ritualist') frame = `${key}_windup_${dir}`;
        shakeX = objective ? 0 : Math.floor(performance.now() / 40) % 2 ? 1 : 0;
        break;
      case 'active':
      case 'recover':
        frame = `${key}_attack_${dir}`;
        break;
      case 'air':
        frame = `${key}_air_side`;
        break;
      case 'stagger':
        frame = `${key}_hurt_${dir}`;
        shakeX = Math.floor(performance.now() / 60) % 2 ? 1 : -1;
        break;
      default:
        break;
    }
    setFrame(this.body, frame, `${key}_walk_${dir}_0`);
    if (!frameSheet.has(this.body.frame.name)) setFrame(this.body, `${key}_walk_side_0`, `${this.type}_walk_down_0`);
    this.body.setFlipX(f.flip);
    let lift = 0;
    if (r.state === 'air') {
      const air = this.type === 'moonDevourer' ? ATK.moonDevourer.leap.airTicks : ATK.werewolf.pounce.airTicks;
      const k = Math.min(1, r.stateT / air);
      lift = Math.sin(k * Math.PI) * (isBoss ? 60 : 24);
    }
    if (this.type === 'frostBride') lift = 4 + Math.round(Math.sin(performance.now() / 400) * 2);
    this.body.setPosition(x + shakeX, y - lift);
    this.body.setDepth(y);
    this.shadow.setPosition(x, y).setDepth(y - 60).setScale(lift > 6 ? Math.max(0.5, 1 - lift / 120) : 1);
    // tintas de estado
    const now = performance.now();
    if (this.flashT > 0) {
      this.flashT -= s;
      this.body.setTint(0xffffff).setTintMode(Phaser.TintModes.FILL);
    } else if (r.state === 'spawn' && (isBoss || def.miniboss || this.type === 'werewolf' || this.type === 'father')) {
      // A silhueta dá lugar ao sprite real antes do cartão cinematográfico.
      if ((isBoss || def.miniboss) && r.stateT >= 12) this.body.clearTint();
      else this.body.setTint(0x5a1470).setTintMode(Phaser.TintModes.FILL);
      this.body.setAlpha(Math.min(1, r.stateT / 20));
    } else if (r.flags & ENEMY_FLAGS.exposed) this.body.setTint(Math.floor(now / 120) % 2 ? 0xffe0a0 : 0xffffff).setTintMode(Phaser.TintModes.MULTIPLY);
    else if (r.flags & ENEMY_FLAGS.rooted) this.body.setTint(0xc0c8d8).setTintMode(Phaser.TintModes.MULTIPLY);
    else if (r.flags & ENEMY_FLAGS.slowed) this.body.setTint(0x9fd8f0).setTintMode(Phaser.TintModes.MULTIPLY);
    else if (r.flags & ENEMY_FLAGS.cursed) this.body.setTint(0xb8d88a).setTintMode(Phaser.TintModes.MULTIPLY);
    else if (r.flags & ENEMY_FLAGS.enraged) this.body.setTint(Math.floor(now / 150) % 2 ? 0xff8080 : 0xffffff).setTintMode(Phaser.TintModes.MULTIPLY);
    else this.body.clearTint();
    if (r.state !== 'spawn') this.body.setAlpha(1);

    const g = this.bar;
    g.clear();
    const top = y - this.body.height + (isBoss ? 0 : 4) - lift;
    // aura de minichefe / afixo (anel pixelado sob os pés)
    const affix = r.affix ? AFFIXES[r.affix] : null;
    if (def.miniboss || affix) {
      const col = affix?.color ?? 0xe07cff;
      const pulse = 0.55 + Math.sin(now / 200) * 0.25;
      g.lineStyle(1, col, pulse).strokeEllipse(x, y, this.body.width * 0.9, 8);
      if (def.miniboss) g.lineStyle(1, 0xe07cff, pulse).strokeEllipse(x, y, this.body.width * 1.1, 11);
    }
    // escudo de chefe (luas/totens de pé)
    if (r.flags & ENEMY_FLAGS.shielded) {
      const a = 0.35 + Math.sin(now / 160) * 0.15;
      g.lineStyle(2, this.type === 'moonDevourer' ? 0x8fd3f0 : 0xe07cff, a).strokeCircle(x, y - this.body.height * 0.45 - lift, this.body.width * 0.45);
    }
    // barra de vida (comuns só quando feridos; elites/objetivos sempre; chefes e minichefes no HUD)
    if (!isBoss && !def.miniboss && r.state !== 'spawn') {
      const elite = def.tier === 'elite';
      if (elite || r.hp < r.mhp) {
        const w = objective ? 28 : elite ? 26 : 16;
        g.fillStyle(0x0b0a12, 1).fillRect(x - w / 2 - 1, top - 1, w + 2, elite ? 4 : 3);
        g.fillStyle(0x440d1a, 1).fillRect(x - w / 2, top, w, elite ? 2 : 1);
        const col = objective ? 0x8fd3f0 : elite ? 0xe0902a : 0xc83838;
        g.fillStyle(col, 1).fillRect(x - w / 2, top, Math.max(1, Math.round((w * r.hp) / r.mhp)), elite ? 2 : 1);
      }
      // marcas do caçador / Ossos do Necromante (só para quem marcou)
      if (r.markBy === myId && r.marks > 0) {
        if (r.marks === 8) g.fillStyle(0xa8d05a, 1).fillRect(x - 3, top - 5, 6, 2).fillRect(x - 1, top - 7, 2, 6);
        else for (let i = 0; i < r.marks; i++) g.fillStyle(0xec6a5e, 1).fillRect(x - r.marks * 2 + i * 4, top - 4, 3, 3);
      }
    }
    // rótulo do afixo / alvo prioritário
    const labelText = r.flags & ENEMY_FLAGS.priority ? '! ALVO !' : affix ? affix.name : '';
    if (labelText && r.state !== 'spawn') {
      if (!this.label) this.label = this.scene.add.bitmapText(0, 0, FONT, labelText, 11).setDepth(93001);
      if (this.label.text !== labelText) this.label.setText(labelText);
      this.label.setTint(r.flags & ENEMY_FLAGS.priority ? 0xf6c257 : (affix?.color ?? 0xffffff)).setVisible(true);
      placeText(this.label, x, top - 3, 0.5, 1);
    } else this.label?.setVisible(false);
    if (r.flags & ENEMY_FLAGS.taunted && !isBoss) {
      g.fillStyle(0xc83838, 1).fillRect(x - 1, y - this.body.height - 6, 2, 4).fillRect(x - 1, y - this.body.height - 1, 2, 1);
    }
    if (r.state === 'stagger') {
      const t = now / 150;
      for (let i = 0; i < 3; i++) {
        const a = t + (i * Math.PI * 2) / 3;
        g.fillStyle(0xf6c257, 1).fillRect(Math.round(x + Math.cos(a) * 7), Math.round(y - this.body.height + Math.sin(a) * 2), 2, 2);
      }
    }
    if (r.flags & ENEMY_FLAGS.rooted) g.lineStyle(1, 0xc0c8d8, 1).strokeEllipse(x, y, this.body.width * 0.7, 6);
  }
}

export const enemyAttackName = (i: number): string => ENEMY_ATTACKS[i] ?? 'none';
export const enemyStateName = (i: number): string => ENEMY_STATES[i] ?? 'move';
export const affixOf = (i: number): AffixId | null => {
  const a = AFFIX_IDS[i];
  return a && a !== 'none' ? a : null;
};

// ---------------------------------------------------------------- servos e sobrevivente

export class MinionView {
  readonly shadow: Phaser.GameObjects.Image;
  readonly body: Phaser.GameObjects.Image;
  readonly bar: Phaser.GameObjects.Graphics;
  readonly range: Phaser.GameObjects.Graphics | null;
  private walkT = Math.random() * 4;
  readonly kind: string;
  x = 0;
  y = 0;

  constructor(scene: Phaser.Scene, readonly id: number, kindIdx: number) {
    this.kind = MINION_KINDS[kindIdx] ?? 'thrall';
    this.shadow = scene.add.image(0, 0, ...tf('shadow_s')).setOrigin(0.5, 0.5);
    this.body = scene.add.image(0, 0, ...tf(`${this.kind}_walk_down_0`)).setOrigin(0.5, 30 / 32);
    this.bar = scene.add.graphics().setDepth(93000);
    this.range = this.kind === 'survivor' ? scene.add.graphics() : null;
  }

  destroy(): void {
    this.shadow.destroy();
    this.body.destroy();
    this.bar.destroy();
    this.range?.destroy();
  }

  update(m: MinionTuple, x: number, y: number, dt: number, moving: boolean): void {
    this.x = x;
    this.y = y;
    const rx = Math.round(x);
    const ry = Math.round(y);
    const state = MINION_STATES[m[6]] ?? 'move';
    const f = facingOf(m[7] / 100);
    if (moving || state === 'rise') this.walkT += (dt / 1000) * 9;
    let frame = `${this.kind}_walk_${f.dir}_${Math.floor(this.walkT) % 4}`;
    if (state === 'rise') frame = `${this.kind}_rise_${Math.min(2, Math.floor(this.walkT / 2) % 3)}`;
    else if (state === 'windup') frame = `${this.kind}_windup_${f.dir}`;
    else if (state === 'attack') frame = `${this.kind}_attack_${f.dir}`;
    setFrame(this.body, frame, `${this.kind}_walk_down_0`);
    this.body.setFlipX(f.flip).setPosition(rx, ry).setDepth(ry);
    this.shadow.setPosition(rx, ry).setDepth(ry - 40);
    if (this.range) {
      const radius = EVENT_RULES.escort.followRadius;
      const color = m[9] > 0 ? 0x7fc47a : 0xf6c257;
      const ring = this.range;
      ring.clear().setDepth(ry - 1);
      ring.lineStyle(1, color, 0.8).beginPath();
      for (let i = 0; i < 48; i++) {
        const start = (i * Math.PI * 2) / 48;
        const end = ((i + 0.58) * Math.PI * 2) / 48;
        ring.moveTo(rx + Math.cos(start) * radius, ry + Math.sin(start) * radius);
        ring.lineTo(rx + Math.cos(end) * radius, ry + Math.sin(end) * radius);
      }
      ring.strokePath();
    }
    // servos quase no fim piscam; exército levemente translúcido
    const life = m[9];
    const now = performance.now();
    if (this.kind !== 'survivor' && life < 20 && Math.floor(now / 100) % 2) this.body.setAlpha(0.5);
    else this.body.setAlpha(this.kind === 'horde' ? 0.92 : 1);
    const g = this.bar;
    g.clear();
    const w = this.kind === 'survivor' ? 22 : 14;
    const top = ry - (this.kind === 'survivor' ? 30 : 20);
    g.fillStyle(0x0b0a12, 1).fillRect(rx - w / 2 - 1, top - 1, w + 2, 3);
    g.fillStyle(this.kind === 'survivor' ? 0x7fc47a : 0xa8d05a, 1).fillRect(rx - w / 2, top, Math.max(1, Math.round((w * m[4]) / Math.max(1, m[5]))), 1);
    if (this.kind === 'thrall') {
      // Barra violeta: duração restante; evita que a expiração pareça uma perda aleatória.
      g.fillStyle(0x0b0a12, 1).fillRect(rx - w / 2 - 1, top + 3, w + 2, 3);
      g.fillStyle(life < 20 ? 0xe09a73 : 0x9474d3, 1).fillRect(rx - w / 2, top + 4, Math.max(1, Math.round(w * life / 100)), 1);
    }
  }
}
