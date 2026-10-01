/**
 * Diretor de ondas: monta a composição a partir do orçamento, respeita o limite de unidades
 * simultâneas, avisa spawns com antecedência e longe dos jogadores, e evita ondas travadas.
 */
import { ATK, ENEMIES, type EnemyType, SPECIAL_RULES, SPECIAL_TYPES, type SpecialType, specialCap } from '../../shared/config/enemies.js';
import { SCALING, scaledBudget, type WaveDef, WAVES } from '../../shared/config/waves.js';
import { ARCHETYPE_NAME, fillQueue, planWave, WAVE_MODIFIERS, type WavePlan } from '../../shared/config/waveVariety.js';
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
  /** Pontos exatos (emboscadas/assaltos) e função tática dos que surgirem. */
  points?: { x: number; y: number }[];
  role?: Enemy['role'];
}

/** Registro de depuração: quais inimigos foram escolhidos e por quê (UV_DEBUG=1 imprime). */
export interface DirectorLog {
  wave: number;
  type: EnemyType;
  reason: string;
}

export class Director {
  private queue: EnemyType[] = [];
  private pending: PendingGroup[] = [];
  private groupTimer = 0;
  private def: WaveDef | null = null;
  /** Plano procedural da onda (mistura, ritmo, portões), semeado por partida+onda. */
  plan: WavePlan | null = null;
  private players = 1;
  private bossType: EnemyType | null = null;
  private bossTimer = 0;
  private maxAlive = 20;
  private minibossType: EnemyType | null = null;
  private minibossAt = 0;
  /** Tamanho inicial da fila (progresso da onda para assaltos). */
  private initialQueue = 0;
  /** Segura novos grupos (ritmo da escolta após emboscadas). */
  private calm = 0;
  /** Último especial usado (alternância entre ondas). */
  private lastSpecials: SpecialType[] = [];
  readonly log: DirectorLog[] = [];

  constructor(private readonly w: World) {}

  reset(): void {
    this.queue = [];
    this.pending = [];
    this.def = null;
    this.plan = null;
    this.bossType = null;
    this.minibossType = null;
    this.calm = 0;
    this.lastSpecials = [];
    this.log.length = 0;
  }

  private note(wave: number, type: EnemyType, reason: string): void {
    this.log.push({ wave, type, reason });
    if (this.log.length > 400) this.log.splice(0, 100);
    if (process.env.UV_DEBUG === '1' && process.env.UV_DIRECTOR_LOG === '1') console.log(`[diretor] onda ${wave}: ${type} — ${reason}`);
  }

  /** Fração da fila da onda já liberada (0–1). */
  progress(): number {
    if (this.initialQueue <= 0) return 1;
    return 1 - this.queue.length / this.initialQueue;
  }

  /** Segura a saída de novos grupos por alguns ticks (respiro de reposicionamento). */
  holdGroups(ticks: number): void {
    this.calm = Math.max(this.calm, ticks);
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
    // variedade procedural (chefe/minichefe saem idênticos à definição)
    const unlocked = (t: EnemyType): boolean => !(SPECIAL_TYPES as readonly string[]).includes(t) || wave >= SPECIAL_RULES.unlockWave[t as SpecialType];
    const plan = planWave(wave, def, this.w.seed, this.w.map.spawns.length, unlocked);
    this.plan = plan;
    this.maxAlive = Math.min(SCALING.hardCap, plan.maxAlive + SCALING.maxAlivePerPlayer * (players - 1));
    // composição por orçamento ponderado (rota de risco aumenta o orçamento)
    let budget = scaledBudget(wave, players, def.boss ? 1 : opts.budgetMul);
    // especiais só depois da onda de introdução de cada um
    const entries = (Object.entries(plan.weights) as [EnemyType, number][]).filter(([t]) => unlocked(t));
    this.queue = fillQueue(entries, budget, this.w.rng, (pick) => {
      if ((SPECIAL_TYPES as readonly string[]).includes(pick)) this.note(wave, pick, 'sorteio por peso');
    });
    if (plan.modifier) this.w.emit({ k: 'msg', txt: WAVE_MODIFIERS[plan.modifier].notice, c: 'bad' });
    else if (plan.tilt) this.note(wave, entries[0]?.[0] ?? 'shambler', `inclinação: ${ARCHETYPE_NAME[plan.tilt]}`);
    // elites garantidos distribuídos ao longo da onda
    const extra: EnemyType[] = [];
    const guaranteed = { ...(def.guaranteed ?? {}) } as Partial<Record<EnemyType, number>>;
    for (const t of Object.keys(guaranteed) as EnemyType[]) if (!unlocked(t)) delete guaranteed[t];
    // presença mínima e combinações: nenhuma sessão fica quase sem os novos inimigos
    if (!def.boss && !def.miniboss) {
      const have = SPECIAL_TYPES.filter((t) => (guaranteed[t] ?? 0) > 0);
      const avail = SPECIAL_TYPES.filter((t) => wave >= SPECIAL_RULES.unlockWave[t]);
      // alterna: prefere o tipo usado há mais tempo
      const fresh = (): SpecialType | undefined => [...avail].filter((t) => !have.includes(t)).sort((a, b) => this.lastSpecials.indexOf(a) - this.lastSpecials.indexOf(b))[0];
      if (wave >= SPECIAL_RULES.guaranteeFrom && have.length === 0) {
        const t = fresh();
        if (t) {
          guaranteed[t] = 1;
          have.push(t);
          this.note(wave, t, 'presença mínima (onda sem especial)');
        }
      }
      if (wave >= SPECIAL_RULES.pairFrom && have.length === 1 && this.w.rng.chance(SPECIAL_RULES.pairChance)) {
        const t = fresh();
        if (t) {
          guaranteed[t] = 1;
          have.push(t);
          this.note(wave, t, 'combinação de dois tipos');
        }
      }
    }
    for (const [t, n] of Object.entries(guaranteed) as [EnemyType, number][]) {
      const count = Math.round(n * (1 + 0.35 * (players - 1)));
      for (let i = 0; i < count; i++) extra.push(t);
      if ((SPECIAL_TYPES as readonly string[]).includes(t)) {
        this.note(wave, t, `garantido ×${count}`);
        this.lastSpecials = [...this.lastSpecials.filter((x) => x !== t), t as SpecialType];
      }
    }
    // rota de risco: elites extras (não em ondas de chefe)
    if (!def.boss) for (let i = 0; i < opts.extraElites; i++) extra.push(this.w.rng.chance(0.5) ? 'werewolf' : 'father');
    extra.forEach((t, i) => {
      const pos = Math.floor(((i + 1) / (extra.length + 1)) * this.queue.length);
      this.queue.splice(pos, 0, t);
    });
    this.initialQueue = this.queue.length;
    this.calm = 0;
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
    // o sobrevivente conta como alguém a proteger: ninguém surge em cima dele
    const guard: { x: number; y: number }[] = [...players];
    for (const m of this.w.minions.values()) if (m.kind === 'survivor') guard.push(m);
    const minDist = (g: SpawnGate): number => guard.reduce((m, p) => Math.min(m, dist(p.x, p.y, g.x, g.y)), Infinity);
    const focus = this.plan?.gateFocus;
    const focused = focus ? gates.filter((_, i) => focus.includes(i)) : gates;
    const safeIn = (list: readonly SpawnGate[]): SpawnGate[] => list.filter((g) => minDist(g) >= SCALING.spawnSafeDistance);
    const safe = safeIn(focused).length ? safeIn(focused) : safeIn(gates);
    if (safe.length) return this.w.rng.pick(safe);
    return gates.reduce((a, b) => (minDist(a) > minDist(b) ? a : b));
  }

  tick(): void {
    const w = this.w;
    const def = this.def;
    const plan = this.plan;
    if (!def || !plan) return;
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
        w.startBossIntro(e);
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
    if (this.calm > 0) this.calm--;
    if (this.calm <= 0 && --this.groupTimer <= 0 && this.queue.length > 0 && alive + pendingCount < this.maxAlive) {
      const room = this.maxAlive - alive - pendingCount;
      const size = Math.min(room, this.queue.length, w.rng.int(plan.groupMin, plan.groupMax));
      const gate = this.chooseGate();
      const types = this.takeGroup(size);
      if (!types.length) {
        this.groupTimer = 15; // só restam especiais no limite: tenta de novo em meio segundo
      } else {
        const warn = sec(SCALING.spawnWarnSeconds);
        this.pending.push({ gate: { x: gate.x, y: gate.y }, types, t: warn });
        w.addZone({ kind: 'spawnWarn', x: gate.x, y: gate.y, r: 26 + types.length * 3, ttl: warn, owner: 0 });
        this.groupTimer = sec(plan.interval * (this.players > 2 ? 0.85 : 1));
      }
    }
    for (const g of this.pending) {
      if (--g.t > 0) continue;
      g.types.forEach((t, i) => {
        const pt = g.points?.[i];
        const pos = pt && circleFree(w.map, pt.x, pt.y, ENEMIES[t].radius) ? pt : this.freeAround(pt?.x ?? g.gate.x, pt?.y ?? g.gate.y, ENEMIES[t].radius, i);
        const e = w.spawnEnemy(t, pos.x, pos.y, this.players);
        if (g.role) e.role = g.role;
        if (ENEMIES[t].miniboss) w.startBossIntro(e);
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

  /**
   * Retira até `size` inimigos da fila respeitando o limite simultâneo de especiais anti-kite
   * (vivos + avisados + neste grupo). Especiais acima do limite esperam na fila.
   */
  private takeGroup(size: number): EnemyType[] {
    const count = this.specialCount();
    const out: EnemyType[] = [];
    for (let i = 0; i < this.queue.length && out.length < size; ) {
      const t = this.queue[i] as EnemyType;
      const cap = specialCap(t, this.players);
      if (cap !== undefined && (count.get(t) ?? 0) >= cap) {
        i++;
        continue;
      }
      count.set(t, (count.get(t) ?? 0) + 1);
      out.push(t);
      this.queue.splice(i, 1);
    }
    return out;
  }

  /** Vivos + avisados por tipo (limites simultâneos de especiais). */
  specialCount(): Map<EnemyType, number> {
    const count = new Map<EnemyType, number>();
    for (const e of this.w.enemies.values()) if (e.state !== 'dead') count.set(e.type, (count.get(e.type) ?? 0) + 1);
    for (const g of this.pending) for (const t of g.types) count.set(t, (count.get(t) ?? 0) + 1);
    return count;
  }

  /** Especial ainda cabe no limite simultâneo? */
  specialFits(t: EnemyType, extra = 0): boolean {
    const cap = specialCap(t, this.players);
    return cap === undefined || (this.specialCount().get(t) ?? 0) + extra < cap;
  }

  /**
   * Grupo planejado (emboscada da escolta, assalto à fogueira/altar): avisa nos pontos exatos
   * e surge depois do aviso, com função tática. Conta como parte da onda.
   */
  plannedGroup(points: { x: number; y: number }[], types: EnemyType[], warnTicks: number, role: Enemy['role'], zone: 'spawnWarn' | 'ambushWarn' | 'assaultWarn'): void {
    if (!types.length) return;
    const wave = this.w.wave;
    for (const t of types) if ((SPECIAL_TYPES as readonly string[]).includes(t)) this.note(wave, t, `grupo planejado (${zone === 'assaultWarn' ? 'assalto' : 'emboscada'})`);
    const gate = points[0] ?? this.w.map.campfire;
    this.pending.push({ gate: { x: gate.x, y: gate.y }, types, t: warnTicks, points, role });
    for (const pt of points) this.w.addZone({ kind: zone, x: pt.x, y: pt.y, r: 20, ttl: warnTicks, owner: 0 });
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
