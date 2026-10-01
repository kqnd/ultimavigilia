/**
 * IA dos inimigos (v1.6): tabela de ameaça, pesos de escolha de alvo por papel, arquétipos de
 * movimento e parâmetros de utilidade dos chefes. Tudo em ticks/px/segundos como o resto da config.
 *
 * Princípio de justiça: a IA fica mais esperta (escolhe melhor alvo, cerca, flanqueia, varia
 * ataques), mas NUNCA mais rápida de reagir: antecipações (windup), recuperações, alcance e dano
 * dos ataques continuam nas tabelas de ATK; o que muda aqui é a decisão e o posicionamento.
 */
import type { EnemyType } from './enemies.js';

/** Papel tático: define pesos de alvo e como o inimigo se movimenta. */
export type AIRole = 'brute' | 'swarm' | 'skirmisher' | 'shooter' | 'boss';

/** Modos de locomoção escolhidos por utilidade (com histerese). */
export type AIMode = 'approach' | 'flank' | 'kite' | 'retreat' | 'regroup';

export interface Archetype {
  role: AIRole;
  /** 0..1: apetite por flanquear/cercar em vez de ir em linha reta. */
  flank: number;
  /** Faixa de distância preferida de quem mantém distância (px); omitido = corpo a corpo. */
  keep?: readonly [number, number];
  /** 0..1: peso de se manter à distância (kite). */
  kite: number;
  /** Fração de vida abaixo da qual recua uma vez (0 = nunca recua). */
  retreatHp: number;
  /** 0..1: peso de reagrupar quando isolado do bando. */
  regroup: number;
  /** 0..1: quanto evita zonas perigosas colocadas pelos jogadores. */
  danger: number;
}

/** Arquétipos por tipo-base (minichefes usam o do inimigo de origem). */
export const ARCHETYPES: Partial<Record<EnemyType, Archetype>> = {
  shambler: { role: 'swarm', flank: 0.55, kite: 0, retreatHp: 0, regroup: 0.2, danger: 0.35 },
  runner: { role: 'skirmisher', flank: 1, kite: 0, retreatHp: 0, regroup: 0, danger: 0.7 },
  werewolf: { role: 'brute', flank: 0.7, kite: 0, retreatHp: 0, regroup: 0, danger: 0.35 },
  father: { role: 'brute', flank: 0.15, kite: 0, retreatHp: 0, regroup: 0, danger: 0.25 },
  acolyte: { role: 'shooter', flank: 0.2, keep: [130, 220], kite: 0.9, retreatHp: 0.3, regroup: 0.5, danger: 1 },
  shadowAcolyte: { role: 'shooter', flank: 0, keep: [150, 250], kite: 1, retreatHp: 0.4, regroup: 0.6, danger: 1 },
  mistStalker: { role: 'skirmisher', flank: 1, kite: 0, retreatHp: 0.25, regroup: 0, danger: 0.9 },
  ossuaryBearer: { role: 'brute', flank: 0, kite: 0, retreatHp: 0, regroup: 0, danger: 0.15 },
  moonDevourer: { role: 'boss', flank: 0, kite: 0, retreatHp: 0, regroup: 0, danger: 0 },
  patriarch: { role: 'boss', flank: 0, kite: 0, retreatHp: 0, regroup: 0, danger: 0 },
  frostBride: { role: 'boss', flank: 0, keep: [100, 190], kite: 0.8, retreatHp: 0, regroup: 0, danger: 0 },
};
export const DEFAULT_ARCHETYPE: Archetype = { role: 'brute', flank: 0.3, kite: 0, retreatHp: 0, regroup: 0, danger: 0.3 };

/**
 * Tabela de ameaça. Por inimigo: jogador -> pontos (dano válido em HP, cura aliada e provocação).
 * A leitura normaliza pela vida máxima do inimigo (`cap` = fração da vida que satura a ameaça).
 */
export const THREAT = {
  /** Constante de decaimento exponencial (s) por categoria: quem para de bater perde a atenção. */
  window: { common: 5, elite: 6, miniboss: 8, boss: 8 },
  /** Fração da vida máxima que equivale a ameaça 1.0 (saturação). */
  cap: { common: 1.5, elite: 0.8, miniboss: 0.2, boss: 0.15 },
  /** Dano causado de longe (além de `farRange`) vale mais: quem fustiga de fora não é ignorado. */
  farRange: 170, farMul: 1.3,
  /** Cura aliada: pontos de ameaça por HP curado, em inimigos a até `healRadius` do curado. */
  healMul: 0.6, healRadius: 360,
  /** Provocação: a ameaça do provocador sobe ao topo da tabela (+ este bônus em ameaça normalizada). */
  tauntBonus: 0.5,
  /** Ameaça inicial do jogador mais próximo ao surgir (estabiliza o primeiro alvo). */
  spawnSeed: 0.15,
  /** Ameaça normalizada abaixo disto some da tabela. */
  prune: 0.01,
} as const;

/** Escolha de alvo: pesos por papel dos fatores (todos normalizados 0..1) e histerese. */
export const TARGETING = {
  /** Escala de distância (px) da curva exp(-d/scale): perto = 1, longe = ~0. */
  distScale: 320,
  /** Pesos por papel: distância, ameaça, afinidade de papel, prioridade (curando/rezando/ferido). */
  weights: {
    brute: { dist: 1.0, threat: 0.8, role: 0.7, priority: 0.45 },
    swarm: { dist: 1.1, threat: 0.35, role: 0.45, priority: 0.3 },
    skirmisher: { dist: 0.65, threat: 0.3, role: 1.0, priority: 0.8 },
    shooter: { dist: 0.55, threat: 0.5, role: 1.0, priority: 0.95 },
    boss: { dist: 0.5, threat: 1.3, role: 0.55, priority: 0.5 },
  } as const,
  /** Bônus ao alvo atual (histerese). */
  sticky: { common: 0.3, boss: 0.4 },
  /** Margem extra que o candidato precisa vencer para derrubar o alvo atual. */
  margin: { common: 0.1, boss: 0.18 },
  /** Reavaliação: intervalo (ticks) e tempo mínimo de permanência no alvo (s). */
  evalTicks: { common: 14, boss: 15 },
  minHold: { common: 1.2, boss: 3 },
  /** Troca antecipada (ignora o tempo mínimo) se a ameaça normalizada do candidato superar a do atual por isto. */
  threatBreak: 0.55,
  /** Trava de provocação após o efeito acabar (s). */
  tauntHold: { common: 1.0, boss: 6 },
  /** Jogadores curando (recentHeal) ou rezando (revivendo) entram na prioridade dentro deste raio. */
  priorityReach: 260,
  /** Cura recente (HP) que satura o fator de prioridade. */
  healSat: 18,
} as const;

/** Locomoção e bando. */
export const STEER = {
  /** Distância de sondagem para desviar de paredes (px além do raio). */
  probe: 14,
  /** Ângulos tentados (rad) ao contornar obstáculo, em ordem. */
  probeAngles: [0.6, 1.2, 1.9] as readonly number[],
  /** Separação entre aliados: alcance em múltiplos do raio e peso. */
  sepRange: 2.8, sepWeight: 0.8,
  /** Coesão leve: só quando isolado do bando e longe do alvo. */
  cohRange: 260, cohMinAllies: 1, cohWeight: 0.35, cohFarTarget: 300, cohIsolated: 150,
  /** Cerco: ângulo máximo (rad) do desvio lateral e janela de distância em que age. */
  surroundAngle: 1.05, surroundNear: 46, surroundFar: 230,
  /** Zonas perigosas dos jogadores: margem (px) e peso base. */
  dangerPad: 14, dangerWeight: 1.4,
  kiteZoneKinds: ['trap', 'glacial', 'rupture', 'rain', 'graveHand', 'choke', 'brew'] as readonly string[],
  /** Travamento: janela de amostragem (ticks), deslocamento mínimo esperado e duração do desvio (ticks). */
  stuckWindow: 15, stuckMinFrac: 0.3, unstickTicks: 22,
  /** Modo: permanência mínima (ticks) antes de reavaliar. */
  modeHold: 18,
  /** Histerese (bônus ao modo atual). */
  modeSticky: 0.15,
  /** Recuo de ferido: duração (s). */
  retreatSeconds: 2.4,
} as const;

/**
 * Justiça: limites que impedem a IA melhor de virar injusta.
 * - `maxAttackers`: no máximo N inimigos comuns/elite corpo a corpo preparando golpe no mesmo jogador.
 * - `thinkTicks`: respiro entre ataques de chefe/minichefe (janela para reagir e castigar).
 */
export const FAIR = {
  maxAttackers: 5,
  /** Respiro após qualquer ataque de chefe/minichefe: [mín, máx] em ticks por fase. */
  thinkTicks: { 1: [14, 26], 2: [9, 18] } as Record<number, readonly [number, number]>,
  /** Multiplicador do respiro na reta final (fúria do chefe). */
  desperationThinkMul: 0.65,
  /** Fração de vida em que o chefe entra em "desespero" (ritmo maior, alvo = mais ameaça). */
  desperationHp: 0.25,
  /** Bônus de recarga por tick extra em desespero (1 a cada N ticks). */
  desperationCdEvery: 5,
  /** Antecipação da mira de projéteis comuns: nunca passa disto (px) — mira justa. */
  maxLead: 60,
} as const;

/** Utilidade de ataques de chefe/minichefe. */
export const UTILITY = {
  /** Fator aplicado ao ataque repetido em sequência (índice 0 = último ataque, 1 = penúltimo...). */
  recency: [0.5, 0.78, 0.92] as readonly number[],
  /** Ruído determinístico (rng da partida) somado à nota para desempatar. */
  jitter: 0.06,
  /** Nota mínima para atacar; abaixo disso o chefe só se posiciona. */
  min: 0.28,
  /** Histórico de ataques lembrados. */
  history: 3,
  /** Reação ao kite: dano de fora de `THREAT.farRange` mantém `heat` por este tempo (s). */
  heatSeconds: 4,
} as const;

/**
 * Escala por progressão (onda). 0 na onda 1, 1 na onda 30. Só afeta a QUALIDADE das decisões
 * (apetite de flanco, coordenação, reação ao kite) e nunca tempos de reação, alcance ou dano.
 */
export const aiSkill = (wave: number): number => Math.max(0, Math.min(1, (wave - 1) / 29));
