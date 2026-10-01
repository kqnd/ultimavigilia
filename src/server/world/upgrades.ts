/**
 * Sorteio de melhorias (v1.3): cada carta da oferta sorteia uma raridade (60/27/11/2%), depois
 * uma carta compatível dessa raridade. Proteções: pelo menos uma de classe e uma geral quando
 * possível, nada de duas cartas da mesma família na mesma oferta, no máximo uma lendária por
 * build (e nunca duas na mesma oferta), bifurcações exclusivas e evita repetir a oferta anterior.
 */
import { LEGENDARY_MAX_PER_BUILD, type Rarity, RARITIES, RARITY_INFO, UPGRADES, type UpgradeDef } from '../../shared/config/upgrades.js';
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

export function legendaryCount(p: Player): number {
  let n = 0;
  for (const [id, k] of Object.entries(p.mods)) if (k > 0 && UPGRADES.find((u) => u.id === id)?.rarity === 'legendary') n++;
  return n;
}

/** Cartas possíveis: da classe ou gerais compatíveis, abaixo do limite, sem o outro lado de uma bifurcação e respeitando o limite de lendárias. */
export function availableUpgrades(p: Player): UpgradeDef[] {
  const forks = takenForks(p);
  const legendaryFull = legendaryCount(p) >= LEGENDARY_MAX_PER_BUILD;
  return UPGRADES.filter((u) => {
    if (u.cls !== null && u.cls !== p.cls) return false;
    if (u.onlyFor && !u.onlyFor.includes(p.cls)) return false;
    const have = p.mods[u.id] ?? 0;
    if (have >= u.maxStacks) return false;
    if (u.fork && forks.has(u.fork) && have === 0) return false;
    if (u.rarity === 'legendary' && legendaryFull && have === 0) return false;
    return true;
  });
}

/** Sorteia uma raridade pelos pesos. */
export function rollRarity(rng: Rng): Rarity {
  const total = RARITIES.reduce((s, r) => s + RARITY_INFO[r].weight, 0);
  let x = rng.next() * total;
  for (const r of RARITIES) {
    x -= RARITY_INFO[r].weight;
    if (x < 0) return r;
  }
  return 'common';
}

/** Ordem de fallback quando não há carta da raridade sorteada: desce primeiro, depois sobe. */
function fallbackOrder(r: Rarity): Rarity[] {
  const i = RARITIES.indexOf(r);
  const down = RARITIES.slice(0, i).reverse();
  const up = RARITIES.slice(i + 1);
  return [r, ...down, ...up];
}

/**
 * `exclude`: cartas banidas (e, ao substituir uma, as que já estão na oferta) — nunca sorteadas.
 * Com `count` 1 (troca de uma carta banida) não força "uma de classe e uma geral".
 */
export function rollUpgrades(rng: Rng, p: Player, count = 3, recent: readonly string[] = [], exclude: readonly string[] = []): string[] {
  const avail = availableUpgrades(p).filter((u) => !exclude.includes(u.id));
  const out: UpgradeDef[] = [];
  const groups = new Set<string>();
  let legendaryInOffer = false;
  const ok = (u: UpgradeDef, avoidRecent: boolean): boolean =>
    !out.includes(u) && !(u.group && groups.has(u.group)) && !(u.rarity === 'legendary' && legendaryInOffer) && !(avoidRecent && recent.includes(u.id));
  const take = (want: 'class' | 'general' | 'any'): boolean => {
    const rarity = rollRarity(rng);
    for (const avoidRecent of [true, false]) {
      for (const r of fallbackOrder(rarity)) {
        const pool = avail.filter((u) => u.rarity === r && ok(u, avoidRecent) && (want === 'any' || (want === 'class') === (u.cls !== null)));
        if (!pool.length) continue;
        const u = rng.pick(pool);
        out.push(u);
        if (u.group) groups.add(u.group);
        if (u.rarity === 'legendary') legendaryInOffer = true;
        return true;
      }
    }
    return false;
  };
  // pelo menos uma de classe e uma geral quando possível
  if (count >= 2) {
    take('class');
    take('general');
  }
  let guard = 0;
  while (out.length < count && guard++ < 12) {
    if (!take(rng.chance(0.5) ? 'class' : 'general')) take('any');
  }
  return out.map((u) => u.id);
}
