/**
 * v1.6 (c): IA. Tabela de ameaça (dano, cura, provocação, decaimento), escolha de alvo por papel
 * com histerese, locomoção (distância dos atiradores, recuo, flanco, paredes, zonas perigosas),
 * utilidade dos chefes (variedade, respiro, reação ao kite) e limites de justiça.
 */
import { describe, expect, it } from 'vitest';
import type { ClassId } from '../src/shared/config/classes.js';
import { ATK, BOSS_AI } from '../src/shared/config/enemies.js';
import { aiSkill, ARCHETYPES, FAIR, STEER, THREAT } from '../src/shared/config/enemyAI.js';
import { sec } from '../src/shared/constants.js';
import { circleFree } from '../src/shared/collision.js';
import { dist } from '../src/shared/math.js';
import type { InputFrame } from '../src/shared/movement.js';
import { claimAttack } from '../src/server/world/ai/context.js';
import { steer } from '../src/server/world/ai/steer.js';
import { addThreat, onHeal, threatCap, threatNorm } from '../src/server/world/ai/threat.js';
import { pickOption } from '../src/server/world/ai/utility.js';
import type { Enemy, Player } from '../src/server/world/types.js';
import { World } from '../src/server/world/world.js';

type InputFn = (p: Player, w: World) => Partial<InputFrame> | null;

function mkWorld(classes: ClassId[]): World {
  const w = new World({ seed: 16, solo: false });
  classes.forEach((c, i) => w.addPlayer(i + 1, `P${i + 1}`, c));
  w.startMatch();
  w.phaseTimer = 0;
  w.director.reset();
  w.debug('hold', 0, '');
  w.debug('kill', 0, '');
  w.god = true;
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
function spawn(w: World, type: Parameters<World['spawnEnemy']>[0], x: number, y: number, frozen = false): Enemy {
  const e = w.spawnEnemy(type, x, y, w.players.size);
  e.state = 'move';
  e.threat.clear();
  if (frozen) e.def = { ...e.def, speed: 0 };
  return e;
}
const place = (p: Player, x: number, y: number): void => {
  p.move.x = x;
  p.move.y = y;
};
/** Ponto livre a `d` px do jogador (procura a direção com espaço). */
function freeAt(w: World, p: Player, d: number, ang0 = 0): { x: number; y: number } {
  for (let k = 0; k < 16; k++) {
    const a = ang0 + (k / 16) * Math.PI * 2;
    const x = p.x + Math.cos(a) * d;
    const y = p.y + Math.sin(a) * d;
    if (circleFree(w.map, x, y, 16)) return { x, y };
  }
  return { x: p.x + d, y: p.y };
}

// ================================================================== ameaça

describe('ameaça: dano, cura, decaimento e provocação', () => {
  it('dano válido gera ameaça em qualquer inimigo (não só chefes), com peso maior de longe', () => {
    const w = mkWorld(['hunter']);
    const p = w.players.get(1) as Player;
    const near = spawn(w, 'shambler', p.x + 30, p.y, true);
    const far = spawn(w, 'shambler', p.x + 220, p.y, true);
    w.hitEnemy(p, near, 5, { poise: 0, kb: 0, fromX: p.x, fromY: p.y, kind: 'proj' });
    w.hitEnemy(p, far, 5, { poise: 0, kb: 0, fromX: p.x, fromY: p.y, kind: 'proj' });
    const dn = near.threat.get(p.id) ?? 0;
    const df = far.threat.get(p.id) ?? 0;
    expect(dn).toBeGreaterThan(0);
    expect(df / dn).toBeCloseTo(THREAT.farMul, 3);
  });

  it('a ameaça decai com o tempo e some quando desprezível', () => {
    const w = mkWorld(['hunter']);
    const p = w.players.get(1) as Player;
    const e = spawn(w, 'father', p.x + 40, p.y, true);
    addThreat(e, p.id, threatCap(e));
    expect(threatNorm(e, p.id)).toBeCloseTo(1, 5);
    run(w, sec(THREAT.window.elite)); // uma constante de tempo: ~37%
    const after = threatNorm(e, p.id);
    expect(after).toBeGreaterThan(0.3);
    expect(after).toBeLessThan(0.45);
    run(w, sec(THREAT.window.elite) * 4);
    expect(e.threat.has(p.id)).toBe(false);
  });

  it('cura aliada gera ameaça no curado nos inimigos por perto (e não nos distantes)', () => {
    const w = mkWorld(['vampire']);
    const p = w.players.get(1) as Player;
    const near = spawn(w, 'shambler', p.x + 80, p.y, true);
    const far = spawn(w, 'shambler', p.x + THREAT.healRadius + 200, p.y, true);
    run(w, 1); // reconstrói o hash espacial
    onHeal(w, p, 20);
    expect(near.threat.get(p.id) ?? 0).toBeGreaterThan(20 * THREAT.healMul * 0.95);
    expect(far.threat.has(p.id)).toBe(false);
  });

  it('provocação: ameaça de topo, trava o alvo e continua travado depois (comum 1s, chefe 6s)', () => {
    const w = mkWorld(['tank', 'hunter']);
    const [tank, hunter] = [w.players.get(1) as Player, w.players.get(2) as Player];
    place(hunter, tank.x + 40, tank.y);
    const boss = spawn(w, 'patriarch', tank.x + 120, tank.y, true);
    const mob = spawn(w, 'shambler', tank.x + 80, tank.y, true);
    for (const e of [boss, mob]) {
      addThreat(e, hunter.id, threatCap(e) * 0.8);
      e.tauntBy = tank.id;
      e.tauntT = sec(3);
      e.targetT = 0;
      expect(w.targetOf(e)?.id).toBe(tank.id);
      expect(threatNorm(e, tank.id)).toBeGreaterThan(threatNorm(e, hunter.id));
    }
    // acaba a provocação: o chefe segue no provocador por tauntLock, o comum por tauntHold
    boss.tauntT = 0;
    mob.tauntT = 0;
    run(w, sec(0.5));
    expect(w.targetOf(boss)?.id).toBe(tank.id);
    run(w, sec(BOSS_AI.tauntLock) - sec(1.5));
    expect(w.targetOf(boss)?.id).toBe(tank.id);
  });
});

// ================================================================== escolha de alvo por papel

describe('escolha de alvo: papéis, prioridade e histerese', () => {
  it('bruto prefere o tanque mesmo um pouco mais longe; atirador prefere o frágil/curandeiro', () => {
    const w = mkWorld(['tank', 'hunter', 'vampire']);
    const [tank, hunter, vamp] = [1, 2, 3].map((i) => w.players.get(i) as Player);
    const base = freeAt(w, tank, 0);
    place(hunter, base.x + 60, base.y);
    place(vamp, base.x + 60, base.y + 30);
    place(tank, base.x, base.y);
    const brute = spawn(w, 'father', base.x + 200, base.y, true);
    run(w, 2);
    brute.targetT = 0;
    // o caçador está mais perto que o tanque; o bruto ainda assim deve olhar o tanque
    const bruteTarget = w.targetOf(brute);
    expect(bruteTarget?.id).toBe(tank.id);
    const caster = spawn(w, 'acolyte', base.x + 200, base.y, true);
    vamp.recentHeal = 25;
    caster.targetT = 0;
    const casterTarget = w.targetOf(caster);
    expect(casterTarget?.id).not.toBe(tank.id);
  });

  it('jogador rezando (revivendo) atrai atiradores ao alcance mais que o vizinho', () => {
    const w = mkWorld(['hunter', 'hunter']);
    const [a, b] = [w.players.get(1) as Player, w.players.get(2) as Player];
    place(b, a.x + 10, a.y + 90);
    const caster = spawn(w, 'acolyte', a.x - 150, a.y, true);
    caster.targetT = 0;
    const before = w.targetOf(caster)?.id;
    expect(before).toBe(a.id); // mais perto
    b.revivingId = 99;
    caster.targetT = 0;
    caster.lockedSince = 0;
    expect(w.targetOf(caster)?.id).toBe(b.id);
  });

  it('jogador caído nunca é alvo', () => {
    const w = mkWorld(['hunter', 'hunter']);
    const [a, b] = [w.players.get(1) as Player, w.players.get(2) as Player];
    const e = spawn(w, 'shambler', a.x + 30, a.y, true);
    e.targetT = 0;
    expect(w.targetOf(e)?.id).toBe(a.id);
    w.god = false;
    w.damagePlayerRaw(a, 99999, false);
    e.targetT = 0;
    expect(w.targetOf(e)?.id).toBe(b.id);
  });

  it('sem troca de alvo a cada tick: três jogadores se movendo trocam raramente', () => {
    const w = mkWorld(['hunter', 'mage', 'vampire']);
    const ps = [1, 2, 3].map((i) => w.players.get(i) as Player);
    const c = freeAt(w, ps[0] as Player, 0);
    const e = spawn(w, 'shambler', c.x, c.y, true);
    const wolf = spawn(w, 'acolyte', c.x + 10, c.y, true);
    let swaps = 0;
    let swapsB = 0;
    let lastA = 0;
    let lastB = 0;
    for (let t = 0; t < 600; t++) {
      ps.forEach((p, i) => place(p, c.x + Math.cos(t * 0.05 + i * 2.1) * 90 + 30 * i, c.y + Math.sin(t * 0.05 + i * 2.1) * 90));
      run(w, 1);
      const ta = w.targetOf(e)?.id ?? 0;
      const tb = w.targetOf(wolf)?.id ?? 0;
      if (lastA && ta !== lastA) swaps++;
      if (lastB && tb !== lastB) swapsB++;
      lastA = ta;
      lastB = tb;
    }
    expect(swaps).toBeLessThanOrEqual(8); // 20 s: no máx. ~1 troca a cada 2,5 s
    expect(swapsB).toBeLessThanOrEqual(8);
  });

  it('enxame se distribui: vários zumbis não fixam todos no mesmo jogador', () => {
    const w = mkWorld(['hunter', 'hunter']);
    const [a, b] = [w.players.get(1) as Player, w.players.get(2) as Player];
    place(b, a.x + 20, a.y + 40);
    const c = freeAt(w, a, 150);
    const mobs: Enemy[] = [];
    for (let i = 0; i < 12; i++) mobs.push(spawn(w, 'shambler', c.x + (i % 4) * 14, c.y + Math.floor(i / 4) * 14, true));
    run(w, 120);
    for (const m of mobs) w.targetOf(m);
    const onA = mobs.filter((m) => m.targetId === a.id).length;
    expect(onA).toBeGreaterThan(0);
    expect(onA).toBeLessThan(12);
  });
});

// ================================================================== locomoção

describe('locomoção por arquétipo', () => {
  it('atirador (Acólito) mantém distância: recua de perto e não cola no jogador', () => {
    const w = mkWorld(['hunter']);
    const p = w.players.get(1) as Player;
    const at = freeAt(w, p, 60);
    const e = spawn(w, 'acolyte', at.x, at.y);
    const [kmin] = ARCHETYPES.acolyte?.keep ?? [130];
    let minD = Infinity;
    run(w, sec(6), () => {
      minD = Math.min(minD, dist(e.x, e.y, p.x, p.y));
      return null;
    });
    expect(dist(e.x, e.y, p.x, p.y)).toBeGreaterThan(kmin * 0.75);
    // depois de afastar-se, não volta ao corpo a corpo
    run(w, sec(4), () => {
      minD = Math.min(minD, dist(e.x, e.y, p.x, p.y));
      return null;
    });
    expect(dist(e.x, e.y, p.x, p.y)).toBeGreaterThan(kmin * 0.75);
  });

  it('atirador ferido recua uma única vez (histerese + permanência)', () => {
    const w = mkWorld(['hunter']);
    const p = w.players.get(1) as Player;
    const at = freeAt(w, p, 170);
    const e = spawn(w, 'acolyte', at.x, at.y);
    const ally = freeAt(w, e as unknown as Player, 60, 1);
    spawn(w, 'shambler', ally.x, ally.y, true);
    e.hp = Math.floor(e.maxHp * 0.2);
    e.cds.orb = 9999;
    e.cds.rune = 9999;
    run(w, 6);
    expect(e.aiMode).toBe('retreat');
    expect(e.retreated).toBe(true);
    const d0 = dist(e.x, e.y, p.x, p.y);
    run(w, sec(STEER.retreatSeconds) - 10);
    expect(dist(e.x, e.y, p.x, p.y)).toBeGreaterThan(d0 - 5);
    run(w, sec(STEER.retreatSeconds));
    expect(e.retreatT).toBe(0);
    // não recua de novo
    for (let i = 0; i < 120; i++) {
      run(w, 1);
      if (i > 10) expect(e.aiMode).not.toBe('retreat');
    }
  });

  it('velocista flanqueia em ondas avançadas e vai direto nas iniciais (progressão justa)', () => {
    const modeAt = (wave: number): string => {
      const w = mkWorld(['hunter']);
      w.wave = wave;
      const p = w.players.get(1) as Player;
      const at = freeAt(w, p, 220);
      const e = spawn(w, 'runner', at.x, at.y);
      run(w, 3);
      return e.aiMode;
    };
    expect(modeAt(1)).toBe('approach');
    expect(modeAt(30)).toBe('flank');
    expect(aiSkill(1)).toBe(0);
    expect(aiSkill(30)).toBe(1);
  });

  it('steering não anda para dentro de parede: sondagem contorna', () => {
    const w = mkWorld(['hunter']);
    const p = w.players.get(1) as Player;
    // acha ponto livre com parede logo à frente numa das 4 direções
    let found: { x: number; y: number; dx: number; dy: number } | null = null;
    for (let tx = 4; tx < 60 && !found; tx++) {
      for (let ty = 4; ty < 60 && !found; ty++) {
        const x = tx * 32 + 16;
        const y = ty * 32 + 16;
        if (!circleFree(w.map, x, y, 8)) continue;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          if (!circleFree(w.map, x + dx * 22, y + dy * 22, 8) && circleFree(w.map, x - dy * 22, y + dx * 22, 8)) {
            found = { x, y, dx, dy };
            break;
          }
        }
      }
    }
    expect(found).not.toBeNull();
    if (!found) return;
    const e = spawn(w, 'shambler', found.x, found.y, true);
    void p;
    const v = steer(w, e, [found.dx, found.dy], 40, { sep: false });
    const len = Math.hypot(v[0], v[1]);
    const look = e.r + STEER.probe;
    expect(circleFree(w.map, e.x + (v[0] / len) * look, e.y + (v[1] / len) * look, e.r)).toBe(true);
  });

  it('atirador desvia de armadilha/zona perigosa de jogador; bruto aceita mais', () => {
    const w = mkWorld(['hunter']);
    const p = w.players.get(1) as Player;
    const at = freeAt(w, p, 300);
    const caster = spawn(w, 'acolyte', at.x, at.y, true);
    const brute = spawn(w, 'father', at.x + 200, at.y + 200, true);
    brute.x = at.x;
    brute.y = at.y;
    const dir: [number, number] = [1, 0];
    const free = steer(w, caster, dir, 50, { sep: false });
    const bruteFree = steer(w, brute, dir, 50, { sep: false });
    w.addZone({ kind: 'trap', x: at.x + 24, y: at.y, r: 30, ttl: 600, owner: p.id });
    run(w, 1);
    const withZone = steer(w, caster, dir, 50, { sep: false });
    const bruteZone = steer(w, brute, dir, 50, { sep: false });
    const dev = (a: [number, number], b: [number, number]): number => Math.hypot(a[0] - b[0], a[1] - b[1]);
    expect(dev(free, withZone)).toBeGreaterThan(1);
    expect(dev(bruteFree, bruteZone)).toBeLessThan(dev(free, withZone));
  });
});

// ================================================================== justiça

describe('justiça: a IA melhor não fica injusta', () => {
  it('limita golpeadores simultâneos por jogador (ficha de ataque)', () => {
    const w = mkWorld(['hunter']);
    const p = w.players.get(1) as Player;
    const c = freeAt(w, p, 40);
    const mobs: Enemy[] = [];
    for (let i = 0; i < 12; i++) {
      const m = spawn(w, 'shambler', c.x + (i % 4) * 4, c.y + Math.floor(i / 4) * 4, true);
      m.targetId = p.id;
      m.targetT = 9999;
      mobs.push(m);
    }
    expect(claimAttack(w, mobs[0] as Enemy, p.id, true)).toBe(true);
    let granted = 1;
    for (let i = 1; i < 12; i++) if (claimAttack(w, mobs[i] as Enemy, p.id, true)) granted++;
    expect(granted).toBe(FAIR.maxAttackers);
    // chefes não são limitados
    expect(claimAttack(w, spawn(w, 'patriarch', c.x, c.y, true), p.id, true)).toBe(true);
  });

  it('as antecipações dos ataques não mudaram (só a decisão fica mais esperta)', () => {
    expect(ATK.shambler.swipe.windup).toBe(16);
    expect(ATK.runner.lunge.windup).toBe(10);
    expect(ATK.acolyte.orb.windup).toBe(22);
    expect(ATK.patriarch.sweep.windup).toBe(24);
    expect(ATK.moonDevourer.claws.windup).toBe(16);
    expect(FAIR.maxLead).toBeLessThanOrEqual(60);
  });
});

// ================================================================== chefes

/** Registra a sequência de ataques iniciados por um chefe durante `ticks` ticks. */
function recordAttacks(w: World, boss: Enemy, ticks: number, extra?: InputFn): { seq: string[]; gaps: number[] } {
  const seq: string[] = [];
  const gaps: number[] = [];
  let prev = boss.state as string;
  let lastMove = -1;
  for (let i = 0; i < ticks; i++) {
    run(w, 1, extra ?? null);
    if (boss.state === 'dead') break;
    const st = boss.state as string;
    if (st === 'move' && prev !== 'move') lastMove = w.tick;
    if (st === 'windup' && prev !== 'windup' && boss.atk !== 'none') {
      seq.push(boss.atk);
      if (lastMove >= 0) gaps.push(w.tick - lastMove);
    }
    prev = st;
  }
  return { seq, gaps };
}

describe('chefes: utilidade de ataques', () => {
  it('Patriarca (fase 2) alterna ataques: usa vários tipos e raramente repete o mesmo seguido', () => {
    const w = mkWorld(['tank', 'hunter']);
    const [tank, hunter] = [w.players.get(1) as Player, w.players.get(2) as Player];
    const c = freeAt(w, tank, 0);
    place(hunter, c.x + 60, c.y + 20);
    const boss = spawn(w, 'patriarch', c.x + 140, c.y);
    boss.phase = 2;
    boss.summonsLeft = 3;
    boss.hp = boss.maxHp;
    boss.maxHp = boss.hp = 9_999_999; // não morre nem entra em desespero
    const { seq } = recordAttacks(w, boss, sec(90));
    expect(seq.length).toBeGreaterThan(8);
    expect(new Set(seq).size).toBeGreaterThanOrEqual(4);
    let maxRun = 1;
    let run1 = 1;
    for (let i = 1; i < seq.length; i++) {
      run1 = seq[i] === seq[i - 1] ? run1 + 1 : 1;
      maxRun = Math.max(maxRun, run1);
    }
    expect(maxRun).toBeLessThanOrEqual(3);
  });

  it('respiro entre ataques: nunca ataca antes do mínimo da janela de reação', () => {
    const w = mkWorld(['tank']);
    const p = w.players.get(1) as Player;
    const c = freeAt(w, p, 0);
    const boss = spawn(w, 'moonDevourer', c.x + 50, c.y);
    boss.maxHp = boss.hp = 9_999_999;
    for (const k of ['claws', 'leap', 'crescent'] as const) boss.cds[k] = 0;
    const { seq, gaps } = recordAttacks(w, boss, sec(40));
    expect(seq.length).toBeGreaterThan(3);
    const [lo] = FAIR.thinkTicks[1] ?? [14];
    for (const g of gaps) expect(g).toBeGreaterThanOrEqual(lo - 1);
  });

  it('reage ao kite: alvo longe e fustigando de fora dispara o gap-closer (salto)', () => {
    const w = mkWorld(['hunter']);
    const p = w.players.get(1) as Player;
    const at = freeAt(w, p, 230);
    const boss = spawn(w, 'moonDevourer', at.x, at.y);
    boss.maxHp = boss.hp = 9_999_999;
    boss.cds.leap = 0;
    // dano de longe aquece o chefe
    w.hitEnemy(p, boss, 30, { poise: 0, kb: 0, fromX: p.x, fromY: p.y, kind: 'proj' });
    expect(boss.heatT).toBeGreaterThan(0);
    const { seq } = recordAttacks(w, boss, sec(5));
    expect(seq[0]).toBe('leap');
  });

  it('de perto prefere garras/crescente a saltar', () => {
    const w = mkWorld(['tank']);
    const p = w.players.get(1) as Player;
    const at = freeAt(w, p, 50);
    const boss = spawn(w, 'moonDevourer', at.x, at.y);
    boss.maxHp = boss.hp = 9_999_999;
    boss.cds.leap = 0;
    const { seq } = recordAttacks(w, boss, sec(2));
    expect(seq[0]).toBe('claws');
  });

  it('não ignora quem causa dano de longe: a ameaça derruba o alvo próximo sem esperar o fim da permanência', () => {
    const w = mkWorld(['hunter', 'hunter']);
    const [near, hunter] = [w.players.get(1) as Player, w.players.get(2) as Player];
    const c = freeAt(w, near, 0);
    const far = freeAt(w, near, 250, 2);
    place(hunter, far.x, far.y);
    const boss = spawn(w, 'patriarch', c.x + 60, c.y, true);
    boss.maxHp = 3000;
    boss.hp = 9_999_999;
    boss.targetT = 0;
    expect(w.targetOf(boss)?.id).toBe(near.id);
    for (let i = 0; i < 40; i++) {
      w.hitEnemy(hunter, boss, 60, { poise: 0, kb: 0, fromX: hunter.x, fromY: hunter.y, kind: 'proj' });
      run(w, 1);
    }
    run(w, 30);
    expect(w.targetOf(boss)?.id).toBe(hunter.id);
  });

  it('desespero: abaixo de 25% de vida o chefe entra em ritmo maior e reavalia o alvo', () => {
    const w = mkWorld(['tank']);
    const p = w.players.get(1) as Player;
    const boss = spawn(w, 'moonDevourer', p.x + 80, p.y, true);
    expect(boss.desperate).toBe(false);
    boss.hp = Math.floor(boss.maxHp * 0.2);
    run(w, 2);
    expect(boss.desperate).toBe(true);
  });

  it('utilidade: ataque repetido é penalizado e nada passa do mínimo se nenhuma opção serve', () => {
    const w = mkWorld(['tank']);
    const p = w.players.get(1) as Player;
    const boss = spawn(w, 'patriarch', p.x + 80, p.y, true);
    boss.recent = ['eruption'];
    const pick = pickOption(w, boss, [
      { atk: 'eruption', ready: true, score: 0.6 },
      { atk: 'sweep', ready: true, score: 0.5 },
    ]);
    expect(pick?.atk).toBe('sweep'); // 0.6*0.5 < 0.5
    expect(pickOption(w, boss, [{ atk: 'sweep', ready: true, score: 0.1 }])).toBeNull();
    expect(pickOption(w, boss, [{ atk: 'sweep', ready: false, score: 1 }])).toBeNull();
  });
});
