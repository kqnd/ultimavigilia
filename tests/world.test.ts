import { describe, expect, it } from 'vitest';
import { BERSERKER, CLASS_IDS, type ClassId, PLAYER_RULES, TANK } from '../src/shared/config/classes.js';
import { MELEE_RULES } from '../src/shared/config/classes.js';
import { INTERMISSION_SECONDS, UPGRADE_BY_ID } from '../src/shared/config/upgrades.js';
import { TOTAL_WAVES } from '../src/shared/config/waves.js';
import { sec, TILE } from '../src/shared/constants.js';
import { BTN, type InputFrame } from '../src/shared/movement.js';
import type { Player } from '../src/server/world/types.js';
import { addPickup } from '../src/server/world/loot.js';
import { hitMinion, spawnMinion } from '../src/server/world/minions.js';
import { detonateGuardian } from '../src/server/world/kits/tank.js';
import { FlowField } from '../src/server/world/nav.js';
import { circleFree } from '../src/shared/collision.js';
import { cloneMap, getMap } from '../src/shared/map.js';
import { rollUpgrades } from '../src/server/world/upgrades.js';
import { World } from '../src/server/world/world.js';
import { Rng } from '../src/shared/math.js';

type InputFn = (p: Player, w: World) => Partial<InputFrame> | null;

function mkWorld(classes: ClassId[], solo = false): World {
  const w = new World({ seed: 42, solo });
  classes.forEach((c, i) => w.addPlayer(i + 1, `P${i + 1}`, c));
  w.startMatch();
  return w;
}

const seqs = new WeakMap<Player, number>();
function feed(w: World, fn: InputFn | null): void {
  for (const p of w.players.values()) {
    const partial = fn ? fn(p, w) : null;
    const s = (seqs.get(p) ?? p.ack) + 1;
    seqs.set(p, s);
    w.pushInputs(p.id, [{ seq: s, mx: 0, my: 0, ax: p.x + 30, ay: p.y, held: 0, pressed: 0, ...(partial ?? {}) }]);
  }
}
function run(w: World, n: number, fn: InputFn | null = null): void {
  for (let i = 0; i < n; i++) {
    feed(w, fn);
    w.step();
  }
}
/** Pula a contagem inicial da onda e remove spawns naturais. */
function quiet(w: World): void {
  w.phaseTimer = 0;
  w.director.reset();
}

describe('classes: habilidades confirmadas no servidor', () => {
  for (const cls of CLASS_IDS) {
    it(`${cls}: básico, Q, E e R causam efeito; recarga e suprema negadas`, () => {
      const w = mkWorld([cls]);
      quiet(w);
      const p = w.players.get(1) as Player;
      const e = w.spawnEnemy('father', p.x + 26, p.y, 1);
      e.state = 'move';
      e.hp = e.maxHp = 5000;
      e.def = { ...e.def, speed: 0 };
      const hp0 = e.hp;
      if (cls === 'necromancer') {
        // Q precisa de essência e de um cadáver por perto
        p.essence = 7;
        addPickup(w, 'corpse', p.x + 12, p.y + 12);
      }
      // básico
      run(w, 1, () => ({ pressed: BTN.attack, ax: e.x, ay: e.y }));
      run(w, 40, () => ({ ax: e.x, ay: e.y }));
      expect(e.hp).toBeLessThan(hp0);
      // Q
      run(w, 1, () => ({ pressed: BTN.q, held: BTN.q, ax: e.x, ay: e.y }));
      // Lapanha: segura a Melancia Madura acima da carga mínima e solta
      run(w, cls === 'lapanha' ? 14 : 3, () => ({ held: BTN.q, ax: e.x, ay: e.y }));
      if (cls === 'lapanha') run(w, 6, () => ({ ax: e.x, ay: e.y }));
      if (cls !== 'tank') expect(p.cd.q).toBeGreaterThan(0);
      else expect(p.blocking).toBe(true);
      run(w, 40, () => ({ ax: e.x, ay: e.y }));
      // Q de novo durante recarga → negado
      if (cls !== 'tank') {
        w.drainEvents();
        run(w, 1, () => ({ pressed: BTN.q, ax: e.x, ay: e.y }));
        const ev = w.drainEvents();
        expect(ev.some((x) => x.k === 'deny' && x.r === 'cd')).toBe(true);
      }
      // E
      run(w, 1, () => ({ pressed: BTN.e, ax: e.x, ay: e.y }));
      run(w, 3, () => ({ ax: e.x, ay: e.y }));
      expect(p.cd.e).toBeGreaterThan(0);
      run(w, 40, () => ({ ax: e.x, ay: e.y }));
      // R sem carga → negado
      w.drainEvents();
      run(w, 1, () => ({ pressed: BTN.r, ax: e.x, ay: e.y }));
      expect(w.drainEvents().some((x) => x.k === 'deny' && x.r === 'ult')).toBe(true);
      // R com carga
      p.ult = 100;
      const hpBeforeR = e.hp;
      run(w, 1, () => ({ pressed: BTN.r, ax: e.x, ay: e.y }));
      expect(p.ult).toBe(0);
      run(w, 90, () => ({ ax: e.x, ay: e.y }));
      if (cls === 'hunter' || cls === 'mage' || cls === 'dog') expect(e.hp).toBeLessThan(hpBeforeR);
      if (cls === 'vampire') expect(p.buffs.feast).toBeGreaterThanOrEqual(0);
    });
  }
});

describe('combate autoritativo', () => {
  it('i-frames da esquiva evitam dano', () => {
    const w = mkWorld(['berserker', 'tank']);
    quiet(w);
    const p = w.players.get(1) as Player;
    run(w, 1, (pl) => (pl.id === 1 ? { pressed: BTN.dodge, mx: 1 } : null));
    expect(p.iframes).toBeGreaterThan(0);
    const r = w.hitPlayer(p, { dmg: 30, heavy: false, fromX: p.x + 10, fromY: p.y, enemy: null, proj: null, blockable: true });
    expect(r).toBe('evaded');
    expect(p.hp).toBe(p.maxHp);
  });

  it('Guardião bloqueia em 360° e sofre quebra de guarda sem stamina', () => {
    const w = mkWorld(['tank', 'dog']);
    quiet(w);
    const p = w.players.get(1) as Player;
    run(w, 2, (pl) => (pl.id === 1 ? { pressed: BTN.q, held: BTN.q, ax: pl.x + 50, ay: pl.y } : null));
    expect(p.blocking).toBe(true);
    const front = w.hitPlayer(p, { dmg: 20, heavy: false, fromX: p.x + 20, fromY: p.y, enemy: null, proj: null, blockable: true });
    expect(front).toBe('blocked');
    expect(p.hp).toBe(p.maxHp);
    const back = w.hitPlayer(p, { dmg: 10, heavy: false, fromX: p.x - 20, fromY: p.y, enemy: null, proj: null, blockable: true });
    expect(back).toBe('blocked');
    expect(p.hp).toBe(p.maxHp);
    p.move.stamina = 2;
    const br = w.hitPlayer(p, { dmg: 40, heavy: false, fromX: p.x + 20, fromY: p.y, enemy: null, proj: null, blockable: true });
    expect(br).toBe('hit');
    expect(p.blocking).toBe(false);
    expect(p.buffs.guardBroken).toBeGreaterThan(0);
  });

  it('investida interrompe e provoca sem precisar de alvo estático', () => {
    const w = mkWorld(['tank', 'dog']);
    quiet(w);
    const p = w.players.get(1) as Player;
    const e = w.spawnEnemy('acolyte', p.x + 42, p.y, 1);
    e.state = 'windup';
    e.atk = 'orb';
    e.def = { ...e.def, speed: 0 };
    run(w, 1, (pl) => pl.id === 1 ? { pressed: BTN.e, ax: e.x, ay: e.y } : null);
    run(w, TANK.charge.ticks, (pl) => pl.id === 1 ? { ax: e.x, ay: e.y } : null);
    expect(e.tauntBy).toBe(p.id);
    expect(e.tauntT).toBeGreaterThan(0);
    expect(e.state).not.toBe('windup');
  });

  it('Última Vigília protege aliado e sobrevivente e conta só dano real', () => {
    const w = mkWorld(['tank', 'dog']);
    quiet(w);
    const guard = w.players.get(1) as Player;
    const ally = w.players.get(2) as Player;
    ally.move.x = guard.x + 18;
    ally.move.y = guard.y;
    const survivor = spawnMinion(w, 0, 'survivor', guard.x + 28, guard.y, { hp: 100, ttl: 1000, speed: 0, damage: 0 });
    expect(survivor).not.toBeNull();
    survivor!.state = 'move';
    guard.ult = PLAYER_RULES.ultMax;
    expect(w.tryStart(guard, 'r')).toBe(true);
    // v1.5: a muralha anda devagar levando a área
    expect(w.moveParams(guard).moveMul).toBe(TANK.bastion.moveMul);
    const a0 = ally.hp;
    w.hitPlayer(ally, { dmg: 50, heavy: false, fromX: ally.x + 10, fromY: ally.y, enemy: null, proj: null, blockable: true });
    expect(a0 - ally.hp).toBe(Math.round(50 * (1 - TANK.bastion.reduction)));
    expect(guard.guardianCharge).toBe(a0 - ally.hp);
    hitMinion(w, survivor!, 50);
    expect(survivor!.hp).toBe(100 - Math.round(50 * (1 - TANK.bastion.reduction)));
    expect(guard.guardianCharge).toBe((a0 - ally.hp) + (100 - survivor!.hp));
    const beforeArtificial = guard.guardianCharge;
    w.damagePlayerRaw(ally, 3, false, true);
    ally.iframes = 5;
    w.hitPlayer(ally, { dmg: 10, heavy: false, fromX: ally.x - 12, fromY: ally.y, enemy: null, proj: null, blockable: true });
    expect(guard.guardianCharge).toBe(beforeArtificial);
  });

  it('bardo aparece em recanto alcançável em todas as ondas e três mapas', () => {
    for (const seed of [1, 42, 98765]) for (const mapId of ['village', 'frozen', 'abyss'] as const) {
      const w = new World({ seed, solo: true });
      w.map = cloneMap(getMap(mapId));
      const field = new FlowField(w.map);
      field.compute(w.map.starts[0]!.x, w.map.starts[0]!.y);
      let previous = '';
      for (let wave = 1; wave <= 30; wave++) {
        w.wave = wave;
        w['pickBardSpot']();
        const bard = w.bard;
        expect(bard, `${mapId} seed ${seed} onda ${wave}`).not.toBeNull();
        expect(circleFree(w.map, bard!.x, bard!.y, 12)).toBe(true);
        expect(field.at(bard!.x, bard!.y)).not.toBe(0xffff);
        expect(Math.hypot(bard!.x - w.map.campfire.x, bard!.y - w.map.campfire.y)).toBeGreaterThan(340);
        expect(w.map.starts.every((s) => Math.hypot(bard!.x - s.x, bard!.y - s.y) > 420)).toBe(true);
        expect(`${bard!.x},${bard!.y}`).not.toBe(previous);
        previous = `${bard!.x},${bard!.y}`;
        expect(w.waveInfo().bd).toEqual([bard!.x, bard!.y]);
      }
    }
  });

  it('explosão tem base, carga limitada e teto contra chefe, sem recarregar a R', () => {
    const w = mkWorld(['tank']);
    quiet(w);
    const p = w.players.get(1) as Player;
    const e = w.spawnEnemy('father', p.x + 28, p.y, 1);
    e.state = 'move';
    e.hp = e.maxHp = 5000;
    w.hash.insert(e);
    p.ult = 100;
    w.tryStart(p, 'r');
    detonateGuardian(w, p);
    expect(5000 - e.hp).toBe(TANK.bastion.baseDamage);
    expect(p.ult).toBe(0);
    p.ult = 100;
    w.tryStart(p, 'r');
    p.guardianCharge = 999;
    const hp = e.hp;
    detonateGuardian(w, p);
    expect(hp - e.hp).toBe(TANK.bastion.baseDamage + TANK.bastion.bonusCap);
    const boss = w.spawnEnemy('moonDevourer', p.x + 35, p.y, 1);
    boss.state = 'move';
    boss.hp = boss.maxHp = 5000;
    w.hash.insert(boss);
    p.ult = 100;
    w.tryStart(p, 'r');
    p.guardianCharge = 999;
    detonateGuardian(w, p);
    expect(5000 - boss.hp).toBeLessThanOrEqual(TANK.bastion.bossDamageCap);
  });

  it('bloqueios pequenos têm ganho de suprema limitado por intervalo', () => {
    const w = mkWorld(['tank']);
    quiet(w);
    const p = w.players.get(1) as Player;
    p.blocking = true;
    p.move.stamina = 120;
    for (let i = 0; i < 10; i++) w.hitPlayer(p, { dmg: 1, heavy: false, fromX: p.x - 10, fromY: p.y, enemy: null, proj: null, blockable: true });
    expect(p.ult).toBe(TANK.wall.ultPerBlock);
    expect(p.ult).toBeLessThan(PLAYER_RULES.ultMax / 10);
  });

  it('berserker: fúria sobe ao bater e apanhar, decai e Loucura cobra exaustão', () => {
    const w = mkWorld(['berserker', 'dog']);
    quiet(w);
    const p = w.players.get(1) as Player;
    const e = w.spawnEnemy('father', p.x + 24, p.y, 2);
    e.state = 'move';
    e.hp = e.maxHp = 5000;
    e.def = { ...e.def, speed: 0 };
    run(w, 1, (pl) => (pl.id === 1 ? { pressed: BTN.attack, ax: e.x, ay: e.y } : null));
    run(w, 20, (pl) => (pl.id === 1 ? { ax: e.x, ay: e.y } : null));
    expect(p.rage).toBeGreaterThan(0);
    const afterHit = p.rage;
    w.damagePlayerRaw(p, 20, false);
    expect(p.rage).toBeGreaterThan(afterHit);
    // decai sem combate
    const peak = p.rage;
    w.killEnemy(e, null);
    run(w, sec(BERSERKER.fury.decayDelay + 2));
    expect(p.rage).toBeLessThan(peak);
    expect(p.rage).toBeLessThanOrEqual(BERSERKER.fury.max);
    // Loucura: bônus durante, exaustão depois
    p.ult = 100;
    run(w, 1, (pl) => (pl.id === 1 ? { pressed: BTN.r } : null));
    run(w, BERSERKER.madness.windup + 2);
    expect(p.buffs.madness).toBeGreaterThan(0);
    p.hp = p.maxHp;
    const hpBefore = p.hp;
    p.iframes = 0;
    w.hitPlayer(p, { dmg: 100, heavy: false, fromX: p.x + 10, fromY: p.y, enemy: null, proj: null, blockable: false });
    // recebe mais dano durante a Loucura (acima do normal de corpo a corpo)
    expect(hpBefore - p.hp).toBeGreaterThan(Math.round(100 * MELEE_RULES.damageTakenMul));
    run(w, sec(BERSERKER.madness.duration) + 5);
    expect(p.buffs.madness).toBe(0);
    expect(p.buffs.exhausted).toBeGreaterThan(0);
  });

  it('Mente de Ferro reduz a vulnerabilidade pela metade (não elimina) e mantém 1,5s de exaustão', () => {
    const w = mkWorld(['berserker']);
    quiet(w);
    const p = w.players.get(1) as Player;
    p.mods['b_iron'] = 1;
    p.buffs.madness = 2;
    const hpBefore = p.hp;
    w.hitPlayer(p, { dmg: 10, heavy: false, fromX: p.x + 10, fromY: p.y, enemy: null, proj: null, blockable: false });
    // +10% da Loucura em vez de +20%; mais a redução geral do corpo a corpo
    expect(hpBefore - p.hp).toBeCloseTo(10 * MELEE_RULES.damageTakenMul * (1 + BERSERKER.madness.ironDamageTaken), 0);
    p.buffs.madness = 1;
    run(w, 1);
    expect(p.buffs.exhausted).toBe(sec(1.5));
  });

  it('chefes resistem a controle e retornos decrescentes evitam travamento', () => {
    const w = mkWorld(['hunter', 'dog']);
    quiet(w);
    const boss = w.spawnEnemy('moonDevourer', 1000, 600, 2);
    const common = w.spawnEnemy('shambler', 900, 600, 2);
    const d1 = w.applyCC(common, 'root', 2);
    const d2 = w.applyCC(common, 'root', 2);
    const d3 = w.applyCC(common, 'root', 2);
    expect(d2).toBeLessThan(d1);
    expect(d3).toBeLessThan(d2);
    const b1 = w.applyCC(boss, 'stun', 2);
    expect(b1).toBeLessThan(1);
    boss.state = 'move';
    w.stagger(boss, 1);
    expect(boss.staggerImmune).toBeGreaterThan(0);
    boss.state = 'move';
    const poise0 = boss.poise;
    w.hitEnemy(null, boss, 1, { poise: 9999, kb: 0, fromX: 0, fromY: 0, kind: 'melee' });
    expect(boss.state).toBe('move');
    expect(boss.poise).toBe(poise0);
  });

  it('Pulso Magnético interrompe acólito, mas não chefe', () => {
    const w = mkWorld(['dog', 'tank']);
    quiet(w);
    const ac = w.spawnEnemy('acolyte', 500, 500, 2);
    ac.state = 'move';
    w.startEnemyAttack(ac, 'orb', 600, 500);
    expect(w.interrupt(ac)).toBe(true);
    expect(ac.state).toBe('stagger');
    const b = w.spawnEnemy('patriarch', 700, 500, 2);
    b.state = 'move';
    w.startEnemyAttack(b, 'sweep', 800, 500);
    expect(w.interrupt(b)).toBe(false);
  });

  it('sem dano aliado: projéteis de jogador não afetam jogadores', () => {
    const w = mkWorld(['hunter', 'tank']);
    quiet(w);
    const t = w.players.get(2) as Player;
    const h = w.players.get(1) as Player;
    t.move.x = h.x + 40;
    t.move.y = h.y;
    run(w, 1, (pl) => (pl.id === 1 ? { pressed: BTN.attack, ax: t.x, ay: t.y } : null));
    run(w, 30);
    expect(t.hp).toBe(t.maxHp);
  });
});

describe('ciclo da partida', () => {
  it('reviver: caído, aliado segura F e dano interrompe', () => {
    const w = mkWorld(['berserker', 'tank']);
    quiet(w);
    const a = w.players.get(1) as Player;
    const b = w.players.get(2) as Player;
    b.move.x = a.x + 20;
    b.move.y = a.y;
    w.damagePlayerRaw(a, 9999, false);
    expect(a.status).toBe(1);
    run(w, 30, (pl) => (pl.id === 2 ? { held: BTN.interact } : null));
    expect(a.reviveProgress).toBeGreaterThan(0);
    w.damagePlayerRaw(b, 1, false);
    expect(a.reviveProgress).toBe(0);
    run(w, sec(PLAYER_RULES.reviveTime) + 5, (pl) => (pl.id === 2 ? { held: BTN.interact } : null));
    expect(a.status).toBe(0);
    expect(a.hp).toBeGreaterThan(0);
  });

  it('todos incapacitados = derrota; solo morre direto', () => {
    const w = mkWorld(['berserker', 'tank']);
    quiet(w);
    for (const p of w.players.values()) w.damagePlayerRaw(p, 9999, false);
    run(w, 2);
    expect(w.phase).toBe('defeat');
    const s = mkWorld(['mage'], true);
    quiet(s);
    const p = s.players.get(1) as Player;
    s.damagePlayerRaw(p, 9999, false);
    expect(p.status).toBe(2);
    run(s, 2);
    expect(s.phase).toBe('defeat');
  });

  it('caído sangra até morrer e volta na próxima onda', () => {
    const w = mkWorld(['berserker', 'tank']);
    quiet(w);
    const a = w.players.get(1) as Player;
    const guardE = w.spawnEnemy('shambler', 100, 100, 2);
    guardE.def = { ...guardE.def, speed: 0 };
    w.damagePlayerRaw(a, 9999, false);
    run(w, sec(PLAYER_RULES.downedTime) + 2);
    expect(a.status).toBe(2);
    expect(w.phase).toBe('wave');
    w.director.start(w.wave, 2);
    w.director.debugClear();
    w.killEnemy(guardE, null);
    run(w, 2);
    expect(w.phase).toBe('intermission'); // onda vazia termina
    expect(a.status).toBe(0);
    expect(a.hp).toBeGreaterThan(0);
  });

  it('30 ondas em 3 capítulos → vitória: rotas, viagens, troca de mapa, melhorias e reinício limpo', () => {
    const w = mkWorld(['hunter', 'dog', 'tank']);
    let guard = 0;
    const seen = new Set<string>();
    const bosses = new Set<string>();
    const maps = new Set<string>();
    let picks = 0;
    while (w.phase !== 'victory' && w.phase !== 'defeat' && guard++ < 400000) {
      feed(w, null);
      w.step();
      for (const p of w.players.values()) p.hp = p.maxHp; // modo deus para o teste de fluxo
      if (w.tick % 20 === 0) {
        for (const e of w.enemies.values()) {
          if (e.def.tier === 'boss') bosses.add(e.type);
          if (e.state !== 'spawn') w.killEnemy(e, w.players.get(1) ?? null);
        }
      }
      seen.add(`${w.phase}:${w.wave}`);
      maps.add(w.map.id);
      if (w.phase === 'intermission' && w.phaseTimer === sec(INTERMISSION_SECONDS - 5)) {
        // jogador 1 confirma uma carta; os outros ficam com a escolha padrão
        const opt = w.offers.get(1)?.find((o) => w.canTake(w.players.get(1) as Player, o));
        if (opt) {
          expect(w.pickUpgrade(1, opt)).toBe(true);
          picks++;
        }
        expect(w.pickUpgrade(1, opt ?? '')).toBe(false); // sem confirmação dupla
      }
      if (w.phase === 'route' && w.votes.size === 0) {
        w.vote(1, 'risk');
        w.vote(2, 'safe'); // empate → rota segura
      }
    }
    expect(w.phase).toBe('victory');
    expect(w.wave).toBe(TOTAL_WAVES);
    expect(seen.has('route:10')).toBe(true);
    expect(seen.has('travel:10')).toBe(true);
    expect(seen.has('route:20')).toBe(true);
    expect(seen.has('wave:21')).toBe(true);
    expect(w.route).toBe('safe');
    expect([...maps].sort()).toEqual(['abyss', 'frozen', 'village']);
    for (const b of ['moonDevourer', 'frostBride', 'patriarch']) expect(bosses.has(b)).toBe(true);
    expect(picks).toBeGreaterThan(20);
    for (const p of w.players.values()) {
      const total = Object.values(p.mods).reduce((s, n) => s + n, 0);
      expect(total).toBeGreaterThan(20);
      expect(total).toBeLessThanOrEqual(TOTAL_WAVES - 1);
      for (const [id, n] of Object.entries(p.mods)) expect(n).toBeLessThanOrEqual(UPGRADE_BY_ID.get(id)?.maxStacks ?? 0);
    }
    // jogar novamente
    w.resetToLobby();
    expect(w.players.size).toBe(0);
    expect(w.enemies.size).toBe(0);
    expect(w.minions.size).toBe(0);
    expect(w.map.id).toBe('village');
    w.addPlayer(1, 'A', 'mage');
    w.startMatch();
    const p = w.players.get(1) as Player;
    expect(w.wave).toBe(1);
    expect(Object.keys(p.mods).length).toBe(0);
    expect(p.hp).toBe(p.maxHp);
    expect(w.projectiles.length).toBe(0);
  });

  it('sorteio de melhorias: 3 opções distintas, da classe ou gerais, dentro do limite', () => {
    const w = mkWorld(['vampire', 'dog']);
    const p = w.players.get(1) as Player;
    const rng = new Rng(7);
    for (let i = 0; i < 200; i++) {
      const opts = rollUpgrades(rng, p);
      expect(new Set(opts).size).toBe(opts.length);
      expect(opts.length).toBe(3);
      for (const id of opts) {
        const d = UPGRADE_BY_ID.get(id);
        expect(d && (d.cls === null || d.cls === 'vampire')).toBe(true);
      }
      expect(opts.some((id) => UPGRADE_BY_ID.get(id)?.cls === 'vampire')).toBe(true);
    }
    p.mods['v_vortex'] = 2; // máximo 2
    for (let i = 0; i < 100; i++) expect(rollUpgrades(rng, p)).not.toContain('v_vortex');
  });

  it('inimigo preso é reposicionado num portão', () => {
    const w = mkWorld(['hunter', 'dog']);
    quiet(w);
    run(w, 7);
    const e = w.spawnEnemy('shambler', 31.5 * TILE, 19.5 * TILE, 2); // dentro da fogueira (sólido)
    e.state = 'move';
    e.x = 31.5 * TILE;
    e.y = 19.5 * TILE;
    // força ficar preso: sem velocidade
    e.def = { ...e.def, speed: 0 };
    run(w, sec(6));
    const g = w.map.spawns.some((s) => Math.hypot(s.x - e.x, s.y - e.y) < 80);
    expect(g || Math.hypot(e.x - 31.5 * TILE, e.y - 19.5 * TILE) > 20).toBe(true);
  });
});

describe('simulação com bots em todas as classes', () => {
  it('3 ondas completas sem exceções e com inimigos morrendo', () => {
    const w = mkWorld([...CLASS_IDS]);
    let kills = 0;
    const brain: InputFn = (p, world) => {
      let best: { x: number; y: number } | null = null;
      let bd = Infinity;
      for (const e of world.enemies.values()) {
        const d = Math.hypot(e.x - p.x, e.y - p.y);
        if (d < bd) {
          bd = d;
          best = e;
        }
      }
      if (!best) return { mx: (world.map.campfire.x - p.x) / 200, my: (world.map.campfire.y + 60 - p.y) / 200 };
      const dx = best.x - p.x;
      const dy = best.y - p.y;
      const l = Math.hypot(dx, dy) || 1;
      const ranged = p.cls === 'hunter' || p.cls === 'mage';
      const want = ranged ? 150 : 22;
      const dir = bd > want ? 1 : -1;
      const buttons = [BTN.attack, BTN.attack, BTN.attack, BTN.q, BTN.e, BTN.r, BTN.dodge];
      const pressed = world.tick % 6 === p.id % 6 ? (buttons[(world.tick / 6 + p.id) % buttons.length | 0] ?? 0) : 0;
      return {
        mx: Math.max(-1, Math.min(1, (dx / l) * dir)),
        my: Math.max(-1, Math.min(1, (dy / l) * dir)),
        ax: best.x,
        ay: best.y,
        pressed,
        held: p.cls === 'tank' && world.tick % 90 < 30 ? BTN.q : 0,
      };
    };
    let guard = 0;
    while (w.wave <= 3 && w.phase !== 'defeat' && guard++ < 30000) {
      feed(w, brain);
      w.step();
      for (const ev of w.drainEvents()) if (ev.k === 'die') kills++;
      for (const p of w.players.values()) if (p.status !== 0) {
        p.status = 0;
        p.hp = p.maxHp;
      }
    }
    expect(kills).toBeGreaterThan(40);
    expect(w.wave).toBeGreaterThanOrEqual(4);
  });
});
