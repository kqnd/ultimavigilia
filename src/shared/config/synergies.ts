/**
 * v1.6 — Sinergias entre cartas. Duas camadas, ambas somadas DENTRO das famílias já limitadas por
 * UPGRADE_CAPS (nunca furam o teto global):
 *  1. Tags de build: cada acúmulo de carta com a tag soma 1 ponto; 3 e 6 pontos liberam bônus de conjunto.
 *  2. Combinações: duas cartas específicas juntas ativam um efeito próprio (ex.: Carrasco).
 * Funções puras, usadas pelo servidor (efeito) e pela interface (dicas), sempre sobre `mods`.
 */
import { UPGRADE_BY_ID } from './upgrades.js';

export type BuildTag = 'ferro' | 'muralha' | 'vento' | 'folego' | 'oficio';
export const BUILD_TAGS: readonly BuildTag[] = ['ferro', 'muralha', 'vento', 'folego', 'oficio'];
export const TAG_INFO: Record<BuildTag, { name: string; hint: string }> = {
  ferro: { name: 'Ferro', hint: 'ofensiva' },
  muralha: { name: 'Muralha', hint: 'resistência' },
  vento: { name: 'Vento', hint: 'mobilidade e recarga' },
  folego: { name: 'Fôlego', hint: 'stamina e ritmo' },
  oficio: { name: 'Ofício', hint: 'cartas da sua classe' },
};

/** Famílias que as sinergias podem reforçar (as mesmas dos tetos globais). */
export type SynKey = 'damage' | 'damageReduction' | 'cooldown' | 'moveSpeed' | 'healBonus' | 'attackSpeed';
export type SynEffects = Partial<Record<SynKey, number>> & { guardShield?: number };

export const GENERAL_TAGS: Record<string, readonly BuildTag[]> = {
  g_fury: ['ferro'], g_first: ['ferro'], g_support: ['ferro'], g_breaker: ['ferro'], g_poise: ['ferro'], g_pressure: ['ferro'], g_haste: ['ferro'],
  g_hide: ['muralha'], g_vigor: ['muralha'], g_skin: ['muralha'], g_guard: ['muralha'], g_objective: ['muralha'], g_bond: ['muralha'], g_pickup: ['muralha'],
  g_step: ['vento'], g_agility: ['vento'], g_retreat: ['vento'], g_dodge: ['vento'], g_qcd: ['vento'], g_ecd: ['vento'], g_focus: ['vento'], g_reach: ['vento'],
  g_lung: ['folego'], g_rhythm: ['folego'], g_breath: ['folego'], g_recovery: ['folego'], g_second: ['folego'], g_devotion: ['folego'], g_eye: ['folego'],
};

/** Tags de uma carta: gerais pelo mapa; cartas de classe são sempre "oficio". */
export function cardTags(id: string): readonly BuildTag[] {
  const u = UPGRADE_BY_ID.get(id);
  if (!u) return [];
  return u.cls !== null ? ['oficio'] : (GENERAL_TAGS[id] ?? []);
}

/** Pontos de cada tag (soma dos acúmulos). */
export function tagPoints(mods: Readonly<Record<string, number>>): Record<BuildTag, number> {
  const out: Record<BuildTag, number> = { ferro: 0, muralha: 0, vento: 0, folego: 0, oficio: 0 };
  for (const [id, n] of Object.entries(mods)) {
    if (n <= 0) continue;
    for (const t of cardTags(id)) out[t] += n;
  }
  return out;
}

/** Bônus de conjunto: limiares de pontos (cada nível substitui o anterior, não soma). */
export const SET_TIERS = [3, 6] as const;
export const SET_BONUSES: Record<BuildTag, readonly [SynEffects, SynEffects]> = {
  ferro: [{ damage: 0.03 }, { damage: 0.06 }],
  muralha: [{ damageReduction: 0.02 }, { damageReduction: 0.04 }],
  vento: [{ cooldown: 0.03 }, { cooldown: 0.05, moveSpeed: 0.02 }],
  folego: [{ attackSpeed: 0.02 }, { attackSpeed: 0.04 }],
  oficio: [{ damage: 0.02 }, { damage: 0.04, cooldown: 0.02 }],
};

export interface Synergy {
  id: string;
  name: string;
  /** Todas as cartas precisam estar com pelo menos 1 acúmulo. */
  needs: readonly [string, string];
  desc: string;
  effects: SynEffects;
}
export const SYNERGIES: readonly Synergy[] = [
  { id: 'executioner', name: 'Carrasco', needs: ['g_fury', 'g_first'], desc: '+4% de dano.', effects: { damage: 0.04 } },
  { id: 'bulwark', name: 'Muralha Viva', needs: ['g_skin', 'g_guard'], desc: '-3% de dano recebido e +10 no escudo da Defesa Improvisada.', effects: { damageReduction: 0.03, guardShield: 10 } },
  { id: 'tempo', name: 'Compasso Sombrio', needs: ['g_focus', 'g_haste'], desc: '-3% de recarga.', effects: { cooldown: 0.03 } },
  { id: 'phantom', name: 'Passo Fantasma', needs: ['g_retreat', 'g_agility'], desc: '+3% de velocidade.', effects: { moveSpeed: 0.03 } },
  { id: 'survivor', name: 'Sobrevivente Nato', needs: ['g_pickup', 'g_vigor'], desc: '+5% de cura de itens.', effects: { healBonus: 0.05 } },
  { id: 'hunter_trail', name: 'Trilha de Ferro', needs: ['h_pierce', 'h_ricochet'], desc: '+4% de dano.', effects: { damage: 0.04 } },
  { id: 'mage_frost', name: 'Inverno Pleno', needs: ['m_converge', 'm_area'], desc: '+4% de dano.', effects: { damage: 0.04 } },
  { id: 'tank_wall', name: 'Martelo e Escudo', needs: ['t_mace', 't_vanguard'], desc: '+4% de dano.', effects: { damage: 0.04 } },
  { id: 'vamp_noble', name: 'Banquete Nobre', needs: ['v_fangs', 'v_noble'], desc: '+4% de dano.', effects: { damage: 0.04 } },
  { id: 'bers_rage', name: 'Sangue em Fúria', needs: ['b_blood', 'b_rage'], desc: '+4% de dano.', effects: { damage: 0.04 } },
  { id: 'necro_reap', name: 'Colheita Fúnebre', needs: ['n_bones', 'n_reaper'], desc: '+4% de dano.', effects: { damage: 0.04 } },
  { id: 'lap_harvest', name: 'Safra Dourada', needs: ['l_seed', 'l_precise'], desc: '+4% de dano.', effects: { damage: 0.04 } },
  { id: 'may_fire', name: 'Rodada Incendiária', needs: ['y_bottle', 'y_hellfire'], desc: '+4% de dano.', effects: { damage: 0.04 } },
  { id: 'dog_pack', name: 'Matilha Ressonante', needs: ['d_magnet', 'd_resonance'], desc: '-3% de recarga.', effects: { cooldown: 0.03 } },
];

export interface SynergyTotals {
  damage: number;
  damageReduction: number;
  cooldown: number;
  moveSpeed: number;
  healBonus: number;
  attackSpeed: number;
  guardShield: number;
}
export const NO_SYNERGY: Readonly<SynergyTotals> = { damage: 0, damageReduction: 0, cooldown: 0, moveSpeed: 0, healBonus: 0, attackSpeed: 0, guardShield: 0 };

export function setTier(points: number): 0 | 1 | 2 {
  return points >= SET_TIERS[1] ? 2 : points >= SET_TIERS[0] ? 1 : 0;
}

export function activeSynergies(mods: Readonly<Record<string, number>>): Synergy[] {
  return SYNERGIES.filter((s) => (mods[s.needs[0]] ?? 0) > 0 && (mods[s.needs[1]] ?? 0) > 0);
}

/** Soma dos efeitos de conjunto e combinações para um conjunto de cartas. */
export function synergyTotals(mods: Readonly<Record<string, number>>): SynergyTotals {
  const t: SynergyTotals = { ...NO_SYNERGY };
  const add = (e: SynEffects): void => {
    for (const k of Object.keys(e) as (keyof SynEffects)[]) t[k] += e[k] ?? 0;
  };
  const pts = tagPoints(mods);
  for (const tag of BUILD_TAGS) {
    const tier = setTier(pts[tag]);
    if (tier > 0) add(SET_BONUSES[tag][tier - 1] as SynEffects);
  }
  for (const s of activeSynergies(mods)) add(s.effects);
  return t;
}

/** Combinações que esta carta completaria (a outra metade já está no build). */
export function completesSynergy(mods: Readonly<Record<string, number>>, id: string): Synergy[] {
  return SYNERGIES.filter((s) => {
    const other = s.needs[0] === id ? s.needs[1] : s.needs[1] === id ? s.needs[0] : null;
    return other !== null && (mods[other] ?? 0) > 0 && (mods[id] ?? 0) === 0;
  });
}
