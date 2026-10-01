/**
 * Contexto de IA por tick: contagens compartilhadas (carga de alvos, atacantes simultâneos) e
 * zonas perigosas dos jogadores. Reconstruído no máximo uma vez por tick e por mundo.
 */
import { ARCHETYPES, type Archetype, DEFAULT_ARCHETYPE, FAIR, STEER } from '../../../shared/config/enemyAI.js';
import { brainType } from '../../../shared/config/enemies.js';
import type { Enemy, Zone } from '../types.js';
import type { World } from '../world.js';

export interface AICache {
  tick: number;
  size: number;
  /** Inimigos (não-objetivo) que têm o jogador como alvo atual. */
  load: Map<number, number>;
  /** Inimigos de combate próximo preparando/executando golpe contra o jogador. */
  attackers: Map<number, number>;
  /** Zonas colocadas por jogadores que ferem/atrapalham inimigos. */
  dangers: Zone[];
}

const caches = new WeakMap<World, AICache>();

export const archetypeOf = (e: Enemy): Archetype => ARCHETYPES[brainType(e.type)] ?? DEFAULT_ARCHETYPE;

export function aiCache(w: World): AICache {
  let c = caches.get(w);
  if (c && c.tick === w.tick && c.size === w.enemies.size) return c;
  c = { tick: w.tick, size: w.enemies.size, load: new Map(), attackers: new Map(), dangers: [] };
  for (const e of w.enemies.values()) {
    if (e.state === 'dead' || e.def.objective || !e.targetId) continue;
    c.load.set(e.targetId, (c.load.get(e.targetId) ?? 0) + 1);
    if ((e.state === 'windup' || e.state === 'active') && e.def.tier !== 'boss' && archetypeOf(e).role !== 'shooter') {
      c.attackers.set(e.targetId, (c.attackers.get(e.targetId) ?? 0) + 1);
    }
  }
  for (const z of w.zones) if (!z.dead && z.owner > 0 && STEER.kiteZoneKinds.includes(z.kind)) c.dangers.push(z);
  caches.set(w, c);
  return c;
}

/**
 * Ficha de ataque: limita quantos inimigos de combate próximo preparam golpe no mesmo jogador
 * ao mesmo tempo (justiça contra cerco). Chefes e alvos que não são jogadores não são limitados.
 */
export function claimAttack(w: World, e: Enemy, targetId: number, isPlayer: boolean): boolean {
  if (!isPlayer || e.def.tier === 'boss' || e.def.miniboss) return true;
  const c = aiCache(w);
  const n = c.attackers.get(targetId) ?? 0;
  if (n >= FAIR.maxAttackers) return false;
  c.attackers.set(targetId, n + 1);
  return true;
}
