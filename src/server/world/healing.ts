/**
 * Cura, Ferida Profana, escudos temporários, sacrifício de vida e atordoamento de jogadores.
 *
 * Toda cura de jogador passa por `healPlayer`, que aplica, nesta ordem:
 *   1. valor já calculado sobre DANO VÁLIDO (quem chama usa `healBasis`/`multiTargetMul`);
 *   2. retorno decrescente por alvo extra (idem, aplicado por quem chama);
 *   3. bônus de cartas (somados, com teto global);
 *   4. Ferida Profana (bloqueio total breve, depois -70%);
 *   5. teto por uso (opcional, `use`);
 *   6. teto por segundo das curas "de combate" (balde que enche continuamente);
 *   7. vida máxima.
 */
import { COMBAT_HEAL, HEAL_RULES, type HealSource, PLAYER_CC, PLAYER_SHIELD } from '../../shared/config/classes.js';
import { ATK } from '../../shared/config/enemies.js';
import { UPGRADE_CAPS } from '../../shared/config/upgrades.js';
import { DT, sec, TICK_RATE } from '../../shared/constants.js';
import type { Enemy, Player, PlayerTelemetry } from './types.js';
import type { World } from './world.js';

export const newTelemetry = (): PlayerTelemetry => ({
  heal: {}, wasted: 0, woundCut: 0, taken: 0, lowTicks: 0, woundsApplied: 0, woundsAvoided: 0, woundsInterrupted: 0, sacrificed: 0, stuns: 0, stunsResisted: 0,
});

/** Multiplicador de retorno decrescente para o i-ésimo alvo (0 = primeiro) da mesma ação. */
export function multiTargetMul(i: number): number {
  const m = HEAL_RULES.multiTarget;
  return m[Math.min(Math.max(0, i), m.length - 1)] ?? 0;
}

/** Base de cura de um acerto: dano válido, sem que bônus acima de +25% aumentem a cura. */
export function healBasis(valid: number, nominal: number): number {
  return Math.max(0, Math.min(valid, nominal * HEAL_RULES.basisCapMul));
}

/** Multiplicador de cura recebida pela Ferida Profana (0 no bloqueio total). */
export function woundMul(p: Player): number {
  if (p.woundT <= 0) return 1;
  if (p.woundBlockT > 0) return 0;
  return 1 - ATK.shadowAcolyte.wound.reduction;
}

/** Contador de uso (teto por uso de uma habilidade). */
export interface HealUse {
  used: number;
  cap: number;
}

export function healPlayer(w: World, p: Player, amount: number, src: HealSource, use?: HealUse): number {
  if (p.status !== 0 || !(amount > 0)) return 0;
  let a = amount;
  if (src === 'pickup') a *= 1 + Math.min(UPGRADE_CAPS.healBonus, w.mod(p, 'g_pickup'));
  const wm = woundMul(p);
  if (wm < 1) {
    p.tele.woundCut += a * (1 - wm);
    a *= wm;
  }
  if (use) {
    a = Math.min(a, Math.max(0, use.cap - use.used));
    use.used += a;
  }
  if (COMBAT_HEAL.has(src)) {
    a = Math.min(a, Math.max(0, p.healBudget));
    p.healBudget -= a;
  }
  if (a <= 0) return 0;
  const before = p.hp;
  p.hp = Math.min(p.maxHp, p.hp + a);
  const got = p.hp - before;
  p.tele.heal[src] = (p.tele.heal[src] ?? 0) + got;
  p.tele.wasted += a - got;
  p.recentHeal += got;
  if (got >= 1) w.emit({ k: 'dmg', tg: 'p', ti: p.id, v: Math.round(got), x: p.x, y: p.y - 18, c: 'heal', s: 0 });
  return got;
}

/** Por tick: balde de cura por segundo, decaimento da cura recente, Ferida, escudo e telemetria. */
export function tickPlayerHealth(w: World, p: Player): void {
  const cap = HEAL_RULES.combatPerSecond[p.cls];
  p.healBudget = Math.min(cap, p.healBudget + cap / TICK_RATE);
  p.recentHeal *= Math.exp(-DT / HEAL_RULES.recentWindow);
  if (p.woundT > 0) {
    p.woundT--;
    if (p.woundBlockT > 0) p.woundBlockT--;
    if (p.woundT === 0) {
      p.woundBlockT = 0;
      p.woundBy = 0;
    }
  }
  if (p.shieldT > 0 && --p.shieldT === 0) p.shieldHp = 0;
  if (p.guardCdT > 0) p.guardCdT--;
  if (p.heartCdT > 0) p.heartCdT--;
  if (p.status === 0 && p.hp / p.maxHp < 0.3) p.tele.lowTicks++;
  void w;
}

/** Remove efeitos negativos persistentes (queda, morte, troca de onda ou mapa). */
export function clearAfflictions(p: Player): void {
  p.woundT = 0;
  p.woundBlockT = 0;
  p.woundBy = 0;
  p.buffs.stunRes = 0;
  p.buffs.slowed = 0;
  p.slowMul = 1;
  if (p.action?.name === 'stun') p.action = null;
}

// ------------------------------------------------------------------ Ferida Profana

/** Aplica (ou renova até o limite) a Ferida Profana. Nunca acumula intensidade. */
export function applyWound(w: World, p: Player, src: Enemy | null): void {
  if (p.status !== 0) return;
  const W = ATK.shadowAcolyte.wound;
  const fresh = p.woundT <= 0;
  p.woundT = Math.max(p.woundT, sec(W.duration));
  if (fresh) p.woundBlockT = sec(W.blockSeconds);
  p.woundBy = src?.id ?? 0;
  p.tele.woundsApplied++;
  w.emit({ k: 'fx', n: 'woundHit', x: p.x, y: p.y - 14, a: fresh ? 1 : 0, o: p.woundBy, r: p.id });
  w.emit({ k: 'sfx', n: 'woundHit', x: p.x, y: p.y });
}

// ------------------------------------------------------------------ escudos e sacrifício

export function addShield(p: Player, amount: number, seconds: number): void {
  p.shieldHp = Math.min(PLAYER_SHIELD.max, p.shieldHp + amount);
  p.shieldT = Math.max(p.shieldT, sec(seconds));
}

/** Escudo absorve dano de inimigos. Retorna o dano que sobra. */
export function absorbWithShield(w: World, p: Player, dmg: number): number {
  if (p.shieldHp <= 0 || dmg <= 0) return dmg;
  const took = Math.min(p.shieldHp, dmg);
  p.shieldHp -= took;
  if (p.shieldHp <= 0) {
    p.shieldHp = 0;
    p.shieldT = 0;
  }
  w.emit({ k: 'dmg', tg: 'p', ti: p.id, v: Math.max(1, Math.round(took)), x: p.x, y: p.y - 16, c: 'shd', s: 0 });
  return dmg - took;
}

/**
 * Sacrifício voluntário de vida (Coração Maduro): nunca abaixo de 1, ignora armadura, escudos e
 * Ferida, não conta como dano recebido (sem suprema, Fúria, stagger ou quebra de reviver).
 * Retorna quanto foi realmente pago.
 */
export function sacrificeLife(w: World, p: Player, amount: number): number {
  if (p.status !== 0 || amount <= 0) return 0;
  const paid = Math.max(0, Math.min(amount, p.hp - 1));
  if (paid <= 0) return 0;
  p.hp -= paid;
  p.tele.sacrificed += paid;
  p.stats.sac = (p.stats.sac ?? 0) + paid;
  w.emit({ k: 'dmg', tg: 'p', ti: p.id, v: Math.max(1, Math.round(paid)), x: p.x, y: p.y - 16, c: 'sac', s: 0 });
  return paid;
}

// ------------------------------------------------------------------ atordoamento

export type StunResult = 'stun' | 'resisted' | 'ignored';

/**
 * Atordoamento raro (golpes anunciados e evitáveis). Depois de um atordoamento, o jogador fica
 * resistente por `PLAYER_CC.resist` s: novos atordoamentos viram uma lentidão curta.
 * Esquiva/i-frames e bloqueio são tratados antes, em `hitPlayer`.
 */
export function stunPlayer(w: World, p: Player, seconds: number): StunResult {
  if (p.status !== 0 || seconds <= 0) return 'ignored';
  if (p.buffs.stunRes > 0 || p.buffs.madness > 0) {
    p.buffs.slowed = Math.max(p.buffs.slowed, sec(PLAYER_CC.resistSlowSeconds));
    p.slowMul = Math.min(p.slowMul, PLAYER_CC.resistSlowMul);
    p.tele.stunsResisted++;
    w.emit({ k: 'fx', n: 'stunResist', x: p.x, y: p.y - 22, a: 0, o: p.id, r: 0 });
    return 'resisted';
  }
  const s = Math.min(PLAYER_CC.maxStun, seconds);
  p.blocking = false;
  p.buffered = null;
  p.revivingId && w.cancelRevive(p);
  const a = w.startAction(p, 'stun', { windup: 0, active: 0, recovery: sec(s) }, { moveMul: 0 });
  a.cancelFrom = 999;
  p.buffs.stunRes = sec(s + PLAYER_CC.resist);
  p.tele.stuns++;
  w.emit({ k: 'fx', n: 'stun', x: p.x, y: p.y - 26, a: s, o: p.id, r: 0 });
  w.emit({ k: 'sfx', n: 'stun', x: p.x, y: p.y });
  return 'stun';
}
