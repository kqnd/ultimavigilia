/** Telegraphs de ataques inimigos e desenho das zonas (área de efeito) no chão. */
import type Phaser from 'phaser';
import { NECRO } from '../../shared/config/classes.js';
import { ATK } from '../../shared/config/enemies.js';
import { ZONE_KINDS, type ZoneTuple } from '../../shared/protocol.js';
import type { RenderEnemy } from './views.js';

const RED = 0xc83838;
const RED_HOT = 0xec6a5e;
const AMBER = 0xf6c257;
const ICE = 0x8fd3f0;
const NECRO_COL = 0xa8d05a;

function sector(g: Phaser.GameObjects.Graphics, x: number, y: number, r: number, a: number, arcDeg: number, prog: number, color: number, heavy: boolean): void {
  const half = (arcDeg * Math.PI) / 360;
  g.fillStyle(color, (heavy ? 0.12 : 0.05) + 0.08 * prog);
  g.slice(x, y, r, a - half, a + half, false);
  g.fillPath();
  // preenchimento crescente indica o tempo até o golpe
  g.fillStyle(color, heavy ? 0.3 : 0.16);
  g.slice(x, y, r * prog, a - half, a + half, false);
  g.fillPath();
  g.lineStyle(heavy ? 2 : 1, prog > 0.8 ? 0xffffff : color, heavy ? 0.95 : 0.6);
  g.beginPath();
  g.arc(x, y, r, a - half, a + half, false);
  g.strokePath();
  if (arcDeg < 360) {
    g.lineBetween(x, y, x + Math.cos(a - half) * r, y + Math.sin(a - half) * r);
    g.lineBetween(x, y, x + Math.cos(a + half) * r, y + Math.sin(a + half) * r);
  }
}

function circle(g: Phaser.GameObjects.Graphics, x: number, y: number, r: number, prog: number, color: number): void {
  g.fillStyle(color, 0.14);
  g.fillCircle(x, y, r);
  g.fillStyle(color, 0.3);
  g.fillCircle(x, y, r * Math.min(1, prog));
  g.lineStyle(prog > 0.8 ? 2 : 1, prog > 0.8 ? 0xffffff : color, 0.95);
  g.strokeCircle(x, y, r);
}

function dashedLine(g: Phaser.GameObjects.Graphics, x0: number, y0: number, x1: number, y1: number, color: number, alpha: number, off: number): void {
  const d = Math.hypot(x1 - x0, y1 - y0);
  const n = Math.floor(d / 6);
  g.lineStyle(2, color, alpha);
  for (let i = 0; i < n; i += 2) {
    const t0 = (i + (off % 2)) / n;
    const t1 = Math.min(1, (i + 1 + (off % 2)) / n);
    g.lineBetween(x0 + (x1 - x0) * t0, y0 + (y1 - y0) * t0, x0 + (x1 - x0) * t1, y0 + (y1 - y0) * t1);
  }
}

/** Desenha o telegraph do ataque em preparação. Retorna true se algo foi desenhado. */
export function drawTelegraph(g: Phaser.GameObjects.Graphics, e: RenderEnemy, r: number): boolean {
  if (e.state !== 'windup' && !(e.state === 'active' && (e.atk === 'lunge' || e.atk === 'dash'))) {
    if (e.state === 'roar') {
      const k = (performance.now() / 300) % 1;
      g.lineStyle(2, e.atk === 'howl' ? 0x8fd3f0 : 0xe07cff, 1 - k);
      g.strokeCircle(e.x, e.y - 10, 30 + k * 90);
      return true;
    }
    return false;
  }
  const t = e.stateT;
  const pulse = Math.floor(performance.now() / 90) % 2;
  switch (e.atk) {
    case 'swipe':
      sector(g, e.x, e.y, ATK.shambler.swipe.range + r, e.facing, ATK.shambler.swipe.arc, t / ATK.shambler.swipe.windup, RED, false);
      return true;
    case 'claw':
      sector(g, e.x, e.y, ATK.werewolf.claw.range + r, e.facing, ATK.werewolf.claw.arc, t / ATK.werewolf.claw.windup, RED, false);
      return true;
    case 'slam':
      sector(g, e.x, e.y, ATK.father.slam.range + r * 0.5, e.facing, ATK.father.slam.arc, t / ATK.father.slam.windup, RED_HOT, true);
      return true;
    case 'claws':
      sector(g, e.x, e.y, ATK.moonDevourer.claws.range, e.facing, ATK.moonDevourer.claws.arc, t / ATK.moonDevourer.claws.windup, RED_HOT, true);
      return true;
    case 'sweep':
      sector(g, e.x, e.y, ATK.patriarch.sweep.range, e.facing, ATK.patriarch.sweep.arc, t / ATK.patriarch.sweep.windup, 0xe07cff, true);
      return true;
    case 'crescent':
      circle(g, e.x, e.y, ATK.moonDevourer.crescent.radius, t / ATK.moonDevourer.crescent.windup, RED_HOT);
      return true;
    case 'lunge': {
      const L = ATK.runner.lunge;
      const len = (L.dashSpeed * L.dashTicks) / 30;
      const ex = e.x + Math.cos(e.facing) * len;
      const ey = e.y + Math.sin(e.facing) * len;
      g.lineStyle(L.hitRadius, RED, 0.18).lineBetween(e.x, e.y, ex, ey);
      g.lineStyle(1, pulse ? 0xffffff : RED, 0.9).lineBetween(e.x, e.y, ex, ey);
      return true;
    }
    case 'pounce': {
      const P = ATK.werewolf.pounce;
      dashedLine(g, e.x, e.y, e.tx, e.ty, RED, 0.8, Math.floor(performance.now() / 80));
      circle(g, e.tx, e.ty, P.landRadius, t / P.windup, RED);
      return true;
    }
    case 'orb':
      g.fillStyle(0xe07cff, pulse ? 0.9 : 0.5).fillCircle(e.x + Math.cos(e.facing) * 8, e.y - 10 + Math.sin(e.facing) * 8, 2 + (t / ATK.acolyte.orb.windup) * 3);
      dashedLine(g, e.x, e.y - 8, e.tx, e.ty, 0xe07cff, 0.35, Math.floor(performance.now() / 100));
      return true;
    case 'rune':
      g.fillStyle(0xe07cff, 0.8).fillCircle(e.x, e.y - 18, 2 + pulse);
      return true;
    case 'slipper': {
      // trajetória anunciada: ida e volta
      const off = Math.floor(performance.now() / 70);
      dashedLine(g, e.x, e.y - 10, e.tx, e.ty, AMBER, 0.9, off);
      g.lineStyle(2, AMBER, 0.9);
      g.lineBetween(e.tx - 5, e.ty - 5, e.tx + 5, e.ty + 5);
      g.lineBetween(e.tx - 5, e.ty + 5, e.tx + 5, e.ty - 5);
      g.lineStyle(1, AMBER, 0.5).strokeCircle(e.tx, e.ty, 10 + (t % 10));
      return true;
    }
    case 'dash': {
      const D = ATK.patriarch.dash;
      const ex = e.x + Math.cos(e.facing) * D.distance;
      const ey = e.y + Math.sin(e.facing) * D.distance;
      g.lineStyle(D.hitRadius * 2, 0xe07cff, 0.15).lineBetween(e.x, e.y, ex, ey);
      g.lineStyle(2, pulse ? 0xffffff : 0xe07cff, 0.9).lineBetween(e.x, e.y, ex, ey);
      return true;
    }
    case 'burst':
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2;
        g.lineStyle(1, 0xe07cff, 0.7).lineBetween(e.x + Math.cos(a) * 24, e.y - 10 + Math.sin(a) * 24, e.x + Math.cos(a) * (40 + t), e.y - 10 + Math.sin(a) * (40 + t));
      }
      return true;
    case 'summon':
      g.lineStyle(2, 0xe07cff, 0.8).strokeCircle(e.x, e.y, 40 + (t % 20));
      return true;
    case 'shards': {
      // leque de estilhaços na direção do alvo
      const S = ATK.frostBride.shards;
      sector(g, e.x, e.y - 10, 90, e.facing, (S.spread * 2 * 180) / Math.PI, t / S.windup, ICE, true);
      return true;
    }
    case 'spikes':
      g.lineStyle(2, pulse ? 0xffffff : ICE, 0.9).strokeCircle(e.x, e.y - 12, 16 + (t % 10));
      return true;
    case 'nova':
      g.fillStyle(ICE, pulse ? 0.9 : 0.5).fillCircle(e.x, e.y - 24, 3);
      return true;
    case 'frostSummon':
      g.lineStyle(2, ICE, 0.8).strokeCircle(e.x, e.y, 40 + (t % 20));
      return true;
    case 'channel': {
      // ritual em andamento: círculo girando que se fecha até o fim da canalização
      const prog = Math.min(1, t / (ATK.ritualist.channel * 30));
      const R = 34;
      g.fillStyle(0x5a1470, 0.12 + prog * 0.15).fillCircle(e.x, e.y, R);
      g.lineStyle(1, 0xe07cff, 0.9).strokeCircle(e.x, e.y, R);
      g.lineStyle(2, pulse ? 0xffffff : 0xe07cff, 0.9);
      g.beginPath();
      g.arc(e.x, e.y, R + 4, -Math.PI / 2, -Math.PI / 2 + prog * Math.PI * 2, false);
      g.strokePath();
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + performance.now() / 900;
        g.fillStyle(0xe07cff, 1).fillRect(Math.round(e.x + Math.cos(a) * (R - 5)) - 1, Math.round(e.y + Math.sin(a) * (R - 5)) - 1, 3, 3);
      }
      return true;
    }
    case 'march': {
      // Marcha Sombria: runas no chão crescem durante a canalização
      const M = ATK.shadowAcolyte.march;
      const prog = Math.min(1, t / M.windup);
      g.lineStyle(1, 0x7dffb0, 0.25 + prog * 0.5).strokeCircle(e.x, e.y, M.radius);
      g.fillStyle(0x2a1a3a, 0.08 + prog * 0.12).fillCircle(e.x, e.y, M.radius * prog);
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + performance.now() / 1400;
        const rx = Math.round(e.x + Math.cos(a) * 16);
        const ry = Math.round(e.y + Math.sin(a) * 10);
        g.fillStyle(0x7dffb0, 0.5 + prog * 0.5).fillRect(rx - 1, ry - 1, 3, 1).fillRect(rx, ry - 2, 1, 3);
      }
      return true;
    }
    case 'mistLeap': {
      const L = ATK.mistStalker.leap;
      if (e.state !== 'windup') return false;
      dashedLine(g, e.x, e.y, e.tx, e.ty, 0xd8f6ff, 0.55, Math.floor(performance.now() / 80));
      circle(g, e.tx, e.ty, L.landRadius, t / L.windup, 0x8fd3f0);
      return true;
    }
    case 'siege': {
      // canalização contra o objetivo: feixe tracejado até a fogueira/altar + anel que fecha
      const prog = Math.min(1, t / ATK.siege.windup);
      dashedLine(g, e.x, e.y - 12, e.tx, e.ty - 6, 0xe07cff, 0.35 + prog * 0.5, Math.floor(performance.now() / 80));
      g.lineStyle(2, pulse ? 0xffffff : 0xe07cff, 0.9);
      g.beginPath();
      g.arc(e.x, e.y - 12, 9, -Math.PI / 2, -Math.PI / 2 + prog * Math.PI * 2, false);
      g.strokePath();
      return true;
    }
    case 'wound': {
      // Ferida Profana: runa girando no Acólito (a linha até o alvo é desenhada pela cena)
      const prog = Math.min(1, t / ATK.shadowAcolyte.wound.windup);
      g.lineStyle(1, 0x7dffb0, 0.5 + prog * 0.5).strokeCircle(e.x, e.y - 12, 8 + (1 - prog) * 6);
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + performance.now() / 300;
        g.fillStyle(0x9a4acb, 1).fillRect(Math.round(e.x + Math.cos(a) * 11) - 1, Math.round(e.y - 12 + Math.sin(a) * 7) - 1, 3, 3);
      }
      return true;
    }
    case 'bash':
      sector(g, e.x, e.y, ATK.ossuaryBearer.bash.range + r * 0.5, e.facing, ATK.ossuaryBearer.bash.arc, t / ATK.ossuaryBearer.bash.windup, RED_HOT, true);
      return true;
    case 'leap':
    case 'eruption':
      return false;
    default:
      return false;
  }
}

/** Desenha uma zona. `mine` indica se pertence ao jogador local. */
export function drawZone(g: Phaser.GameObjects.Graphics, z: ZoneTuple, now: number): void {
  const [, kindIdx, x, y, r, ttl, , extra] = z;
  const kind = ZONE_KINDS[kindIdx];
  const pulse = Math.floor(now / 120) % 2;
  switch (kind) {
    case 'glacial': {
      g.fillStyle(0x4f9cc8, 0.22).fillCircle(x, y, r);
      g.lineStyle(1, 0xd8f6ff, 0.8).strokeCircle(x, y, r);
      g.lineStyle(1, 0x8fd3f0, 0.5).strokeCircle(x, y, r - 4);
      for (let i = 0; i < 10; i++) {
        const a = i * 2.4 + now / 2000;
        const d = ((i * 37) % 100) / 100;
        g.fillStyle(0xd8f6ff, 0.8).fillRect(Math.round(x + Math.cos(a) * r * d), Math.round(y + Math.sin(a) * r * d), 2, 2);
      }
      break;
    }
    case 'bastion':
      g.fillStyle(0xf6c257, 0.1).fillCircle(x, y, r);
      g.lineStyle(2, 0xf6c257, pulse ? 0.9 : 0.6).strokeCircle(x, y, r);
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2 + now / 1500;
        g.fillStyle(0xfff0ae, 0.9).fillRect(Math.round(x + Math.cos(a) * r), Math.round(y + Math.sin(a) * r) - 3, 2, 3);
      }
      break;
    case 'choke': {
      // Bomba de Fumaça: nuvem de bolhas cinzentas que giram devagar (vermelha se incendiária)
      const hell = extra > 0;
      const fade = Math.min(1, ttl / 15);
      g.fillStyle(hell ? 0x3a2418 : 0x2a2d3a, 0.42 * fade).fillCircle(x, y, r);
      for (let i = 0; i < 14; i++) {
        const a = i * 2.39 + now / (1800 + (i % 3) * 400);
        const d = r * (0.25 + ((i * 37) % 70) / 100);
        const pr = 6 + (i % 4) * 3 + Math.sin(now / 300 + i) * 2;
        g.fillStyle(i % 3 ? 0x565b70 : 0x7a8096, 0.5 * fade).fillCircle(x + Math.cos(a) * d, y + Math.sin(a) * d, pr);
      }
      g.lineStyle(1, hell ? 0xff7a2a : 0xa3a9bb, 0.5 * fade).strokeCircle(x, y, r);
      break;
    }
    case 'brew': {
      // Rodada da Casa: poça de cachaça com anel de fogo e línguas de chama girando
      const fade = Math.min(1, ttl / 15);
      g.fillStyle(0x6e360d, 0.22 * fade).fillCircle(x, y, r);
      g.fillStyle(0xe0902a, 0.08 * fade).fillCircle(x, y, r * 0.7);
      g.lineStyle(3, 0xd9512c, 0.8 * fade).strokeCircle(x, y, r);
      g.lineStyle(1, 0xffd08a, (pulse ? 0.9 : 0.6) * fade).strokeCircle(x, y, r - 3);
      for (let i = 0; i < 24; i++) {
        const a = (i / 24) * Math.PI * 2 + now / 900;
        const h = 3 + Math.round((1 + Math.sin(now / 80 + i * 1.9)) * 3);
        const fx0 = Math.round(x + Math.cos(a) * r);
        const fy0 = Math.round(y + Math.sin(a) * r);
        g.fillStyle(i % 3 ? 0xff7a2a : 0xf6c257, 0.85 * fade).fillRect(fx0, fy0 - h, 2, h);
      }
      // redemoinho puxando para o centro
      for (let i = 0; i < 10; i++) {
        const k = (now / 900 + i / 10) % 1;
        const a = i * 0.63 + k * 3;
        const d = r * (1 - k);
        g.fillStyle(0xf6c257, 0.7 * fade * (1 - k)).fillRect(Math.round(x + Math.cos(a) * d), Math.round(y + Math.sin(a) * d), 2, 2);
      }
      break;
    }
    case 'polarity': {
      g.fillStyle(0x2aa3b8, 0.12).fillCircle(x, y, r);
      for (let k = 0; k < 3; k++) {
        const rr = r * (1 - ((now / 700 + k / 3) % 1));
        g.lineStyle(2, 0x6fe3ef, 0.8).strokeCircle(x, y, rr);
      }
      break;
    }
    case 'rupture': {
      const prog = extra > 0 ? 1 - ttl / extra : 0;
      g.fillStyle(0x5c4fd6, 0.15 + prog * 0.2).fillCircle(x, y, r);
      g.lineStyle(2, prog > 0.8 && pulse ? 0xffffff : 0x8f86ff, 1).strokeCircle(x, y, r);
      g.lineStyle(1, 0xc7c2ff, 0.8).strokeCircle(x, y, r * prog);
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2 - now / 600;
        g.fillStyle(0xc7c2ff, 1).fillRect(Math.round(x + Math.cos(a) * (r - 6)) - 1, Math.round(y + Math.sin(a) * (r - 6)) - 1, 3, 3);
      }
      break;
    }
    case 'rain':
      g.lineStyle(1, 0xc0c8d8, 0.7).strokeCircle(x, y, r);
      g.fillStyle(0xc0c8d8, 0.08).fillCircle(x, y, r);
      break;
    case 'rune': {
      const prog = extra > 0 ? 1 - ttl / extra : 0;
      circle(g, x, y, r, prog, 0xe07cff);
      g.lineStyle(1, 0xe07cff, 0.9);
      for (let i = 0; i < 5; i++) {
        const a0 = (i / 5) * Math.PI * 2 + now / 800;
        const a1 = ((i + 2) / 5) * Math.PI * 2 + now / 800;
        g.lineBetween(x + Math.cos(a0) * r * 0.8, y + Math.sin(a0) * r * 0.8, x + Math.cos(a1) * r * 0.8, y + Math.sin(a1) * r * 0.8);
      }
      break;
    }
    case 'eruption': {
      const prog = extra > 0 ? 1 - ttl / extra : 0;
      circle(g, x, y, r, prog, 0x9a2cc0);
      break;
    }
    case 'leapMark': {
      const prog = extra > 0 ? 1 - ttl / extra : 0;
      circle(g, x, y, r, prog, RED_HOT);
      g.lineStyle(1, 0xffffff, 0.6);
      g.lineBetween(x - r, y, x + r, y);
      g.lineBetween(x, y - r, x, y + r);
      break;
    }
    case 'graveHand': {
      // preparação (anel que fecha) e depois mãos saindo do chão
      const active = Math.round(NECRO.hand.duration * 30);
      if (ttl > active) {
        const prog = extra > 0 ? 1 - (ttl - active) / extra : 1;
        circle(g, x, y, r, prog, NECRO_COL);
        break;
      }
      g.fillStyle(0x2a3a1a, 0.35).fillCircle(x, y, r);
      g.lineStyle(1, NECRO_COL, 0.9).strokeCircle(x, y, r);
      const n = Math.max(6, Math.round(r / 5));
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + i * 1.7;
        const d = r * (0.2 + ((i * 37) % 70) / 100);
        const hx = Math.round(x + Math.cos(a) * d);
        const hy = Math.round(y + Math.sin(a) * d * 0.8);
        const up = 3 + ((Math.floor(now / 180) + i) % 3);
        // mão ossuda saindo do chão: antebraço, palma e dedos
        g.fillStyle(0x1b1f14, 0.8).fillRect(hx - 3, hy, 7, 2);
        g.fillStyle(0xd6ddc0, 1).fillRect(hx, hy - up, 2, up).fillRect(hx - 2, hy - up - 2, 6, 2);
        g.fillRect(hx - 2, hy - up - 4, 1, 2).fillRect(hx, hy - up - 5, 1, 3).fillRect(hx + 2, hy - up - 4, 1, 2);
      }
      break;
    }
    case 'moonPulse': {
      const prog = extra > 0 ? 1 - ttl / extra : 0;
      circle(g, x, y, r, prog, ICE);
      break;
    }
    case 'nova': {
      const prog = extra > 0 ? 1 - ttl / extra : 0;
      circle(g, x, y, r, prog, 0xd8f6ff);
      break;
    }
    case 'iceSpike': {
      const prog = extra > 0 ? 1 - ttl / extra : 0;
      circle(g, x, y, r, prog, ICE);
      g.fillStyle(0xd8f6ff, pulse ? 1 : 0.6).fillRect(x - 1, y - 3, 3, 3);
      break;
    }
    case 'leapLand': {
      const prog = extra > 0 ? 1 - ttl / extra : 0;
      circle(g, x, y, r, prog, 0xd9512c);
      break;
    }
    case 'assaultWarn':
    case 'ambushWarn': {
      // portão/ponto de ataque destacado: seta pulsante apontando para o chão + anel
      const col = kind === 'assaultWarn' ? AMBER : RED_HOT;
      const k = (now / 350) % 1;
      g.fillStyle(col, 0.18).fillEllipse(x, y, r * 2.2, r * 1.1);
      g.lineStyle(2, col, 1 - k).strokeEllipse(x, y, r * 2.2 * (0.5 + k * 0.5), r * 1.1 * (0.5 + k * 0.5));
      const by = Math.round(y - r - 16 + (pulse ? 0 : 2));
      g.fillStyle(col, 1).fillRect(x - 1, by, 3, 7).fillTriangle(x - 4, by + 7, x + 4, by + 7, x, by + 11);
      break;
    }
    case 'spawnWarn': {
      const boss = extra === 1;
      const k = (now / 400) % 1;
      g.fillStyle(boss ? 0x9a2cc0 : 0x6e1424, 0.25).fillEllipse(x, y, r * 2, r);
      g.lineStyle(2, boss ? 0xe07cff : RED, 1 - k).strokeEllipse(x, y, r * 2 * (0.4 + k * 0.6), r * (0.4 + k * 0.6));
      g.fillStyle(RED_HOT, pulse ? 1 : 0.4).fillRect(x - 1, y - r - 12, 3, 7).fillRect(x - 1, y - r - 3, 3, 2);
      break;
    }
    default:
      break;
  }
}

/** Feixes da Marcha Sombria: ligam o Acólito aos aliados que serão acelerados. */
export function drawMarchBeams(g: Phaser.GameObjects.Graphics, caster: RenderEnemy, all: readonly RenderEnemy[]): void {
  const M = ATK.shadowAcolyte.march;
  const prog = Math.min(1, caster.stateT / M.windup);
  for (const o of all) {
    if (o.id === caster.id) continue;
    if ((o.x - caster.x) ** 2 + (o.y - caster.y) ** 2 > M.radius * M.radius) continue;
    g.lineStyle(1, 0x7dffb0, 0.15 + prog * 0.45).lineBetween(Math.round(caster.x), Math.round(caster.y - 12), Math.round(o.x), Math.round(o.y - 8));
  }
}

/** Ferida Profana: linha rúnica do Acólito até o jogador marcado e símbolo sobre ele. */
export function drawWoundLink(g: Phaser.GameObjects.Graphics, caster: RenderEnemy, tx: number, ty: number, locked: boolean): void {
  const W = ATK.shadowAcolyte.wound;
  const prog = Math.min(1, caster.stateT / W.windup);
  const now = performance.now();
  dashedLine(g, caster.x, caster.y - 12, tx, ty - 10, locked ? 0xffffff : 0x9a4acb, 0.3 + prog * 0.5, Math.floor(now / 70));
  // símbolo sobre o alvo: losango que fecha conforme a canalização
  const cy = Math.round(ty - 46);
  const rr = Math.round(10 - prog * 5);
  g.lineStyle(2, locked ? 0xffffff : 0x7dffb0, 0.95);
  g.beginPath();
  g.moveTo(tx, cy - rr);
  g.lineTo(tx + rr, cy);
  g.lineTo(tx, cy + rr);
  g.lineTo(tx - rr, cy);
  g.closePath();
  g.strokePath();
  g.fillStyle(0x9a4acb, 0.6 + prog * 0.4).fillRect(tx - 1, cy - 1, 3, 3);
}
