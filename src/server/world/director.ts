/**
 * Diretor de ondas: monta a composição a partir do orçamento, respeita o limite de unidades
 * simultâneas, avisa spawns com antecedência e longe dos jogadores, e evita ondas travadas.
 */
import { ATK, ENEMIES, type EnemyType } from '../../shared/config/enemies.js';
import { SCALING, scaledBudget, type WaveDef, WAVES } from '../../shared/config/waves.js';
import { sec } from '../../shared/constants.js';
import { circleFree } from '../../shared/collision.js';
import { WORLD_H, WORLD_W, type SpawnGate } from '../../shared/map.js';
import { dist } from '../../shared/math.js';
import type { Enemy } from './types.js';
import type { World } from './world.js';

interface PendingGroup {
  gate: { x: number; y: number };
  types: EnemyType[];
  t: number;
}

export class Director {
  private queue: EnemyType[] = [];
  private pending: PendingGroup[] = [];
  private groupTimer = 0;
  private def: WaveDef | null = null;
  private players = 1;
  private bossType: EnemyType | null = null;
  private bossTimer = 0;
  private maxAlive = 20;
  private minibossType: EnemyType | null = null;
  private minibossAt = 0;

  constructor(private readonly w: World) {}

  reset(): void {
    this.queue = [];
    this.pending = [];
    this.def = null;
    this.bossType = null;
    this.minibossType = null;
  }

  /** Esvazia a fila da onda atual mantendo-a ativa (testes/depuração). */
  debugClear(): void {
    this.queue = [];
    this.pending = [];
    this.bossType = null;
    this.minibossType = null;
  }

  start(wave: number, players: number, opts: { budgetMul: number; extraElites: number } = { budgetMul: 1, extraElites: 0 }): void {
    const def = WAVES[wave - 1] ?? null;
    this.def = def;
    this.players = players;
    this.queue = [];
    this.pending = [];
    this.groupTimer = 0;
    this.minibossType = null;
    if (!def) return;
    this.maxAlive = Math.min(SCALING.hardCap, def.maxAlive + SCALING.maxAlivePerPlayer * (players - 1));
    // composição por orçamento ponderado (rota de risco aumenta o orçamento)
    let budget = scaledBudget(wave, players, def.boss ? 1 : opts.budgetMul);
    const entries = Object.entries(def.weights) as [EnemyType, number][];
    const total = entries.reduce((s, [, v]) => s + v, 0);
    let guard = 0;
    while (budget > 0.5 && guard++ < 500) {
      let r = this.w.rng.next() * total;
      let pick: EnemyType = entries[0]?.[0] ?? 'shambler';
      for (const [t, v] of entries) {
        r -= v;
        if (r <= 0) {
          pick = t;
          break;
        }
      }
      this.queue.push(pick);
      budget -= ENEMIES[pick].budget;
    }
    // elites garantidos distribuídos ao longo da onda
    const extra: EnemyType[] = [];
    for (const [t, n] of Object.entries(def.guaranteed ?? {}) as [EnemyType, number][]) {
      const count = Math.round(n * (1 + 0.35 * (players - 1)));
      for (let i = 0; i < count; i++) extra.push(t);
    }
    // rota de risco: elites extras (não em ondas de chefe)
    if (!def.boss) for (let i = 0; i < opts.extraElites; i++) extra.push(this.w.rng.chance(0.5) ? 'werewolf' : 'father');
    extra.forEach((t, i) => {
      const pos = Math.floor(((i + 1) / (extra.length + 1)) * this.queue.length);
      this.queue.splice(pos, 0, t);
    });
    this.bossType = def.boss ?? null;
    this.bossTimer = sec(2);
    if (this.bossType) this.groupTimer = sec(8);
    // minichefe entra depois que ~35% da fila já saiu
    if (def.miniboss) {
      this.minibossType = def.miniboss;
      this.minibossAt = Math.floor(this.queue.length * 0.65);
    }
  }

  /** Inimigos que ainda faltam derrotar (vivos + fila + avisos pendentes + chefe a surgir). */
  remaining(): number {
    let alive = 0;
    for (const e of this.w.enemies.values()) if (e.state !== 'dead' && !e.def.objective) alive++;
    return alive + this.queue.length + this.pending.reduce((s, g) => s + g.types.length, 0) + (this.bossType ? 1 : 0) + (this.minibossType ? 1 : 0);
  }

  complete(): boolean {
    return this.def !== null && this.remaining() === 0;
  }

  private aliveCount(): number {
    let n = 0;
    for (const e of this.w.enemies.values()) if (e.state !== 'dead' && !e.def.objective) n++;
    return n;
  }

  private chooseGate(): SpawnGate {
    const gates = this.w.map.spawns;
    const players = this.w.alivePlayers();
    const minDist = (g: SpawnGate): number => players.reduce((m, p) => Math.min(m, dist(p.x, p.y, g.x, g.y)), Infinity);
    const safe = gates.filter((g) => minDist(g) >= SCALING.spawnSafeDistance);
    if (safe.length) return this.w.rng.pick(safe);
    return gates.reduce((a, b) => (minDist(a) > minDist(b) ? a : b));
  }

  tick(): void {
    const w = this.w;
    const def = this.def;
    if (!def) return;
    // chefe
    if (this.bossType) {
      if (this.bossTimer === sec(2)) {
        const bp = this.bossPoint(this.bossType);
        w.addZone({ kind: 'spawnWarn', x: bp.x, y: bp.y, r: 60, ttl: sec(2), owner: 0, extra: 1 });
        w.emit({ k: 'sfx', n: 'bossWarn', x: bp.x, y: bp.y });
      }
      if (--this.bossTimer <= 0) {
        const bp = this.bossPoint(this.bossType);
        const e = w.spawnEnemy(this.bossType, bp.x, bp.y, this.players);
        if (this.bossType === 'patriarch') e.summonsLeft = ATK.patriarch.summon.perPhase;
        w.emit({ k: 'boss', et: e.typeIdx, ph: 1 });
        this.bossType = null;
      }
    }
    // minichefe
    if (this.minibossType && this.queue.length <= this.minibossAt) {
      const gate = this.chooseGate();
      const t = this.minibossType;
      this.minibossType = null;
      w.addZone({ kind: 'spawnWarn', x: gate.x, y: gate.y, r: 40, ttl: sec(1.5), owner: 0, extra: 1 });
      this.pending.push({ gate: { x: gate.x, y: gate.y }, types: [t], t: sec(1.5) });
      w.emit({ k: 'msg', txt: `MINICHEFE: ${ENEMIES[t].name}!`, c: 'boss' });
      w.emit({ k: 'sfx', n: 'bossWarn', x: gate.x, y: gate.y });
    }
    // grupos
    const alive = this.aliveCount();
    const pendingCount = this.pending.reduce((s, g) => s + g.types.length, 0);
    if (alive === 0 && pendingCount === 0 && this.groupTimer > 20) this.groupTimer = 20;
    if (--this.groupTimer <= 0 && this.queue.length > 0 && alive + pendingCount < this.maxAlive) {
      const room = this.maxAlive - alive - pendingCount;
      const size = Math.min(room, this.queue.length, w.rng.int(def.groupMin, def.groupMax));
      const gate = this.chooseGate();
      const types = this.queue.splice(0, size);
      const warn = sec(SCALING.spawnWarnSeconds);
      this.pending.push({ gate: { x: gate.x, y: gate.y }, types, t: warn });
      w.addZone({ kind: 'spawnWarn', x: gate.x, y: gate.y, r: 26 + types.length * 3, ttl: warn, owner: 0 });
      this.groupTimer = sec(def.interval * (this.players > 2 ? 0.85 : 1));
    }
    for (const g of this.pending) {
      if (--g.t > 0) continue;
      g.types.forEach((t, i) => {
        const pos = this.freeAround(g.gate.x, g.gate.y, ENEMIES[t].radius, i);
        w.spawnEnemy(t, pos.x, pos.y, this.players);
      });
      g.types = [];
    }
    this.pending = this.pending.filter((g) => g.types.length > 0);
    // anti-travamento: poucos inimigos restantes e ninguém morre há um tempo → enfurecem e são revelados
    if (this.queue.length === 0 && this.pending.length === 0 && alive > 0 && alive <= 3) {
      if (w.tick - w.lastKillTick > sec(18)) {
        for (const e of w.enemies.values()) if (e.def.tier !== 'boss' && !e.enraged) e.enraged = true;
      }
    }
  }

  private bossPoint(_t: EnemyType): { x: number; y: number } {
    return this.w.map.points.boss;
  }

  /** Surge um inimigo perto de um ponto (reforços de eventos). */
  spawnNear(t: EnemyType, x: number, y: number): Enemy {
    const pos = this.freeAround(x, y, ENEMIES[t].radius, this.w.rng.int(0, 7));
    const e = this.w.spawnEnemy(t, pos.x, pos.y, this.players);
    this.w.emit({ k: 'fx', n: 'summon', x: pos.x, y: pos.y, a: 0, o: 0, r: 16 });
    return e;
  }

  private freeAround(x: number, y: number, r: number, i: number): { x: number; y: number } {
    for (let k = 0; k < 24; k++) {
      const a = (i * 2.4 + k * 0.9) % (Math.PI * 2);
      const d = 6 + ((i + k) % 5) * 9;
      const px = x + Math.cos(a) * d;
      const py = y + Math.sin(a) * d;
      if (circleFree(this.w.map, px, py, r)) return { x: px, y: py };
    }
    return { x, y };
  }

  /** Reforços limitados invocados por chefes. */
  summonAround(boss: Enemy, count: number, types: readonly EnemyType[]): void {
    let alive = this.aliveCount();
    for (let i = 0; i < count && alive < SCALING.hardCap; i++) {
      const t = types[i % types.length] as EnemyType;
      const a = (i / count) * Math.PI * 2;
      const pos = this.freeAround(boss.x + Math.cos(a) * 56, boss.y + Math.sin(a) * 56, ENEMIES[t].radius, i);
      this.w.spawnEnemy(t, pos.x, pos.y, this.players);
      this.w.emit({ k: 'fx', n: 'summon', x: pos.x, y: pos.y, a: 0, o: 0, r: 16 });
      alive++;
    }
  }

  /** Detecta inimigos presos/fora do mapa e os reposiciona em um portão seguro. */
  watchStuck(e: Enemy): void {
    const w = this.w;
    const out = e.x < 0 || e.y < 0 || e.x > WORLD_W || e.y > WORLD_H || !circleFree(w.map, e.x, e.y, e.r * 0.8);
    if (e.state !== 'move' && !out) {
      e.progressT = 0;
      return;
    }
    const t = w.players.get(e.targetId);
    if (!t || t.status !== 0) {
      e.progressT = 0;
      return;
    }
    if (e.progressTarget !== t.id) {
      e.progressTarget = t.id;
      e.progressBest = 0xffff;
      e.progressT = 0;
    }
    const f = w.fields.get(t.id)?.at(e.x, e.y) ?? 0xffff;
    if (f + 12 < e.progressBest) {
      e.progressBest = f;
      e.progressT = 0;
    } else e.progressT++;
    const far = dist(e.x, e.y, t.x, t.y) > 90;
    if (out || (e.progressT > sec(5) && far && e.def.tier !== 'boss') || (e.progressT > sec(8) && far)) {
      const g = this.chooseGate();
      const pos = this.freeAround(g.x, g.y, e.r, e.id % 7);
      w.emit({ k: 'fx', n: 'teleport', x: e.x, y: e.y, a: 0, o: 0, r: e.r });
      e.x = pos.x;
      e.y = pos.y;
      e.kvx = 0;
      e.kvy = 0;
      e.progressT = 0;
      e.progressBest = 0xffff;
      w.emit({ k: 'fx', n: 'teleport', x: e.x, y: e.y, a: 0, o: 0, r: e.r });
    }
  }
}
