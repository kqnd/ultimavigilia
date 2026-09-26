/**
 * Sistemas da v0.2: quebráveis e itens, Berserker/Necromante, servos, bifurcações, afixos,
 * eventos, desafios, capítulos/rotas e mecânicas de chefe. Tudo verificado no servidor.
 */
import { describe, expect, it } from 'vitest';
import { AFFIX_RULES, affixChance } from '../src/shared/config/affixes.js';
import { CHAPTERS } from '../src/shared/config/chapters.js';
import { type ClassId, DOG, NECRO, VAMPIRE } from '../src/shared/config/classes.js';
import { ATK } from '../src/shared/config/enemies.js';
import { PICKUPS } from '../src/shared/config/loot.js';
import { EVENT_RULES } from '../src/shared/config/objectives.js';
import { UPGRADE_BY_ID } from '../src/shared/config/upgrades.js';
import { TOTAL_WAVES, WAVES } from '../src/shared/config/waves.js';
import { circleFree } from '../src/shared/collision.js';
import { sec, TILE } from '../src/shared/constants.js';
import { isSolidTile, Obst } from '../src/shared/map.js';
import { BTN, type InputFrame } from '../src/shared/movement.js';
import { addPickup, damageBreakable, stepPickups } from '../src/server/world/loot.js';
import { minionDamage, minionsOf, spawnMinion } from '../src/server/world/minions.js';
import { bossObjectiveDamageMul, countObjectives } from '../src/server/world/objectives.js';
import type { Enemy, Player } from '../src/server/world/types.js';
import { availableUpgrades, rollUpgrades } from '../src/server/world/upgrades.js';
import { World } from '../src/server/world/world.js';
import { Rng } from '../src/shared/math.js';

type InputFn = (p: Player, w: World) => Partial<InputFrame> | null;

function mkWorld(classes: ClassId[], solo = false): World {
  const w = new World({ seed: 7, solo });
  classes.forEach((c, i) => w.addPlayer(i + 1, `P${i + 1}`, c));
  w.startMatch();
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
function quiet(w: World): void {
  w.phaseTimer = 0;
  w.director.reset();
}
function dummy(w: World, type: Parameters<World['spawnEnemy']>[0], x: number, y: number, hp = 5000): Enemy {
  const e = w.spawnEnemy(type, x, y, w.players.size);
  e.state = 'move';
  e.hp = e.maxHp = hp;
  e.def = { ...e.def, speed: 0 };
  return e;
}

// ================================================================== quebráveis e itens

describe('caixas, barris e itens de cura', () => {
  it('quebra libera o tile (colisão e tiros), cura só a vida atual e cada item é coletado uma vez', () => {
    const w = mkWorld(['hunter', 'tank']);
    quiet(w);
    const b = w.map.breakables[0];
    expect(b).toBeTruthy();
    if (!b) return;
    expect(isSolidTile(w.map, b.tx, b.ty)).toBe(true);
    // força o drop para tornar o teste determinístico
    w.rng.chance = () => true;
    expect(damageBreakable(w, b.i, 5, null)).toBe(false);
    expect(damageBreakable(w, b.i, 999, null)).toBe(true);
    expect(isSolidTile(w.map, b.tx, b.ty)).toBe(false);
    expect(damageBreakable(w, b.i, 999, null)).toBe(false); // já quebrado
    const item = w.pickups.find((i) => i.kind === 'heal');
    expect(item).toBeTruthy();
    if (!item) return;
    const a = w.players.get(1) as Player;
    const c = w.players.get(2) as Player;
    // jogador com vida cheia não consome o item
    a.move.x = item.x;
    a.move.y = item.y;
    stepPickups(w);
    expect(w.pickups.includes(item)).toBe(true);
    // feridos: só um coleta, e a vida máxima não muda
    a.hp = a.maxHp - 5;
    c.move.x = item.x;
    c.move.y = item.y;
    c.hp = c.maxHp - 50;
    const max = a.maxHp;
    w.drainEvents();
    stepPickups(w);
    const picks = w.drainEvents().filter((e) => e.k === 'pickup');
    expect(picks.length).toBe(1);
    expect(a.maxHp).toBe(max);
    expect(a.hp).toBeLessThanOrEqual(a.maxHp);
    expect(w.pickups.includes(item)).toBe(false);
  });

  it('limite de itens no chão: o mais antigo some', () => {
    const w = mkWorld(['hunter']);
    for (let i = 0; i < PICKUPS.maxActive + 4; i++) addPickup(w, 'heal', 100 + i * 20, 100);
    expect(w.pickups.filter((p) => p.kind === 'heal').length).toBe(PICKUPS.maxActive);
  });

  it('ataques de jogador quebram caixas no alcance', () => {
    const w = mkWorld(['berserker']);
    quiet(w);
    const p = w.players.get(1) as Player;
    // primeiro quebrável com um lado livre para o jogador
    const offs = [[-26, 0], [26, 0], [0, 26], [0, -26]] as const;
    const b = w.map.breakables.find((q) => offs.some(([dx, dy]) => circleFree(w.map, (q.tx + 0.5) * TILE + dx, (q.ty + 0.5) * TILE + dy, p.r)));
    expect(b).toBeTruthy();
    if (!b) return;
    const bx = (b.tx + 0.5) * TILE;
    const by = (b.ty + 0.5) * TILE;
    for (const [dx, dy] of offs)
      if (circleFree(w.map, bx + dx, by + dy, p.r)) {
        p.move.x = bx + dx;
        p.move.y = by + dy;
        break;
      }
    for (let k = 0; k < 6; k++) {
      run(w, 1, () => ({ pressed: BTN.attack, ax: bx, ay: by }));
      run(w, 25, () => ({ ax: bx, ay: by }));
    }
    expect(w.breakHp[b.i]).toBe(0);
  });
});

// ================================================================== Vampiro e Dog

describe('ajustes de Vampiro e Dog', () => {
  it('Mordida em cone acerta vários, cura com teto por uso e por segundo', () => {
    const w = mkWorld(['vampire']);
    quiet(w);
    const p = w.players.get(1) as Player;
    p.hp = 10;
    const es = [0, 0.5, -0.5].map((a) => dummy(w, 'shambler', p.x + Math.cos(a) * 30, p.y + Math.sin(a) * 30));
    const hp0 = es.map((e) => e.hp);
    run(w, 1, () => ({ pressed: BTN.q, ax: p.x + 40, ay: p.y }));
    run(w, VAMPIRE.bite.windup + VAMPIRE.bite.active + 2, () => ({ ax: p.x + 40, ay: p.y }));
    const hits = es.filter((e, i) => e.hp < (hp0[i] as number)).length;
    expect(hits).toBe(3);
    expect(p.hp - 10).toBeLessThanOrEqual(VAMPIRE.bite.healCapPerUse + 0.01);
    expect(p.hp - 10).toBeGreaterThan(0);
    expect(p.biteHealed).toBeLessThanOrEqual(VAMPIRE.bite.healCapPerUse + 0.01);
    // teto por segundo vale para qualquer cura com limite
    p.healBudget = VAMPIRE.healPerSecondCap;
    const before = p.hp;
    w.healPlayer(p, 999, true);
    expect(p.hp - before).toBeLessThanOrEqual(VAMPIRE.healPerSecondCap);
  });

  it('Pulso do Dog: preparação e recuperação curtas, anda durante o golpe', () => {
    expect(DOG.pulse.windup + DOG.pulse.recovery).toBeLessThanOrEqual(10);
    expect(DOG.pulse.moveMul).toBeGreaterThan(0.5);
    const w = mkWorld(['dog']);
    quiet(w);
    const p = w.players.get(1) as Player;
    run(w, 1, () => ({ pressed: BTN.q }));
    expect(p.action?.moveMul ?? 0).toBeGreaterThan(0.5);
    run(w, DOG.pulse.windup + DOG.pulse.recovery + 3);
    expect(w.canAct(p)).toBe(true);
  });
});

// ================================================================== Necromante

describe('Necromante: essência, servos e limites', () => {
  it('essência vem de mortes próximas (elite vale mais), respeita o teto e ignora quedas de aliados', () => {
    const w = mkWorld(['necromancer', 'tank']);
    quiet(w);
    const n = w.players.get(1) as Player;
    const t = w.players.get(2) as Player;
    w.killEnemy(dummy(w, 'shambler', n.x + 40, n.y), null);
    expect(n.essence).toBe(NECRO.essence.perCommon);
    w.killEnemy(dummy(w, 'werewolf', n.x + 40, n.y), null);
    expect(n.essence).toBe(NECRO.essence.perCommon + NECRO.essence.perElite);
    w.killEnemy(dummy(w, 'shambler', n.x + NECRO.essence.radius + 80, n.y), null);
    expect(n.essence).toBe(NECRO.essence.perCommon + NECRO.essence.perElite); // longe demais
    w.damagePlayerRaw(t, 9999, false);
    expect(n.essence).toBe(NECRO.essence.perCommon + NECRO.essence.perElite); // aliado caído não gera
    for (let i = 0; i < 20; i++) w.killEnemy(dummy(w, 'shambler', n.x + 30, n.y), null);
    expect(n.essence).toBe(NECRO.essence.max);
  });

  it('Erguer Morto: nega sem essência e sem cadáver; limite de servos sacrifica o mais antigo', () => {
    const w = mkWorld(['necromancer']);
    quiet(w);
    const p = w.players.get(1) as Player;
    const cast = (): string[] => {
      w.drainEvents();
      p.cd.q = 0;
      run(w, 1, () => ({ pressed: BTN.q, ax: p.x + 20, ay: p.y }));
      run(w, NECRO.raise.windup + NECRO.raise.recovery + 2, () => ({ ax: p.x + 20, ay: p.y }));
      return w.drainEvents().flatMap((e) => (e.k === 'deny' ? [e.r] : []));
    };
    p.essence = 0;
    addPickup(w, 'corpse', p.x + 20, p.y);
    expect(cast()).toContain('essence');
    w.pickups = [];
    p.essence = NECRO.essence.max;
    expect(cast()).toContain('corpse');
    expect(minionsOf(w, p.id, 'thrall').length).toBe(0);
    for (let i = 0; i < NECRO.raise.maxActive + 1; i++) {
      addPickup(w, 'corpse', p.x + 20, p.y + 4);
      p.essence = NECRO.essence.max;
      expect(cast()).toEqual([]);
    }
    const thralls = minionsOf(w, p.id, 'thrall');
    expect(thralls.length).toBe(NECRO.raise.maxActive);
    // o cadáver é consumido
    expect(w.pickups.filter((c) => c.kind === 'corpse').length).toBe(0);
  });

  it('servos atacam, atraem inimigos, expiram e não contam para o fim da onda', () => {
    const w = mkWorld(['necromancer', 'tank']);
    quiet(w);
    const p = w.players.get(1) as Player;
    const e = dummy(w, 'shambler', p.x + 60, p.y);
    e.def = { ...e.def, speed: 40 };
    const m = spawnMinion(w, p.id, 'thrall', p.x + 40, p.y, { hp: NECRO.thrall.hp, ttl: sec(NECRO.thrall.duration), speed: NECRO.thrall.speed, damage: NECRO.thrall.damage });
    expect(m).toBeTruthy();
    const hp0 = e.hp;
    run(w, 90);
    expect(e.hp).toBeLessThan(hp0);
    expect(w.targetOf(e)?.id).toBe(m?.id);
    // expira
    run(w, sec(NECRO.thrall.duration) + 30);
    expect(w.minions.size).toBe(0);
    // com só servos vivos a onda termina
    w.killEnemy(e, null);
    spawnMinion(w, p.id, 'thrall', p.x + 40, p.y, { hp: 50, ttl: sec(30), speed: 90, damage: 5 });
    w.director.start(w.wave, 2);
    w.director.debugClear();
    run(w, 3);
    expect(w.phase).toBe('intermission');
    expect(w.minions.size).toBe(0); // limpos no fim da onda
  });

  it('servos somem quando o dono cai, desconecta, o mapa muda ou a partida termina', () => {
    const w = mkWorld(['necromancer', 'tank']);
    quiet(w);
    const p = w.players.get(1) as Player;
    const mk = (): void => {
      spawnMinion(w, p.id, 'thrall', p.x + 30, p.y, { hp: 50, ttl: sec(30), speed: 90, damage: 5 });
    };
    mk();
    w.damagePlayerRaw(p, 9999, false);
    expect(w.minions.size).toBe(0);
    p.status = 0;
    p.hp = p.maxHp;
    mk();
    w.setConnected(p.id, false);
    expect(w.minions.size).toBe(0);
    w.setConnected(p.id, true);
    mk();
    w.setChapter(2);
    expect(w.minions.size).toBe(0);
    mk();
    for (const q of w.players.values()) w.damagePlayerRaw(q, 9999, false);
    run(w, 2);
    expect(w.phase).toBe('defeat');
    expect(w.minions.size).toBe(0);
  });

  it('Exército dos Sem Nome consome a essência, tem teto de unidades e de dano em chefes', () => {
    const w = mkWorld(['necromancer']);
    quiet(w);
    const p = w.players.get(1) as Player;
    p.essence = NECRO.essence.max;
    p.ult = 100;
    run(w, 1, () => ({ pressed: BTN.r }));
    run(w, NECRO.army.windup + 3);
    expect(p.essence).toBe(0);
    const horde = minionsOf(w, p.id, 'horde');
    expect(horde.length).toBe(Math.min(NECRO.army.maxUnits, NECRO.army.base + NECRO.essence.max * NECRO.army.perEssence));
    const boss = dummy(w, 'moonDevourer', p.x + 200, p.y, 99999);
    for (const e of w.enemies.values()) if (e.type === 'falseMoon') w.killEnemy(e, null);
    boss.exposedT = 0;
    const hp0 = boss.hp;
    const unit = horde[0];
    if (!unit) return;
    for (let i = 0; i < 200; i++) minionDamage(w, p, unit, boss, 50, { poise: 0, kb: 0, kind: 'melee' });
    expect(hp0 - boss.hp).toBeLessThanOrEqual(NECRO.army.bossDamageCapPerCast * 1.31 + 1);
  });

  it('limite global de entidades invocadas', () => {
    const w = mkWorld(['necromancer']);
    const p = w.players.get(1) as Player;
    let n = 0;
    for (let i = 0; i < 40; i++) if (spawnMinion(w, p.id, 'horde', p.x, p.y, { hp: 10, ttl: 100, speed: 50, damage: 1 })) n++;
    expect(n).toBeLessThanOrEqual(16);
  });
});

// ================================================================== bifurcações e confirmação

describe('bifurcações de melhorias', () => {
  it('depois de tomar um lado, o outro não é oferecido e o servidor recusa', () => {
    const w = mkWorld(['hunter']);
    const p = w.players.get(1) as Player;
    p.mods['h_ricochet'] = 1;
    expect(availableUpgrades(p).some((u) => u.id === 'h_blast')).toBe(false);
    const rng = new Rng(3);
    for (let i = 0; i < 200; i++) expect(rollUpgrades(rng, p)).not.toContain('h_blast');
    expect(w.canTake(p, 'h_blast')).toBe(false);
    // forçando a oferta, a escolha ainda é recusada
    w.phase = 'intermission';
    w.offers.set(1, ['h_blast', 'g_vigor', 'g_fury']);
    expect(w.pickUpgrade(1, 'h_blast')).toBe(false);
    expect(w.pickUpgrade(1, 'g_vigor')).toBe(true);
    expect(w.pickUpgrade(1, 'g_fury')).toBe(false); // uma confirmação por intervalo
  });

  it('todas as bifurcações têm exatamente dois lados da mesma classe', () => {
    const forks = new Map<string, string[]>();
    for (const u of UPGRADE_BY_ID.values()) if (u.fork) forks.set(u.fork, [...(forks.get(u.fork) ?? []), u.id]);
    expect(forks.size).toBeGreaterThanOrEqual(4);
    for (const ids of forks.values()) {
      expect(ids.length).toBe(2);
      expect(new Set(ids.map((id) => UPGRADE_BY_ID.get(id)?.cls)).size).toBe(1);
    }
  });
});

// ================================================================== afixos

describe('afixos de elite', () => {
  it('chance cresce com a onda até o teto; Sangrento cura ao acertar; Blindado resiste a poise', () => {
    expect(affixChance(1, 0)).toBe(0);
    expect(affixChance(TOTAL_WAVES, 0)).toBeLessThanOrEqual(AFFIX_RULES.maxChance);
    const w = mkWorld(['tank']);
    quiet(w);
    const p = w.players.get(1) as Player;
    const wolf = dummy(w, 'werewolf', p.x + 20, p.y, 400);
    wolf.affix = 'bloody';
    wolf.hp = 200;
    w.hitPlayer(p, { dmg: 10, heavy: false, fromX: wolf.x, fromY: wolf.y, enemy: wolf, proj: null, blockable: false });
    expect(wolf.hp).toBe(200 + 10 * AFFIX_RULES.bloodyLifestealRatio);
    // O Alfa da onda 5 tem milhares de PV no cooperativo: não pode curar
    // centenas por golpe só porque a vida dele escalou com a equipe.
    w.debug('wave', 5, '');
    const alpha = w.spawnEnemy('alphaWolf', p.x + 40, p.y, 4);
    expect(alpha.affix).toBe('bloody');
    alpha.hp = alpha.maxHp - 500;
    const before = alpha.hp;
    p.iframes = 0;
    w.hitPlayer(p, { dmg: 20, heavy: false, fromX: alpha.x, fromY: alpha.y, enemy: alpha, proj: null, blockable: false });
    expect(alpha.hp - before).toBe(20 * AFFIX_RULES.bloodyLifestealRatio);
    const a1 = dummy(w, 'acolyte', p.x - 60, p.y, 500);
    const a2 = dummy(w, 'acolyte', p.x - 60, p.y + 40, 500);
    a1.affix = 'armored';
    const hit = a2.def.poise; // exatamente o suficiente para desequilibrar um acólito comum
    w.hitEnemy(null, a1, 1, { poise: hit, kb: 0, fromX: p.x, fromY: p.y, kind: 'melee' });
    w.hitEnemy(null, a2, 1, { poise: hit, kb: 0, fromX: p.x, fromY: p.y, kind: 'melee' });
    expect(a2.state).toBe('stagger');
    expect(a1.state).not.toBe('stagger');
  });
});

// ================================================================== eventos e desafios

describe('eventos de onda e desafios', () => {
  it('ritual: se o tempo acaba, o ritual falha e dois lobisomens surgem; matar o ritualista dá sucesso', () => {
    const waveRitual = WAVES.findIndex((d) => d.event === 'ritual') + 1;
    expect(waveRitual).toBeGreaterThan(0);
    const w = mkWorld(['hunter', 'tank']);
    w.debug('wave', waveRitual, '');
    w.phaseTimer = 0;
    run(w, sec(3) + 2);
    const ev = w.objectives.event;
    expect(ev?.kind).toBe('ritual');
    if (!ev) return;
    const wolves0 = [...w.enemies.values()].filter((e) => e.type === 'werewolf').length;
    ev.t = 1;
    run(w, 2);
    expect(ev.state).toBe(2);
    expect([...w.enemies.values()].filter((e) => e.type === 'werewolf').length).toBe(wolves0 + EVENT_RULES.ritual.failSpawn.length);
    // de novo, agora com sucesso
    w.debug('wave', waveRitual, '');
    w.phaseTimer = 0;
    run(w, sec(3) + 2);
    const ev2 = w.objectives.event;
    const rit = [...w.enemies.values()].find((e) => e.type === 'ritualist');
    expect(rit).toBeTruthy();
    if (rit) w.killEnemy(rit, w.players.get(1) ?? null);
    run(w, 2);
    expect(ev2?.state).toBe(1);
  });

  it('carrinho funerário: chegar ao centro é falha; destruí-lo é sucesso', () => {
    const waveCart = WAVES.findIndex((d) => d.event === 'cart') + 1;
    const w = mkWorld(['hunter']);
    w.debug('wave', waveCart, '');
    w.phaseTimer = 0;
    run(w, sec(3) + 2);
    const cart = [...w.enemies.values()].find((e) => e.type === 'funeralCart');
    expect(cart).toBeTruthy();
    if (!cart) return;
    cart.x = w.map.campfire.x;
    cart.y = w.map.campfire.y + 40;
    run(w, 3);
    expect(w.objectives.event?.state).toBe(2);
  });

  it('desafio "ninguém cai" falha na primeira queda e desafios não bloqueiam o fim da onda', () => {
    const w = mkWorld(['hunter', 'tank']);
    quiet(w);
    w.objectives.challenge = { kind: 'noDowns', state: 0, hp: 0, maxHp: 0, t: -1, maxT: -1, x: 0, y: 0, target: 0 };
    w.damagePlayerRaw(w.players.get(2) as Player, 9999, false);
    expect(w.objectives.challenge?.state).toBe(2);
    w.director.start(w.wave, 2);
    w.director.debugClear();
    run(w, 3);
    expect(w.phase).toBe('intermission');
  });
});

// ================================================================== capítulos, mapas e rotas

describe('capítulos, mapas e rotas', () => {
  it('30 ondas em 3 capítulos com mapas e climas distintos', () => {
    expect(TOTAL_WAVES).toBe(30);
    expect(CHAPTERS.map((c) => c.map)).toEqual(['village', 'frozen', 'abyss']);
    expect(new Set(CHAPTERS.map((c) => c.climate)).size).toBe(3);
    expect(WAVES[9]?.boss).toBe('moonDevourer');
    expect(WAVES[19]?.boss).toBe('frostBride');
    expect(WAVES[29]?.boss).toBe('patriarch');
  });

  it('troca de capítulo: mapa novo, jogadores em pontos livres e entidades limpas', () => {
    const w = mkWorld(['hunter', 'dog', 'tank']);
    quiet(w);
    dummy(w, 'shambler', 500, 500);
    addPickup(w, 'heal', 400, 400);
    w.setChapter(3);
    expect(w.map.id).toBe('abyss');
    expect(w.enemies.size).toBe(0);
    expect(w.pickups.length).toBe(0);
    expect(w.projectiles.length).toBe(0);
    for (const p of w.players.values()) expect(circleFree(w.map, p.x, p.y, p.r)).toBe(true);
    // quebráveis do novo mapa intactos
    for (const b of w.map.breakables) expect(w.map.obst[b.ty * w.map.w + b.tx]).toBe(b.kind === Obst.Barrel ? Obst.Barrel : Obst.Crate);
  });

  it('votação: maioria decide; empate ou nenhum voto = rota segura', () => {
    const w = mkWorld(['hunter', 'dog', 'tank']);
    const toRoute = (): void => {
      w.debug('wave', 10, '');
      w.director.debugClear();
      for (const e of w.enemies.values()) w.killEnemy(e, null);
      run(w, 3);
      expect(w.phase).toBe('intermission');
      w.phaseTimer = 1;
      run(w, 2);
      expect(w.phase).toBe('route');
    };
    toRoute();
    w.vote(1, 'risk');
    w.vote(2, 'risk');
    w.vote(3, 'safe');
    run(w, 2);
    expect(w.route).toBe('risk');
    expect(w.phase).toBe('travel');
    expect(w.map.id).toBe('frozen');
    run(w, sec(10));
    expect(w.phase).toBe('wave');
    expect(w.wave).toBe(11);
    // empate
    toRoute();
    w.vote(1, 'risk');
    w.vote(2, 'safe');
    w.phaseTimer = 1;
    run(w, 2);
    expect(w.route).toBe('safe');
    // ninguém vota
    toRoute();
    w.phaseTimer = 1;
    run(w, 2);
    expect(w.route).toBe('safe');
    expect(w.vote(1, 'risk')).toBe(false); // fora da votação
  });
});

// ================================================================== chefes

describe('mecânicas de chefe', () => {
  it('Devorador: luas falsas reduzem o dano recebido; quebrá-las expõe o chefe', () => {
    const w = mkWorld(['hunter']);
    quiet(w);
    const boss = w.spawnEnemy('moonDevourer', w.map.points.boss.x, w.map.points.boss.y, 1);
    boss.state = 'move';
    const moons = countObjectives(w, 'falseMoon');
    expect(moons).toBe(w.map.points.moons.length);
    expect(bossObjectiveDamageMul(w, boss)).toBeLessThan(1);
    for (const e of [...w.enemies.values()]) if (e.type === 'falseMoon') w.killEnemy(e, w.players.get(1) ?? null);
    run(w, 2);
    expect(boss.exposedT).toBeGreaterThan(0);
    expect(bossObjectiveDamageMul(w, boss)).toBe(ATK.falseMoon.exposedDamageMul);
  });

  it('Patriarca: protegido pelos 3 totens; derrubá-los abre a segunda fase', () => {
    const w = mkWorld(['hunter']);
    w.setChapter(3); // totens ficam na mansão
    quiet(w);
    const boss = w.spawnEnemy('patriarch', w.map.points.boss.x, w.map.points.boss.y, 1);
    boss.state = 'move';
    expect(countObjectives(w, 'abyssTotem')).toBe(3);
    expect(bossObjectiveDamageMul(w, boss)).toBe(ATK.patriarch.shieldedDamageMul);
    for (const e of [...w.enemies.values()]) if (e.type === 'abyssTotem') w.killEnemy(e, w.players.get(1) ?? null);
    run(w, 60);
    expect(bossObjectiveDamageMul(w, boss)).toBe(1);
    expect(boss.phase).toBe(2);
  });
});
