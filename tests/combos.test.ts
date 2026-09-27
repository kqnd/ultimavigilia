/**
 * Combos entre classes: Combo Gélido (duas lentidões de fontes diferentes = atordoamento breve),
 * Casca Traiçoeira + golpe pesado (atordoa na hora, sem estourar postura), Escudo do Portador
 * quebrado (pulso de controle em comuns próximos), Provocação + Casca (empurrão em cadeia),
 * Marca de Ossos + atordoar (Essência bônus) e Caçador de Névoa velado exposto por área. Tudo
 * verificado no servidor autoritativo — nenhum combo aqui deveria alterar dano/CC fora das
 * janelas e cooldowns próprios (ver ../src/shared/config/combos.ts).
 */
import { describe, expect, it } from 'vitest';
import { type ClassId } from '../src/shared/config/classes.js';
import { COMBOS } from '../src/shared/config/combos.js';
import { sec } from '../src/shared/constants.js';
import { type InputFrame } from '../src/shared/movement.js';
import { lapanhaKit } from '../src/server/world/kits/lapanha.js';
import type { Enemy, Player } from '../src/server/world/types.js';
import { World } from '../src/server/world/world.js';

type InputFn = (p: Player, w: World) => Partial<InputFrame> | null;

function mkWorld(classes: ClassId[]): World {
  const w = new World({ seed: 14, solo: false });
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

describe('Combo Gélido: duas lentidões de fontes diferentes virando atordoamento breve', () => {
  it('a segunda lentidão, de fonte diferente, atordoa; a mesma fonte repetida não', () => {
    const w = mkWorld(['hunter']);
    const p = me(w);
    const e = spawn(w, 'shambler', p.x + 40, p.y);
    expect(w.applyCC(e, 'slow', 2, 0.5, p, 'c:hunter')).toBeGreaterThan(0);
    expect(e.cc.stun).toBe(0);
    // mesma fonte de novo: só renova a lentidão, não congela
    w.applyCC(e, 'slow', 2, 0.5, p, 'c:hunter');
    expect(e.cc.stun).toBe(0);
    // fonte diferente: combo dispara
    w.applyCC(e, 'slow', 2, 0.5, null, 'field');
    expect(e.cc.stun).toBeGreaterThan(0);
  });

  it('respeita cooldown por inimigo (não recongela instantaneamente de novo)', () => {
    const w = mkWorld(['hunter']);
    const p = me(w);
    const e = spawn(w, 'shambler', p.x + 40, p.y);
    w.applyCC(e, 'slow', 2, 0.5, p, 'c:hunter');
    w.applyCC(e, 'slow', 2, 0.5, null, 'field');
    expect(e.cc.stun).toBeGreaterThan(0);
    e.cc.stun = 0;
    // ainda dentro do cooldown do combo: nova fonte diferente não congela de novo
    w.applyCC(e, 'slow', 2, 0.5, p, 'c:hunter2');
    expect(e.cc.stun).toBe(0);
    expect(e.cc.freezeCd).toBeGreaterThan(0);
  });

  it('chefes/elites resistem ao congelamento tanto quanto resistiriam a um atordoamento normal', () => {
    const w = mkWorld(['hunter']);
    const p = me(w);
    const boss = spawn(w, 'patriarch', p.x + 40, p.y);
    expect(boss.def.ccResist).toBeLessThan(1); // chefe resiste a CC
    w.applyCC(boss, 'slow', 2, 0.5, p, 'c:hunter');
    w.applyCC(boss, 'slow', 2, 0.5, null, 'field');
    // a duração de atordoamento aplicada segue exatamente ccResist do chefe (mesma fórmula do
    // atordoamento comum) e é sempre menor que a duração cheia sem resistência
    expect(boss.cc.stun).toBeLessThan(sec(COMBOS.freeze.seconds));
    expect(boss.cc.stun).toBeCloseTo(sec(COMBOS.freeze.seconds * boss.def.ccResist), 0);
  });
});

describe('Combo Casca Traiçoeira + golpe pesado: atordoa na hora durante a vulnerabilidade pós-escorregão', () => {
  it('golpe pesado com vulnT ativo atordoa mesmo sem estourar a barra de postura', () => {
    const w = mkWorld(['hunter']);
    const p = me(w);
    const e = spawn(w, 'shambler', p.x + 40, p.y);
    e.vulnT = sec(1);
    e.state = 'move';
    const before = e.poise;
    w.hitEnemy(p, e, 10, { poise: COMBOS.slipFollowUp.poiseThreshold, kb: 0, fromX: p.x, fromY: p.y, kind: 'melee' });
    expect(e.state).toBe('stagger');
    expect(e.vulnT).toBe(0); // consumido: só um aproveitamento por escorregão
    expect(e.poise).toBe(before); // não passou pelo acúmulo normal de postura
  });

  it('sem vulnT, o mesmo golpe só acumula postura normalmente (não atordoa de graça)', () => {
    const w = mkWorld(['hunter']);
    const p = me(w);
    // postura do elite (60) é maior que o limiar do combo (30): uma única batida no limiar
    // não estoura a barra por si só, então sem vulnT ela só deveria acumular.
    const e = spawn(w, 'werewolf', p.x + 40, p.y);
    e.state = 'move';
    w.hitEnemy(p, e, 10, { poise: COMBOS.slipFollowUp.poiseThreshold, kb: 0, fromX: p.x, fromY: p.y, kind: 'melee' });
    expect(e.state).not.toBe('stagger');
    expect(e.poise).toBeGreaterThan(0);
  });
});

describe('Combo Escudo do Portador quebrado: pulso de controle em comuns próximos', () => {
  it('ao destruir o escudo, comuns próximos são atordoados; elites não', () => {
    const w = mkWorld(['hunter']);
    const p = me(w);
    const bearer = spawn(w, 'ossuaryBearer', p.x + 60, p.y);
    const common = spawn(w, 'shambler', bearer.x + 30, bearer.y);
    const elite = spawn(w, 'werewolf', bearer.x - 30, bearer.y);
    common.state = 'move';
    elite.state = 'move';
    run(w, 1); // popula o hash espacial usado por enemiesInCircle
    w.damageShield(bearer, bearer.shieldMax + 999, p);
    expect(bearer.shieldHp).toBe(0);
    expect(common.state).toBe('stagger');
    expect(elite.state).not.toBe('stagger');
  });

  it('sem ser destruído (ainda com vida), não dispara o pulso', () => {
    const w = mkWorld(['hunter']);
    const p = me(w);
    const bearer = spawn(w, 'ossuaryBearer', p.x + 60, p.y);
    const common = spawn(w, 'shambler', bearer.x + 30, bearer.y);
    common.state = 'move';
    w.damageShield(bearer, 1, p);
    expect(bearer.shieldHp).toBeGreaterThan(0);
    expect(common.state).not.toBe('stagger');
  });
});

describe('Combo Provocação + Casca Traiçoeira: escorregão de um alvo provocado empurra quem está perto', () => {
  it('inimigo provocado que escorrega machuca comuns próximos; sem provocação, não', () => {
    const w = mkWorld(['lapanha']);
    const p = me(w);
    const target = spawn(w, 'shambler', p.x + 60, p.y);
    target.state = 'move';
    target.tauntBy = 999; // simula provocação de um Guardião (id fictício, só precisa existir)
    target.tauntT = sec(2);
    const bystander = spawn(w, 'shambler', target.x + 20, target.y);
    bystander.state = 'move';
    run(w, 1); // popula o hash espacial usado por enemiesInCircle
    const hpBefore = bystander.hp;
    const z = w.addZone({ kind: 'peel', x: target.x, y: target.y, r: 40, ttl: sec(3), owner: p.id, a: 0 });
    lapanhaKit.zoneTick?.(w, z, p);
    expect(target.slideT).toBeGreaterThan(0); // escorregou de verdade (comum)
    expect(bystander.hp).toBeLessThan(hpBefore);
  });

  it('sem provocação ativa, o escorregão não machuca quem está perto (só a Casca em si)', () => {
    const w = mkWorld(['lapanha']);
    const p = me(w);
    const target = spawn(w, 'shambler', p.x + 60, p.y);
    target.state = 'move';
    const bystander = spawn(w, 'shambler', target.x + 20, target.y);
    bystander.state = 'move';
    run(w, 1); // popula o hash espacial usado por enemiesInCircle
    const hpBefore = bystander.hp;
    const z = w.addZone({ kind: 'peel', x: target.x, y: target.y, r: 40, ttl: sec(3), owner: p.id, a: 0 });
    lapanhaKit.zoneTick?.(w, z, p);
    expect(target.slideT).toBeGreaterThan(0);
    expect(bystander.hp).toBe(hpBefore);
  });
});

describe('Combo Marca de Ossos + atordoar: Essência bônus imediata para quem marcou', () => {
  it('atordoar um alvo marcado dá Essência na hora, respeitando o cooldown por inimigo', () => {
    const w = mkWorld(['necromancer']);
    const nec = me(w);
    nec.essence = 0;
    const e = spawn(w, 'shambler', nec.x + 40, nec.y);
    e.boneBy = nec.id;
    e.boneT = sec(3);
    e.state = 'move';
    w.stagger(e, 0.5);
    expect(nec.essence).toBe(COMBOS.markStagger.essence);
    // atordoar de novo, ainda dentro do cooldown do combo: sem bônus extra
    e.state = 'move';
    w.stagger(e, 0.5);
    expect(nec.essence).toBe(COMBOS.markStagger.essence);
  });

  it('sem marca, atordoar não gera Essência', () => {
    const w = mkWorld(['necromancer']);
    const nec = me(w);
    nec.essence = 0;
    const e = spawn(w, 'shambler', nec.x + 40, nec.y);
    e.state = 'move';
    w.stagger(e, 0.5);
    expect(nec.essence).toBe(0);
  });
});

describe('Combo Caçador de Névoa velado exposto: acerto em área revela e dá pequeno bônus de dano', () => {
  it('um acerto em área nele velado o expõe; o golpe seguinte na janela recebe o bônus', () => {
    const w = mkWorld(['mage']);
    const p = me(w);
    const e = spawn(w, 'mistStalker', p.x + 60, p.y);
    e.veiled = true;
    e.state = 'move';
    w.hitEnemy(p, e, 20, { poise: 0, kb: 0, fromX: p.x, fromY: p.y, kind: 'aoe' });
    expect(e.exposedT).toBeGreaterThan(0);
    const hpBefore = e.hp;
    w.hitEnemy(p, e, 20, { poise: 0, kb: 0, fromX: p.x, fromY: p.y, kind: 'melee' });
    const dealt = hpBefore - e.hp;
    expect(dealt).toBe(Math.max(1, Math.round(20 * COMBOS.exposeVeiled.mul)));
  });

  it('golpe corpo a corpo (não em área) não expõe o velado', () => {
    const w = mkWorld(['mage']);
    const p = me(w);
    const e = spawn(w, 'mistStalker', p.x + 60, p.y);
    e.veiled = true;
    e.state = 'move';
    w.hitEnemy(p, e, 20, { poise: 0, kb: 0, fromX: p.x, fromY: p.y, kind: 'melee' });
    expect(e.exposedT).toBe(0);
  });

  it('já exposto, não estende a janela por golpe em área repetido (não reduz dano do golpe atual)', () => {
    const w = mkWorld(['mage']);
    const p = me(w);
    const e = spawn(w, 'mistStalker', p.x + 60, p.y);
    e.veiled = true;
    e.state = 'move';
    w.hitEnemy(w.players.get(1) as Player, e, 20, { poise: 0, kb: 0, fromX: p.x, fromY: p.y, kind: 'aoe' });
    const t1 = e.exposedT;
    run(w, 5);
    w.hitEnemy(p, e, 20, { poise: 0, kb: 0, fromX: p.x, fromY: p.y, kind: 'aoe' });
    expect(e.exposedT).toBeLessThan(t1); // não renovou: só decaiu com o tempo
  });
});
