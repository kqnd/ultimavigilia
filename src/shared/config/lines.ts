/**
 * Falas curtas dos personagens jogáveis (balão sobre a cabeça). Tom do Lapanha: alegre, corajoso,
 * bem-humorado e natural — expressões regionais com moderação, sem sotaque fonético forçado.
 */
import type { ClassId } from './classes.js';

export type LineKind =
  | 'select' | 'matchStart' | 'waveStart' | 'fullQ' | 'slip' | 'ult' | 'lowHp' | 'heal'
  | 'minibossDown' | 'bossDown' | 'reviveAlly' | 'revived' | 'victory' | 'defeat';

export const LINES: Partial<Record<ClassId, Partial<Record<LineKind, readonly string[]>>>> = {
  lapanha: {
    select: ['Bora, meu povo! Melancia fresquinha pra noite inteira.', 'Relaxe que eu trouxe o cesto cheio.', 'Com sorriso no rosto e melancia na mão, ninguém passa.'],
    matchStart: ['Bora, meu povo!', 'Noite longa? Melancia não falta.', 'Fica perto que eu cubro vocês.'],
    waveStart: ['Lá vem mais. Tá tudo certo!', 'Oxe, chegaram cedo hoje.', 'Segura aí que a feira abriu.', 'Mais uma rodada!'],
    fullQ: ['Essa aqui tá madura!', 'Segura essa!', 'Olha a melancia!', 'Essa é das grandes!'],
    slip: ['Escorregou, foi?', 'Cuidado com a casca!', 'Ih, lá vai ele!'],
    ult: ['Um pedacinho e eu volto novo!', 'Hora da safra!', 'Doce que só! Bora de novo.'],
    lowHp: ['Tô inteiro... quase.', 'Calma, calma, dá pra virar!', 'Ainda sobrou um pedaço de mim.'],
    heal: ['Ahh, agora sim.', 'Refrescou!'],
    minibossDown: ['Caiu o grandão!', 'Esse aí não volta mais pra feira.'],
    bossDown: ['A noite é nossa!', 'Arretado! Derrubamos!', 'Quem manda aqui é a vigília!'],
    reviveAlly: ['Levanta, que a noite não acabou!', 'Toma um pedaço e bora!'],
    revived: ['Valeu! Fico te devendo uma melancia.', 'De pé de novo, graças a você!'],
    victory: ['Amanheceu! Vou dividir o resto do cesto com todo mundo.', 'Conseguimos, meu povo!'],
    defeat: ['Hoje não deu... amanhã a gente volta.', 'Guarda uma melancia pra mim.'],
  },
};

/** Intervalo mínimo entre falas do mesmo jogador (s) e por tipo repetido (s). */
export const LINE_RULES = { minGap: 5, sameKindGap: 18, bubbleSeconds: 2.6 } as const;
