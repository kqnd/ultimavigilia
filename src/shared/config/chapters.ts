/**
 * Campanha em três capítulos (10 ondas cada), cada um com mapa, clima e adaptações próprias
 * dos inimigos. Também define a escolha de rota entre capítulos.
 */

export type Climate = 'night' | 'winter' | 'ash';
export type MapId = 'village' | 'frozen' | 'abyss';
export const MAP_IDS: readonly MapId[] = ['village', 'frozen', 'abyss'];

export interface ChapterDef {
  n: 1 | 2 | 3;
  map: MapId;
  climate: Climate;
  name: string;
  subtitle: string;
  firstWave: number;
  lastWave: number;
  /** Como a horda se adapta ao clima. */
  enemies: {
    label: string;
    hpMul: number;
    speedMul: number;
    /** Efeito aplicado ao jogador quando atingido por inimigos deste capítulo. */
    onHit: 'none' | 'chill' | 'burn';
    /** Inimigos adaptados ignoram o chão lento do capítulo (neve funda / areia movediça). */
    ignoreSlowFloor: boolean;
  };
  /** Tempestade periódica (nevasca / tempestade de cinzas): visual + inimigos mais rápidos. */
  storm: { every: number; duration: number; enemySpeedMul: number; name: string } | null;
}

export const CHAPTERS: readonly ChapterDef[] = [
  {
    n: 1,
    map: 'village',
    climate: 'night',
    name: 'A Vila Amaldiçoada',
    subtitle: 'Uma noite que não termina.',
    firstWave: 1,
    lastWave: 10,
    enemies: { label: '', hpMul: 1, speedMul: 1, onHit: 'none', ignoreSlowFloor: false },
    storm: null,
  },
  {
    n: 2,
    map: 'frozen',
    climate: 'winter',
    name: 'O Cemitério Congelado',
    subtitle: 'Um labirinto de sepulturas sob a nevasca.',
    firstWave: 11,
    lastWave: 20,
    enemies: { label: 'Congelados', hpMul: 1.15, speedMul: 0.92, onHit: 'chill', ignoreSlowFloor: true },
    storm: { every: 50, duration: 9, enemySpeedMul: 1.15, name: 'NEVASCA' },
  },
  {
    n: 3,
    map: 'abyss',
    climate: 'ash',
    name: 'A Mansão no Deserto de Cinzas',
    subtitle: 'Onde a areia queima e o abismo respira.',
    firstWave: 21,
    lastWave: 30,
    enemies: { label: 'Ressecados', hpMul: 0.92, speedMul: 1.12, onHit: 'burn', ignoreSlowFloor: true },
    storm: { every: 45, duration: 8, enemySpeedMul: 1.15, name: 'TEMPESTADE DE CINZAS' },
  },
];

export const chapterOfWave = (wave: number): ChapterDef => CHAPTERS.find((c) => wave >= c.firstWave && wave <= c.lastWave) ?? (CHAPTERS[0] as ChapterDef);

/** Efeitos de clima sobre jogadores. */
export const CLIMATE_EFFECTS = {
  chill: { duration: 1.6, speedMul: 0.78 },
  burn: { duration: 3, damagePerSecond: 3 },
  /** Multiplicador de velocidade em chão lento (neve funda / areia movediça). */
  slowFloorMul: 0.8,
} as const;

// ---------------------------------------------------------------- rota entre capítulos

export type Route = 'risk' | 'safe';

export const ROUTE = {
  /** Duração da votação (s). */
  voteSeconds: 20,
  /** Empate (ou ninguém votou) = rota segura. */
  tieBreak: 'safe' as Route,
  risk: {
    name: 'Portal de Risco',
    desc: '+30% de inimigos, +15% de chance de afixo e +1 elite garantido por onda. Recompensa: 4 cartas por intervalo e desafios valem o dobro neste capítulo.',
    budgetMul: 1.3,
    affixBonus: 0.15,
    extraElites: 1,
    offerBonus: 1,
  },
  safe: {
    name: 'Rota Segura',
    desc: 'Cura total, todos de pé e +30% de suprema agora. Inimigos com -10% de vida neste capítulo; 3 cartas por intervalo.',
    hpMul: 0.9,
    ultGain: 30,
  },
} as const;

/** Cinemática de viagem entre capítulos (s). O servidor espera este tempo antes da próxima onda. */
export const TRAVEL_SECONDS = 9;
