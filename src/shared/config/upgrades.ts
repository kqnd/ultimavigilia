/**
 * Melhorias escolhidas entre ondas. Valores exatos exibidos ao jogador.
 *
 * v1.3: quatro raridades. Comuns são pequenas e confiáveis (4–8%), incomuns são perceptíveis ou
 * condicionais, raras mudam a build e lendárias transformam o estilo com custo real. Pequenos
 * bônus SOMAM (nunca multiplicam entre si) e cada família tem um teto global (UPGRADE_CAPS).
 */
import type { ClassId } from './classes.js';

export type Rarity = 'common' | 'uncommon' | 'rare' | 'legendary';
export const RARITIES: readonly Rarity[] = ['common', 'uncommon', 'rare', 'legendary'];
/** Tipo de carta mostrado na interface. */
export type UpgradeKind = 'numeric' | 'conditional' | 'fork' | 'transform';

export const RARITY_INFO: Record<Rarity, { name: string; weight: number }> = {
  common: { name: 'COMUM', weight: 60 },
  uncommon: { name: 'INCOMUM', weight: 27 },
  rare: { name: 'RARA', weight: 11 },
  legendary: { name: 'LENDÁRIA', weight: 2 },
};
export const KIND_INFO: Record<UpgradeKind, string> = {
  numeric: 'Melhoria numérica',
  conditional: 'Condicional',
  fork: 'Bifurcação',
  transform: 'Transformação',
};
/** No máximo uma lendária por build. */
export const LEGENDARY_MAX_PER_BUILD = 1;

/** Tetos globais das famílias de bônus de cartas (soma de todas as cartas da família). */
export const UPGRADE_CAPS = {
  cooldown: 0.25,
  moveSpeed: 0.15,
  attackSpeed: 0.12,
  damage: 0.3,
  damageReduction: 0.16,
  healBonus: 0.2,
  projectileRange: 0.15,
  area: 0.3,
} as const;
export type CapKey = keyof typeof UPGRADE_CAPS;
export const CAP_TEXT: Record<CapKey, string> = {
  cooldown: 'recarga',
  moveSpeed: 'velocidade',
  attackSpeed: 'velocidade de ataque',
  damage: 'dano de cartas',
  damageReduction: 'redução de dano',
  healBonus: 'bônus de cura',
  projectileRange: 'alcance',
  area: 'área',
};

export interface UpgradeDef {
  id: string;
  name: string;
  /** Texto com o efeito e o valor exatos por acúmulo. */
  desc: string;
  cls: ClassId | null;
  maxStacks: number;
  /** Valor numérico por acúmulo (interpretação depende do id). */
  value: number;
  icon: string;
  rarity: Rarity;
  kind: UpgradeKind;
  /**
   * Bifurcação de estilo: melhorias do mesmo grupo são mutuamente exclusivas. Depois de escolher
   * uma, as outras do grupo deixam de ser oferecidas e o servidor recusa qualquer tentativa.
   */
  fork?: string;
  /** Família de efeito parecido: a mesma oferta não traz duas cartas da mesma família. */
  group?: string;
  /** Teto global que limita esta carta (mostrado na carta). */
  cap?: CapKey;
  /** Só aparece para estas classes (ex.: alcance de projéteis). */
  onlyFor?: readonly ClassId[];
  /** Comparação simples na carta: rótulo, unidade e sinal (valor × acúmulos). */
  show?: { label: string; unit: '%' | 's' | 'px' | '' | ' de vida' | ' de stamina'; sign: '+' | '-'; pct?: boolean };
}

type Extra = Partial<Pick<UpgradeDef, 'fork' | 'group' | 'cap' | 'onlyFor' | 'show'>>;
const U = (id: string, name: string, cls: ClassId | null, rarity: Rarity, kind: UpgradeKind, maxStacks: number, value: number, icon: string, desc: string, extra: Extra = {}): UpgradeDef => ({
  id, name, desc, cls, rarity, kind, maxStacks, value, icon, ...extra,
});
const pct = (label: string, sign: '+' | '-' = '+'): UpgradeDef['show'] => ({ label, unit: '%', sign, pct: true });

/** Nome legível de cada bifurcação (interface). */
export const FORKS: Record<string, { name: string }> = {
  guardian_path: { name: 'Caminho do Guardião' },
  hunter_path: { name: 'Caminho do Caçador' },
  vampire_path: { name: 'Caminho do Sangue' },
  berserker_path: { name: 'Caminho da Fúria' },
  necro_path: { name: 'Caminho dos Mortos' },
  lapanha_path: { name: 'Caminho da Feira' },
};

const SHOOTERS: readonly ClassId[] = ['hunter', 'mage', 'necromancer', 'lapanha'];

export const UPGRADES: readonly UpgradeDef[] = [
  // ================================================================ GERAIS — comuns
  U('g_hide', 'Casca Grossa', null, 'common', 'numeric', 3, 6, 'shield', '+6 de vida máxima (e cura o mesmo valor).', { group: 'hp', show: { label: 'Vida máxima', unit: ' de vida', sign: '+' } }),
  U('g_lung', 'Pulmão Treinado', null, 'common', 'numeric', 3, 8, 'lung', '+8 de stamina máxima.', { group: 'stamina', show: { label: 'Stamina máxima', unit: ' de stamina', sign: '+' } }),
  U('g_rhythm', 'Ritmo Controlado', null, 'common', 'numeric', 3, 0.05, 'wind', '+5% de regeneração de stamina.', { group: 'stamina', show: pct('Regeneração de stamina') }),
  U('g_step', 'Passo Firme', null, 'common', 'numeric', 2, 0.05, 'boot', '+5% de velocidade de movimento fora de ações.', { group: 'speed', cap: 'moveSpeed', show: pct('Velocidade fora de ações') }),
  U('g_agility', 'Passos Leves', null, 'common', 'numeric', 2, 0.07, 'boot', '+7% de velocidade de movimento.', { group: 'speed', cap: 'moveSpeed', show: pct('Velocidade') }),
  U('g_poise', 'Golpe Estável', null, 'common', 'numeric', 3, 0.05, 'mace', '+5% de dano de equilíbrio (stagger) causado.', { show: pct('Dano de equilíbrio') }),
  U('g_reach', 'Mira Paciente', null, 'common', 'numeric', 2, 0.05, 'eye', '+5% de alcance dos projéteis e arremessos.', { cap: 'projectileRange', onlyFor: SHOOTERS, show: pct('Alcance') }),
  U('g_qcd', 'Recuperação Breve', null, 'common', 'numeric', 3, 0.04, 'hourglass', '-4% no tempo de recarga do Q.', { group: 'cooldown', cap: 'cooldown', show: pct('Recarga do Q', '-') }),
  U('g_ecd', 'Recuperação Alternada', null, 'common', 'numeric', 3, 0.04, 'hourglass', '-4% no tempo de recarga do E.', { group: 'cooldown', cap: 'cooldown', show: pct('Recarga do E', '-') }),
  U('g_pickup', 'Vigor de Sobrevivente', null, 'common', 'numeric', 2, 0.06, 'heart', 'Itens de vida curam +6%.', { cap: 'healBonus', show: pct('Cura de itens') }),
  U('g_dodge', 'Pé Leve', null, 'common', 'numeric', 2, 0.04, 'wind', 'Esquiva custa 4% menos stamina.', { show: pct('Custo da esquiva', '-') }),
  U('g_haste', 'Mãos Rápidas', null, 'common', 'numeric', 2, 0.04, 'sword', '+4% de velocidade do ataque básico.', { cap: 'attackSpeed', show: pct('Velocidade do básico') }),
  U('g_eye', 'Olho de Vigília', null, 'common', 'conditional', 1, 0.35, 'eye', 'Telegraphs perigosos ficam levemente mais visíveis (contorno mais forte).'),
  U('g_bond', 'Laço de Vigília', null, 'common', 'numeric', 2, 0.3, 'hands', 'Revive aliados 30% mais rápido.', { show: pct('Velocidade para reviver') }),
  // ================================================================ GERAIS — incomuns
  U('g_vigor', 'Vigor da Vigília', null, 'uncommon', 'numeric', 2, 18, 'heart', '+18 de vida máxima (e cura o mesmo valor).', { group: 'hp', show: { label: 'Vida máxima', unit: ' de vida', sign: '+' } }),
  U('g_breath', 'Fôlego de Ferro', null, 'uncommon', 'numeric', 2, 15, 'lung', '+15 de stamina máxima.', { group: 'stamina', show: { label: 'Stamina máxima', unit: ' de stamina', sign: '+' } }),
  U('g_recovery', 'Respiração Ritmada', null, 'uncommon', 'numeric', 2, 0.18, 'wind', '+18% de regeneração de stamina.', { group: 'stamina', show: pct('Regeneração de stamina') }),
  U('g_focus', 'Foco Sombrio', null, 'uncommon', 'numeric', 2, 0.09, 'hourglass', '-9% no tempo de recarga das habilidades Q e E.', { group: 'cooldown', cap: 'cooldown', show: pct('Recarga Q e E', '-') }),
  U('g_devotion', 'Devoção', null, 'uncommon', 'numeric', 2, 0.2, 'star', '+20% de carga da suprema.', { show: pct('Carga da suprema') }),
  U('g_skin', 'Couro Curtido', null, 'uncommon', 'numeric', 2, 0.06, 'shield', '-6% de dano recebido.', { cap: 'damageReduction', show: pct('Dano recebido', '-') }),
  U('g_first', 'Primeiro Sangue', null, 'uncommon', 'conditional', 1, 0.12, 'sword', 'O primeiro golpe contra um inimigo com vida cheia causa +12%.', { cap: 'damage' }),
  U('g_retreat', 'Retirada Tática', null, 'uncommon', 'conditional', 1, 0.1, 'boot', 'Depois de esquivar de um ataque de verdade: +10% de velocidade por 1,5s.', { cap: 'moveSpeed' }),
  U('g_second', 'Fôlego Renovado', null, 'uncommon', 'conditional', 1, 15, 'lung', 'Eliminar um elite recupera 15 de stamina.'),
  U('g_pressure', 'Pressão Constante', null, 'uncommon', 'conditional', 1, 12, 'mace', 'O terceiro acerto seguido no mesmo alvo causa +12 de dano de equilíbrio.'),
  U('g_guard', 'Defesa Improvisada', null, 'uncommon', 'conditional', 1, 15, 'shield', 'Ao cair abaixo de 25% da vida: escudo de 15 por 4s (recarga de 40s).'),
  U('g_support', 'Caçador de Suportes', null, 'uncommon', 'conditional', 1, 0.12, 'eye', '+12% de dano contra Acólitos (suportes e conjuradores).', { cap: 'damage' }),
  U('g_objective', 'Guardião do Objetivo', null, 'uncommon', 'conditional', 1, 0.08, 'tower', 'Dentro da área de uma missão (fogueira, altar, perto do sobrevivente): -8% de dano recebido.', { cap: 'damageReduction' }),
  U('g_breaker', 'Quebra-Formação', null, 'uncommon', 'conditional', 1, 0.25, 'axe', '+25% de dano contra escudos de ossos, caixas e barris.'),
  // ================================================================ GERAIS — raras
  U('g_fury', 'Lâmina Ungida', null, 'rare', 'numeric', 2, 0.1, 'sword', '+10% de dano causado.', { cap: 'damage', show: pct('Dano causado') }),
  // ================================================================ Caçador
  U('h_pierce', 'Virote Farpado', 'hunter', 'uncommon', 'numeric', 2, 1, 'bolt', 'Virotes básicos atravessam +1 inimigo; após cada alvo, o virote mantém 75% do dano.'),
  U('h_traps', 'Armadilheiro', 'hunter', 'common', 'numeric', 2, 1, 'trap', '+1 armadilha ativa simultânea e -1s de recarga da armadilha.'),
  U('h_rain', 'Chuva Densa', 'hunter', 'uncommon', 'numeric', 2, 2, 'rain', 'Chuva de Prata dispara +2 saraivadas.'),
  U('h_mark', 'Presa Profunda', 'hunter', 'common', 'numeric', 2, 0.015, 'eye', '+1,5% de dano de projéteis por marca em Presa Marcada.'),
  U('h_fan', 'Recuo em Leque', 'hunter', 'uncommon', 'conditional', 1, 2, 'fan', 'Recuo Preciso dispara +2 virotes laterais, cada um com 50% do dano.'),
  U('h_ricochet', 'Virote Ricocheteante', 'hunter', 'rare', 'fork', 1, 0.4, 'ricochet', 'BIFURCAÇÃO: cada virote básico ricocheteia 1 vez para outro inimigo a até 95px com 40% do dano.', { fork: 'hunter_path' }),
  U('h_blast', 'Armadilha Explosiva', 'hunter', 'rare', 'fork', 1, 34, 'blast', 'BIFURCAÇÃO: armadilhas explodem ao disparar: 34 de dano e empurrão em 48px (ainda prendem o alvo principal).', { fork: 'hunter_path' }),
  // ================================================================ Mago
  U('m_area', 'Selo Ampliado', 'mage', 'uncommon', 'numeric', 2, 0.15, 'snow', 'Selo Glacial com +15% de raio.', { cap: 'area' }),
  U('m_duration', 'Gelo Eterno', 'mage', 'common', 'numeric', 2, 1, 'ice', 'Selo Glacial dura +1s.'),
  U('m_converge', 'Convergência Plena', 'mage', 'uncommon', 'numeric', 2, 0.3, 'orb', 'Básico fortalecido causa +30% de dano.'),
  U('m_rupture', 'Ruptura Rápida', 'mage', 'rare', 'conditional', 1, 0.35, 'burst', 'Preparação da Ruptura Arcana 35% mais curta.'),
  U('m_blink', 'Passo Longo', 'mage', 'common', 'numeric', 1, 30, 'blink', 'Passo Etéreo alcança +30px.'),
  // ================================================================ Guardião
  U('t_guard', 'Guarda Temperada', 'tank', 'uncommon', 'numeric', 2, 0.2, 'shield', 'Bloqueios consomem 20% menos stamina.'),
  U('t_taunt', 'Eco da Investida', 'tank', 'common', 'numeric', 2, 12, 'horn', 'Investida de Escudo com +12px de raio de provocação.'),
  U('t_bastion', 'Almas Generosas', 'tank', 'rare', 'conditional', 1, 4, 'tower', 'Última Vigília cura aliados em 4 de vida por segundo.'),
  U('t_mace', 'Maça Pesada', 'tank', 'common', 'numeric', 2, 0.15, 'mace', 'Golpe de Maça: +15% de dano e de stagger.'),
  U('t_protector', 'Juramento do Protetor', 'tank', 'rare', 'fork', 1, 0.06, 'shield', 'BIFURCAÇÃO: Última Vigília protege aliados e sobrevivente em mais 6%; Investida provoca por +1s.', { fork: 'guardian_path' }),
  U('t_vanguard', 'Juramento da Vanguarda', 'tank', 'rare', 'fork', 1, 0.25, 'mace', 'BIFURCAÇÃO: contra-ataque perfeito e Investida causam +25% de dano.', { fork: 'guardian_path' }),
  // ================================================================ Vampiro (v1.3: bônus somados, sem multiplicar cura)
  U('v_fangs', 'Presas Afiadas', 'vampire', 'common', 'numeric', 2, 6, 'fang', 'Mordida: +6 de dano e +3 no teto de cura por uso.'),
  U('v_thirst', 'Sede Insaciável', 'vampire', 'uncommon', 'numeric', 1, 2, 'drop', '+2 acúmulos máximos de Sede (o bônus de dano acima de +25% não aumenta a cura).'),
  U('v_feast', 'Banquete Longo', 'vampire', 'uncommon', 'numeric', 2, 1.5, 'goblet', 'Banquete dura +1,5s.'),
  U('v_vortex', 'Redemoinho Faminto', 'vampire', 'common', 'numeric', 2, 0.15, 'mist', 'Redemoinho Rubro: +15% de raio e -0,5s de recarga.', { cap: 'area' }),
  U('v_swarm', 'Mordida da Revoada', 'vampire', 'rare', 'fork', 1, 0.35, 'swarm', 'BIFURCAÇÃO: Mordida com +40° de arco e +35% de alcance (mais alvos; alvos extras curam cada vez menos).', { fork: 'vampire_path' }),
  U('v_noble', 'Presa Nobre', 'vampire', 'rare', 'fork', 1, 0.5, 'crown', 'BIFURCAÇÃO: contra elites e chefes a Mordida causa +40% de dano, cura +50% e o teto por uso sobe +4.', { fork: 'vampire_path' }),
  // ================================================================ Berserker
  U('b_blood', 'Sangue Fervente', 'berserker', 'common', 'numeric', 2, 0.25, 'drop', '+25% de Fúria gerada ao causar e receber dano.'),
  U('b_cleave', 'Machado Largo', 'berserker', 'uncommon', 'numeric', 2, 0.12, 'axe', 'Combo e Rasgo Frenético com +12% de alcance.'),
  U('b_quake', 'Salto Sísmico', 'berserker', 'uncommon', 'numeric', 2, 0.15, 'quake', 'Salto Brutal: +15% de raio no pouso e -0,5s de recarga.'),
  U('b_rage', 'Fúria Ofensiva', 'berserker', 'rare', 'fork', 1, 0.2, 'fury', 'BIFURCAÇÃO: com Fúria acima de 60, +20% de dano adicional.', { fork: 'berserker_path' }),
  U('b_iron', 'Mente de Ferro', 'berserker', 'rare', 'fork', 1, 1.5, 'helm', 'BIFURCAÇÃO: durante a Loucura recebe +10% de dano (em vez de +20%) e a exaustão dura 1,5s.', { fork: 'berserker_path' }),
  // ================================================================ Dog
  U('d_pulse', 'Pulso Extra', 'dog', 'rare', 'numeric', 1, 1, 'rings', 'GRITO DO FIM ganha +1 pulso.'),
  U('d_throat', 'Garganta de Ferro', 'dog', 'common', 'numeric', 2, 0.12, 'mouth', 'Grito com +12% de alcance.', { cap: 'area' }),
  U('d_magnet', 'Ímã Forte', 'dog', 'uncommon', 'numeric', 2, 0.3, 'magnet', 'Polaridade puxa 30% mais forte e com +15px de raio.'),
  U('d_resonance', 'Ressonância Rápida', 'dog', 'uncommon', 'numeric', 2, 3, 'wave', 'Ressonância precisa de 3 acertos a menos.'),
  // ================================================================ Necromante
  U('n_bones', 'Ossos Afiados', 'necromancer', 'uncommon', 'numeric', 2, 1, 'bone', 'Rajada Óssea atravessa +1 inimigo, causa +2 de dano e mantém 75% do dano após cada alvo.'),
  U('n_ritual', 'Ritualista', 'necromancer', 'rare', 'conditional', 1, 0.2, 'hand', 'Com 3+ de Essência, a Mão da Sepultura gasta 1 para amaldiçoar: +25% de raio e inimigos dentro causam -20% de dano.'),
  U('n_lord', 'Senhor dos Mortos', 'necromancer', 'rare', 'fork', 2, 0.25, 'skull', 'BIFURCAÇÃO: servos com +25% de vida e +2s de duração.', { fork: 'necro_path' }),
  U('n_reaper', 'Ceifador de Almas', 'necromancer', 'rare', 'fork', 1, 30, 'scythe', 'BIFURCAÇÃO: servos que morrem, expiram ou são sacrificados explodem (30 de dano, ×2 contra elites) e curam você em 5.', { fork: 'necro_path' }),
  // ================================================================ Lapanha
  U('l_seed', 'Semente Graúda', 'lapanha', 'common', 'numeric', 3, 0.06, 'melon', '+6% de dano no centro dos arremessos básicos (a borda não muda).', { show: pct('Dano central do básico') }),
  U('l_arm', 'Braço de Feira', 'lapanha', 'common', 'numeric', 2, 0.07, 'bigMelon', '+7% de alcance dos arremessos (a trajetória continua alinhada à colisão).', { cap: 'projectileRange', show: pct('Alcance dos arremessos') }),
  U('l_pulp', 'Polpa Farta', 'lapanha', 'common', 'numeric', 3, 0.08, 'pulp', '+8% de Polpa por acerto no centro (respeita o teto por ação).', { show: pct('Polpa por acerto central') }),
  U('l_peel', 'Casca Resistente', 'lapanha', 'common', 'numeric', 2, 1, 'peel', 'Casca Traiçoeira fica +1s no chão.', { show: { label: 'Duração da casca', unit: 's', sign: '+' } }),
  U('l_frozen', 'Melancia Gelada', 'lapanha', 'uncommon', 'conditional', 1, 0.2, 'ice', 'Inimigos atingidos pelo centro ficam 20% mais lentos por 1s (não acumula).'),
  U('l_seeds', 'Sementes Saltitantes', 'lapanha', 'uncommon', 'fork', 1, 3, 'seeds', 'BIFURCAÇÃO: cada explosão solta 3 sementes de 4 de dano (no máximo uma por inimigo; não geram Polpa).', { fork: 'lapanha_path' }),
  U('l_econ', 'Economia de Polpa', 'lapanha', 'uncommon', 'conditional', 1, 0.15, 'heartMelon', 'Melancia Madura custa 15% menos vida, mas o bônus máximo de dano cai 8%.'),
  U('l_wet', 'Piso Molhado', 'lapanha', 'uncommon', 'conditional', 1, 0.3, 'peel', 'Quem escorrega deixa uma poça de 22px que deixa inimigos 30% mais lentos por 2,5s (máx. 3 poças).'),
  U('l_heart', 'Coração da Melancia', 'lapanha', 'rare', 'conditional', 1, 12, 'heartMelon', 'Melancia Madura que acerta 4+ inimigos dá escudo de 12 por 4s (recarga interna de 10s; não cresce com mais alvos).'),
  U('l_precise', 'Colheita Precisa', 'lapanha', 'rare', 'fork', 1, 0.2, 'bigMelon', 'BIFURCAÇÃO: Melancia Madura com carga máxima causa +20% no centro e -20% na borda.', { fork: 'lapanha_path' }),
  U('l_cascade', 'Cascata de Cascas', 'lapanha', 'rare', 'conditional', 1, 1, 'peel', 'Esmagar a casca cria uma segunda casca menor (3s, não pode ser esmagada).'),
  U('l_last', 'Último Pedaço', 'lapanha', 'rare', 'conditional', 1, 0.015, 'harvest', 'Na Safra Abençoada, abaixo de 20% da vida a regeneração sobe +1,5%/s até passar de 35%. A Ferida Profana continua valendo.'),
  U('l_endless', 'Melancia Sem Fim', 'lapanha', 'legendary', 'transform', 1, 1, 'bigMelon', 'Durante a Safra Abençoada, a primeira Melancia Madura com carga máxima não custa vida (uma vez por Safra; não aumenta o dano).'),
  U('l_fair', 'Feira da Meia-Noite', 'lapanha', 'legendary', 'transform', 1, 1, 'melon', 'Os básicos alternam: melancia larga (+35% de área, -20% de dano) e melancia densa (-25% de área, +25% no centro).'),
];

export const UPGRADE_BY_ID: ReadonlyMap<string, UpgradeDef> = new Map(UPGRADES.map((u) => [u.id, u]));
export const INTERMISSION_SECONDS = 30;

/** Cartas oferecidas por intervalo (base). Desafios e a rota de risco podem somar +1. */
export const BASE_OFFER_COUNT = 3;
export const MAX_OFFER_COUNT = 4;

/** Texto "atual → próximo" de uma carta com comparação numérica. */
export function upgradeCompare(u: UpgradeDef, have: number): string | null {
  const s = u.show;
  if (!s) return null;
  const f = (n: number): string => {
    const v = s.pct ? Math.round(u.value * n * 1000) / 10 : Math.round(u.value * n * 10) / 10;
    return `${n === 0 ? '' : s.sign}${String(v).replace('.', ',')}${s.unit}`;
  };
  return `${s.label}: ${have === 0 ? '0' : f(have)} → ${f(have + 1)}`;
}
