/** Sorteio de melhorias: 3 opções sem duplicatas, respeitando limites e combinando gerais + classe. */
import { UPGRADES, type UpgradeDef } from '../../shared/config/upgrades.js';
import type { Rng } from '../../shared/math.js';
import type { Player } from './types.js';

/** Bifurcações já escolhidas pelo jogador. */
export function takenForks(p: Player): Set<string> {
  const out = new Set<string>();
  for (const [id, n] of Object.entries(p.mods)) {
    if (n <= 0) continue;
    const f = UPGRADES.find((u) => u.id === id)?.fork;
    if (f) out.add(f);
  }
  return out;
}

/** Cartas possíveis: da classe ou gerais, abaixo do limite, e sem o outro lado de uma bifurcação já tomada. */
export function availableUpgrades(p: Player): UpgradeDef[] {
  const forks = takenForks(p);
  return UPGRADES.filter((u) => {
    if (u.cls !== null && u.cls !== p.cls) return false;
    const have = p.mods[u.id] ?? 0;
    if (have >= u.maxStacks) return false;
    if (u.fork && forks.has(u.fork) && have === 0) return false;
    return true;
  });
}

export function rollUpgrades(rng: Rng, p: Player, count = 3): string[] {
  const avail = availableUpgrades(p);
  const cls = avail.filter((u) => u.cls !== null);
  const gen = avail.filter((u) => u.cls === null);
  const out: UpgradeDef[] = [];
  const take = (pool: UpgradeDef[]): void => {
    // os dois lados de uma bifurcação podem aparecer juntos: escolher um exclui o outro para sempre
    const rest = pool.filter((u) => !out.includes(u));
    if (rest.length) out.push(rng.pick(rest));
  };
  // pelo menos uma de classe e uma geral quando possível
  take(cls);
  take(gen);
  while (out.length < count) {
    const before = out.length;
    take(rng.chance(0.5) ? cls : gen);
    if (out.length === before) take(avail);
    if (out.length === before) break;
  }
  return out.map((u) => u.id);
}
