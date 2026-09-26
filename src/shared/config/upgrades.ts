/** Melhorias escolhidas entre ondas. Valores exatos exibidos ao jogador. */
import type { ClassId } from './classes.js';

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
  /**
   * Bifurcação de estilo: melhorias do mesmo grupo são mutuamente exclusivas. Depois de escolher
   * uma, as outras do grupo deixam de ser oferecidas e o servidor recusa qualquer tentativa.
   */
  fork?: string;
}

const U = (id: string, name: string, cls: ClassId | null, maxStacks: number, value: number, icon: string, desc: string, fork?: string): UpgradeDef => ({
  id,
  name,
  desc,
  cls,
  maxStacks,
  value,
  icon,
  ...(fork ? { fork } : {}),
});

/** Nome legível de cada bifurcação (interface). */
export const FORKS: Record<string, { name: string }> = {
  hunter_path: { name: 'Caminho do Caçador' },
  vampire_path: { name: 'Caminho do Sangue' },
  berserker_path: { name: 'Caminho da Fúria' },
  necro_path: { name: 'Caminho dos Mortos' },
};

export const UPGRADES: readonly UpgradeDef[] = [
  // --- Gerais ---
  U('g_vigor', 'Vigor da Vigília', null, 3, 18, 'heart', '+18 de vida máxima (e cura o mesmo valor).'),
  U('g_breath', 'Fôlego de Ferro', null, 3, 15, 'lung', '+15 de stamina máxima.'),
  U('g_recovery', 'Respiração Ritmada', null, 3, 0.18, 'wind', '+18% de regeneração de stamina.'),
  U('g_fury', 'Lâmina Ungida', null, 3, 0.1, 'sword', '+10% de dano causado.'),
  U('g_agility', 'Passos Leves', null, 2, 0.07, 'boot', '+7% de velocidade de movimento.'),
  U('g_focus', 'Foco Sombrio', null, 3, 0.09, 'hourglass', '-9% no tempo de recarga das habilidades Q e E.'),
  U('g_devotion', 'Devoção', null, 2, 0.2, 'star', '+20% de carga da suprema.'),
  U('g_bond', 'Laço de Vigília', null, 2, 0.3, 'hands', 'Revive aliados 30% mais rápido.'),
  U('g_skin', 'Couro Curtido', null, 2, 0.08, 'shield', '-8% de dano recebido.'),
  // --- Caçador ---
  U('h_pierce', 'Virote Farpado', 'hunter', 2, 1, 'bolt', 'Virotes básicos atravessam +1 inimigo.'),
  U('h_traps', 'Armadilheiro', 'hunter', 2, 1, 'trap', '+1 armadilha ativa simultânea e -1s de recarga da armadilha.'),
  U('h_rain', 'Chuva Densa', 'hunter', 2, 3, 'rain', 'Chuva de Prata dispara +3 saraivadas.'),
  U('h_mark', 'Presa Profunda', 'hunter', 2, 0.03, 'eye', '+3% de dano por marca em Presa Marcada.'),
  U('h_fan', 'Recuo em Leque', 'hunter', 1, 2, 'fan', 'Recuo Preciso dispara +2 virotes em leque.'),
  U('h_ricochet', 'Virote Ricocheteante', 'hunter', 1, 0.6, 'ricochet', 'BIFURCAÇÃO: cada virote básico ricocheteia 1 vez para outro inimigo a até 110px com 60% do dano.', 'hunter_path'),
  U('h_blast', 'Armadilha Explosiva', 'hunter', 1, 34, 'blast', 'BIFURCAÇÃO: armadilhas explodem ao disparar: 34 de dano e empurrão em 48px (ainda prendem o alvo principal).', 'hunter_path'),
  // --- Mago ---
  U('m_area', 'Selo Ampliado', 'mage', 2, 0.25, 'snow', 'Selo Glacial com +25% de raio.'),
  U('m_duration', 'Gelo Eterno', 'mage', 2, 1.5, 'ice', 'Selo Glacial dura +1,5s.'),
  U('m_converge', 'Convergência Plena', 'mage', 2, 0.5, 'orb', 'Básico fortalecido causa +50% de dano.'),
  U('m_rupture', 'Ruptura Rápida', 'mage', 1, 0.35, 'burst', 'Preparação da Ruptura Arcana 35% mais curta.'),
  U('m_blink', 'Passo Longo', 'mage', 1, 40, 'blink', 'Passo Etéreo alcança +40px.'),
  // --- Tank ---
  U('t_guard', 'Guarda Temperada', 'tank', 2, 0.25, 'shield', 'Bloqueios consomem 25% menos stamina.'),
  U('t_taunt', 'Eco da Provocação', 'tank', 2, 50, 'horn', 'Provocação com +50px de raio.'),
  U('t_bastion', 'Bastião Vivo', 'tank', 1, 4, 'tower', 'Bastião cura aliados em 4 de vida por segundo.'),
  U('t_mace', 'Maça Pesada', 'tank', 2, 0.25, 'mace', 'Golpe de Maça: +25% de dano e de stagger.'),
  // --- Vampiro ---
  U('v_fangs', 'Presas Afiadas', 'vampire', 2, 8, 'fang', 'Mordida: +8 de dano e +6 no teto de cura por uso.'),
  U('v_thirst', 'Sede Insaciável', 'vampire', 2, 2, 'drop', '+2 acúmulos máximos de Sede.'),
  U('v_feast', 'Banquete Longo', 'vampire', 2, 3, 'goblet', 'Banquete dura +3s.'),
  U('v_mist', 'Névoa Espessa', 'vampire', 1, 2, 'mist', 'Névoa Rubra: -2s de recarga.'),
  U('v_swarm', 'Mordida da Revoada', 'vampire', 1, 0.35, 'swarm', 'BIFURCAÇÃO: Mordida com +40° de arco e +35% de alcance (mais alvos por uso).', 'vampire_path'),
  U('v_noble', 'Presa Nobre', 'vampire', 1, 1, 'crown', 'BIFURCAÇÃO: contra elites e chefes a Mordida causa +40% de dano e a cura dobra (teto por uso +50%).', 'vampire_path'),
  // --- Berserker ---
  U('b_blood', 'Sangue Fervente', 'berserker', 2, 0.4, 'drop', '+40% de Fúria gerada ao causar e receber dano.'),
  U('b_cleave', 'Machado Largo', 'berserker', 2, 0.15, 'axe', 'Combo e Rasgo Frenético com +15% de alcance.'),
  U('b_quake', 'Salto Sísmico', 'berserker', 2, 0.3, 'quake', 'Salto Brutal: +30% de raio no pouso e -1s de recarga.'),
  U('b_rage', 'Fúria Ofensiva', 'berserker', 1, 0.2, 'fury', 'BIFURCAÇÃO: com Fúria acima de 60, +20% de dano adicional.', 'berserker_path'),
  U('b_iron', 'Mente de Ferro', 'berserker', 1, 0.35, 'helm', 'BIFURCAÇÃO: durante a Loucura recebe -35% de dano (em vez de +20%) e não sofre exaustão.', 'berserker_path'),
  // --- Dog ---
  U('d_pulse', 'Pulso Extra', 'dog', 2, 1, 'rings', 'GRITO DO FIM ganha +1 pulso.'),
  U('d_throat', 'Garganta de Ferro', 'dog', 2, 0.2, 'mouth', 'Grito com +20% de alcance.'),
  U('d_magnet', 'Ímã Forte', 'dog', 2, 0.4, 'magnet', 'Polaridade puxa 40% mais forte e com +20px de raio.'),
  U('d_resonance', 'Ressonância Rápida', 'dog', 2, 5, 'wave', 'Ressonância precisa de 5 acertos a menos.'),
  // --- Necromante ---
  U('n_bones', 'Ossos Afiados', 'necromancer', 2, 1, 'bone', 'Rajada Óssea atravessa +1 inimigo e causa +3 de dano.'),
  U('n_ritual', 'Ritualista', 'necromancer', 1, 0.2, 'hand', 'Com 3+ de Essência, a Mão da Sepultura gasta 1 para amaldiçoar: +25% de raio e inimigos dentro causam -20% de dano.'),
  U('n_lord', 'Senhor dos Mortos', 'necromancer', 2, 0.4, 'skull', 'BIFURCAÇÃO: servos com +40% de vida e +4s de duração.', 'necro_path'),
  U('n_reaper', 'Ceifador de Almas', 'necromancer', 1, 30, 'scythe', 'BIFURCAÇÃO: servos que morrem, expiram ou são sacrificados explodem (30 de dano, ×2 contra elites) e curam você em 5.', 'necro_path'),
];

export const UPGRADE_BY_ID: ReadonlyMap<string, UpgradeDef> = new Map(UPGRADES.map((u) => [u.id, u]));
export const INTERMISSION_SECONDS = 30;

/** Cartas oferecidas por intervalo (base). Desafios e a rota de risco podem somar +1. */
export const BASE_OFFER_COUNT = 3;
export const MAX_OFFER_COUNT = 4;
