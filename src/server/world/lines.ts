/** Falas de personagens (balões): frequência limitada e escolha determinística (não usa o RNG do jogo). */
import { LINE_RULES, type LineKind, LINES } from '../../shared/config/lines.js';
import { sec } from '../../shared/constants.js';
import type { Player } from './types.js';
import type { World } from './world.js';

const lastKind = new WeakMap<Player, Map<LineKind, number>>();

export function playerSay(w: World, p: Player, kind: LineKind, force = false): void {
  const pool = LINES[p.cls]?.[kind];
  if (!pool || !pool.length || (p.status !== 0 && kind !== 'defeat')) return;
  let kinds = lastKind.get(p);
  if (!kinds) {
    kinds = new Map();
    lastKind.set(p, kinds);
  }
  const prevKind = kinds.get(kind) ?? -99999;
  if (!force && (w.tick - p.lastSayTick < sec(LINE_RULES.minGap) || w.tick - prevKind < sec(LINE_RULES.sameKindGap))) return;
  p.lastSayTick = w.tick;
  kinds.set(kind, w.tick);
  const txt = pool[(w.tick + p.id * 7 + kind.length) % pool.length] as string;
  w.emit({ k: 'say', pi: p.id, txt });
}
