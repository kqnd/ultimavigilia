/**
 * v1.6 — variedade procedural das ondas: determinismo por semente, orçamento preservado e
 * ondas de checkpoint idênticas à definição.
 */
import { describe, expect, it } from 'vitest';
import { ENEMIES, type EnemyType } from '../src/shared/config/enemies.js';
import { isCheckpointWave, scaledBudget, TOTAL_WAVES, WAVES } from '../src/shared/config/waves.js';
import { fillQueue, planWave, VARIETY } from '../src/shared/config/waveVariety.js';
import { Rng } from '../src/shared/math.js';
import { World } from '../src/server/world/world.js';

const entriesOf = (w: Partial<Record<EnemyType, number>>): [EnemyType, number][] => Object.entries(w) as [EnemyType, number][];
const cost = (q: readonly EnemyType[]): number => q.reduce((s, t) => s + ENEMIES[t].budget, 0);
const MAX_ITEM = 8;

describe('variedade de ondas', () => {
  it('é determinística por semente e onda', () => {
    for (let wave = 1; wave <= TOTAL_WAVES; wave++) {
      const a = planWave(wave, WAVES[wave - 1]!, 1234, 4);
      const b = planWave(wave, WAVES[wave - 1]!, 1234, 4);
      expect(b).toEqual(a);
    }
    // sementes diferentes variam (ao menos uma onda comum difere)
    let differs = 0;
    for (let wave = 3; wave <= TOTAL_WAVES; wave++) if (JSON.stringify(planWave(wave, WAVES[wave - 1]!, 1, 4)) !== JSON.stringify(planWave(wave, WAVES[wave - 1]!, 2, 4))) differs++;
    expect(differs).toBeGreaterThan(10);
  });

  it('o diretor monta a mesma fila para a mesma semente', () => {
    const queueOf = (seed: number): EnemyType[] => {
      const w = new World({ seed, solo: true });
      w.addPlayer(1, 'P1', 'hunter' as never);
      w.startMatch();
      w.director.start(7, 1);
      return (w.director as unknown as { queue: EnemyType[] }).queue.slice();
    };
    expect(queueOf(77)).toEqual(queueOf(77));
    expect(queueOf(77).length).toBeGreaterThan(5);
  });

  it('o orçamento fica dentro da tolerância e a média preserva a curva', () => {
    for (let wave = 1; wave <= TOTAL_WAVES; wave++) {
      const def = WAVES[wave - 1]!;
      if (def.boss || def.miniboss) continue;
      const budget = scaledBudget(wave, 1);
      let sumVar = 0;
      let sumBase = 0;
      const N = 200;
      for (let seed = 1; seed <= N; seed++) {
        const plan = planWave(wave, def, seed, 4);
        const q = fillQueue(entriesOf(plan.weights), budget, new Rng(seed * 7919));
        const c = cost(q);
        expect(c).toBeGreaterThanOrEqual(budget - 0.5 - 1e-9);
        expect(c).toBeLessThan(budget + MAX_ITEM);
        sumVar += c;
        sumBase += cost(fillQueue(entriesOf(def.weights), budget, new Rng(seed * 7919)));
      }
      expect(Math.abs(sumVar - sumBase) / N / budget).toBeLessThan(0.06);
    }
  });

  it('ondas de checkpoint ficam inalteradas', () => {
    for (let wave = 1; wave <= TOTAL_WAVES; wave++) {
      if (!isCheckpointWave(wave)) continue;
      const def = WAVES[wave - 1]!;
      for (const seed of [1, 21, 999, 123456]) {
        const plan = planWave(wave, def, seed, 4);
        expect(plan).toEqual({ weights: def.weights, groupMin: def.groupMin, groupMax: def.groupMax, interval: def.interval, maxAlive: def.maxAlive, tilt: null, modifier: null, gateFocus: null });
        const a = fillQueue(entriesOf(plan.weights), scaledBudget(wave, 1), new Rng(seed));
        const b = fillQueue(entriesOf(def.weights), scaledBudget(wave, 1), new Rng(seed));
        expect(a).toEqual(b);
      }
    }
  });

  it('ondas 1-2, respiro e evento não recebem modificador, e a taxa global é razoável', () => {
    let mods = 0;
    let eligible = 0;
    for (let seed = 1; seed <= 300; seed++) {
      for (let wave = 1; wave <= TOTAL_WAVES; wave++) {
        const def = WAVES[wave - 1]!;
        const plan = planWave(wave, def, seed, 4);
        if (wave <= 2) expect(plan.weights).toEqual(def.weights);
        if (def.breather || def.event) expect(plan.modifier).toBeNull();
        if (!def.boss && !def.miniboss && !def.breather && !def.event && wave >= 3) {
          eligible++;
          if (plan.modifier) mods++;
        }
      }
    }
    expect(mods / eligible).toBeGreaterThan(VARIETY.modifierChance - 0.07);
    expect(mods / eligible).toBeLessThan(VARIETY.modifierChance + 0.07);
  });

  it('não introduz tipos fora da definição da onda', () => {
    for (let seed = 1; seed <= 50; seed++)
      for (let wave = 3; wave <= TOTAL_WAVES; wave++) {
        const def = WAVES[wave - 1]!;
        expect(Object.keys(planWave(wave, def, seed, 4).weights).sort()).toEqual(Object.keys(def.weights).sort());
      }
  });

  it('cerco usa só dois portões válidos', () => {
    let seen = 0;
    for (let seed = 1; seed <= 400 && seen < 5; seed++) {
      const plan = planWave(12 + (seed % 3), WAVES[11 + (seed % 3)]!, seed, 5);
      if (plan.modifier === 'siege') {
        seen++;
        expect(plan.gateFocus).toHaveLength(2);
        for (const g of plan.gateFocus!) expect(g).toBeLessThan(5);
      }
    }
    expect(seen).toBeGreaterThan(0);
  });
});
