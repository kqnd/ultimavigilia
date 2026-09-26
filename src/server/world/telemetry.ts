/**
 * Telemetria de balanceamento (servidor). Não é enviada aos jogadores; fica disponível para
 * simulações/testes e no console com o comando de depuração `tele`.
 */
import type { EnemyType } from '../../shared/config/enemies.js';
import { TICK_RATE } from '../../shared/constants.js';
import type { Player, PlayerTelemetry } from './types.js';
import type { World } from './world.js';

export interface WaveTelemetry {
  wave: number;
  seconds: number;
  spawns: Partial<Record<EnemyType, number>>;
  players: Record<number, PlayerTelemetry & { cls: string }>;
}

interface ObjectiveTelemetry {
  damage: number;
  maxPressers: number;
  pressTicks: number;
  byType: Partial<Record<EnemyType, number>>;
}

export class WorldTelemetry {
  waves: WaveTelemetry[] = [];
  private cur: WaveTelemetry | null = null;
  private startTick = 0;
  /** Base dos contadores dos jogadores no início da onda (para medir por onda). */
  private base = new Map<number, PlayerTelemetry>();
  objectives: Record<'bonfire' | 'altar' | 'escort', ObjectiveTelemetry> = WorldTelemetry.emptyObjectives();
  missions: { kind: string; wave: number; ok: boolean }[] = [];
  ambushes = 0;
  assaults = { bonfire: 0, altar: 0 };

  private static emptyObjectives(): Record<'bonfire' | 'altar' | 'escort', ObjectiveTelemetry> {
    const o = (): ObjectiveTelemetry => ({ damage: 0, maxPressers: 0, pressTicks: 0, byType: {} });
    return { bonfire: o(), altar: o(), escort: o() };
  }

  reset(): void {
    this.waves = [];
    this.cur = null;
    this.base.clear();
    this.objectives = WorldTelemetry.emptyObjectives();
    this.missions = [];
    this.ambushes = 0;
    this.assaults = { bonfire: 0, altar: 0 };
  }

  beginWave(n: number, tick: number): void {
    this.cur = { wave: n, seconds: 0, spawns: {}, players: {} };
    this.startTick = tick;
  }

  /** Fecha a onda: guarda a diferença dos contadores de cada jogador. */
  endWave(tick: number, w: World): void {
    const c = this.cur;
    if (!c) return;
    c.seconds = Math.round((tick - this.startTick) / TICK_RATE);
    for (const p of w.players.values()) c.players[p.id] = { ...diff(p.tele, this.base.get(p.id)), cls: p.cls };
    for (const p of w.players.values()) this.base.set(p.id, snapshot(p));
    this.waves.push(c);
    this.cur = null;
  }

  onSpawn(type: EnemyType): void {
    if (!this.cur) return;
    this.cur.spawns[type] = (this.cur.spawns[type] ?? 0) + 1;
  }

  objectiveDamage(kind: 'bonfire' | 'altar' | 'escort', amount: number): void {
    this.objectives[kind].damage += amount;
  }

  objectivePressure(kind: 'bonfire' | 'altar', n: number, types: EnemyType[]): void {
    const o = this.objectives[kind];
    o.maxPressers = Math.max(o.maxPressers, n);
    if (n > 0) o.pressTicks++;
    for (const t of types) o.byType[t] = (o.byType[t] ?? 0) + 1;
  }

  mission(kind: string, ok: boolean, wave: number): void {
    this.missions.push({ kind, wave, ok });
  }

  ambush(): void {
    this.ambushes++;
  }

  assault(kind: 'bonfire' | 'altar'): void {
    this.assaults[kind]++;
  }

  /** Aparições acumuladas de um tipo até a onda N (inclusive). */
  spawnsUntil(type: EnemyType, wave: number): number {
    return this.waves.filter((x) => x.wave <= wave).reduce((s, x) => s + (x.spawns[type] ?? 0), 0);
  }

  report(w: World): unknown {
    return {
      waves: this.waves.map((x) => ({ wave: x.wave, s: x.seconds, spawns: x.spawns, players: x.players })),
      objectives: this.objectives,
      missions: this.missions,
      ambushes: this.ambushes,
      assaults: this.assaults,
      now: [...w.players.values()].map((p) => ({ id: p.id, cls: p.cls, tele: p.tele })),
    };
  }
}

function snapshot(p: Player): PlayerTelemetry {
  return { ...p.tele, heal: { ...p.tele.heal } };
}

function diff(a: PlayerTelemetry, b: PlayerTelemetry | undefined): PlayerTelemetry {
  if (!b) return snapshot({ tele: a } as Player);
  const heal: PlayerTelemetry['heal'] = {};
  for (const k of Object.keys(a.heal) as (keyof PlayerTelemetry['heal'])[]) heal[k] = (a.heal[k] ?? 0) - (b.heal[k] ?? 0);
  return {
    heal,
    wasted: a.wasted - b.wasted,
    woundCut: a.woundCut - b.woundCut,
    taken: a.taken - b.taken,
    lowTicks: a.lowTicks - b.lowTicks,
    woundsApplied: a.woundsApplied - b.woundsApplied,
    woundsAvoided: a.woundsAvoided - b.woundsAvoided,
    woundsInterrupted: a.woundsInterrupted - b.woundsInterrupted,
    sacrificed: a.sacrificed - b.sacrificed,
    stuns: a.stuns - b.stuns,
    stunsResisted: a.stunsResisted - b.stunsResisted,
  };
}
