/**
 * v1.3: função central de cura (Vampiro), Ferida Profana, atordoamento raro com resistência,
 * classe Lapanha (Polpa, Melancia Madura com sacrifício, Casca Traiçoeira, Safra Abençoada) e
 * raridades das melhorias. Tudo verificado no servidor autoritativo.
 */
import { describe, expect, it } from 'vitest';
import { type ClassId, HEAL_RULES, LAPANHA, PLAYER_CC, ripeCostFrac, VAMPIRE } from '../src/shared/config/classes.js';
import { ATK, BOSS_AI } from '../src/shared/config/enemies.js';
import { LEGENDARY_MAX_PER_BUILD, RARITIES, RARITY_INFO, UPGRADE_BY_ID, UPGRADES } from '../src/shared/config/upgrades.js';
import { sec } from '../src/shared/constants.js';
import { Rng } from '../src/shared/math.js';
import { BTN, type InputFrame } from '../src/shared/movement.js';
import { applyWound, healPlayer, multiTargetMul, sacrificeLife, stunPlayer } from '../src/server/world/healing.js';
import type { Enemy, Player } from '../src/server/world/types.js';
import { availableUpgrades, rollRarity, rollUpgrades } from '../src/server/world/upgrades.js';
import { World } from '../src/server/world/world.js';

type InputFn = (p: Player, w: World) => Partial<InputFrame> | null;

function mkWorld(classes: ClassId[]): World {
  const w = new World({ seed: 13, solo: false });
  classes.forEach((c, i) => w.addPlayer(i + 1, `P${i + 1}`, c));
  w.startMatch();
  w.phaseTimer = 0;
  w.director.reset();
  w.debug('hold', 0, '');
  w.debug('kill', 0, '');
  return w;
}
const seqs = new WeakMap<Player, number>();
function run(w: World, n: number, fn: InputFn | null = null): void {
  for (let i = 0; i < n; i++) {
    for (const p of w.players.values()) {
      const s = (seqs.get(p) ?? p.ack) + 1;
      seqs.set(p, s);
      w.pushInputs(p.id, [{ seq: s, mx: 0, my: 0, ax: p.x + 30, ay: p.y, held: 0, pressed: 0, ...(fn?.(p, w) ?? {}) }]);
    }
    w.step();
  }
}
function spawn(w: World, type: Parameters<World['spawnEnemy']>[0], x: number, y: number): Enemy {
  const e = w.spawnEnemy(type, x, y, w.players.size);
  e.state = 'move';
  e.def = { ...e.def, speed: 0 };
  return e;
}
const me = (w: World): Player => w.players.get(1) as Player;

// ================================================================== cura central

describe('cura central (Vampiro)', () => {
  it('retorno decrescente por alvo: 100%, 60%, 35% e 15% para os demais', () => {
    expect([0, 1, 2, 3, 7].map(multiTargetMul)).toEqual([1, 0.6, 0.35, 0.15, 0.15]);
    expect(HEAL_RULES.multiTarget[0]).toBe(1);
  });

  it('Mordida: 1 alvo cura 28% do dano; 3 alvos não passam do teto por uso; alvo quase morto cura só o dano válido', () => {
    const w = mkWorld(['vampire']);
    w.god = true;
    const p = me(w);
    const bite = (targets: Enemy[]): number => {
      p.hp = 20;
      p.healBudget = 999;
      p.cd.q = 0;
      const before = p.hp;
      run(w, 1, () => ({ pressed: BTN.q, ax: (targets[0] as Enemy).x, ay: (targets[0] as Enemy).y }));
      run(w, VAMPIRE.bite.windup + VAMPIRE.bite.active + 3, () => ({ ax: (targets[0] as Enemy).x, ay: (targets[0] as Enemy).y }));
      return p.hp - before;
    };
    const one = spawn(w, 'werewolf', p.x + 30, p.y);
    const healOne = bite([one]);
    expect(healOne).toBeGreaterThan(0);
    expect(healOne).toBeLessThanOrEqual(VAMPIRE.bite.damage * 1.25 * VAMPIRE.bite.healRatio + 0.01);
    w.debug('kill', 0, '');
    run(w, VAMPIRE.bite.cooldown * 30 + 5);
    const three = [0, 0.5, -0.5].map((a) => spawn(w, 'werewolf', p.x + Math.cos(a) * 30, p.y + Math.sin(a) * 30));
    const healThree = bite(three);
    expect(healThree).toBeLessThanOrEqual(VAMPIRE.bite.healCapPerUse + 0.01);
    // com retorno decrescente, 3 alvos curam menos que 3× um alvo
    expect(healThree).toBeLessThan(healOne * 3);
    w.debug('kill', 0, '');
    run(w, VAMPIRE.bite.cooldown * 30 + 5);
    const weak = spawn(w, 'shambler', p.x + 30, p.y);
    weak.hp = 3;
    const healWeak = bite([weak]);
    expect(healWeak).toBeLessThanOrEqual(3 * VAMPIRE.bite.healRatio + 0.01);
  });

  it('objetivos/alvos invulneráveis (Lua Falsa) não concedem cura', () => {
    const w = mkWorld(['vampire']);
    const p = me(w);
    w.god = true;
    const e = spawn(w, 'falseMoon', p.x + 30, p.y);
    p.hp = 20;
    p.healBudget = 999;
    run(w, 1, () => ({ pressed: BTN.q, ax: e.x, ay: e.y }));
    run(w, VAMPIRE.bite.windup + VAMPIRE.bite.active + 3, () => ({ ax: e.x, ay: e.y }));
    expect(p.hp).toBe(20);
  });

  it('teto por segundo vale para roubo de vida e explosões; pickups não entram no balde de combate', () => {
    const w = mkWorld(['vampire']);
    const p = me(w);
    p.hp = 10;
    p.healBudget = VAMPIRE.healPerSecondCap;
    healPlayer(w, p, 999, 'feast');
    expect(p.hp - 10).toBeLessThanOrEqual(VAMPIRE.healPerSecondCap + 0.01);
    const mid = p.hp;
    healPlayer(w, p, 50, 'feast');
    expect(p.hp).toBe(mid); // balde vazio
    healPlayer(w, p, 20, 'pickup');
    expect(p.hp).toBeGreaterThan(mid);
    expect(VAMPIRE.healPerSecondCap).toBeLessThanOrEqual(30);
    expect(VAMPIRE.bite.healCapPerUse).toBeLessThanOrEqual(26);
    expect(VAMPIRE.feast.lifesteal).toBeLessThanOrEqual(0.12);
  });
});

// ================================================================== Ferida Profana

describe('Ferida Profana', () => {
  it('bloqueio total breve, depois -70%; não acumula; limpa na troca de onda e ao cair', () => {
    const w = mkWorld(['vampire']);
    const p = me(w);
    const W = ATK.shadowAcolyte.wound;
    p.hp = 20;
    applyWound(w, p, null);
    expect(p.woundT).toBe(sec(W.duration));
    expect(p.woundBlockT).toBe(sec(W.blockSeconds));
    expect(healPlayer(w, p, 10, 'pickup')).toBe(0);
    p.woundBlockT = 0;
    const got = healPlayer(w, p, 10, 'pickup');
    expect(got).toBeGreaterThan(0);
    expect(got).toBeLessThanOrEqual(10 * (1 - W.reduction) * 1.3 + 0.01);
    // renovar não aumenta intensidade nem ultrapassa a duração
    applyWound(w, p, null);
    applyWound(w, p, null);
    expect(p.woundT).toBe(sec(W.duration));
    expect(p.woundBlockT).toBe(0);
    // sacrifício não é afetado
    const before = p.hp;
    expect(sacrificeLife(w, p, 5)).toBe(5);
    expect(p.hp).toBe(before - 5);
    // troca de onda limpa
    w.debug('wave', 3, '');
    expect(p.woundT).toBe(0);
  });

  it('o Acólito Sombrio canaliza, mostra o alvo e o projétil pode ser evitado saindo da linha', () => {
    const w = mkWorld(['vampire']);
    const p = me(w);
    const e = spawn(w, 'shadowAcolyte', p.x + 180, p.y);
    e.cds.wound = 0;
    e.cds.march = 999;
    p.recentHeal = 50;
    let marked = false;
    for (let i = 0; i < 90 && !marked; i++) {
      run(w, 1);
      marked = e.atk === 'wound' && e.state === 'windup';
    }
    expect(marked).toBe(true);
    expect(e.aimPid).toBe(p.id);
    // o jogador se desloca para fora da linha antes do disparo
    run(w, ATK.shadowAcolyte.wound.windup + 20, () => ({ mx: 0, my: 1 }));
    run(w, 40, () => ({ mx: 0, my: 1 }));
    expect(p.woundT).toBe(0);
  });
});

// ================================================================== atordoamento

describe('atordoamento raro com resistência', () => {
  it('segundo atordoamento dentro da resistência vira lentidão; duração máxima respeitada', () => {
    const w = mkWorld(['hunter']);
    const p = me(w);
    expect(stunPlayer(w, p, 5)).toBe('stun');
    expect(p.action?.name).toBe('stun');
    expect(p.action?.total).toBeLessThanOrEqual(sec(PLAYER_CC.maxStun));
    expect(stunPlayer(w, p, 0.5)).toBe('resisted');
    run(w, sec(PLAYER_CC.maxStun + PLAYER_CC.resist) + 2);
    expect(stunPlayer(w, p, 0.5)).toBe('stun');
  });
});

// ================================================================== chefes: ameaça

describe('chefes/minichefes: ameaça de dano na escolha de alvo', () => {
  it('dano válido a um chefe acumula ameaça para o autor do golpe', () => {
    const w = mkWorld(['hunter']);
    const p = me(w);
    const boss = spawn(w, 'patriarch', p.x + 40, p.y);
    expect(boss.threat.size).toBe(0);
    w.hitEnemy(p, boss, 50, { poise: 0, kb: 0, fromX: p.x, fromY: p.y, kind: 'melee' });
    expect(boss.threat.get(p.id)).toBeGreaterThan(0);
  });

  it('não troca de alvo travado antes de retargetSeconds, mesmo com muita ameaça no outro jogador', () => {
    const w = mkWorld(['hunter', 'hunter']);
    w.god = true;
    const [p1, p2] = [w.players.get(1) as Player, w.players.get(2) as Player];
    p2.move.x = p1.x;
    p2.move.y = p1.y;
    const boss = spawn(w, 'patriarch', p1.x + 120, p1.y);
    expect(w.targetOf(boss)?.id).toBe(p1.id); // mesma distância/classe: fica com o primeiro
    boss.threat.set(p2.id, 100000);
    run(w, sec(BOSS_AI.retargetSeconds) - 20);
    expect(w.targetOf(boss)?.id).toBe(p1.id); // ainda dentro da janela: continua travado
  });

  it('reavalia após retargetSeconds e passa para quem acumulou muito mais ameaça', () => {
    const w = mkWorld(['hunter', 'hunter']);
    w.god = true;
    const [p1, p2] = [w.players.get(1) as Player, w.players.get(2) as Player];
    p2.move.x = p1.x;
    p2.move.y = p1.y;
    const boss = spawn(w, 'patriarch', p1.x + 120, p1.y);
    expect(w.targetOf(boss)?.id).toBe(p1.id);
    boss.threat.set(p2.id, 100000);
    run(w, sec(BOSS_AI.retargetSeconds) + 10);
    expect(w.targetOf(boss)?.id).toBe(p2.id); // janela expirou: reavalia e segue quem mais bateu
  });

  it('não troca por vantagem marginal (switchMargin evita alternância entre alvos parecidos)', () => {
    const w = mkWorld(['hunter', 'hunter']);
    w.god = true;
    const [p1, p2] = [w.players.get(1) as Player, w.players.get(2) as Player];
    p2.move.x = p1.x;
    p2.move.y = p1.y;
    const boss = spawn(w, 'patriarch', p1.x + 120, p1.y);
    expect(w.targetOf(boss)?.id).toBe(p1.id);
    boss.threat.set(p2.id, 1); // vantagem irrisória
    run(w, sec(BOSS_AI.retargetSeconds) + 10);
    expect(w.targetOf(boss)?.id).toBe(p1.id); // mantém o alvo travado
  });
});

// ================================================================== Lapanha

describe('Lapanha', () => {
  it('melancia básica: centro causa mais que a borda e gera Polpa', () => {
    const w = mkWorld(['lapanha']);
    const p = me(w);
    const a = spawn(w, 'werewolf', p.x + 120, p.y);
    const b = spawn(w, 'werewolf', p.x + 120, p.y + 22);
    const ha = a.hp;
    const hb = b.hp;
    run(w, 1, () => ({ pressed: BTN.attack, ax: a.x, ay: a.y }));
    run(w, 40, () => ({ ax: a.x, ay: a.y }));
    expect(ha - a.hp).toBeGreaterThan(hb - b.hp);
    expect(hb - b.hp).toBeGreaterThan(0);
    expect(p.ult).toBeGreaterThan(0);
  });

  it('Melancia Madura: custo entre 3% e 12% da vida, nunca abaixo de 1; soltar antes do mínimo não custa', () => {
    expect(ripeCostFrac(0)).toBeCloseTo(0.03);
    expect(ripeCostFrac(1)).toBeCloseTo(0.12);
    const w = mkWorld(['lapanha']);
    const p = me(w);
    // carga máxima
    run(w, 1, () => ({ pressed: BTN.q, held: BTN.q }));
    run(w, LAPANHA.ripe.chargeMaxTicks + 2, () => ({ held: BTN.q }));
    const hp0 = p.hp;
    run(w, 10);
    expect(hp0 - p.hp).toBeCloseTo(p.maxHp * 0.12, 0);
    // vida baixa: fica com 1
    p.cd.q = 0;
    p.hp = 3;
    run(w, 1, () => ({ pressed: BTN.q, held: BTN.q }));
    run(w, LAPANHA.ripe.chargeMaxTicks + 2, () => ({ held: BTN.q }));
    run(w, 10);
    expect(p.hp).toBe(1);
    // esquiva antes da carga mínima: sem custo
    p.cd.q = 0;
    p.hp = 60;
    run(w, 1, () => ({ pressed: BTN.q, held: BTN.q }));
    run(w, 2, () => ({ held: BTN.q }));
    run(w, 1, () => ({ pressed: BTN.dodge, mx: 1 }));
    run(w, 10);
    expect(p.hp).toBe(60);
  });

  it('sacrifício não conta como dano recebido nem gera suprema por dano', () => {
    const w = mkWorld(['lapanha']);
    const p = me(w);
    const ult = p.ult;
    sacrificeLife(w, p, 10);
    expect(p.ult).toBe(ult);
    expect(p.tele.taken).toBe(0);
    expect(p.tele.sacrificed).toBe(10);
  });

  it('Casca Traiçoeira: comum escorrega, chefe só fica lento; no máximo 2 cascas', () => {
    const w = mkWorld(['lapanha']);
    const p = me(w);
    for (let i = 0; i < 3; i++) {
      p.cd.e = 0;
      run(w, 1, () => ({ pressed: BTN.e, ax: p.x + 60, ay: p.y + i * 20 - 20 }));
      run(w, LAPANHA.peel.windup + LAPANHA.peel.recovery + 2);
    }
    expect(w.zones.filter((z) => z.kind === 'peel' && !z.dead).length).toBe(LAPANHA.peel.maxActive);
    const z = w.zones.find((q) => q.kind === 'peel' && !q.dead)!;
    run(w, sec(LAPANHA.peel.armSeconds) + 1);
    const e = w.spawnEnemy('shambler', z.x, z.y, 1);
    e.state = 'move';
    e.facing = 0;
    run(w, 2);
    expect(e.slideT).toBeGreaterThan(0);
    const z2 = w.zones.find((q) => q.kind === 'peel' && !q.dead)!;
    const boss = w.spawnEnemy('moonDevourer', z2.x, z2.y, 1);
    boss.state = 'move';
    run(w, 2);
    expect(boss.slideT).toBe(0);
  });

  it('Safra Abençoada: regenera ao longo do tempo (mais com vida baixa), não gera Polpa e respeita a Ferida', () => {
    const w = mkWorld(['lapanha']);
    const p = me(w);
    p.hp = 10;
    p.ult = 100;
    run(w, 1, () => ({ pressed: BTN.r }));
    run(w, LAPANHA.harvest.windup + 2);
    expect(p.buffs.harvest).toBeGreaterThan(0);
    expect(p.ult).toBe(0);
    run(w, sec(LAPANHA.harvest.duration) + 5);
    const healed = p.hp - 10;
    expect(healed).toBeGreaterThan(p.maxHp * 0.3);
    expect(healed).toBeLessThanOrEqual(p.maxHp * LAPANHA.harvest.maxRegen * LAPANHA.harvest.duration + 0.5);
    expect(p.ult).toBe(0);
    // com Ferida Profana a mesma Safra cura bem menos
    const w2 = mkWorld(['lapanha']);
    const q = me(w2);
    q.hp = 10;
    q.ult = 100;
    run(w2, 1, () => ({ pressed: BTN.r }));
    run(w2, LAPANHA.harvest.windup + 2);
    for (let i = 0; i < sec(LAPANHA.harvest.duration) + 5; i++) {
      if (q.woundT < 10) applyWound(w2, q, null);
      run(w2, 1);
    }
    expect(q.hp - 10).toBeLessThan(healed * 0.45);
  });
});

// ================================================================== raridades

describe('raridades das melhorias', () => {
  it('distribuição próxima de 60/27/11/2 em milhares de sorteios', () => {
    const rng = new Rng(5);
    const n = 20000;
    const c: Record<string, number> = {};
    for (let i = 0; i < n; i++) {
      const r = rollRarity(rng);
      c[r] = (c[r] ?? 0) + 1;
    }
    for (const r of RARITIES) expect(Math.abs((c[r] ?? 0) / n - RARITY_INFO[r].weight / 100)).toBeLessThan(0.015);
  });

  it('no máximo uma lendária por build; ofertas sem família repetida; todas as classes têm cartas próprias', () => {
    const w = mkWorld(['lapanha']);
    const p = me(w);
    const legend = UPGRADES.filter((u) => u.cls === 'lapanha' && u.rarity === 'legendary');
    expect(legend.length).toBeGreaterThanOrEqual(1);
    expect(legend.length).toBeLessThanOrEqual(2);
    p.mods[(legend[0] as { id: string }).id] = 1;
    expect(availableUpgrades(p).filter((u) => u.rarity === 'legendary' && !(p.mods[u.id] ?? 0)).length).toBe(0);
    expect(LEGENDARY_MAX_PER_BUILD).toBe(1);
    const rng = new Rng(9);
    for (let i = 0; i < 500; i++) {
      const offer = rollUpgrades(rng, p, 3).map((id) => UPGRADE_BY_ID.get(id)!);
      const groups = offer.map((u) => u.group).filter(Boolean);
      expect(new Set(groups).size).toBe(groups.length);
      for (const u of offer) expect(u.cls === null || u.cls === 'lapanha').toBe(true);
    }
    expect(UPGRADES.filter((u) => u.cls === 'lapanha').length).toBeGreaterThanOrEqual(12);
  });
});
