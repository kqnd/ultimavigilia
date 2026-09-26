/** HUD: vida, stamina, recargas, suprema, onda, inimigos, aliados, chefe e indicadores. */
import Phaser from 'phaser';
import { ABILITY_ICONS } from '../../art/icons.js';
import { CHAPTERS } from '../../shared/config/chapters.js';
import { BERSERKER, CLASSES, DOG, NECRO, PLAYER_RULES } from '../../shared/config/classes.js';
import { ATK, ENEMIES, ENEMY_TYPES } from '../../shared/config/enemies.js';
import { CHALLENGES, WAVE_EVENTS, type ChallengeKind, type WaveEventKind } from '../../shared/config/objectives.js';
import { TOTAL_WAVES, WAVES } from '../../shared/config/waves.js';
import { ACTIONS, PLAYER_FLAGS, ENEMY_FLAGS, MINION_KINDS, type ObjectiveInfo } from '../../shared/protocol.js';
import type { Keybinds } from '../../shared/bridge.js';
import type { Session } from '../session.js';
import { keyLabel } from './input.js';
import type { GameScene } from './scene.js';
import { FONT, placeText, tf } from './textures.js';

const DENY_TEXT: Record<string, string> = {
  cd: 'Habilidade em recarga',
  st: 'Stamina insuficiente',
  ult: 'Suprema ainda não carregada',
  range: 'Chegue mais perto do aliado caído',
  busy: 'Ocupado',
  essence: 'Essência insuficiente',
  corpse: 'Nenhum cadáver por perto',
  blocked: 'Sem espaço para isso aqui',
};

const ROMAN = ['', 'I', 'II', 'III'];
const STORM_COLOR = [0, 0xcfd4df, 0xd8f6ff, 0xd0885a];

export class HudScene extends Phaser.Scene {
  game2!: GameScene;
  session!: Session;
  keys!: () => Keybinds;
  showNet = true;
  private g!: Phaser.GameObjects.Graphics;
  private texts = new Map<string, Phaser.GameObjects.BitmapText>();
  private icons = new Map<string, Phaser.GameObjects.Image>();
  private msg = { text: '', until: 0, color: 0xec6a5e };
  private banner = { text: '', sub: '', until: 0, color: 0xf6c257 };
  private lastDeny = 0;

  constructor() {
    super('hud');
  }

  create(): void {
    this.g = this.add.graphics();
  }

  private text(key: string, x: number, y: number, s: string, color = 0xcfd4df, origin: [number, number] = [0, 0], scale = 1): Phaser.GameObjects.BitmapText {
    let t = this.texts.get(key);
    if (!t) {
      t = this.add.bitmapText(0, 0, FONT, '', 11);
      this.texts.set(key, t);
    }
    if (t.text !== s) t.setText(s);
    t.setTint(color).setVisible(true).setScale(scale).setDepth(10);
    placeText(t, x, y, origin[0], origin[1]);
    return t;
  }

  private icon(key: string, frame: string, x: number, y: number, alpha = 1): Phaser.GameObjects.Image {
    let i = this.icons.get(key);
    if (!i) {
      i = this.add.image(0, 0, ...tf(frame)).setOrigin(0, 0);
      this.icons.set(key, i);
    }
    const [tex, fr] = tf(frame);
    if (i.frame.name !== fr) i.setTexture(tex, fr);
    i.setPosition(x, y).setVisible(true).setAlpha(alpha).setDepth(5);
    return i;
  }

  deny(reason: string): void {
    const now = performance.now();
    if (now - this.lastDeny < 450) return;
    this.lastDeny = now;
    this.message(DENY_TEXT[reason] ?? reason, 0xec6a5e, 1100);
  }

  message(text: string, color = 0xcfd4df, ms = 1600): void {
    this.msg = { text, until: performance.now() + ms, color };
  }

  showBanner(text: string, sub: string, color = 0xf6c257, ms = 2600): void {
    this.banner = { text, sub, until: performance.now() + ms, color };
  }

  private bar(x: number, y: number, w: number, h: number, frac: number, fg: number, bg: number, border = 0x0b0a12): void {
    const g = this.g;
    g.fillStyle(border, 1).fillRect(x - 1, y - 1, w + 2, h + 2);
    g.fillStyle(bg, 1).fillRect(x, y, w, h);
    g.fillStyle(fg, 1).fillRect(x, y, Math.max(0, Math.round(w * Math.max(0, Math.min(1, frac)))), h);
    if (h >= 3) g.fillStyle(0xffffff, 0.25).fillRect(x, y, Math.round(w * Math.max(0, Math.min(1, frac))), 1);
  }

  override update(): void {
    for (const t of this.texts.values()) t.setVisible(false);
    for (const i of this.icons.values()) i.setVisible(false);
    const g = this.g;
    g.clear();
    const gs = this.game2;
    const sess = this.session;
    if (!gs || gs.mode !== 'match') return;
    const latest = sess.latest();
    if (!latest) return;
    const me = latest.p.find((p) => p.id === sess.myId);
    const now = performance.now();

    // rede/desempenho
    if (this.showNet) {
      const avg = gs.fpsSamples.reduce((s, v) => s + v, 0) / Math.max(1, gs.fpsSamples.length);
      this.text('net', 4, 3, `${sess.rtt | 0}ms  ${Math.round(1000 / Math.max(1, avg))}fps`, 0x565b70);
    }

    // onda e inimigos
    const w = latest.w;
    const waveDef = WAVES[w.n - 1];
    if (w.ph === 'wave') {
      this.text('wave', 320, 4, `CAP. ${ROMAN[w.ch] ?? w.ch} · ONDA ${w.n}/${TOTAL_WAVES}`, 0xf6c257, [0.5, 0]);
      this.text('wtitle', 320, 15, waveDef?.title ?? '', 0xa3a9bb, [0.5, 0]);
      if (w.tm > 0) this.text('wcount', 320, 60, `${Math.ceil(w.tm / 30)}`, 0xf6c257, [0.5, 0], 3);
      else this.text('left', 320, 26, `Inimigos restantes: ${w.left}`, 0xcfd4df, [0.5, 0]);
    } else if (w.ph === 'intermission') {
      this.text('wave', 320, 4, `INTERVALO — próxima onda em ${Math.ceil(w.tm / 30)}s`, 0x7fc47a, [0.5, 0]);
    } else if (w.ph === 'route') {
      this.text('wave', 320, 4, `ESCOLHA DE ROTA — ${Math.ceil(w.tm / 30)}s`, 0xf6c257, [0.5, 0]);
    }
    // tempestade do clima
    const chapter = CHAPTERS[w.ch - 1];
    if (w.st > 0 && chapter?.storm && (w.ph === 'wave' || w.ph === 'intermission')) {
      const blink = Math.floor(now / 400) % 2 ? 1 : 0.6;
      this.text('storm', 320, w.ph === 'wave' ? 26 : 15, `${chapter.storm.name} — a horda acelera`, STORM_COLOR[w.ch] ?? 0xcfd4df, [0.5, 0]).setAlpha(blink);
      if (w.ph === 'wave' && w.tm <= 0) this.texts.get('left')?.setVisible(false);
    }
    // eventos e desafios (painel à esquerda)
    this.objectivePanel(w.ev, w.cg, w.ph);

    // chefe
    if (w.boss) {
      const b = gs.renderedEnemies.find((e) => e.id === w.boss);
      if (b) {
        const def = ENEMIES[b.type];
        const p2 = (b.flags & ENEMY_FLAGS.phase2) !== 0;
        this.text('bossname', 320, 38, `${def.name}${p2 ? ' — FASE 2' : ''}`, p2 ? 0xe07cff : 0xec6a5e, [0.5, 0]);
        const mini = !!def.miniboss;
        this.bar(mini ? 220 : 170, 50, mini ? 200 : 300, mini ? 4 : 5, b.hp / b.mhp, mini ? 0xe07cff : p2 ? 0x9a2cc0 : 0xc83838, 0x260911);
        if (!mini) g.fillStyle(0xeef1f7, 1).fillRect(320, 49, 1, 7);
        const bo = w.bo;
        if (bo) {
          let line = '';
          let col = 0xa3a9bb;
          if (bo.k === 'moon') {
            if (bo.x > 0) {
              line = `EXPOSTO! +${Math.round((ATK.falseMoon.exposedDamageMul - 1) * 100)}% de dano — ${bo.x}s`;
              col = Math.floor(now / 200) % 2 ? 0xffe0a0 : 0xf6c257;
            } else if (bo.n > 0) {
              line = `Luas Falsas ${bo.n}/${bo.tot}: chefe resiste ${Math.round(Math.min(0.8, bo.n * ATK.falseMoon.damageReductionPerMoon) * 100)}% — quebre as luas`;
              col = 0x8fd3f0;
            }
          } else if (bo.n > 0) {
            line = `Totens ${bo.n}/${bo.tot}: Patriarca protegido — destrua os totens`;
            col = 0xe07cff;
          }
          if (line) this.text('bossobj', 320, 58, line, col, [0.5, 0]);
        }
      }
    }

    // painel do jogador
    if (me) {
      const cls = CLASSES[me.c];
      const x0 = 6;
      const y0 = 318;
      g.fillStyle(0x0b0a12, 0.75).fillRect(x0 - 2, y0 - 4, 132, 42);
      this.icon('portrait', `${me.c}_idle_down_${Math.floor(now / 500) % 2}`, x0 - 2, y0 - 6);
      this.bar(x0 + 32, y0, 94, 6, me.hp / me.mhp, me.hp / me.mhp < 0.3 && Math.floor(now / 250) % 2 ? 0xec6a5e : 0xc83838, 0x440d1a);
      this.text('hp', x0 + 34, y0 - 3, `${me.hp}/${me.mhp}`, 0xffffff);
      this.bar(x0 + 32, y0 + 10, 94, 3, me.st / me.mst, 0x8fbf5a, 0x1f3129);
      const ult = me.u / PLAYER_RULES.ultMax;
      this.bar(x0 + 32, y0 + 17, 94, 4, ult, ult >= 1 ? (Math.floor(now / 200) % 2 ? 0xf6c257 : 0xfff0ae) : 0xa8591a, 0x3e1e08);
      const guardianCasting = me.c === 'tank' && ACTIONS[me.act] === 'r';
      this.text('ultlbl', x0 + 32, y0 + 22, guardianCasting ? `R DETONAR: ${60 + Math.round(me.k * 1.2)} DANO` : ult >= 1 ? `SUPREMA PRONTA [${keyLabel(this.keys().r)}]` : `Suprema ${Math.floor(ult * 100)}%`, guardianCasting || ult >= 1 ? 0xf6c257 : 0x7a8096);
      // passiva
      let passive = '';
      if (me.c === 'vampire' && me.k > 0) passive = `Sede ×${me.k}`;
      if (me.c === 'dog') passive = me.f & PLAYER_FLAGS.resonant ? 'RESSONÂNCIA MÁXIMA' : `Ressonância ${me.k}/${DOG.resonance.max}`;
      if (me.c === 'mage' && me.f & PLAYER_FLAGS.empowered) passive = 'Convergência pronta';
      if (me.c === 'berserker') {
        const mad = (me.f & PLAYER_FLAGS.madness) !== 0;
        const exh = (me.f & PLAYER_FLAGS.exhausted) !== 0;
        passive = mad ? 'LOUCURA!' : exh ? 'Exausto' : `Fúria ${me.k}`;
        const hi = me.k >= BERSERKER.fury.high;
        this.bar(x0 + 60, y0 - 12, 66, 3, me.k / BERSERKER.fury.max, mad ? (Math.floor(now / 120) % 2 ? 0xffffff : 0xc83838) : hi ? 0xec6a5e : 0xd9512c, 0x2e0d0a);
      }
      if (me.c === 'necromancer') {
        passive = 'Essência';
        const max = NECRO.essence.max;
        for (let i = 0; i < max; i++) {
          const on = i < me.k;
          g.fillStyle(0x0b0a12, 1).fillRect(x0 + 44 + i * 7, y0 - 15, 6, 6);
          g.fillStyle(on ? 0xa8d05a : 0x2a3320, 1).fillRect(x0 + 45 + i * 7, y0 - 14, 4, 4);
          if (on) g.fillStyle(0xe8ffc0, 1).fillRect(x0 + 45 + i * 7, y0 - 14, 1, 1);
        }
        const thrall = MINION_KINDS.indexOf('thrall');
        const n = (latest.m ?? []).filter((m) => m[8] === me.id && m[1] === thrall).length;
        this.text('thralls', x0 + 46 + max * 7, y0 - 16, `Servos ${n}/${NECRO.raise.maxActive}`, 0x7a8096);
      }
      if (me.c === 'hunter' && me.f & PLAYER_FLAGS.surrounded) passive = 'CERCADO! +25% dano recebido';
      if (me.c === 'tank') passive = guardianCasting ? 'ÁREA: -12% DANO' : me.f & PLAYER_FLAGS.blocking ? 'Égide 360° erguida' : '';
      if (passive) this.text('passive', x0, y0 - 16, passive, cls.color);

      // barra de habilidades
      const k = this.keys();
      const slots: [string, string, number, number][] = [
        ['LMB', ABILITY_ICONS[me.c]?.[0] ?? 'star', 0, 1],
        [keyLabel(k.q), ABILITY_ICONS[me.c]?.[1] ?? 'star', me.cd[0], me.cm[0]],
        [keyLabel(k.e), ABILITY_ICONS[me.c]?.[2] ?? 'star', me.cd[1], me.cm[1]],
        [keyLabel(k.r), ABILITY_ICONS[me.c]?.[3] ?? 'star', ult >= 1 || guardianCasting ? 0 : 1, 1],
      ];
      const bx = 320 - (slots.length * 22) / 2;
      const by = 327; // ícone (16 px) + rótulo cabem inteiros acima da borda inferior (360)
      slots.forEach(([lbl, ic, cd, cm], i) => {
        const x = bx + i * 22;
        const isUlt = i === 3;
        const ready = cd <= 0;
        this.icon(`slot${i}`, `icon_${ic}`, x, by, ready ? 1 : 0.55);
        if (!ready && !isUlt && cm > 0) {
          const frac = cd / cm;
          g.fillStyle(0x0b0a12, 0.65).fillRect(x + 1, by + 1 + Math.round(14 * (1 - frac)), 14, Math.round(14 * frac));
          this.text(`cd${i}`, x + 8, by + 3, `${Math.ceil(cd / 30)}`, 0xffffff, [0.5, 0]);
        }
        if (isUlt && !ready) {
          g.fillStyle(0x0b0a12, 0.6).fillRect(x + 1, by + 1, 14, Math.round(14 * (1 - ult)));
        }
        if (isUlt && ready) g.lineStyle(1, Math.floor(now / 150) % 2 ? 0xf6c257 : 0xfff0ae, 1).strokeRect(x - 1, by - 1, 18, 18);
        this.text(`key${i}`, x + 8, by + 17, lbl, 0xa3a9bb, [0.5, 0]);
      });
      // passiva (ícone)
      this.icon('slotp', `icon_${ABILITY_ICONS[me.c]?.[4] ?? 'star'}`, bx + slots.length * 22 + 4, by, 0.9);
      this.text('keyp', bx + slots.length * 22 + 12, by + 17, 'pass.', 0x565b70, [0.5, 0]);
      this.text('skillhint', 636, 347, 'F1 HABILIDADES', 0xf6c257, [1, 0]);

      // caído / morto
      if (me.s === 1) {
        this.text('down1', 320, 150, 'VOCÊ CAIU', 0xec6a5e, [0.5, 0], 2);
        this.text('down2', 320, 176, `Um aliado pode te reviver segurando ${keyLabel(k.interact)} — ${Math.ceil(me.bl / 30)}s`, 0xcfd4df, [0.5, 0]);
      } else if (me.s === 2 && w.ph === 'wave') {
        const sp = gs.rendered.find((p) => p.id === gs.spectateId);
        this.text('dead1', 320, 70, 'Você volta na próxima onda se a equipe sobreviver', 0xa3a9bb, [0.5, 0]);
        if (sp) this.text('dead2', 320, 82, `Observando: ${sess.nameOf(sp.id)} (clique para trocar)`, 0xf6c257, [0.5, 0]);
      }
      // prompt de reviver
      if (me.s === 0) {
        const mx = gs.rendered.find((p) => p.id === sess.myId);
        const downed = gs.rendered.find((p) => p.data.s === 1 && mx && Math.hypot(p.x - mx.x, p.y - mx.y) < PLAYER_RULES.reviveRange + 20);
        if (downed) {
          const reviving = (me.f & PLAYER_FLAGS.reviving) !== 0;
          this.text('revive', 320, 230, reviving ? `Revivendo ${sess.nameOf(downed.id)}… ${downed.data.rv}%` : `Segure ${keyLabel(k.interact)} para reviver ${sess.nameOf(downed.id)}`, 0x7fc47a, [0.5, 0]);
        }
      }
    }

    // aliados (lista à direita)
    let ay = 6;
    for (const p of latest.p) {
      if (p.id === sess.myId) continue;
      const cls = CLASSES[p.c];
      const x = 544;
      g.fillStyle(0x0b0a12, 0.7).fillRect(x - 2, ay - 1, 94, 22);
      this.icon(`ally${p.id}`, `icon_${ABILITY_ICONS[p.c]?.[0] ?? 'star'}`, x, ay + 2, p.s === 0 ? 1 : 0.4);
      const status = p.cn === 0 ? 'desconectado' : p.s === 1 ? 'CAÍDO' : p.s === 2 ? 'morto' : '';
      this.text(`an${p.id}`, x + 19, ay, sess.nameOf(p.id), status ? 0x7a8096 : cls.color);
      if (status) this.text(`as${p.id}`, x + 19, ay + 10, status, p.s === 1 ? 0xec6a5e : 0x7a8096);
      else {
        this.bar(x + 19, ay + 11, 70, 3, p.hp / p.mhp, 0xc83838, 0x440d1a);
        this.bar(x + 19, ay + 16, 70, 1, p.u / 100, 0xe0902a, 0x3e1e08);
      }
      ay += 24;
    }

    // indicadores fora da tela (aliados, pings, inimigos enfurecidos)
    const cam = gs.cameras.main;
    const edge = (wx: number, wy: number, color: number, key: string, label?: string): void => {
      const sx = wx - cam.scrollX;
      const sy = wy - cam.scrollY;
      if (sx >= 0 && sx <= 640 && sy >= 0 && sy <= 360) return;
      const cx = 320;
      const cy = 180;
      const a = Math.atan2(sy - cy, sx - cx);
      const m = Math.min(Math.abs((300 - 8) / Math.cos(a)), Math.abs((160 - 8) / Math.sin(a)));
      const ex = cx + Math.cos(a) * m;
      const ey = cy + Math.sin(a) * m;
      const img = this.icon(`edge${key}`, 'arrow', ex, ey);
      img.setOrigin(0.5, 0.5).setRotation(a).setTint(color);
      if (label) this.text(`edgel${key}`, ex - Math.cos(a) * 14, ey - Math.sin(a) * 12, label, color, [0.5, 0.5]);
    };
    for (const p of gs.rendered) if (p.id !== sess.myId) edge(p.x, p.y - 10, p.data.s === 1 ? 0xec6a5e : CLASSES[p.cls].color, `p${p.id}`, `${Math.round(Math.hypot(p.x - cam.scrollX - 320, p.y - cam.scrollY - 180) / 32)}m`);
    const survivor = gs.survivorPosition();
    if (survivor && w.ph === 'wave') {
      const sx = survivor.x - cam.scrollX;
      const sy = survivor.y - cam.scrollY;
      edge(survivor.x, survivor.y - 12, 0x7fc47a, 'survivor', 'SOBREV.');
      if (sx >= 12 && sx <= 628 && sy >= 8 && sy <= 352) {
        // A posição depende apenas do sobrevivente na tela, nunca do lado onde
        // o jogador está. Só vira para baixo quando falta espaço no topo.
        const below = sy < 62;
        const pinY = below ? sy + 14 : sy - 43;
        const labelY = below ? sy + 28 : sy - 59;
        this.icon('survivorPin', 'ping', sx - 6, pinY).setTint(0x7fc47a);
        this.text('survivorLabel', sx, labelY, 'SOBREVIVENTE', 0x7fc47a, [0.5, 0]);
      }
    }
    gs.pings.forEach((p, i) => edge(p.x, p.y, 0xf6c257, `ping${i}`));
    for (const e of gs.renderedEnemies) if (e.flags & ENEMY_FLAGS.enraged) edge(e.x, e.y, 0xc83838, `en${e.id}`);
    for (const p of gs.pings) {
      const sx = p.x - cam.scrollX;
      const sy = p.y - cam.scrollY;
      if (sx >= 0 && sx <= 640 && sy >= 0 && sy <= 360) this.icon(`pingi${p.x}${p.y}`, 'ping', sx - 6, sy - 18);
    }

    // mensagens
    if (now < this.msg.until) this.text('msg', 320, 290, this.msg.text, this.msg.color, [0.5, 0]);
    if (now < this.banner.until) {
      const k = (this.banner.until - now) / 400;
      const a = Math.min(1, k);
      this.text('banner', 320, 110, this.banner.text, this.banner.color, [0.5, 0.5], 3).setAlpha(a);
      if (this.banner.sub) this.text('bsub', 320, 132, this.banner.sub, 0xcfd4df, [0.5, 0.5]).setAlpha(a);
    }
    if (sess.paused) this.text('paused', 320, 170, 'PAUSADO', 0xf6c257, [0.5, 0.5], 2);
    void ENEMY_TYPES;
  }

  /** Evento da onda e desafio opcional (mesmo estilo dos painéis de aliados). */
  private objectivePanel(ev: ObjectiveInfo | null, cg: ObjectiveInfo | null, ph: string): void {
    if (ph !== 'wave') return;
    const g = this.g;
    const x = 4;
    let y = 19;
    const W = 176;
    const now = performance.now();
    const status = (o: ObjectiveInfo): [string, number] | null => (o.s === 1 ? ['CONCLUÍDO', 0x7fc47a] : o.s === 2 ? ['FALHOU', 0xec6a5e] : null);
    const secs = (t: number): string => `${Math.max(0, Math.ceil(t / 30))}s`;
    if (ev) {
      const def = WAVE_EVENTS[ev.k as WaveEventKind];
      if (def) {
        const st = status(ev);
        g.fillStyle(0x0b0a12, 0.75).fillRect(x - 2, y - 1, W, st ? 22 : 30);
        this.text('evname', x + 1, y, `EVENTO: ${def.name}`, 0xf6c257);
        if (st) this.text('evst', x + 1, y + 10, st[0], st[1]);
        else {
          const info = ev.k === 'ritual' ? `${def.goal} — ${secs(ev.t)}` : def.goal;
          this.text('evgoal', x + 1, y + 10, info, 0xa3a9bb);
          if (ev.p >= 0) {
            const col = ev.k === 'ritual' ? 0xe07cff : ev.k === 'cart' ? 0xe0902a : ev.p < 30 && Math.floor(now / 250) % 2 ? 0xec6a5e : 0x7fc47a;
            this.bar(x + 1, y + 22, W - 6, 2, ev.p / 100, col, 0x1f1a24);
          }
        }
        y += (st ? 22 : 30) + 3;
      }
    }
    if (cg) {
      const def = CHALLENGES[cg.k as ChallengeKind];
      if (def) {
        const st = status(cg);
        g.fillStyle(0x0b0a12, 0.75).fillRect(x - 2, y - 1, W, cg.p >= 0 && !st ? 30 : 22);
        this.text('cgname', x + 1, y, `DESAFIO: ${def.name}`, 0x8fd3f0);
        const tail = cg.k === 'speed' || cg.k === 'elite' ? ` — ${secs(cg.t)}` : '';
        if (st) this.text('cgst', x + 1, y + 10, st[1] === 0x7fc47a ? `${st[0]}: ${def.rewardText}` : st[0], st[1]);
        else this.text('cgrw', x + 1, y + 10, `Opcional: ${def.rewardText}${tail}`, 0x7a8096);
        if (cg.p >= 0 && !st) this.bar(x + 1, y + 22, W - 6, 2, cg.p / 100, cg.k === 'altar' ? 0x7fc47a : 0x8fd3f0, 0x1f1a24);
      }
    }
  }
}
