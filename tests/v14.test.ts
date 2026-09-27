/**
 * v1.4 — Berserker (Redemoinho girante, Fúria como vantagem, economia de stamina), correções do
 * Lapanha (acerto das frutas em arco e Melancia Madura por cima de paredes) e falas de todas as
 * classes. Tudo verificado no servidor autoritativo.
 */
import { describe, expect, it } from 'vitest';
import { BERSERKER, CLASS_IDS, CLASSES, type ClassId, LAPANHA } from '../src/shared/config/classes.js';
import { LINES, type LineKind } from '../src/shared/config/lines.js';
import { sec, SHOT_HEIGHT, TILE } from '../src/shared/constants.js';
import { blocksShot } from '../src/shared/map.js';
import { BTN, type InputFrame } from '../src/shared/movement.js';
import type { Enemy, Player } from '../src/server/world/types.js';
import { World } from '../src/server/world/world.js';

type InputFn = (p: Player, w: World) => Partial<InputFrame> | null;

function mkWorld(classes: ClassId[]): World {
  const w = new World({ seed: 21, solo: false });
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
function spawn(w: World, type: Parameters<World['spawnEnemy']>[0], x: number, y: number): Enemy {
  const e = w.spawnEnemy(type, x, y, w.players.size);
  e.state = 'move';
  e.def = { ...e.def, speed: 0 };
  return e;
}
const me = (w: World): Player => w.players.get(1) as Player;

describe('Berserker — Q virou Redemoinho de Fúria (girante)', () => {
  it('o giro alcança quem está ATRÁS do Berserker (o corte frontal antigo não alcançava)', () => {
    const w = mkWorld(['berserker']);
    const p = me(w);
    // mira à direita; o inimigo fica à esquerda, fora de qualquer cone frontal
    const behind = spawn(w, 'shambler', p.x - 24, p.y);
    behind.state = 'move';
    const hp0 = behind.hp;
    run(w, 1, (pl) => ({ pressed: BTN.q, ax: pl.x + 30, ay: pl.y }));
    run(w, BERSERKER.frenzy.windup + BERSERKER.frenzy.pulses * BERSERKER.frenzy.pulseEvery + 2);
    expect(behind.hp).toBeLessThan(hp0);
  });

  it('dá os pulsos configurados e o dano total bate com a configuração', () => {
    const w = mkWorld(['berserker']);
    const p = me(w);
    const e = spawn(w, 'shambler', p.x + 20, p.y);
    e.def = { ...e.def, speed: 0, poise: 9999, ccResist: 0 }; // não escorrega nem cambaleia para fora
    e.hp = e.maxHp = 9999;
    const hp0 = e.hp;
    run(w, 1, (pl) => ({ pressed: BTN.q, ax: pl.x + 30, ay: pl.y }));
    run(w, BERSERKER.frenzy.windup + BERSERKER.frenzy.pulses * BERSERKER.frenzy.pulseEvery + 4);
    const dealt = hp0 - e.hp;
    // cada pulso acerta uma vez; o alvo colado é varrido por todos eles
    expect(dealt).toBeGreaterThanOrEqual(BERSERKER.frenzy.damage * 2);
    expect(dealt).toBeLessThanOrEqual(BERSERKER.frenzy.damage * BERSERKER.frenzy.pulses * 1.6);
  });

  it('acertar o giro rende Fúria na hora, uma vez por uso (o resto é só a Fúria por dano)', () => {
    const w = mkWorld(['berserker']);
    const p = me(w);
    const e = spawn(w, 'shambler', p.x + 20, p.y);
    e.def = { ...e.def, speed: 0, poise: 9999 };
    e.hp = e.maxHp = 9999;
    const hp0 = e.hp;
    p.rage = 0;
    run(w, 1, (pl) => ({ pressed: BTN.q, ax: pl.x + 30, ay: pl.y }));
    run(w, BERSERKER.frenzy.windup + BERSERKER.frenzy.pulses * BERSERKER.frenzy.pulseEvery + 4);
    const dealt = hp0 - e.hp;
    // Fúria final = bônus do giro (uma vez) + Fúria normal por dano causado
    expect(p.rage).toBeCloseTo(BERSERKER.frenzy.furyGain + dealt * BERSERKER.fury.perDamageDealt, 4);
  });

  it('o giro não rende Fúria quando não acerta ninguém', () => {
    const w = mkWorld(['berserker']);
    const p = me(w);
    p.rage = 0;
    run(w, 1, (pl) => ({ pressed: BTN.q, ax: pl.x + 30, ay: pl.y }));
    run(w, BERSERKER.frenzy.windup + BERSERKER.frenzy.pulses * BERSERKER.frenzy.pulseEvery + 4);
    expect(p.rage).toBe(0);
  });

  it('custa menos stamina que o Rasgo antigo (16) e cabe mais vezes na barra', () => {
    expect(BERSERKER.frenzy.stamina).toBeLessThan(16);
    expect(CLASSES.berserker.stamina).toBeGreaterThan(110);
    expect(CLASSES.berserker.staminaRegen).toBeGreaterThan(34);
  });
});

describe('Berserker — Fúria alta agora é vantagem', () => {
  it('com Fúria alta o golpe custa menos stamina do que com Fúria baixa', () => {
    const w = mkWorld(['berserker']);
    const p = me(w);
    p.rage = 0;
    p.move.stamina = 100;
    w.spendStamina(p, 20);
    const calmCost = 100 - p.move.stamina;
    p.rage = BERSERKER.fury.max;
    p.move.stamina = 100;
    w.spendStamina(p, 20);
    const furiousCost = 100 - p.move.stamina;
    expect(furiousCost).toBeLessThan(calmCost);
    expect(furiousCost).toBeCloseTo(20 * BERSERKER.fury.staminaCostMulHigh, 5);
  });

  it('com Fúria alta a stamina começa a voltar mais cedo', () => {
    const w = mkWorld(['berserker']);
    const p = me(w);
    p.rage = 0;
    w.spendStamina(p, 10);
    const calmDelay = p.staminaDelay;
    p.rage = BERSERKER.fury.max;
    w.spendStamina(p, 10);
    expect(p.staminaDelay).toBeLessThan(calmDelay);
  });

  /** Dano que de fato entra num golpe de 40, pelo caminho normal do servidor. */
  function taken(w: World, p: Player): number {
    p.hp = p.maxHp;
    p.iframes = 0;
    p.buffs.stunRes = 0;
    w.hitPlayer(p, { dmg: 40, heavy: false, fromX: p.x + 20, fromY: p.y, enemy: null, proj: null, blockable: false });
    return p.maxHp - p.hp;
  }

  it('com Fúria alta recebe MENOS dano (antes recebia mais)', () => {
    const w = mkWorld(['berserker']);
    w.god = false;
    const p = me(w);
    p.rage = 0;
    const calm = taken(w, p);
    p.rage = BERSERKER.fury.max;
    const furious = taken(w, p);
    expect(calm).toBeGreaterThan(0);
    expect(furious).toBeLessThan(calm);
  });

  it('a Loucura segue sendo o momento de risco: aí sim recebe mais dano', () => {
    const w = mkWorld(['berserker']);
    w.god = false;
    const p = me(w);
    p.rage = BERSERKER.fury.max;
    const furious = taken(w, p);
    p.buffs.madness = sec(BERSERKER.madness.duration);
    expect(taken(w, p)).toBeGreaterThan(furious);
  });

  it('parado, a Fúria escorre — é esse o preço de mantê-la alta', () => {
    const w = mkWorld(['berserker']);
    const p = me(w);
    p.rage = BERSERKER.fury.max;
    p.rageIdle = 0;
    run(w, sec(BERSERKER.fury.decayDelay) + 30);
    expect(p.rage).toBeLessThan(BERSERKER.fury.max - BERSERKER.fury.decayPerSecond * 0.5);
  });
});

describe('Lapanha — acerto das frutas em arco (o bug: parecia acertar e não contava)', () => {
  it('a melancia acerta quando o sprite encosta no inimigo, mesmo com o ponto de chão atrás dos pés', () => {
    const w = mkWorld(['lapanha']);
    const p = me(w);
    const e = spawn(w, 'shambler', p.x + 120, p.y);
    e.state = 'move';
    run(w, 1); // popula o hash espacial
    const hp0 = e.hp;
    const m = LAPANHA.melon;
    // voa na altura dos pés + o deslocamento vertical do desenho: na tela passa DENTRO do inimigo,
    // mas no plano do chão fica ~20px ao sul — exatamente o caso que antes não contava acerto
    const offset = SHOT_HEIGHT + 12;
    w.spawnProjectile({
      kind: 'melon', team: 'p', owner: p.id, x: e.x - 40, y: e.y + offset,
      vx: m.speed, vy: 0, r: m.radius, dmg: m.centerDamage, range: m.range, lob: m.range,
      splash: m.blastRadius, poise: m.poise, kb: m.knockback, a: m.edgeDamage,
    });
    run(w, 12);
    expect(e.hp).toBeLessThan(hp0);
  });

  it('não vira acerto mágico: uma melancia que passa longe continua não acertando', () => {
    const w = mkWorld(['lapanha']);
    const p = me(w);
    const e = spawn(w, 'shambler', p.x + 120, p.y);
    e.state = 'move';
    run(w, 1);
    const hp0 = e.hp;
    const m = LAPANHA.melon;
    w.spawnProjectile({
      kind: 'melon', team: 'p', owner: p.id, x: e.x - 40, y: e.y + 90,
      vx: m.speed, vy: 0, r: m.radius, dmg: m.centerDamage, range: m.range, lob: m.range,
      splash: m.blastRadius, poise: m.poise, kb: m.knockback, a: m.edgeDamage,
    });
    run(w, 12);
    expect(e.hp).toBe(hp0);
  });
});

describe('Lapanha — Melancia Madura passa por cima de paredes', () => {
  /**
   * Acha uma parede fina (um tile sólido com chão livre dos dois lados na mesma linha): é o
   * cenário exato de "jogar a melancia por cima do muro".
   */
  function thinWall(w: World): { x: number; y: number } | null {
    for (let ty = 2; ty < w.map.h - 2; ty++) {
      for (let tx = 2; tx < w.map.w - 3; tx++) {
        if (!blocksShot(w.map, tx, ty)) continue;
        if (blocksShot(w.map, tx - 1, ty) || blocksShot(w.map, tx + 1, ty)) continue;
        if (blocksShot(w.map, tx - 2, ty) || blocksShot(w.map, tx + 2, ty)) continue;
        return { x: tx * TILE + TILE / 2, y: ty * TILE + TILE / 2 };
      }
    }
    return null;
  }

  it('a fruta não morre na parede: passa por cima e segue até o ponto mirado', () => {
    const w = mkWorld(['lapanha']);
    const p = me(w);
    const wall = thinWall(w);
    expect(wall, 'cenário sem parede fina: o teste não verificaria nada').toBeTruthy();
    if (!wall) return;
    const R = LAPANHA.ripe;
    const start = wall.x - TILE * 1.5;
    const reach = TILE * 3;
    const pr = w.spawnProjectile({
      kind: 'bigMelon', team: 'p', owner: p.id, x: start, y: wall.y,
      vx: R.speed, vy: 0, r: 5, dmg: R.minDamage, range: reach, lob: reach,
      splash: R.minRadius, poise: R.minPoise, kb: R.minKnockback, tx: start + reach, ty: wall.y,
    });
    run(w, Math.ceil(reach / (R.speed / 30)) + 2);
    expect(pr.x).toBeGreaterThan(wall.x + TILE / 2);
  });

  it('uma melancia comum (arco baixo) continua parando na parede', () => {
    const w = mkWorld(['lapanha']);
    const p = me(w);
    const wall = thinWall(w);
    expect(wall, 'cenário sem parede fina: o teste não verificaria nada').toBeTruthy();
    if (!wall) return;
    const m = LAPANHA.melon;
    const start = wall.x - TILE * 1.5;
    const pr = w.spawnProjectile({
      kind: 'melon', team: 'p', owner: p.id, x: start, y: wall.y,
      vx: m.speed, vy: 0, r: m.radius, dmg: m.centerDamage, range: TILE * 6, lob: TILE * 6,
      splash: m.blastRadius, poise: m.poise, kb: m.knockback, a: m.edgeDamage,
    });
    run(w, 10);
    expect(pr.dead).toBe(true);
    expect(pr.x).toBeLessThan(wall.x + TILE);
  });

  it('o alvo do Q é o ponto mirado, sem travar no primeiro obstáculo do caminho', () => {
    const w = mkWorld(['lapanha']);
    const p = me(w);
    const wall = thinWall(w);
    expect(wall).toBeTruthy();
    if (!wall) return;
    // jogador de um lado da parede, mira do outro lado
    p.move.x = wall.x - TILE * 2;
    p.move.y = wall.y;
    const aimX = wall.x + TILE * 2;
    w.drainEvents();
    // carrega o Q e solta
    run(w, 1, () => ({ pressed: BTN.q, held: BTN.q, ax: aimX, ay: wall.y }));
    run(w, LAPANHA.ripe.chargeMinTicks + 2, () => ({ held: BTN.q, ax: aimX, ay: wall.y }));
    run(w, 6, () => ({ held: 0, ax: aimX, ay: wall.y }));
    const melon = w.projectiles.find((q) => q.kind === 'bigMelon');
    expect(melon, 'a Melancia Madura não foi lançada').toBeTruthy();
    // o destino ficou além da parede (antes era cortado no último ponto livre antes dela)
    expect((melon as { tx: number }).tx).toBeGreaterThan(wall.x);
  });
});

describe('Falas: todas as classes têm voz própria', () => {
  const GENERIC: LineKind[] = ['matchStart', 'waveStart', 'ult', 'lowHp', 'minibossDown', 'bossDown', 'reviveAlly', 'revived', 'victory', 'defeat'];

  it('cada uma das oito classes tem falas em todos os momentos genéricos', () => {
    for (const cls of CLASS_IDS) {
      const pool = LINES[cls];
      expect(pool, `classe ${cls} sem falas`).toBeTruthy();
      for (const kind of GENERIC) {
        expect((pool?.[kind]?.length ?? 0), `${cls}/${kind} sem falas`).toBeGreaterThan(0);
      }
    }
  });

  it('nenhuma fala é repetida entre classes (cada voz é reconhecível)', () => {
    const seen = new Map<string, ClassId>();
    for (const cls of CLASS_IDS) {
      for (const pool of Object.values(LINES[cls] ?? {})) {
        for (const line of pool ?? []) {
          expect(seen.has(line), `"${line}" repetida em ${cls} e ${seen.get(line)}`).toBe(false);
          seen.set(line, cls);
        }
      }
    }
  });

  it('a suprema faz o personagem falar, em qualquer classe', () => {
    for (const cls of CLASS_IDS) {
      const w = mkWorld([cls]);
      const p = me(w);
      p.ult = 100;
      p.essence = 7; // Necromante: o Exército exige Essência
      w.drainEvents();
      run(w, 1, () => ({ pressed: BTN.r }));
      const said = w.drainEvents().filter((ev) => ev.k === 'say' && ev.pi === p.id).map((ev) => (ev as { txt: string }).txt);
      expect(said.length, `classe ${cls} não falou ao usar a suprema`).toBeGreaterThan(0);
      expect(LINES[cls]?.ult).toContain(said[0]);
    }
  });
});
