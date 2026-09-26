/**
 * Composição das 30 ondas (três capítulos) e escala por número de jogadores.
 * A dificuldade sobe por variedade (mais elites, afixos, eventos, minichefes) e por um degrau
 * de capítulo; a vida cresce devagar dentro de cada capítulo para não virar "esponja de dano".
 */
import type { EnemyType } from './enemies.js';
import type { WaveEventKind } from './objectives.js';

export interface WaveDef {
  /** Orçamento base (pontos de inimigos) para 1 jogador. */
  budget: number;
  weights: Partial<Record<EnemyType, number>>;
  /** Elites garantidos (não consomem orçamento extra). */
  guaranteed?: Partial<Record<EnemyType, number>>;
  boss?: EnemyType;
  /** Minichefe (surge no meio da onda, com barra no topo). */
  miniboss?: EnemyType;
  /** Evento de onda fixo. */
  event?: WaveEventKind;
  /** Onda de respiro (menos pressão, sem desafio). */
  breather?: boolean;
  maxAlive: number;
  groupMin: number;
  groupMax: number;
  /** Intervalo entre grupos (s). */
  interval: number;
  title: string;
}

export const WAVES: readonly WaveDef[] = [
  // ---------------- Capítulo I — A Vila Amaldiçoada
  { title: 'Os Primeiros Mortos', budget: 16, weights: { shambler: 5, runner: 1 }, maxAlive: 18, groupMin: 3, groupMax: 5, interval: 3.2 },
  { title: 'Passos Apressados', budget: 24, weights: { shambler: 3, runner: 3 }, maxAlive: 22, groupMin: 3, groupMax: 6, interval: 3.0 },
  { title: 'Brasas em Perigo', budget: 28, weights: { shambler: 4, runner: 2, acolyte: 1 }, event: 'bonfire', maxAlive: 24, groupMin: 4, groupMax: 6, interval: 3.0 },
  { title: 'Cânticos na Névoa', budget: 34, weights: { shambler: 4, runner: 2, acolyte: 2 }, guaranteed: { werewolf: 1 }, maxAlive: 26, groupMin: 4, groupMax: 6, interval: 3.0 },
  { title: 'O Uivo do Alfa', budget: 26, weights: { shambler: 3, runner: 3 }, miniboss: 'alphaWolf', maxAlive: 24, groupMin: 3, groupMax: 5, interval: 3.4 },
  { title: 'Chinelos ao Luar', budget: 40, weights: { shambler: 4, runner: 2, acolyte: 2 }, guaranteed: { father: 1 }, maxAlive: 28, groupMin: 4, groupMax: 7, interval: 2.8 },
  { title: 'Um Vivo na Estrada', budget: 36, weights: { shambler: 4, runner: 3, acolyte: 1 }, event: 'escort', maxAlive: 26, groupMin: 4, groupMax: 6, interval: 3.0 },
  { title: 'A Procissão', budget: 50, weights: { shambler: 3, runner: 3, acolyte: 3, werewolf: 1 }, guaranteed: { father: 1 }, maxAlive: 32, groupMin: 5, groupMax: 8, interval: 2.6 },
  { title: 'A Última Hora', budget: 56, weights: { shambler: 4, runner: 3, acolyte: 3, werewolf: 2, father: 1 }, guaranteed: { werewolf: 1 }, maxAlive: 34, groupMin: 5, groupMax: 8, interval: 2.4 },
  { title: 'Devorador da Lua', budget: 14, weights: { runner: 2, shambler: 3 }, boss: 'moonDevourer', maxAlive: 14, groupMin: 2, groupMax: 4, interval: 7 },
  // ---------------- Capítulo II — O Cemitério Congelado
  { title: 'Passos na Neve', budget: 26, weights: { shambler: 4, runner: 2 }, breather: true, maxAlive: 22, groupMin: 3, groupMax: 6, interval: 3.2 },
  { title: 'Velas Negras', budget: 34, weights: { shambler: 3, runner: 2, acolyte: 3 }, event: 'ritual', maxAlive: 26, groupMin: 4, groupMax: 6, interval: 3.0 },
  { title: 'Matilha Branca', budget: 40, weights: { shambler: 3, runner: 4, werewolf: 1 }, guaranteed: { werewolf: 2 }, maxAlive: 28, groupMin: 4, groupMax: 7, interval: 2.8 },
  { title: 'O Cortejo Gelado', budget: 42, weights: { shambler: 4, runner: 2, acolyte: 2 }, event: 'cart', maxAlive: 28, groupMin: 4, groupMax: 7, interval: 2.8 },
  { title: 'O Acólito Supremo', budget: 32, weights: { shambler: 3, acolyte: 2, runner: 2 }, miniboss: 'highAcolyte', maxAlive: 26, groupMin: 3, groupMax: 6, interval: 3.2 },
  { title: 'Lápides que Respiram', budget: 50, weights: { shambler: 4, runner: 3, acolyte: 2, father: 1 }, guaranteed: { father: 1 }, maxAlive: 32, groupMin: 5, groupMax: 8, interval: 2.6 },
  { title: 'Entre Sebes Mortas', budget: 54, weights: { shambler: 3, runner: 4, acolyte: 2, werewolf: 2 }, maxAlive: 34, groupMin: 5, groupMax: 8, interval: 2.5 },
  { title: 'A Guia na Nevasca', budget: 46, weights: { shambler: 4, runner: 3, acolyte: 2 }, event: 'escort', maxAlive: 30, groupMin: 4, groupMax: 7, interval: 2.8 },
  { title: 'O Frio que Anda', budget: 62, weights: { shambler: 4, runner: 3, acolyte: 3, werewolf: 2, father: 1 }, guaranteed: { werewolf: 1, father: 1 }, maxAlive: 36, groupMin: 5, groupMax: 9, interval: 2.3 },
  { title: 'Noiva do Inverno', budget: 16, weights: { shambler: 3, runner: 2 }, boss: 'frostBride', maxAlive: 16, groupMin: 2, groupMax: 4, interval: 7 },
  // ---------------- Capítulo III — A Mansão no Deserto de Cinzas
  { title: 'Areia nos Dentes', budget: 30, weights: { shambler: 3, runner: 3 }, breather: true, maxAlive: 24, groupMin: 3, groupMax: 6, interval: 3.0 },
  { title: 'Rodas no Deserto', budget: 44, weights: { shambler: 3, runner: 3, acolyte: 2 }, event: 'cart', maxAlive: 30, groupMin: 4, groupMax: 7, interval: 2.8 },
  { title: 'Salões Vazios', budget: 52, weights: { shambler: 3, runner: 3, acolyte: 3, werewolf: 1 }, guaranteed: { werewolf: 1 }, maxAlive: 32, groupMin: 5, groupMax: 8, interval: 2.6 },
  { title: 'A Fogueira no Deserto', budget: 48, weights: { shambler: 4, runner: 3, acolyte: 2, father: 1 }, event: 'bonfire', maxAlive: 32, groupMin: 5, groupMax: 8, interval: 2.6 },
  { title: 'O Pai Ancestral', budget: 38, weights: { shambler: 3, runner: 3, acolyte: 2 }, miniboss: 'elderFather', maxAlive: 28, groupMin: 4, groupMax: 7, interval: 3.0 },
  { title: 'Retratos que Observam', budget: 60, weights: { shambler: 3, runner: 3, acolyte: 3, werewolf: 2, father: 1 }, guaranteed: { father: 1 }, maxAlive: 36, groupMin: 5, groupMax: 9, interval: 2.4 },
  { title: 'O Último Cântico', budget: 56, weights: { shambler: 3, runner: 3, acolyte: 4, werewolf: 1 }, event: 'ritual', maxAlive: 34, groupMin: 5, groupMax: 8, interval: 2.5 },
  { title: 'Os Sem Descanso', budget: 66, weights: { shambler: 4, runner: 4, acolyte: 3, werewolf: 2, father: 2 }, guaranteed: { werewolf: 1, father: 1 }, maxAlive: 38, groupMin: 6, groupMax: 9, interval: 2.2 },
  { title: 'A Beira do Abismo', budget: 70, weights: { shambler: 4, runner: 3, acolyte: 3, werewolf: 3, father: 2 }, guaranteed: { werewolf: 2, father: 1 }, maxAlive: 40, groupMin: 6, groupMax: 10, interval: 2.1 },
  { title: 'Patriarca do Abismo', budget: 12, weights: { shambler: 3, acolyte: 1 }, boss: 'patriarch', maxAlive: 12, groupMin: 2, groupMax: 4, interval: 8 },
];

export const SCALING = {
  /** Orçamento × (1 + budgetPerPlayer × (n-1)). */
  budgetPerPlayer: 0.7,
  hpPerPlayer: 0.3,
  bossHpPerPlayer: 0.85,
  /** Crescimento de vida e dano DENTRO de cada capítulo (por onda). */
  hpPerWave: 0.05,
  damagePerWave: 0.035,
  /** Degrau de cada capítulo (1, 2, 3): multiplica vida e dano base. */
  chapterHp: [1, 1.3, 1.6] as const,
  chapterDamage: [1, 1.2, 1.4] as const,
  maxAlivePerPlayer: 10,
  /** Limite absoluto de inimigos simultâneos. */
  hardCap: 110,
  spawnWarnSeconds: 1.2,
  spawnSafeDistance: 220,
  /** Onda de respiro: orçamento extra reduzido e intervalos maiores (já refletido na tabela). */
} as const;

export const TOTAL_WAVES = WAVES.length;

export function scaledBudget(wave: number, players: number, mul = 1): number {
  const w = WAVES[wave - 1];
  if (!w) return 0;
  return w.budget * (1 + SCALING.budgetPerPlayer * (players - 1)) * mul;
}

/** Índice da onda dentro do capítulo (0–9). */
export const waveInChapter = (wave: number): number => (wave - 1) % 10;
