/** HUD: vida, stamina, recargas, suprema, onda, inimigos, aliados, chefe e indicadores. */
import Phaser from 'phaser';
import { ABILITY_ICONS, BAT_ABILITY_ICONS } from '../../art/icons.js';
import { CHAPTERS } from '../../shared/config/chapters.js';
import { BERSERKER, CLASSES, DOG, JOTA, LAPANHA, MAYCON, NECRO, PLAYER_RULES, ripeCostFrac, ripePower, TANK } from '../../shared/config/classes.js';
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

type BannerKind = 'info' | 'wave' | 'boss' | 'mini' | 'checkpoint' | 'restore';

const DIM_COLORS = new Set([0x565b70, 0x7a8096, 0xa3a9bb]);

const ROMAN = ['', 'I', 'II', 'III'];
const STORM_COLOR = [0, 0xcfd4df, 0xd8f6ff, 0xd0885a];

export class HudScene extends Phaser.Scene {
  game2!: GameScene;
  session!: Session;
  keys!: () => Keybinds;
  showNet = true;
  private g!: Phaser.GameObjects.Graphics;
  /** Camada acima dos ícones (recarga radial, pulsos, bordas de estado). */
  private gTop!: Phaser.GameObjects.Graphics;
  private texts = new Map<string, Phaser.GameObjects.BitmapText>();
  private icons = new Map<string, Phaser.GameObjects.Image>();
  private msg = { text: '', until: 0, color: 0xec6a5e };
  private banner: { text: string; sub: string; start: number; until: number; color: number; kind: BannerKind } = { text: '', sub: '', start: 0, until: 0, color: 0xf6c257, kind: 'info' };
  private lastDeny = 0;
  /** Acessibilidade (ligada pelo app a partir das configurações). */
  highContrast = false;
  reduceMotion = false;
  /** Dicas contextuais: ids já vistos e callback para persistir. */
  hintsOn = true;
  hintsSeen = new Set<string>();
  onHintSeen: ((id: string) => void) | null = null;
  private hintQueue: { id: string; text: string }[] = [];
  private hintCur: { id: string; text: string; start: number; until: number } | null = null;
  private hintGapUntil = 0;
  private hintsShown = 0;
  /** Estado por ícone de habilidade: pronto no quadro anterior e instante em que ficou pronto. */
  private slotReady: boolean[] = [];
  private slotPulse: number[] = [];
  private denyFlash = { at: 0, reason: '' };
  /** Vida "fantasma" (perda recente) e instante do último ganho de vida. */
  private hpLag = -1;
  private hpLagHold = 0;
  private hpPrev = -1;
  private hpGainAt = 0;

  constructor() {
    super('hud');
  }

  create(): void {
    this.g = this.add.graphics();
    this.gTop = this.add.graphics().setDepth(6);
  }

  private text(key: string, x: number, y: number, s: string, color = 0xcfd4df, origin: [number, number] = [0, 0], scale = 1): Phaser.GameObjects.BitmapText {
    let t = this.texts.get(key);
    if (!t) {
      t = this.add.bitmapText(0, 0, FONT, '', 11);
      this.texts.set(key, t);
    }
    if (t.text !== s) t.setText(s);
    if (this.highContrast && DIM_COLORS.has(color)) color = 0xe6e9f2;
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

  /** Opacidade de painéis: sólidos no alto contraste. */
  private pa(a: number): number {
    return this.highContrast ? 1 : a;
  }

  /** Pisca (alternância temporizada) ou fica fixo quando o movimento está reduzido. */
  private blinkOn(now: number, period: number): boolean {
    return this.reduceMotion ? true : Math.floor(now / period) % 2 === 1;
  }

  /** Enfileira uma dica contextual (uma vez por id; desligável nas configurações). */
  hint(id: string, text: string): void {
    if (!this.hintsOn || this.hintsSeen.has(id) || this.hintCur?.id === id || this.hintQueue.some((h) => h.id === id)) return;
    this.hintQueue.push({ id, text });
  }

  deny(reason: string): void {
    const now = performance.now();
    this.denyFlash = { at: now, reason };
    if (now - this.lastDeny < 450) return;
    this.lastDeny = now;
    this.message(DENY_TEXT[reason] ?? reason, 0xec6a5e, 1100);
  }

  message(text: string, color = 0xcfd4df, ms = 1600): void {
    this.msg = { text, until: performance.now() + ms, color };
  }

  showBanner(text: string, sub: string, color = 0xf6c257, ms = 2600, kind: BannerKind = 'info'): void {
    const now = performance.now();
    const next = { text, sub, start: now, until: now + ms, color, kind };
    const sticky = (k: BannerKind): boolean => k === 'checkpoint' || k === 'restore';
    // avisos de checkpoint nunca são atropelados (nem atropelam) outro aviso ativo: entram em fila
    if (now < this.banner.until && (sticky(kind) || sticky(this.banner.kind))) {
      this.bannerNext = { ...next, ms };
      return;
    }
    this.banner = next;
  }
  private bannerNext: (typeof this.banner & { ms: number }) | null = null;

  private bar(x: number, y: number, w: number, h: number, frac: number, fg: number, bg: number, border = 0x0b0a12): void {
    const g = this.g;
    if (this.highContrast) border = 0xffffff;
    g.fillStyle(border, 1).fillRect(x - 1, y - 1, w + 2, h + 2);
    g.fillStyle(bg, 1).fillRect(x, y, w, h);
    g.fillStyle(fg, 1).fillRect(x, y, Math.max(0, Math.round(w * Math.max(0, Math.min(1, frac)))), h);
    if (h >= 3) g.fillStyle(0xffffff, 0.25).fillRect(x, y, Math.round(w * Math.max(0, Math.min(1, frac))), 1);
  }

  /** Setor quadrado (estilo recarga de MOBA): cobre a fração `remaining` restante, no sentido horário a partir do topo. */
  private sweep(g: Phaser.GameObjects.Graphics, cx: number, cy: number, hs: number, remaining: number, alpha: number): void {
    const f = Math.max(0, Math.min(1, remaining));
    if (f <= 0) return;
    const a0 = -Math.PI / 2 + Math.PI * 2 * (1 - f);
    const steps = Math.max(2, Math.ceil(f * 40));
    const pts: Phaser.Math.Vector2[] = [new Phaser.Math.Vector2(cx, cy)];
    for (let i = 0; i <= steps; i++) {
      const a = a0 + ((Math.PI * 2 * f) * i) / steps;
      const c = Math.cos(a);
      const s = Math.sin(a);
      const r = hs / Math.max(Math.abs(c), Math.abs(s));
      pts.push(new Phaser.Math.Vector2(Math.round(cx + c * r), Math.round(cy + s * r)));
    }
    g.fillStyle(0x0b0a12, alpha).fillPoints(pts, true, true);
  }

  override update(): void {
    for (const t of this.texts.values()) t.setVisible(false);
    for (const i of this.icons.values()) i.setVisible(false);
    const g = this.g;
    g.clear();
    this.gTop.clear();
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
    if (gs.aimDebugText) this.text('aimdbg', 4, 348, gs.aimDebugText, 0x8fd3f0);

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
      const blink = this.blinkOn(now, 400) ? 1 : 0.6;
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
              col = this.blinkOn(now, 200) ? 0xffe0a0 : 0xf6c257;
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
      g.fillStyle(0x0b0a12, this.pa(0.75)).fillRect(x0 - 2, y0 - 4, 132, 42);
      this.icon('portrait', `${me.c}_idle_down_${Math.floor(now / 500) % 2}`, x0 - 2, y0 - 6);
      // vida: faixa clara mostra a perda recente; flash verde ao curar; abaixo de 30% pisca e ganha rótulo
      if (this.hpPrev < 0 || me.hp > this.hpPrev) {
        if (this.hpPrev >= 0) this.hpGainAt = now;
        this.hpLag = Math.max(this.hpLag, me.hp);
        if (this.hpPrev < 0) this.hpLag = me.hp;
      } else if (me.hp < this.hpPrev) this.hpLagHold = now + 380;
      this.hpPrev = me.hp;
      if (this.hpLag > me.hp && now > this.hpLagHold) this.hpLag = Math.max(me.hp, this.hpLag - Math.max(0.4, (this.hpLag - me.hp) * 0.08));
      else if (this.hpLag < me.hp) this.hpLag = me.hp;
      const hpLow = me.hp / me.mhp < 0.3;
      this.bar(x0 + 32, y0, 94, 6, me.hp / me.mhp, hpLow && this.blinkOn(now, 250) ? 0xec6a5e : 0xc83838, 0x440d1a);
      if (this.hpLag > me.hp) {
        const a = Math.round((94 * me.hp) / me.mhp);
        const b = Math.round((94 * Math.min(me.mhp, this.hpLag)) / me.mhp);
        g.fillStyle(0xf2d2c8, 0.5).fillRect(x0 + 32 + a, y0, Math.max(0, b - a), 6);
      }
      if (now - this.hpGainAt < 260) g.fillStyle(0x9af08a, 0.55 * (1 - (now - this.hpGainAt) / 260)).fillRect(x0 + 32, y0, 94, 6);
      if (hpLow) g.lineStyle(1, this.blinkOn(now, 250) ? 0xffffff : 0xec6a5e, 1).strokeRect(x0 + 31, y0 - 1, 96, 8);
      // escudo temporário por cima da vida
      if (me.sh > 0) g.fillStyle(0xbfe3ff, 0.85).fillRect(x0 + 32, y0 + 5, Math.min(94, Math.round((94 * me.sh) / me.mhp)), 1);
      // Lapanha: prévia do sacrifício da Melancia Madura (parte da vida que será consumida)
      const charging = me.c === 'lapanha' && ACTIONS[me.act] === 'charge' && me.ch >= 0;
      if (charging) {
        const frac = Math.min(1, me.ch / 100);
        const mul = me.f & PLAYER_FLAGS.harvest ? LAPANHA.harvest.costMul : 1;
        const cost = Math.min(Math.max(0, me.hp - 1), me.mhp * ripeCostFrac(frac) * mul);
        const x1 = x0 + 32 + Math.round((94 * (me.hp - cost)) / me.mhp);
        const x2 = x0 + 32 + Math.round((94 * me.hp) / me.mhp);
        g.fillStyle(this.blinkOn(now, 120) ? 0xffffff : 0xff9a8a, 1).fillRect(x1, y0, Math.max(1, x2 - x1), 6);
        const R = LAPANHA.ripe;
        const dmg = Math.round(R.minDamage + (R.maxDamage - R.minDamage) * ripePower(frac));
        this.text('qprev', x0 + 32, y0 - 26, `Q: -${Math.round(cost)} vida · ${dmg} dano${frac >= 1 ? ' · MÁXIMA' : ''}`, frac >= 1 ? 0xffffff : 0xff9a8a);
      }
      this.text('hp', x0 + 34, y0 - 3, `${me.hp}/${me.mhp}`, 0xffffff);
      // stamina (logo abaixo da vida)
      const stLow = me.st / me.mst < 0.2;
      const stDenied = this.denyFlash.reason === 'st' && now - this.denyFlash.at < 400;
      this.bar(x0 + 32, y0 + 10, 94, 3, me.st / me.mst, stLow || stDenied ? 0xec6a5e : 0x8fbf5a, 0x1f3129);
      if (stDenied && this.blinkOn(now, 100)) g.lineStyle(1, 0xffffff, 1).strokeRect(x0 + 31, y0 + 9, 96, 5);
      // estados (empilhados para cima, ao lado do painel): Ferida Profana, atordoado, resistência, Safra
      const sx = x0 + 132;
      let sy = y0 + 18;
      if (me.f & PLAYER_FLAGS.wounded) {
        const blockAll = (me.f & PLAYER_FLAGS.woundBlock) !== 0;
        const W = ATK.shadowAcolyte.wound;
        g.fillStyle(0x0b0a12, this.pa(0.8)).fillRect(sx - 1, sy - 1, 122, 20);
        if (blockAll) g.lineStyle(1, this.blinkOn(now, 100) ? 0xffffff : 0x9a4acb, 1).strokeRect(sx - 1, sy - 1, 122, 20);
        this.icon('st_wound', 'icon_wound', sx, sy, 1);
        this.text('st_wound_t', sx + 16, sy - 1, blockAll ? 'CURA BLOQUEADA' : `Cura -${Math.round(W.reduction * 100)}%`, blockAll ? 0xffffff : 0xc79aff);
        this.bar(sx + 16, sy + 12, 102, 2, me.wd / (W.duration * 10), blockAll ? 0xffffff : 0x9a4acb, 0x1a0d24);
        this.text('st_wound_s', sx + 118, sy - 1, `${(me.wd / 10).toFixed(1)}s`, 0xa3a9bb, [1, 0]);
        sy -= 22;
      }
      if (me.f & PLAYER_FLAGS.stunned) {
        g.fillStyle(0x0b0a12, this.pa(0.8)).fillRect(sx - 1, sy - 1, 76, 18);
        this.icon('st_stun', 'icon_stun', sx, sy, 1);
        this.text('st_stun_t', sx + 16, sy + 1, 'ATORDOADO', 0xf6c257);
        sy -= 20;
      } else if (me.f & PLAYER_FLAGS.stunResist) {
        this.text('st_res', sx, sy + 6, 'Resistente a atordoar', 0xa3a9bb);
        sy -= 12;
      }
      if (me.f & PLAYER_FLAGS.harvest) {
        const reduced = (me.f & PLAYER_FLAGS.wounded) !== 0;
        this.text('st_harv', sx, sy + 6, reduced ? 'Safra: regeneração REDUZIDA' : 'Safra Abençoada: regenerando', reduced ? 0xc79aff : 0x7fc47a);
      }
      const ult = me.u / PLAYER_RULES.ultMax;
      if (me.c === 'lapanha') {
        // Polpa: fatia de melancia (casca verde, polpa vermelha e sementes); pronta pisca em branco
        this.bar(x0 + 32, y0 + 17, 94, 4, ult, ult >= 1 ? (this.blinkOn(now, 200) ? 0xff7a6a : 0xfff0e0) : 0xd84a4a, 0x24602a, 0x3f9a3a);
        const fill = Math.round(94 * Math.min(1, ult));
        for (let i = 6; i < fill; i += 12) g.fillStyle(0x1a0d0d, 1).fillRect(x0 + 32 + i, y0 + 18 + ((i / 12) % 2), 1, 2);
      } else this.bar(x0 + 32, y0 + 17, 94, 4, ult, ult >= 1 ? (this.blinkOn(now, 200) ? 0xf6c257 : 0xfff0ae) : 0xa8591a, 0x3e1e08);
      const guardianCasting = me.c === 'tank' && ACTIONS[me.act] === 'r';
      this.text('ultlbl', x0 + 32, y0 + 22, guardianCasting ? `R DETONAR: ${TANK.bastion.baseDamage + Math.round((me.k * TANK.bastion.bonusCap) / 100)} DANO` : me.ul > 0 ? `Suprema selada ${me.ul}s` : ult >= 1 ? `${cls.ultName ? cls.ultName.toUpperCase() + ' CHEIA' : 'SUPREMA PRONTA'} [${keyLabel(this.keys().r)}]` : `${cls.ultName ?? 'Suprema'} ${Math.floor(ult * 100)}%`, guardianCasting || ult >= 1 ? 0xf6c257 : 0x7a8096);
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
        this.bar(x0 + 60, y0 - 12, 66, 3, me.k / BERSERKER.fury.max, mad ? (this.blinkOn(now, 120) ? 0xffffff : 0xc83838) : hi ? 0xec6a5e : 0xd9512c, 0x2e0d0a);
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
      if (me.c === 'lapanha') passive = me.f & PLAYER_FLAGS.harvest ? 'SAFRA ABENÇOADA' : 'Coração Maduro';
      if (me.c === 'hunter' && me.f & PLAYER_FLAGS.surrounded) passive = 'CERCADO! +25% dano recebido';
      if (me.c === 'tank') passive = guardianCasting ? `MURALHA: -${TANK.bastion.selfReduction * 100}% / ALIADOS -${TANK.bastion.reduction * 100}%` : me.f & PLAYER_FLAGS.blocking ? 'Égide 360° erguida' : '';
      if (me.c === 'maycon') passive = me.f & PLAYER_FLAGS.brewing ? 'RODADA DA CASA!' : me.k > 0 ? `Visão Sombria: ${me.k} marcado${me.k > 1 ? 's' : ''} (+${Math.round((MAYCON.darkSight.damageMul - 1) * 100)}%)` : 'Visão Sombria';
      if (me.c === 'jota') {
        // Contexto (barra verde-água que estoura em /compact) ou, no Modo Batman, o tempo restante
        const isBat = (me.f & PLAYER_FLAGS.batman) !== 0;
        const hot = (me.f & PLAYER_FLAGS.compact) !== 0;
        passive = isBat ? 'MODO BATMAN' : hot ? 'COMPACTADO! +dano +ataque' : `Contexto ${me.k}%`;
        const frac = isBat ? me.ch / 100 : me.k / JOTA.context.max;
        this.bar(x0 + 60, y0 - 12, 66, 3, frac, isBat ? 0x8a9cff : hot ? (Math.floor(now / 120) % 2 ? 0xffffff : 0x7dffd0) : me.k >= 80 ? 0x9affe0 : 0x58d6a8, isBat ? 0x151a38 : 0x0f2a22);
      }
      if (passive) this.text('passive', x0, y0 - 16, passive, me.c === 'jota' && me.f & PLAYER_FLAGS.batman ? 0xb8c4ff : cls.color);

      // barra de habilidades
      const k = this.keys();
      const icons: readonly string[] | undefined = me.c === 'jota' && me.f & PLAYER_FLAGS.batman ? BAT_ABILITY_ICONS : ABILITY_ICONS[me.c];
      const slots: [string, string, number, number][] = [
        ['LMB', icons?.[0] ?? 'star', 0, 1],
        [keyLabel(k.q), icons?.[1] ?? 'star', me.cd[0], me.cm[0]],
        [keyLabel(k.e), icons?.[2] ?? 'star', me.cd[1], me.cm[1]],
        [keyLabel(k.r), icons?.[3] ?? 'star', ult >= 1 || guardianCasting ? 0 : 1, 1],
      ];
      const bx = 320 - (slots.length * 22) / 2;
      const by = 327; // ícone (16 px) + rótulo cabem inteiros acima da borda inferior (360)
      const gt = this.gTop;
      slots.forEach(([lbl, ic, cd, cm], i) => {
        const x = bx + i * 22;
        const isUlt = i === 3;
        const ready = cd <= 0;
        // pulso quando a habilidade volta a ficar pronta (não dispara no primeiro quadro)
        if (i > 0 && this.slotReady[i] === false && ready) this.slotPulse[i] = now;
        this.slotReady[i] = ready;
        g.fillStyle(0x0b0a12, this.pa(0.85)).fillRect(x - 1, by - 1, 18, 18);
        this.icon(`slot${i}`, `icon_${ic}`, x, by, ready ? 1 : 0.5);
        if (!ready && cm > 0) {
          // recarga radial: o setor escuro encolhe no sentido horário a partir do topo
          const remaining = isUlt ? 1 - ult : cd / cm;
          this.sweep(gt, x + 8, by + 8, 8, remaining, this.pa(0.72));
          if (isUlt) this.text(`cd${i}`, x + 8, by + 5, `${Math.floor(ult * 100)}`, 0xffffff, [0.5, 0]);
          else this.text(`cd${i}`, x + 8, by + 5, cd < 90 ? (cd / 30).toFixed(1) : `${Math.ceil(cd / 30)}`, 0xffffff, [0.5, 0]);
        }
        const denied = now - this.denyFlash.at < 350 && ((this.denyFlash.reason === 'cd' && !ready && !isUlt) || (this.denyFlash.reason === 'ult' && isUlt && !ready));
        const border = denied ? (this.blinkOn(now, 90) ? 0xec6a5e : 0xffffff) : ready ? (isUlt ? (this.blinkOn(now, 150) ? 0xf6c257 : 0xfff0ae) : i === 0 ? 0x4d6fa3 : cls.color) : 0x37507e;
        gt.lineStyle(1, border, 1).strokeRect(x - 0.5, by - 0.5, 17, 17);
        const pulseAge = now - (this.slotPulse[i] ?? -9999);
        if (pulseAge < 450) {
          const t = pulseAge / 450;
          const grow = this.reduceMotion ? 1 : Math.round(t * 5);
          gt.fillStyle(0xffffff, 0.55 * (1 - t)).fillRect(x, by, 16, 16);
          gt.lineStyle(1, t < 0.5 ? 0xffffff : cls.color, 1 - t * 0.8).strokeRect(x - 0.5 - grow, by - 0.5 - grow, 17 + grow * 2, 17 + grow * 2);
        }
        this.text(`key${i}`, x + 8, by + 17, lbl, ready && i > 0 ? 0xf6c257 : 0xa3a9bb, [0.5, 0]);
      });
      // passiva (ícone)
      this.icon('slotp', `icon_${icons?.[4] ?? 'star'}`, bx + slots.length * 22 + 4, by, 0.9);
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
      g.fillStyle(0x0b0a12, this.pa(0.7)).fillRect(x - 2, ay - 1, 94, 22);
      this.icon(`ally${p.id}`, `icon_${ABILITY_ICONS[p.c]?.[0] ?? 'star'}`, x, ay + 2, p.s === 0 ? 1 : 0.4);
      const status = p.cn === 0 ? 'desconectado' : p.s === 1 ? 'CAÍDO' : p.s === 2 ? 'morto' : '';
      const nameColor = status ? 0x7a8096 : cls.color;
      this.text(`an${p.id}`, x + 19, ay, sess.nameOf(p.id), nameColor);
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

    // dicas contextuais (uma vez cada, desligáveis)
    if (me && me.s === 0 && w.ph === 'wave') {
      const kb = this.keys();
      if (w.n === 1) {
        this.hint('atk', 'Botão esquerdo ataca · botão direito move · mire com o mouse');
        this.hint('skills', `${keyLabel(kb.q)} e ${keyLabel(kb.e)} usam habilidades: o ícone mostra a recarga · F1 explica cada uma`);
        this.hint('dodge', `${keyLabel(kb.dodge)} esquiva (gasta a barra verde). Fuja das marcas no chão`);
      }
      if (me.u / PLAYER_RULES.ultMax >= 1) this.hint('ult', `Suprema pronta! Pressione ${keyLabel(kb.r)}`);
      if (me.hp / me.mhp < 0.35) this.hint('lowhp', 'Vida baixa! Afaste-se e deixe a equipe cobrir; aliados podem te reviver');
      if (latest.p.some((p) => p.id !== sess.myId && p.s === 1)) this.hint('allydown', `Aliado caído: aproxime-se e segure ${keyLabel(kb.interact)} para reviver`);
      if (w.boss) this.hint('boss', 'Chefe: leia os avisos no chão e esquive. A barra grande no topo mostra a vida dele');
    }
    this.drawHints(now, !!sess.paused || now < this.banner.until || !!w.intro || w.ph !== 'wave');

    // mensagens
    if (now < this.msg.until) {
      const mt = this.text('msg', 320, 290, this.msg.text, this.msg.color, [0.5, 0]);
      const mw = mt.width + 10;
      g.fillStyle(0x0b0a12, this.pa(0.7)).fillRect(Math.round(320 - mw / 2), 288, mw, 13);
    }
    if (now >= this.banner.until && this.bannerNext) {
      const n = this.bannerNext;
      this.bannerNext = null;
      this.banner = { text: n.text, sub: n.sub, start: now, until: now + n.ms, color: n.color, kind: n.kind };
    }
    if (now < this.banner.until) this.drawBanner(now);
    if (sess.paused) this.text('paused', 320, 170, 'PAUSADO', 0xf6c257, [0.5, 0.5], 2);
    void ENEMY_TYPES;
  }

  /** Aviso grande (onda, chefe, checkpoint): placa que abre do centro, kicker colorido e decoração por tipo. */
  private drawBanner(now: number): void {
    const g = this.g;
    const b = this.banner;
    const age = now - b.start;
    const left = b.until - now;
    const t = this.reduceMotion ? 1 : Math.min(1, age / 260);
    const ease = Math.round((1 - (1 - t) * (1 - t)) * 10) / 10;
    const alpha = Math.min(1, left / 400);
    const cy = 116;
    const w = Math.round(640 * ease);
    const kicker = b.kind === 'boss' ? 'CHEFE À FRENTE' : b.kind === 'mini' ? 'MINICHEFE À FRENTE' : b.kind === 'checkpoint' ? 'PROGRESSO SALVO' : b.kind === 'restore' ? 'A EQUIPE CAIU' : '';
    if ((b.kind === 'boss' || b.kind === 'mini') && age < 1600) {
      const on = this.reduceMotion || Math.floor(age / 160) % 2 === 0;
      if (on) g.fillStyle(b.color, 0.45 * alpha).fillRect(0, 0, 640, 6).fillRect(0, 354, 640, 6);
    }
    g.fillStyle(0x0b0a12, this.pa(0.7) * alpha).fillRect(Math.round(320 - w / 2), cy - 28, w, 56);
    const edge = b.kind === 'restore' && this.blinkOn(now, 220) ? 0xffffff : b.color;
    g.fillStyle(edge, alpha).fillRect(Math.round(320 - w / 2), cy - 28, w, 1).fillRect(Math.round(320 - w / 2), cy + 27, w, 1);
    if (ease < 0.6) return;
    const lift = this.reduceMotion ? 0 : Math.round((1 - ease) * 10);
    if (kicker) this.text('bkick', 320, cy - 27 - lift, kicker, b.color, [0.5, 0]).setAlpha(alpha);
    this.text('banner', 320, cy - 1 - lift, b.text, b.color, [0.5, 0.5], 3).setAlpha(alpha);
    if (b.sub) this.text('bsub', 320, cy + 19 - lift, b.sub, 0xe6e9f2, [0.5, 0.5]).setAlpha(alpha);
    if (b.kind === 'checkpoint') {
      // bandeiras tremulando nas laterais da placa
      const wave = this.reduceMotion ? 0 : Math.floor(now / 280) % 2;
      for (const fx of [150, 490]) {
        g.fillStyle(0xcfd4df, alpha).fillRect(fx, cy - 14, 2, 26);
        g.fillStyle(b.color, alpha).fillRect(fx + 2, cy - 14, 14 - wave * 2, 8).fillRect(fx + 2, cy - 6, 10 + wave * 2, 4);
      }
    }
  }

  /** Dica contextual: placa discreta acima da barra de habilidades. */
  private drawHints(now: number, hold: boolean): void {
    if (!this.hintsOn) {
      this.hintCur = null;
      this.hintQueue.length = 0;
      return;
    }
    if (this.hintCur && now > this.hintCur.until) {
      this.hintCur = null;
      this.hintGapUntil = now + 1500;
    }
    if (!this.hintCur && !hold && this.hintQueue.length && now > this.hintGapUntil) {
      const h = this.hintQueue.shift() as { id: string; text: string };
      this.hintCur = { ...h, start: now, until: now + 6500 };
      this.hintsSeen.add(h.id);
      this.hintsShown++;
      this.onHintSeen?.(h.id);
    }
    const c = this.hintCur;
    if (!c) return;
    const age = now - c.start;
    const a = Math.min(1, age / 200, (c.until - now) / 300);
    const slide = this.reduceMotion ? 0 : Math.round((1 - Math.min(1, age / 200)) * 8);
    const y = 304 + slide;
    const t = this.text('hint', 0, y + 2, c.text, 0xf6e6b0).setAlpha(a);
    const tag = 28;
    const total = tag + 6 + t.width;
    const x = Math.round(320 - total / 2);
    placeText(t, x + tag + 6, y + 2, 0, 0);
    const g = this.g;
    g.fillStyle(0x0b0a12, this.pa(0.88) * a).fillRect(x - 4, y - 2, total + 8, 15);
    g.fillStyle(0xf6c257, a).fillRect(x - 4, y - 2, total + 8, 1).fillRect(x - 4, y + 12, total + 8, 1);
    g.fillStyle(0x6e360d, a).fillRect(x - 2, y, tag, 11);
    this.text('hinttag', x - 2 + tag / 2, y + 2, 'DICA', 0xfff0ae, [0.5, 0]).setAlpha(a);
    if (this.hintsShown === 1) this.text('hintoff', 320, y - 13, 'Dicas podem ser desligadas em Configurações', 0xa3a9bb, [0.5, 0]).setAlpha(a);
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
        g.fillStyle(0x0b0a12, this.pa(0.75)).fillRect(x - 2, y - 1, W, st ? 22 : 30);
        this.text('evname', x + 1, y, `EVENTO: ${def.name}`, 0xf6c257);
        if (st) this.text('evst', x + 1, y + 10, st[0], st[1]);
        else {
          const info = ev.k === 'ritual' ? `${def.goal} — ${secs(ev.t)}` : def.goal;
          const dg = ev.d ?? -1;
          if (dg >= 0) {
            // estado do objetivo: SEGURO / AMEAÇADO / CRÍTICO + quantos inimigos pressionam
            const lbl = dg >= 2 ? 'CRÍTICO' : dg === 1 ? 'AMEAÇADO' : 'SEGURO';
            const col = dg >= 2 ? (this.blinkOn(now, 160) ? 0xff5a4a : 0xffffff) : dg === 1 ? 0xf6c257 : 0x7fc47a;
            this.text('evgoal', x + 1, y + 10, `${lbl}${(ev.n ?? 0) > 0 ? ` — ${ev.n} pressionando` : ''}`, col);
          } else this.text('evgoal', x + 1, y + 10, info, 0xa3a9bb);
          if (ev.p >= 0) {
            const col = ev.k === 'ritual' ? 0xe07cff : ev.k === 'cart' ? 0xe0902a : ev.p < 30 && this.blinkOn(now, 250) ? 0xec6a5e : 0x7fc47a;
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
        g.fillStyle(0x0b0a12, this.pa(0.75)).fillRect(x - 2, y - 1, W, cg.p >= 0 && !st ? 30 : 22);
        this.text('cgname', x + 1, y, `DESAFIO: ${def.name}`, 0x8fd3f0);
        const tail = cg.k === 'speed' || cg.k === 'elite' ? ` — ${secs(cg.t)}` : '';
        if (!st && cg.k === 'altar' && (cg.d ?? -1) >= 0) {
          const dg = cg.d ?? 0;
          this.text('cgrw', x + 1, y + 10, `${dg >= 2 ? 'CRÍTICO' : dg === 1 ? 'AMEAÇADO' : 'SEGURO'}${(cg.n ?? 0) > 0 ? ` — ${cg.n} no altar` : ''}`, dg >= 2 ? (this.blinkOn(now, 160) ? 0xff5a4a : 0xffffff) : dg === 1 ? 0xf6c257 : 0x7fc47a);
        } else if (st) this.text('cgst', x + 1, y + 10, st[1] === 0x7fc47a ? `${st[0]}: ${def.rewardText}` : st[0], st[1]);
        else if (!(cg.k === 'altar' && (cg.d ?? -1) >= 0)) this.text('cgrw', x + 1, y + 10, `Opcional: ${def.rewardText}${tail}`, 0x7a8096);
        if (cg.p >= 0 && !st) this.bar(x + 1, y + 22, W - 6, 2, cg.p / 100, cg.k === 'altar' ? 0x7fc47a : 0x8fd3f0, 0x1f1a24);
      }
    }
  }
}
