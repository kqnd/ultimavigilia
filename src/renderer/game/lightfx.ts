/**
 * Camada de LUZ das habilidades (v1.5). Cada evento de efeito ganha, além dos pixels de sempre
 * (scene.namedFx), luz aditiva por cima da escuridão: clarões, ondas de choque, faíscas, raios,
 * pilares e luzes que recortam a noite. A regra de leitura é a mesma para todas as classes:
 *
 * - golpes comuns: rastro luminoso + faísca no fio da arma (curto, nunca esconde o boneco);
 * - habilidades (Q/E): uma assinatura de forma própria (anel, cone, coluna, espiral) na cor da classe;
 * - supremas: coluna de luz + onda de choque + raios + luz forte que ilumina a área ao redor.
 *
 * Paletas por classe ficam aqui para todo mundo "brilhar" na mesma linguagem.
 */
import type { GameEvent } from '../../shared/protocol.js';
import type { Effects } from './effects.js';

type FxEvent = Extract<GameEvent, { k: 'fx' }>;

export const LIGHT = {
  tank: 0x8ff5dc, tankHi: 0xe6fff8,
  hunter: 0xdbe8ff, hunterGold: 0xffd27a,
  mage: 0x8f7bff, mageHi: 0xd8d0ff, ice: 0x8fdcff,
  vampire: 0xff2a44, vampireHi: 0xff9a9a,
  berserker: 0xff6a1a, berserkerHi: 0xffc36a,
  dog: 0x4fe6ff, dogHi: 0xd2fbff,
  necro: 0xb4f05a, necroHi: 0xe8ffc0, necroDark: 0xa060ff,
  lapanha: 0xff5a5a, lapanhaLeaf: 0x8fe070,
  maycon: 0xffb43a, mayconFlame: 0xff6a1a, glass: 0xb8ff9a, smoke: 0x9aa6c0,
  abyss: 0xd860ff, gold: 0xffd25a, white: 0xffffff,
} as const;

export interface LightCtx {
  /** Segue o jogador (posição do tronco). */
  follow: (id: number) => () => { x: number; y: number } | null;
}

/** Acende a luz de um evento de efeito. Retorna sem fazer nada para eventos sem luz. */
export function skillLight(f: Effects, ev: FxEvent, ctx: LightCtx): void {
  const L = LIGHT;
  const { x, y, a, r } = ev;
  const cx = Math.cos(a);
  const cy = Math.sin(a);
  switch (ev.n) {
    // ================================================================ GUARDIÃO — almas verde-água
    case 'guardianGuard':
      f.shock(x, y - 10, 26, L.tank, 0.35, 0.8, 0.85);
      f.glow(x, y - 10, L.tank, 0.8, { life: 0.4, grow: 1.4, alpha: 0.45, follow: ctx.follow(ev.o) });
      f.swirl(x, y - 10, 8, L.tank, 26, 0.45, true, 0.75);
      break;
    case 'guardianBlockPhysical':
      f.flare(x + Math.cos(a) * 8, y + Math.sin(a) * 6, L.tankHi, 0.5, 0.16);
      f.sparks(x + Math.cos(a) * 8, y + Math.sin(a) * 6, 9, L.tank, 170, 0.28, { dir: a, spread: 1.5 });
      f.light(x, y, 48, 0.7, 0.18);
      break;
    case 'guardianBlockProjectile':
      f.flare(x, y, L.tank, 0.45, 0.16);
      f.shock(x, y, 16, L.tankHi, 0.2, 0.8, 1);
      f.sparks(x, y, 6, L.tank, 150, 0.25, { dir: a, spread: 1.8 });
      break;
    case 'guardianBreak':
      f.flare(x, y, L.tankHi, 1.1, 0.3);
      f.shock(x, y, 44, L.tank, 0.4);
      f.sparks(x, y, 18, L.tankHi, 200, 0.5, { g: 160 });
      f.light(x, y, 72, 1, 0.3);
      break;
    case 'guardianDash':
      f.streak(x + cx * r * 0.5, y - 8 + cy * r * 0.5, a, L.tank, r * 1.2, 0.35, 0.8);
      f.glow(x, y - 8, L.tank, 0.9, { life: 0.3, grow: 1.4, alpha: 0.6 });
      break;
    case 'guardianTrail':
      f.glow(x, y - 8, L.tank, 0.55, { life: 0.35, grow: 1.6, alpha: 0.35, sy: 0.7 });
      f.sparks(x, y - 8, 2, L.tankHi, 50, 0.3, { dir: a + Math.PI, spread: 1.6 });
      break;
    case 'guardianImpact':
      f.flare(x, y - 6, L.tankHi, 0.75, 0.22);
      f.shock(x, y, Math.min(48, r), L.tank, 0.3);
      f.sparks(x, y - 6, 10, L.tank, 180, 0.32, { dir: a, spread: 1.4 });
      f.light(x, y, 48, 0.9, 0.22);
      break;
    case 'guardianCounter':
      f.flare(x + cx * r * 0.6, y - 9 + cy * r * 0.6, L.tankHi, 0.9, 0.22);
      f.shock(x, y, r, L.tank, 0.3, 0.9);
      f.rays(x, y - 9, 8, L.tank, r * 0.9, 0.3, a);
      f.light(x, y, 72, 1, 0.25);
      break;
    case 'guardianPlant':
      // a muralha se ergue: coluna de almas + domo de luz no chão
      f.pillar(x, y, L.tank, 120, 1.2, 0.8);
      f.shock(x, y, r, L.tank, 0.6, 0.9);
      f.shock(x, y, r * 0.6, L.tankHi, 0.45, 0.8);
      f.swirl(x, y - 12, 18, L.tank, r * 0.8, 0.7, true, 0.45);
      f.light(x, y, 160, 1, 0.8);
      break;
    case 'guardianCharge':
      if (a > 0.06) f.swirl(x, y - 12, 2 + Math.round(a * 4), a > 0.6 ? L.tankHi : L.tank, 30 + a * 30, 0.5, true, 0.5);
      break;
    case 'bulwarkTaunt':
      f.shock(x, y, r, L.tank, 0.5, 0.55, 0.5);
      f.glow(x, y - 10, L.tank, 1.2, { life: 0.35, grow: 1.3, alpha: 0.3 });
      break;
    case 'guardianBurst':
      f.flare(x, y - 8, L.tankHi, 1.6 + a, 0.4);
      f.pillar(x, y, L.tank, 150, 1.6, 0.7);
      f.shock(x, y, r, L.tank, 0.5);
      f.shock(x, y, r * 1.25, L.tankHi, 0.65, 0.6);
      f.rays(x, y - 8, 14, L.tank, r * 0.9, 0.45);
      f.sparks(x, y - 8, 26 + Math.round(a * 20), L.tankHi, 240, 0.6, { up: 30 });
      f.light(x, y, 160, 1, 0.6);
      break;
    case 'guardianReflect':
      f.flare(x, y, L.tankHi, 0.8, 0.22);
      f.streak(x + cx * 20, y + cy * 14, a, L.tank, 60, 0.25, 0.7);
      f.sparks(x, y, 10, L.tankHi, 220, 0.3, { dir: a, spread: 0.7 });
      break;
    case 'mace':
      f.glow(x + cx * r * 0.8, y - 8 + cy * r * 0.8, L.tankHi, 0.45, { life: 0.16, grow: 1.4, alpha: 0.55 });
      break;
    case 'quakeWindup':
      f.swirl(x, y - 14, 10, L.tank, 30, 0.38, true, 0.6);
      f.glow(x, y - 20, L.tankHi, 0.5, { life: 0.38, grow: 1.6, alpha: 0.6, fadeIn: 0.5, follow: ctx.follow(ev.o) });
      break;
    case 'maceQuake':
      // Martelo Sísmico: rachadura de luz no chão em 360°
      f.flare(x, y, L.tankHi, 1.2, 0.3);
      f.shock(x, y, r, L.tank, 0.42, 1, 0.55);
      f.shock(x, y, r * 0.55, L.tankHi, 0.3, 0.9, 0.55);
      f.rays(x, y, 10, L.tank, r * 1.1, 0.3);
      f.sparks(x, y, 16, L.tankHi, 200, 0.45, { up: 40, g: 200 });
      f.light(x, y, 112, 1, 0.35);
      break;

    // ================================================================ CAÇADOR — prata e ouro
    case 'recoil':
      f.streak(x - cx * 30, y - 8 - cy * 20, a, L.hunter, 70, 0.3, 0.6);
      f.flare(x, y - 8, L.hunter, 0.55, 0.18);
      break;
    case 'trapSnap':
      f.flare(x, y, L.hunter, 0.7, 0.2);
      f.rays(x, y, 8, L.hunter, 28, 0.25);
      f.light(x, y, 48, 0.9, 0.25);
      break;
    case 'trapBlast':
      f.flare(x, y, L.hunterGold, 1.3, 0.35);
      f.shock(x, y, r, L.hunterGold, 0.38);
      f.sparks(x, y, 22, L.hunterGold, 220, 0.5, { up: 30, g: 180 });
      f.light(x, y, 112, 1, 0.4);
      break;
    case 'ricochet':
      f.flare(x, y, L.hunter, 0.4, 0.14);
      f.sparks(x, y, 5, L.hunter, 160, 0.22, { dir: a, spread: 0.8 });
      break;
    case 'rainVolley':
      for (let i = 0; i < 4; i++) {
        const ang = Math.random() * Math.PI * 2;
        const d = Math.random() * r;
        const px = x + Math.cos(ang) * d;
        const py = y + Math.sin(ang) * d * 0.8;
        f.streak(px - 4, py - 22, Math.atan2(40, 8), L.hunter, 46, 0.14, 0.35);
        f.glow(px, py, L.hunterGold, 0.4, { life: 0.18, grow: 1.6, alpha: 0.7 });
      }
      f.light(x, y, r > 60 ? 112 : 72, 0.55, 0.2);
      break;

    // ================================================================ MAGO — arcano violeta
    case 'blinkOut':
    case 'blinkIn':
      f.flare(x, y - 10, L.mage, 0.9, 0.3);
      f.swirl(x, y - 10, 12, L.mageHi, ev.n === 'blinkOut' ? 4 : 26, 0.4, ev.n === 'blinkIn', 0.8);
      f.pillar(x, y, L.mage, 50, 0.6, 0.35);
      f.light(x, y, 72, 0.9, 0.3);
      break;
    case 'arcaneBurst':
      f.flare(x, y, L.mage, 0.9, 0.28);
      f.shock(x, y, r, L.mageHi, 0.3);
      f.sparks(x, y, 12, L.mageHi, 180, 0.35);
      f.light(x, y, 72, 0.9, 0.3);
      break;
    case 'rupture':
      f.flare(x, y, L.mage, 1.5, 0.45);
      f.pillar(x, y, L.mage, 180, 1.6, 0.75);
      f.shock(x, y, r, L.mage, 0.55);
      f.shock(x, y, r * 1.35, L.mageHi, 0.75, 0.5);
      f.shock(x, y, r * 0.5, L.mageHi, 0.35, 0.6);
      f.rays(x, y, 14, L.mage, r * 1.1, 0.45);
      f.sparks(x, y, 30, L.mageHi, 320, 0.7, { up: 40 });
      f.swirl(x, y, 16, L.mage, r * 0.2, 0.6, false, 0.6);
      f.light(x, y, 160, 1, 0.8);
      break;

    // ================================================================ VAMPIRO — carmesim
    case 'claw1':
    case 'claw2':
      f.glow(x + cx * r * 0.8, y - 10 + cy * r * 0.8, L.vampire, 0.4, { life: 0.14, grow: 1.5, alpha: 0.5 });
      break;
    case 'biteWindup':
      f.glow(x + cx * 14, y - 8 + cy * 10, L.vampire, 0.6, { life: 0.22, grow: 0.6, alpha: 0.5, fadeIn: 0.6 });
      break;
    case 'bite':
      f.flare(x + cx * r * 0.55, y - 8 + cy * r * 0.55, L.vampire, 0.85, 0.25);
      f.sparks(x + cx * r * 0.55, y - 8 + cy * r * 0.55, 12, L.vampireHi, 170, 0.35, { dir: a, spread: 1.3, g: 120 });
      f.light(x, y, 48, 0.8, 0.25);
      break;
    case 'vortexStart':
      f.swirl(x, y - 6, 14, L.vampire, r, 0.35, true, 0.55);
      break;
    case 'vortex':
      f.shock(x, y - 4, r, L.vampire, 0.25, 0.6, 0.6);
      f.swirl(x, y - 4, 8, L.vampireHi, r * 0.8, 0.3, false, 0.55);
      f.light(x, y, 72, 0.7, 0.2);
      break;
    case 'feast':
      f.pillar(x, y, L.vampire, 90, 1, 0.6);
      f.swirl(x, y - 10, 16, L.vampireHi, 40, 0.6, true, 0.6);
      break;
    case 'feastBurst':
      f.flare(x, y - 6, L.vampireHi, 1.8, 0.4);
      f.shock(x, y - 4, r, L.vampire, 0.45);
      f.shock(x, y - 4, r * 0.6, L.vampireHi, 0.35, 0.8);
      f.rays(x, y - 6, 12, L.vampire, r, 0.4);
      f.sparks(x, y - 6, 30, L.vampireHi, 260, 0.6, { g: 140 });
      f.light(x, y, 160, 1, 0.5);
      break;
    case 'mist':
      f.glow(x, y - 6, L.vampire, 0.9, { life: 0.4, grow: 1.6, alpha: 0.35 });
      break;

    // ================================================================ BERSERKER — brasa e fogo
    case 'axe1':
    case 'axe2':
      f.glow(x + cx * r * 0.8, y - 10 + cy * r * 0.8, L.berserkerHi, 0.4, { life: 0.14, grow: 1.6, alpha: 0.55 });
      f.sparks(x + cx * r * 0.8, y - 10 + cy * r * 0.8, 3, L.berserker, 120, 0.22, { dir: a, spread: 1.4 });
      break;
    case 'axe3':
      f.flare(x + cx * r * 0.7, y - 8 + cy * r * 0.7, L.berserkerHi, 0.9, 0.24);
      f.sparks(x + cx * r * 0.7, y - 8 + cy * r * 0.7, 12, L.berserker, 220, 0.4, { dir: a, spread: 1.6, g: 160 });
      f.light(x, y, 72, 0.9, 0.22);
      break;
    case 'frenzySpin':
      f.shock(x, y - 6, r, L.berserker, 0.2, 0.55, 0.6);
      f.sparks(x + cx * r * 0.7, y - 8 + cy * r * 0.7, 5, L.berserkerHi, 180, 0.3, { dir: a + Math.PI / 2, spread: 0.8 });
      f.light(x, y, 72, 0.7, 0.18);
      break;
    case 'leapLand':
      f.flare(x, y, L.berserkerHi, 1.3, 0.32);
      f.shock(x, y, r, L.berserker, 0.4, 1, 0.55);
      f.shock(x, y, r * 0.6, L.berserkerHi, 0.3, 0.9, 0.55);
      f.rays(x, y, 10, L.berserker, r * 1.1, 0.32);
      f.sparks(x, y, 22, L.berserkerHi, 240, 0.55, { up: 50, g: 260 });
      f.light(x, y, 112, 1, 0.4);
      break;
    case 'madness':
      f.pillar(x, y, L.berserker, 150, 1.6, 0.9);
      f.flare(x, y - 12, L.berserkerHi, 1.6, 0.45);
      f.shock(x, y, r + 40, L.berserker, 0.5);
      f.shock(x, y, r + 20, 0xff2a10, 0.4, 0.8);
      f.rays(x, y - 10, 14, L.berserker, 70, 0.45);
      f.sparks(x, y - 10, 36, L.berserkerHi, 230, 0.8, { up: 60 });
      f.light(x, y, 160, 1, 0.7);
      break;
    case 'fury':
      f.swirl(x, y - 10, 12, L.berserkerHi, r, 0.5, true, 0.6);
      break;
    case 'exhausted':
      f.glow(x, y, 0x6a7090, 0.7, { life: 0.5, grow: 1.4, alpha: 0.35 });
      break;

    // ================================================================ DOG — ondas magnéticas
    case 'shout':
    case 'shoutBig': {
      const big = ev.n === 'shoutBig';
      f.glow(x + cx * 14, y + cy * 10, L.dogHi, big ? 0.9 : 0.5, { life: 0.2, grow: 1.6, alpha: 0.7 });
      f.streak(x + cx * r * 0.5, y + cy * r * 0.5, a, L.dog, r * (big ? 1.3 : 1), big ? 0.32 : 0.22, big ? 1.4 : 0.8);
      f.sparks(x + cx * 16, y + cy * 12, big ? 18 : 6, L.dogHi, big ? 300 : 220, 0.3, { dir: a, spread: 0.9 });
      if (big) {
        f.flare(x + cx * 18, y + cy * 12, L.dogHi, 1.1, 0.28);
        f.light(x + cx * r * 0.5, y + cy * r * 0.5, 112, 0.9, 0.35);
      } else f.light(x + cx * 30, y + cy * 20, 48, 0.6, 0.18);
      break;
    }
    case 'pulse':
      f.flare(x, y, L.dogHi, 0.9, 0.24);
      f.shock(x, y, r, L.dog, 0.38, 1, 0.7);
      f.shock(x, y, r * 0.7, L.dogHi, 0.3, 0.8, 0.7);
      f.light(x, y, 112, 0.9, 0.35);
      break;
    case 'endScream':
      // três pulsos seguidos: cada um mais contido, para o boneco continuar legível no meio
      f.flare(x, y, L.dogHi, 1.1, 0.35);
      f.shock(x, y, r, L.dog, 0.55, 0.8, 0.75);
      f.shock(x, y, r * 0.7, L.dogHi, 0.4, 0.55, 0.75);
      if (a === 0) f.rays(x, y, 12, L.dog, r * 0.9, 0.4);
      f.sparks(x, y, 18, L.dogHi, 320, 0.45);
      f.light(x, y, 160, 1, 0.6);
      break;

    // ================================================================ NECROMANTE — almas verdes
    case 'raise':
      f.pillar(x, y, L.necro, 60, 0.7, 0.6);
      f.swirl(x, y - 4, 10, L.necroHi, 18, 0.6, false, 0.6);
      f.light(x, y, 48, 0.9, 0.5);
      break;
    case 'raiseCast':
      f.swirl(x, y - 6, 12, L.necro, 26, 0.45, true, 0.6);
      f.glow(x, y - 12, L.necro, 0.7, { life: 0.45, grow: 1.4, alpha: 0.5 });
      break;
    case 'armyCall':
      f.swirl(x, y - 10, 20, L.necro, 40, 0.7, true, 0.6);
      f.pillar(x, y, L.necroDark, 100, 1.2, 0.7);
      break;
    case 'army':
      f.flare(x, y, L.necroHi, 1.6, 0.4);
      f.shock(x, y, r * 2, L.necro, 0.55);
      f.shock(x, y, r, L.necroDark, 0.45, 0.9);
      f.rays(x, y - 8, 12, L.necro, r * 1.6, 0.45);
      f.sparks(x, y - 8, 30, L.necroHi, 240, 0.7, { up: 40 });
      f.light(x, y, 160, 1, 0.6);
      break;
    case 'boneBlast':
      f.flare(x, y, L.necroHi, 0.8, 0.24);
      f.shock(x, y, r, L.necro, 0.3);
      f.light(x, y, 48, 0.8, 0.25);
      break;
    case 'minionFade':
      f.glow(x, y - 4, L.necro, 0.6, { life: 0.5, grow: 1.6, alpha: 0.45, vy: -20 });
      break;
    case 'essence':
      f.swirl(x, y, 3 + r, L.necroHi, 16, 0.45, true, 0.7);
      break;

    // ================================================================ LAPANHA — polpa e folha
    case 'melonBoom':
    case 'melonBoomBig': {
      const big = ev.n === 'melonBoomBig';
      f.flare(x, y - 4, L.lapanha, big ? 1.3 : 0.6, big ? 0.32 : 0.2);
      f.shock(x, y, r, big ? 0xff8a7a : L.lapanha, big ? 0.38 : 0.26, 0.8);
      f.sparks(x, y - 4, big ? 20 : 7, 0xff8a7a, big ? 220 : 150, 0.4, { up: 50, g: 260 });
      if (big) f.sparks(x, y - 4, 8, L.lapanhaLeaf, 160, 0.45, { up: 40, g: 240 });
      f.light(x, y, big ? 112 : 48, big ? 1 : 0.7, big ? 0.35 : 0.2);
      break;
    }
    case 'chargeMax':
      f.flare(x, y, L.lapanha, 0.7, 0.25);
      f.swirl(x, y, 10, 0xffd0c0, 20, 0.4, true, 0.8);
      break;
    case 'ripeThrow':
      f.glow(x, y - 16, L.lapanha, 0.5 + a * 0.4, { life: 0.25, grow: 1.5, alpha: 0.6 });
      break;
    case 'peelBurst':
      f.flare(x, y, L.lapanhaLeaf, 0.7, 0.24);
      f.shock(x, y, r, L.lapanhaLeaf, 0.3);
      break;
    case 'harvest':
      f.pillar(x, y, L.lapanhaLeaf, 90, 1, 0.8);
      f.swirl(x, y - 10, 16, 0xffd0c0, 34, 0.7, true, 0.6);
      f.shock(x, y, 40, L.lapanhaLeaf, 0.5);
      f.light(x, y, 112, 1, 0.6);
      break;
    case 'slip':
      if (r > 0) f.sparks(x, y, 5, 0xff8a7a, 120, 0.3, { dir: a, spread: 0.8 });
      break;

    // ================================================================ MAYCON — cachaça, fumaça e tapete
    case 'bottleBurst':
      f.flare(x, y - 4, L.maycon, 0.6, 0.2);
      f.sparks(x, y - 4, 10, L.glass, 170, 0.35, { up: 40, g: 260 });
      f.shock(x, y, r, L.maycon, 0.24, 0.7);
      f.light(x, y, 48, 0.75, 0.2);
      break;
    case 'chokeBurst':
      // a bomba explode: clarão do pavio e uma nuvem que "engole" a luz em volta
      f.flare(x, y - 4, a > 0 ? L.mayconFlame : 0xfff0d0, 0.9, 0.22);
      f.shock(x, y, r, a > 0 ? L.mayconFlame : L.smoke, 0.45, 0.55, 0.7);
      f.sparks(x, y - 4, 12, a > 0 ? L.mayconFlame : 0xfff0d0, 200, 0.3, { up: 20 });
      f.light(x, y, 72, 0.8, 0.2);
      break;
    case 'chokeFire':
      f.glow(x + (Math.random() - 0.5) * r * 1.2, y + (Math.random() - 0.5) * r * 0.9, L.mayconFlame, 0.35 + Math.random() * 0.25, { life: 0.45, grow: 1.4, alpha: 0.6, vy: -24 });
      break;
    case 'chokeEnd':
      f.shock(x, y, r, L.smoke, 0.5, 0.35, 0.7);
      break;
    case 'carpetDash':
      f.streak(x + cx * r * 0.5, y - 6 + cy * r * 0.5, a, L.maycon, r * 1.3, 0.4, 0.9);
      f.flare(x, y - 6, L.gold, 0.8, 0.25);
      f.sparks(x, y - 6, 12, L.gold, 200, 0.4, { dir: a + Math.PI, spread: 1.2 });
      f.light(x, y, 72, 0.9, 0.3);
      break;
    case 'carpetTrail':
      // poeira mágica dourada que cai do tapete
      for (let i = 0; i < 3; i++) f.glow(x + (Math.random() - 0.5) * 22, y - 2 + Math.random() * 4, i ? L.gold : L.white, 0.14 + Math.random() * 0.1, { life: 0.6, vx: (Math.random() - 0.5) * 30, vy: 10 + Math.random() * 20, frame: 'glow_core', alpha: 0.9, grow: 0.3 });
      f.glow(x, y - 4, L.maycon, 0.6, { life: 0.25, grow: 1.3, alpha: 0.35, sy: 0.5 });
      break;
    case 'carpetHit':
      f.flare(x, y, L.gold, 0.55, 0.18);
      f.sparks(x, y, 6, L.maycon, 180, 0.3, { dir: a, spread: 0.9 });
      break;
    case 'drinkStart':
      f.swirl(x, y - 16, 10, L.maycon, 20, 0.6, true, 0.7);
      f.glow(x + 6, y - 22, L.maycon, 0.5, { life: 0.65, grow: 1.6, alpha: 0.6, fadeIn: 0.6, follow: ctx.follow(ev.o) });
      break;
    case 'brewBurst':
      // RODADA DA CASA: o gole vira um anel de fogo que explode para fora
      f.flare(x, y - 10, L.maycon, 2.2, 0.5);
      f.pillar(x, y, L.mayconFlame, 140, 1.6, 0.7);
      f.shock(x, y, r, L.mayconFlame, 0.55, 1, 1);
      f.shock(x, y, r * 0.7, L.maycon, 0.45, 0.9, 1);
      f.shock(x, y, r * 1.2, L.gold, 0.7, 0.5, 1);
      f.rays(x, y - 6, 16, L.maycon, r, 0.5);
      f.sparks(x, y - 8, 40, L.maycon, 300, 0.75, { up: 60, g: 120 });
      f.swirl(x, y, 18, L.gold, r * 0.15, 0.7, false, 0.6);
      f.light(x, y, 160, 1, 0.9);
      break;
    case 'brewPulse': {
      // labaredas correm pelo anel enquanto ele dura
      const ang = Math.random() * Math.PI * 2;
      const px = x + Math.cos(ang) * r;
      const py = y + Math.sin(ang) * r;
      f.glow(px, py - 4, L.mayconFlame, 0.45 + Math.random() * 0.25, { life: 0.5, grow: 1.5, alpha: 0.75, vy: -30, fadeIn: 0.15 });
      f.sparks(px, py - 4, 2, L.maycon, 60, 0.5, { dir: -Math.PI / 2, spread: 0.8, g: -40 });
      break;
    }
    case 'brewEnd':
      f.shock(x, y, r, L.maycon, 0.5, 0.45, 1);
      f.sparks(x, y, 14, L.mayconFlame, 140, 0.5, { up: 30 });
      break;

    // ================================================================ gerais
    case 'parry':
      f.flare(x, y, L.gold, 1.1, 0.25);
      f.rays(x, y, 10, L.gold, 40, 0.25);
      f.light(x, y, 72, 1, 0.25);
      break;
    case 'block':
      f.flare(x, y, 0xdfefff, 0.45, 0.14);
      break;
    case 'comboFreeze':
      f.flare(x, y, L.ice, 0.8, 0.3);
      f.shock(x, y, 22, L.ice, 0.35);
      break;
    case 'comboFollowUp':
    case 'comboExpose':
      f.flare(x, y, L.gold, 0.7, 0.25);
      break;
    case 'stun':
      f.glow(x, y, L.gold, 0.5, { life: 0.4, grow: 1.4, alpha: 0.5 });
      break;
    case 'checkpoint':
    case 'checkpointRestore': {
      const restore = ev.n === 'checkpointRestore';
      f.pillar(x, y, restore ? 0xff5a3a : L.gold, 220, 2.2, 1.6);
      f.shock(x, y, 160, restore ? 0xff5a3a : L.gold, 1.1, 0.8, 0.6);
      f.swirl(x, y - 20, 24, L.gold, 90, 1.2, true, 0.5);
      f.light(x, y, 160, 1, 1.6);
      break;
    }
    // inimigos e chefes: a mesma linguagem de luz, em tons de ameaça
    case 'bossLand':
      f.shock(x, y, r, 0xff4a3a, 0.45, 0.8, 0.55);
      f.light(x, y, 112, 0.8, 0.35);
      break;
    case 'abyssBurst':
    case 'ritualDone':
      f.flare(x, y - 20, L.abyss, 1.8, 0.5);
      f.shock(x, y - 10, r, L.abyss, 0.6);
      f.light(x, y, 160, 1, 0.6);
      break;
    case 'runeBlast':
    case 'eruptionBlast':
      f.flare(x, y, L.abyss, 0.8, 0.28);
      f.shock(x, y, r, L.abyss, 0.3, 0.8);
      f.light(x, y, 72, 0.8, 0.3);
      break;
    case 'moonBlast':
    case 'frostBlast':
      f.flare(x, y, L.ice, 0.9, 0.3);
      f.shock(x, y, r, L.ice, 0.35);
      f.light(x, y, 72, 0.8, 0.3);
      break;
    case 'exposed':
      f.flare(x, y, 0xffe0a0, 1.6, 0.45);
      f.shock(x, y, r, 0xffe0a0, 0.55);
      f.light(x, y, 160, 1, 0.5);
      break;
    default:
      break;
  }
}

/** Cor do halo de cada projétil (rastro de luz). null = sem halo. */
export function projectileGlow(kind: string): { c: number; s: number } | null {
  switch (kind) {
    case 'bolt': return { c: LIGHT.hunter, s: 0.32 };
    case 'pierceBolt': return { c: LIGHT.hunterGold, s: 0.5 };
    case 'missile': return { c: LIGHT.mage, s: 0.5 };
    case 'empMissile': return { c: LIGHT.mageHi, s: 0.8 };
    case 'orb':
    case 'abyssOrb': return { c: LIGHT.abyss, s: 0.5 };
    case 'bone': return { c: LIGHT.necro, s: 0.42 };
    case 'iceShard': return { c: LIGHT.ice, s: 0.42 };
    case 'bigMelon': return { c: LIGHT.lapanha, s: 0.45 };
    case 'woundBolt': return { c: 0xb07aff, s: 0.45 };
    case 'bottle': return { c: LIGHT.glass, s: 0.3 };
    case 'chokeBomb': return { c: LIGHT.mayconFlame, s: 0.3 };
    case 'slipper': return { c: 0xffa13a, s: 0.28 };
    default: return null;
  }
}
