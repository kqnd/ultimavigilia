/**
 * v1.6 — Meta-progressão leve ("Lembranças") e limites de reroll/banir por partida.
 * Lembranças são ganhas por onda vencida e por chefe abatido e gastas em pequenos desbloqueios
 * permanentes. Nenhum deles aumenta dano, vida ou resistência: só dão mais controle sobre as
 * ofertas (reroll/banir), mais Lembranças ou uma variante inicial pequena.
 */
import type { ClassId } from './classes.js';

/** Por jogador, por partida (não recarregam em checkpoint). */
export const REROLLS_PER_MATCH = 2;
export const BANISH_PER_MATCH = 2;

export const MEMORY = {
  perWave: 2,
  perMiniboss: 4,
  perBoss: 8,
  victory: 30,
  /** Teto por partida (antes de bônus), para o ganho nunca explodir. */
  maxPerMatch: 150,
} as const;

export interface PerkDef {
  id: string;
  name: string;
  desc: string;
  cost: number;
}
export const PERKS: readonly PerkDef[] = [
  { id: 'rr1', name: 'Segunda Chance', desc: '+1 reroll de cartas por partida.', cost: 40 },
  { id: 'bn1', name: 'Esquecimento', desc: '+1 banimento de carta por partida.', cost: 60 },
  { id: 'mem1', name: 'Memória Vívida', desc: '+10% de Lembranças ganhas.', cost: 80 },
  { id: 'start', name: 'Dote do Veterano', desc: 'Começa a partida com 1 carta COMUM de classe aleatória.', cost: 120 },
];
export const PERK_BY_ID: ReadonlyMap<string, PerkDef> = new Map(PERKS.map((p) => [p.id, p]));
export const MEMORY_BONUS_PER_PERK = 0.1;

export interface MemoryInput {
  /** Ondas concluídas (a onda em andamento na derrota não conta). */
  waves: number;
  minibosses: number;
  bosses: number;
  victory: boolean;
}

/** Lembranças ganhas numa partida, com bônus de perks já aplicado. */
export function memoryReward(i: MemoryInput, perks: readonly string[] = []): number {
  const base = Math.min(
    MEMORY.maxPerMatch,
    Math.max(0, i.waves) * MEMORY.perWave + Math.max(0, i.minibosses) * MEMORY.perMiniboss + Math.max(0, i.bosses) * MEMORY.perBoss + (i.victory ? MEMORY.victory : 0),
  );
  const mul = 1 + (perks.includes('mem1') ? MEMORY_BONUS_PER_PERK : 0);
  return Math.round(base * mul);
}

/** Valida ids recebidos da rede/disco: só perks conhecidos, sem repetição. */
export function sanitizePerks(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const v of raw) if (typeof v === 'string' && PERK_BY_ID.has(v) && !out.includes(v)) out.push(v);
  return out;
}

/** Perfil persistente (separado do estado da partida, que é descartado ao morrer). */
export interface Profile {
  memories: number;
  totalEarned: number;
  perks: string[];
  runs: number;
  wins: number;
  bestWave: number;
  /** Melhor onda por classe. */
  bestByClass: Partial<Record<ClassId, number>>;
}
export const EMPTY_PROFILE: Profile = { memories: 0, totalEarned: 0, perks: [], runs: 0, wins: 0, bestWave: 0, bestByClass: {} };

export function normalizeProfile(raw: unknown): Profile {
  const p: Profile = { ...EMPTY_PROFILE, perks: [], bestByClass: {} };
  if (typeof raw !== 'object' || raw === null) return p;
  const r = raw as Record<string, unknown>;
  const n = (v: unknown, hi = 1e7): number => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(0, Math.floor(v))) : 0);
  p.memories = n(r.memories);
  p.totalEarned = Math.max(n(r.totalEarned), p.memories);
  p.perks = sanitizePerks(r.perks);
  p.runs = n(r.runs);
  p.wins = Math.min(p.runs, n(r.wins));
  p.bestWave = n(r.bestWave, 999);
  if (typeof r.bestByClass === 'object' && r.bestByClass !== null) {
    for (const [k, v] of Object.entries(r.bestByClass as Record<string, unknown>)) p.bestByClass[k as ClassId] = n(v, 999);
  }
  return p;
}

export interface RunResult {
  memories: number;
  wave: number;
  victory: boolean;
  cls: ClassId | null;
}

/** Aplica o fim de uma partida ao perfil (puro). */
export function applyRun(profile: Profile, run: RunResult): Profile {
  const gain = Math.max(0, Math.min(MEMORY.maxPerMatch * 2, Math.floor(run.memories)));
  const bestByClass = { ...profile.bestByClass };
  if (run.cls) bestByClass[run.cls] = Math.max(bestByClass[run.cls] ?? 0, run.wave);
  return {
    ...profile,
    memories: profile.memories + gain,
    totalEarned: profile.totalEarned + gain,
    runs: profile.runs + 1,
    wins: profile.wins + (run.victory ? 1 : 0),
    bestWave: Math.max(profile.bestWave, run.wave),
    bestByClass,
    perks: [...profile.perks],
  };
}

/** Compra um perk; retorna o mesmo perfil se não for possível. */
export function buyPerk(profile: Profile, id: string): { profile: Profile; ok: boolean } {
  const def = PERK_BY_ID.get(id);
  if (!def || profile.perks.includes(id) || profile.memories < def.cost) return { profile, ok: false };
  return { profile: { ...profile, memories: profile.memories - def.cost, perks: [...profile.perks, id] }, ok: true };
}
