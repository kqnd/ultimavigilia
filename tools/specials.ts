/**
 * Frequência dos inimigos especiais (Acólito Sombrio, Caçador de Névoa, Portador do Ossário) na
 * fila do diretor, para várias sementes. Conta aparições acumuladas até as ondas 10, 20 e 30.
 * Uso: node --import tsx tools/specials.ts [sementes=20] [jogadores=1]
 */
import type { ClassId } from '../src/shared/config/classes.js';
import { World } from '../src/server/world/world.js';

const seeds = Number(process.argv[2] ?? 20);
const players = Number(process.argv[3] ?? 1);
const TYPES = ['shadowAcolyte', 'mistStalker', 'ossuaryBearer'] as const;
const marks = [10, 20, 30];
const acc: Record<number, Record<string, number[]>> = {};
for (const m of marks) acc[m] = Object.fromEntries(TYPES.map((t) => [t, [] as number[]]));
let wavesWithout = 0;
let wavesCounted = 0;
let pairWaves = 0;
let trioWaves = 0;
for (let s = 1; s <= seeds; s++) {
  const w = new World({ seed: s, solo: players === 1 });
  for (let i = 0; i < players; i++) w.addPlayer(i + 1, `P${i}`, (['hunter', 'vampire', 'tank', 'mage'] as ClassId[])[i % 4] as ClassId);
  w.startMatch();
  const total: Record<string, number> = { shadowAcolyte: 0, mistStalker: 0, ossuaryBearer: 0 };
  for (let wave = 1; wave <= 30; wave++) {
    w.debug('wave', wave, '');
    const q = [...((w.director as unknown as { queue: string[] }).queue ?? [])];
    const kinds = new Set<string>();
    for (const t of q) if (t in total) {
      total[t] = (total[t] ?? 0) + 1;
      kinds.add(t);
    }
    const boss = wave % 10 === 0 || wave % 10 === 5;
    if (!boss && wave >= 9) {
      wavesCounted++;
      if (kinds.size === 0) wavesWithout++;
      if (kinds.size === 2) pairWaves++;
      if (kinds.size === 3) trioWaves++;
    }
    if (marks.includes(wave)) for (const t of TYPES) acc[wave]?.[t]?.push(total[t] ?? 0);
  }
}
const avg = (a: number[]): string => (a.reduce((x, y) => x + y, 0) / Math.max(1, a.length)).toFixed(1);
console.log(`${seeds} sementes, ${players} jogador(es) — aparições acumuladas (média [mín–máx])`);
for (const m of marks) {
  console.log(`  até a onda ${m}: ` + TYPES.map((t) => { const a = acc[m]?.[t] ?? []; return `${t} ${avg(a)} [${Math.min(...a)}–${Math.max(...a)}]`; }).join(' · '));
}
console.log(`  ondas comuns 9–29: sem especial ${wavesWithout}/${wavesCounted}, com 2 tipos ${pairWaves}, com os 3 ${trioWaves}`);
