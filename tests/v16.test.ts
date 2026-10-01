/**
 * v1.6 — sinergias entre cartas, reroll/banir, meta-progressão (Lembranças) e estatísticas de partida.
 */
import { describe, expect, it } from 'vitest';
import type { ClassId } from '../src/shared/config/classes.js';
import { CLASS_IDS } from '../src/shared/config/classes.js';
import {
  applyRun, BANISH_PER_MATCH, buyPerk, EMPTY_PROFILE, MEMORY, memoryReward, normalizeProfile, PERKS, REROLLS_PER_MATCH, sanitizePerks,
} from '../src/shared/config/meta.js';
import {
  activeSynergies, BUILD_TAGS, cardTags, completesSynergy, SET_BONUSES, setTier, SYNERGIES, synergyTotals, tagPoints,
} from '../src/shared/config/synergies.js';
import { UPGRADE_BY_ID, UPGRADE_CAPS, UPGRADES } from '../src/shared/config/upgrades.js';
import { parseClientMessage } from '../src/shared/protocol.js';
import type { Player } from '../src/server/world/types.js';
import { World } from '../src/server/world/world.js';

function mkWorld(cls: ClassId = 'tank', perks: string[] = []): World {
  const w = new World({ seed: 33, solo: true });
  w.addPlayer(1, 'P1', cls);
  w.setPerks(1, perks);
  w.startMatch();
  w.phaseTimer = 0;
  w.director.reset();
  w.debug('hold', 0, '');
  w.debug('kill', 0, '');
  w.god = true;
  return w;
}
const me = (w: World): Player => w.players.get(1) as Player;
function toIntermission(w: World): void {
  w.holdWave = false;
  w.phaseTimer = 0;
  w.director.complete = () => true;
  w.step();
  expect(w.phase).toBe('intermission');
}

describe('sinergias: dados consistentes', () => {
  it('toda combinação usa cartas existentes e compatíveis entre si', () => {
    for (const s of SYNERGIES) {
      const [a, b] = s.needs.map((id) => UPGRADE_BY_ID.get(id));
      expect(a, s.id).toBeDefined();
      expect(b, s.id).toBeDefined();
      expect(a?.cls ?? b?.cls ?? null).toBe(b?.cls ?? a?.cls ?? null);
      // a combinação nunca depende de duas cartas de bifurcações rivais
      if (a?.fork && b?.fork) expect(a.fork).not.toBe(b.fork);
    }
    expect(new Set(SYNERGIES.map((s) => s.id)).size).toBe(SYNERGIES.length);
  });

  it('toda carta geral tem tag e toda carta de classe é Ofício', () => {
    for (const u of UPGRADES) {
      if (u.cls === null) expect(cardTags(u.id).length, u.id).toBeGreaterThan(0);
      else expect(cardTags(u.id)).toEqual(['oficio']);
    }
  });

  it('bônus de conjunto: limiares em 3 e 6 pontos e valores crescentes', () => {
    expect(setTier(2)).toBe(0);
    expect(setTier(3)).toBe(1);
    expect(setTier(6)).toBe(2);
    for (const t of BUILD_TAGS) {
      const [lo, hi] = SET_BONUSES[t];
      for (const k of Object.keys(lo) as (keyof typeof lo)[]) expect(hi[k] ?? 0).toBeGreaterThanOrEqual(lo[k] ?? 0);
    }
  });

  it('o máximo teórico de sinergias é pequeno frente aos tetos globais', () => {
    // melhor build possível de cada classe: todas as gerais + cartas da classe (uma bifurcação por grupo)
    for (const cls of CLASS_IDS) {
      const all: Record<string, number> = {};
      const forks = new Set<string>();
      for (const u of UPGRADES) {
        if (u.cls !== null && u.cls !== cls) continue;
        if (u.fork) {
          if (forks.has(u.fork)) continue;
          forks.add(u.fork);
        }
        all[u.id] = u.maxStacks;
      }
      const t = synergyTotals(all);
      expect(t.damage, cls).toBeLessThanOrEqual(0.2);
      expect(t.cooldown, cls).toBeLessThanOrEqual(0.13);
      expect(t.damageReduction, cls).toBeLessThanOrEqual(UPGRADE_CAPS.damageReduction * 0.6);
    }
  });
});

describe('sinergias: cálculo', () => {
  it('conta pontos por tag somando acúmulos e ativa o conjunto', () => {
    const mods = { g_fury: 2, g_first: 1 };
    expect(tagPoints(mods).ferro).toBe(3);
    expect(synergyTotals(mods).damage).toBeCloseTo(0.03 + 0.04, 5); // conjunto Ferro + Carrasco
    expect(activeSynergies(mods).map((s) => s.id)).toContain('executioner');
  });

  it('sem cartas não há bônus; uma carta isolada não ativa combinação', () => {
    expect(synergyTotals({}).damage).toBe(0);
    expect(activeSynergies({ g_fury: 1 })).toHaveLength(0);
  });

  it('avisa quando uma carta oferecida completa uma combinação', () => {
    expect(completesSynergy({ g_fury: 1 }, 'g_first').map((s) => s.id)).toEqual(['executioner']);
    expect(completesSynergy({ g_fury: 1, g_first: 1 }, 'g_first')).toHaveLength(0);
  });

  it('o servidor aplica o cache nas cartas escolhidas e respeita o teto de dano', () => {
    const w = mkWorld('tank');
    const p = me(w);
    p.mods = { g_fury: 2, g_first: 1 };
    w.refreshSynergies(p);
    expect(p.syn.damage).toBeCloseTo(0.07, 5);
    const e = w.spawnEnemy('shambler', p.x + 40, p.y, 1);
    const before = w.damageMul(p, e);
    p.mods = {};
    w.refreshSynergies(p);
    expect(before).toBeGreaterThan(w.damageMul(p, e));
    p.syn.damage = 5;
    expect(w.damageMul(p, e)).toBeLessThanOrEqual(1 + UPGRADE_CAPS.damage + 1.5);
  });
});

describe('reroll e banir', () => {
  it('limites por partida e perks somam', () => {
    const w = mkWorld('hunter');
    expect(me(w).rerolls).toBe(REROLLS_PER_MATCH);
    expect(me(w).banishes).toBe(BANISH_PER_MATCH);
    const w2 = mkWorld('hunter', ['rr1', 'bn1']);
    expect(me(w2).rerolls).toBe(REROLLS_PER_MATCH + 1);
    expect(me(w2).banishes).toBe(BANISH_PER_MATCH + 1);
  });

  it('reroll troca a oferta, gasta uma carga e termina no limite', () => {
    const w = mkWorld('hunter');
    toIntermission(w);
    const first = [...(w.offers.get(1) ?? [])];
    expect(first.length).toBeGreaterThanOrEqual(3);
    expect(w.rerollOffer(1)).toBe(true);
    expect(me(w).rerolls).toBe(REROLLS_PER_MATCH - 1);
    expect(w.offers.get(1)?.length).toBe(first.length);
    expect(w.rerollOffer(1)).toBe(true);
    expect(w.rerollOffer(1)).toBe(false);
    expect(me(w).stats.rr).toBe(2);
  });

  it('não permite reroll/banir depois de confirmar nem fora do intervalo', () => {
    const w = mkWorld('hunter');
    expect(w.rerollOffer(1)).toBe(false);
    toIntermission(w);
    const id = (w.offers.get(1) ?? [])[0] as string;
    expect(w.pickUpgrade(1, id)).toBe(true);
    expect(w.rerollOffer(1)).toBe(false);
    expect(w.banishCard(1, id)).toBe(false);
  });

  it('banir remove a carta, não a oferece mais e só vale para cartas da oferta', () => {
    const w = mkWorld('hunter');
    toIntermission(w);
    const offer = [...(w.offers.get(1) ?? [])];
    expect(w.banishCard(1, 'carta_inexistente')).toBe(false);
    const target = offer[0] as string;
    expect(w.banishCard(1, target)).toBe(true);
    const now = w.offers.get(1) ?? [];
    expect(now).not.toContain(target);
    expect(me(w).banished).toContain(target);
    expect(me(w).banishes).toBe(BANISH_PER_MATCH - 1);
    // nenhum sorteio seguinte traz a carta banida
    for (let i = 0; i < 40; i++) {
      me(w).rerolls = 99;
      w.rerollOffer(1);
      expect(w.offers.get(1)).not.toContain(target);
    }
  });
});

describe('meta-progressão: Lembranças', () => {
  it('recompensa por onda/chefe/vitória com teto e bônus de perk', () => {
    expect(memoryReward({ waves: 0, minibosses: 0, bosses: 0, victory: false })).toBe(0);
    expect(memoryReward({ waves: 5, minibosses: 1, bosses: 0, victory: false })).toBe(5 * MEMORY.perWave + MEMORY.perMiniboss);
    expect(memoryReward({ waves: 18, minibosses: 3, bosses: 3, victory: true })).toBeLessThanOrEqual(MEMORY.maxPerMatch);
    expect(memoryReward({ waves: 10, minibosses: 0, bosses: 0, victory: false }, ['mem1'])).toBe(22);
  });

  it('perfil: aplica a partida, compra perks uma vez e não gasta sem saldo', () => {
    let pr = applyRun(EMPTY_PROFILE, { memories: 100, wave: 9, victory: false, cls: 'tank' });
    expect(pr).toMatchObject({ memories: 100, totalEarned: 100, runs: 1, wins: 0, bestWave: 9 });
    expect(pr.bestByClass.tank).toBe(9);
    pr = applyRun(pr, { memories: 5, wave: 4, victory: true, cls: 'tank' });
    expect(pr.bestByClass.tank).toBe(9);
    expect(pr.wins).toBe(1);
    const poor = buyPerk(EMPTY_PROFILE, 'rr1');
    expect(poor.ok).toBe(false);
    const bought = buyPerk(pr, 'rr1');
    expect(bought.ok).toBe(true);
    expect(bought.profile.memories).toBe(pr.memories - (PERKS.find((p) => p.id === 'rr1')?.cost ?? 0));
    expect(buyPerk(bought.profile, 'rr1').ok).toBe(false);
    expect(buyPerk(pr, 'nao_existe').ok).toBe(false);
  });

  it('normaliza dados corrompidos do disco e ids de perk da rede', () => {
    expect(normalizeProfile('lixo')).toEqual(EMPTY_PROFILE);
    const p = normalizeProfile({ memories: -5, totalEarned: 3, perks: ['rr1', 'rr1', 'x', 4], runs: 2, wins: 9, bestWave: 'a', bestByClass: { tank: 7 } });
    expect(p.memories).toBe(0);
    expect(p.perks).toEqual(['rr1']);
    expect(p.wins).toBe(2);
    expect(sanitizePerks(['bn1', 'hack', 'bn1'])).toEqual(['bn1']);
    expect(sanitizePerks(null)).toEqual([]);
  });

  it('nenhum perk aumenta dano, vida ou resistência diretamente', () => {
    for (const perk of PERKS) expect(perk.desc.toLowerCase()).not.toMatch(/dano|vida m|resist/);
  });

  it('Dote do Veterano começa com 1 carta comum da classe e o servidor valida perks', () => {
    for (const cls of CLASS_IDS) {
      const w = mkWorld(cls, ['start', 'hack']);
      const owned = Object.keys(me(w).mods);
      expect(me(w).perks).toEqual(['start']);
      if (owned.length) {
        expect(owned).toHaveLength(1);
        const u = UPGRADE_BY_ID.get(owned[0] as string);
        expect(u?.cls).toBe(cls);
        expect(u?.rarity).toBe('common');
      }
    }
  });
});

describe('estatísticas da partida', () => {
  it('registra dano recebido, ondas e Lembranças no resultado', () => {
    const w = mkWorld('tank');
    w.god = false;
    w.damagePlayerRaw(me(w), 7, false);
    expect(me(w).stats.taken).toBe(7);
    toIntermission(w);
    expect(w.wavesCleared).toBe(1);
    const st = w.matchStats()[1];
    expect(st?.taken).toBe(7);
    expect(st?.mem).toBe(memoryReward({ waves: 1, minibosses: 0, bosses: 0, victory: false }));
  });

  it('nova partida zera contadores', () => {
    const w = mkWorld('tank');
    toIntermission(w);
    me(w).rerolls = 0;
    w.startMatch();
    expect(w.wavesCleared).toBe(0);
    expect(me(w).rerolls).toBe(REROLLS_PER_MATCH);
    expect(me(w).stats.taken).toBe(0);
  });
});

describe('protocolo v1.6', () => {
  it('valida reroll, banish e perks', () => {
    expect(parseClientMessage({ t: 'reroll' })).toEqual({ t: 'reroll' });
    expect(parseClientMessage({ t: 'banish', id: 'g_fury' })).toEqual({ t: 'banish', id: 'g_fury' });
    expect(parseClientMessage({ t: 'banish', id: 5 })).toBeNull();
    expect(parseClientMessage({ t: 'perks', ids: ['rr1'] })).toEqual({ t: 'perks', ids: ['rr1'] });
    expect(parseClientMessage({ t: 'perks', ids: [1] })).toBeNull();
    expect(parseClientMessage({ t: 'perks', ids: Array(40).fill('a') })).toBeNull();
  });
});
