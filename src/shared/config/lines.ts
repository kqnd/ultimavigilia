/**
 * Falas curtas dos personagens jogáveis (balão sobre a cabeça). Cada classe tem uma voz própria e
 * reconhecível em uma linha — é assim que o time percebe quem falou sem ler o nome:
 *
 * - Caçador: seco, técnico, conta o que vê. Nunca comemora alto.
 * - Mago: erudito e um tanto vaidoso; fala de padrões, cinzas e cálculo.
 * - Guardião: comando curto, protetor, sempre no plural ("a linha", "atrás de mim").
 * - Vampiro: aristocrático e cortês até a crueldade; trata a horda como jantar.
 * - Berserker: grito curto, brutal, adora sangrar e fazer sangrar.
 * - Dog: criança empolgada de pulmões impossíveis; tudo é a coisa mais legal do mundo.
 * - Necromante: solene e formal; é educado com os mortos e frio com os vivos.
 * - Lapanha: alegre, corajoso, bem-humorado e natural — expressões regionais com moderação,
 *   sem sotaque fonético forçado.
 * - Maycon: gamer bonachão; vive citando Hunt: Showdown (Bounty, Dark Sight, extração, Choke,
 *   Lawson, Bayou...) e trata a noite como uma partida ranqueada.
 */
import type { ClassId } from './classes.js';

export type LineKind =
  | 'select' | 'matchStart' | 'waveStart' | 'fullQ' | 'slip' | 'ult' | 'lowHp' | 'heal'
  | 'minibossDown' | 'bossDown' | 'reviveAlly' | 'revived' | 'victory' | 'defeat'
  /** A equipe caiu e voltou ao último checkpoint. */
  | 'checkpoint';

export const LINES: Partial<Record<ClassId, Partial<Record<LineKind, readonly string[]>>>> = {
  hunter: {
    select: ['Eu abro caminho. Vocês aproveitam.', 'Dê-me linha de tiro e o resto é meu.'],
    matchStart: ['Posição tomada.', 'Armadilhas no chão. Andem por dentro.', 'Vou marcar os grandes primeiro.'],
    waveStart: ['Mais deles. Contei doze.', 'Vêm pela esquerda.', 'Segurem a linha, eu pego os de trás.', 'Preparado.'],
    ult: ['Chuva neles.', 'Saiam do círculo.', 'Não pisem onde eu apontei.'],
    lowHp: ['Estou ferido. Preciso de espaço.', 'Perdi sangue. Cubram-me.', 'Não consigo recuar sozinho.'],
    minibossDown: ['Alvo grande abatido.', 'Esse já não anda.'],
    bossDown: ['Rastro encerrado.', 'Caça feita. Recolham o que der.'],
    reviveAlly: ['De pé. Ainda tem noite.', 'Fica comigo. Levanta.'],
    revived: ['Obrigado. Não erro de novo.', 'Voltei. Onde estão eles?'],
    checkpoint: ['De novo. Agora eu sei por onde eles vêm.', 'Recomeçar o rastro. Sem pressa.'],
    victory: ['Amanheceu. Boa caça.', 'Sobrevivemos. É o que importa.'],
    defeat: ['Errei o tiro que importava.', 'Perdi o rastro...'],
  },
  mage: {
    select: ['Tragam-nos agrupados. Eu faço o resto.', 'Um bom padrão vale mais que cem golpes.'],
    matchStart: ['As runas estão quentes.', 'Agrupem-nos para mim.', 'Vamos ver o que a noite aprendeu.'],
    waveStart: ['Que formação desleixada.', 'Juntos assim? Que gentileza.', 'Padrão previsível.', 'Mais material.'],
    ult: ['Cinzas.', 'Observem o cálculo.', 'Isto vai doer no lugar certo.'],
    lowHp: ['O manto não segura mais.', 'Estou exposto. Alguém à minha frente!', 'Não tenho vida para isto.'],
    minibossDown: ['Reduzido.', 'Nem era tão resistente.'],
    bossDown: ['Encerrado, e com elegância.', 'Estava tudo nos cálculos.'],
    reviveAlly: ['Levante-se. Ainda preciso de você.', 'Ainda não. Respire.'],
    revived: ['Grato. Isso não constava.', 'De volta. Não me distraio outra vez.'],
    checkpoint: ['Recalculando. O erro foi de variável, não de método.', 'Segunda tentativa. Agora com dados.'],
    victory: ['A noite cedeu ao método.', 'Belo trabalho. Previsível, mas belo.'],
    defeat: ['As contas não fecharam...', 'Eu devia ter visto.'],
  },
  tank: {
    select: ['Fico na frente. Sempre.', 'Atrás de mim ninguém cai.'],
    matchStart: ['Linha formada. Atrás de mim.', 'Eu seguro. Vocês batem.', 'Ninguém passa por aqui.'],
    waveStart: ['Aqui vêm eles. Firmes!', 'Escudo erguido!', 'Não recuem. Eu aguento.', 'Comigo!'],
    ult: ['ESCUDO!', 'Todos para dentro!', 'Aqui eles param.'],
    lowHp: ['A armadura está cedendo.', 'Preciso de um instante!', 'Não consigo segurar muito mais.'],
    minibossDown: ['Derrubado.', 'Esse bateu no escudo errado.'],
    bossDown: ['A linha aguentou.', 'Segurar era o plano. Funcionou.'],
    reviveAlly: ['Eu te cubro. Levanta!', 'De pé, soldado. Eu estou aqui.'],
    revived: ['Obrigado. Volto para a frente.', 'De pé. Minha vez de segurar.'],
    checkpoint: ['Reagrupem atrás de mim. Desta vez a linha segura.', 'Caímos. Levantamos. Formação!'],
    victory: ['A linha não quebrou.', 'Todos de pé. É só isso que conta.'],
    defeat: ['Eu devia ter segurado...', 'A linha caiu comigo.'],
  },
  vampire: {
    select: ['Que noite generosa. Tanto sangue de pé.', 'Eu me sirvo enquanto trabalho.'],
    matchStart: ['A mesa está posta.', 'Deixem alguns inteiros para mim.', 'Que fome oportuna.'],
    waveStart: ['Mais convidados. Que delícia.', 'Vieram em bandos. Melhor assim.', 'Sirvam-se... ou me deixem servir.', 'Ah, o jantar.'],
    ult: ['BANQUETE!', 'Agora eu me sirvo de verdade.', 'Todos vocês. De uma vez.'],
    lowHp: ['Isto é... humilhante.', 'Preciso beber. Agora.', 'Estou pálido até para mim.'],
    minibossDown: ['Sangue nobre, esse.', 'Seco.'],
    bossDown: ['Guardei o melhor para o fim.', 'Um brinde. A mim.'],
    reviveAlly: ['Levante-se. Você ainda me é útil.', 'Não morra. É desperdício.'],
    revived: ['Devo-lhe uma taça.', 'Gentileza. Anotada.'],
    checkpoint: ['Um contratempo deselegante. Repitamos o prato.', 'A noite ainda me deve um jantar.'],
    victory: ['A noite foi minha. E de vocês, claro.', 'Que ceia excelente.'],
    defeat: ['Que fim... vulgar.', 'Sede. Só sede...'],
  },
  berserker: {
    select: ['Traz eles. TODOS eles.', 'Machado afiado, noite curta.'],
    matchStart: ['BORA!', 'Solta a horda!', 'Tô coçando pra bater.'],
    waveStart: ['MAIS!', 'Vem, vem, vem!', 'É pouco! Manda mais!', 'HAH! Finalmente!'],
    ult: ['LOUCURA!', 'AGORA SIM!', 'SANGUE! TUDO!'],
    lowHp: ['Isso é meu sangue? MELHOR!', 'Dói. Gostei.', 'Ainda tô de pé!'],
    minibossDown: ['CAIU!', 'Era grande. E daí?'],
    bossDown: ['EU DERRUBEI!', 'RACHOU no meio!'],
    reviveAlly: ['LEVANTA! Falta muito!', 'De pé! Tem gente pra bater!'],
    revived: ['HAH! De volta!', 'Valeu. Agora sai da frente.'],
    checkpoint: ['DE NOVO! AGORA COM MAIS RAIVA!', 'Morri? Ótimo. Volto pior.'],
    victory: ['AMANHECEU E EU TÔ VIVO!', 'Boa noite. Boa MESMO.'],
    defeat: ['Não... me deixa bater... mais uma...', 'Cansei.'],
  },
  dog: {
    select: ['Eu grito MUITO alto! Quer ver?', 'Vou ajudar! Prometo!'],
    matchStart: ['Vamos vamos vamos!', 'Eu tô pronto! Tô pronto!', 'Fica perto que eu grito neles!'],
    waveStart: ['Olha quantos!', 'EU VI! EU VI!', 'Vou empurrar todos!', 'Aqui vou eu!'],
    ult: ['AAAAAAAH!', 'AGORA EU GRITO DE VERDADE!', 'TAPA OS OUVIDOS!'],
    lowHp: ['Ai! Isso doeu!', 'Alguém me ajuda...', 'Tô com medo. Mas tô aqui!'],
    minibossDown: ['CAIU O GRANDÃO!', 'Viu? VIU?'],
    bossDown: ['A GENTE GANHOU DELE!', 'Eu gritei mais alto!'],
    reviveAlly: ['Levanta! Levanta!', 'Eu te ajudo! Segura!'],
    revived: ['Valeu! Você é o melhor!', 'Voltei! Cadê eles?'],
    checkpoint: ['Continua! Continua! Ainda dá!', 'Foi só um susto! Bora de novo!'],
    victory: ['A GENTE CONSEGUIU!', 'Melhor noite da minha vida!'],
    defeat: ['Eu gritei... não deu...', 'Quero ir pra casa.'],
  },
  necromancer: {
    select: ['Os mortos desta noite trabalharão para nós.', 'Nada aqui se desperdiça.'],
    matchStart: ['Deixem os corpos onde caírem.', 'O livro está aberto.', 'Eles servirão melhor mortos.'],
    waveStart: ['Mais matéria-prima.', 'Aproximem-se. Contribuam.', 'A horda traz os próprios servos.', 'Bem-vindos ao fim de vocês.'],
    ult: ['ERGUAM-SE, SEM NOME!', 'Todos vocês. De pé. Agora.', 'A sepultura está vazia. Eu a esvaziei.'],
    lowHp: ['Esta carne é frágil.', 'Preciso de tempo. Ganhem-no para mim.', 'Não sou eu que devia sangrar.'],
    minibossDown: ['Descanse. Depois levante.', 'Esse me servirá bem.'],
    bossDown: ['Até os grandes obedecem no fim.', 'Nome anotado. Alma também.'],
    reviveAlly: ['Ainda não é sua hora. Eu decido isso.', 'Volte. Eu não autorizei sua morte.'],
    revived: ['Curioso. Do outro lado é silencioso.', 'Grato. Eu devolvo o favor um dia.'],
    checkpoint: ['A morte nos devolveu. Desta vez, cobrem caro.', 'Voltamos do outro lado. Ninguém comente.'],
    victory: ['A noite cobrou o preço dela. Nós pagamos menos.', 'Todos de pé. Notável.'],
    defeat: ['Então é assim... do outro lado...', 'Eu voltarei. De uma forma ou de outra.'],
  },
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
    checkpoint: ['Caímo, mas levantamo! Bora, meu povo!', 'Recomeça a feira, que a melancia ainda tá boa.'],
    victory: ['Amanheceu! Vou dividir o resto do cesto com todo mundo.', 'Conseguimos, meu povo!'],
    defeat: ['Hoje não deu... amanhã a gente volta.', 'Guarda uma melancia pra mim.'],
  },
  maycon: {
    select: ['Bora de Bounty? Eu levo o tapete.', 'Contrato aceito. Agora é sobreviver e extrair.', 'Pode deixar que eu dou o Choke neles.'],
    matchStart: ['Dark Sight ligado. Tô vendo tudo.', 'Isso aqui é pior que Lawson Delta de madrugada.', 'Escuta... corvo assustado é sinal de grunt.'],
    waveStart: ['Ouvi passo no Bayou!', 'Mais grunt que hive no Scrapbeak.', 'Choke neles, galera!', 'Cuidado que tem Hive aí no meio!'],
    ult: ['RODADA DA CASA! Eu pago!', 'Um gole e é Hellfire na cara!', 'Saideira de Vitality, rapaziada!'],
    lowHp: ['Tô no último bar de vida!', 'Me tira do fogo! Ninguém revive pegando fogo!', 'Tô sangrando igual sem Bandage.'],
    heal: ['Ahh, Vitality Shot da roça.', 'Recarreguei a barra!'],
    minibossDown: ['Caiu! Pega o clue!', 'Banish nesse aí!'],
    bossDown: ['BOSS BANIDO! Corre pra extração!', 'Bounty no ombro, rapaziada!'],
    reviveAlly: ['Levanta! Não vou te deixar virar loot!', 'Toma esse Vitality e volta pro jogo!'],
    revived: ['Valeu! Achei que ia pro lobby.', 'Voltei! Só perdi uma Trait.'],
    victory: ['EXTRAÍMOS! GG, time!', 'Amanheceu e a Bounty é nossa!'],
    defeat: ['Wipe... igual quando o Assassino pula de dois.', 'Fomos pro lobby, rapaziada...'],
    checkpoint: ['Wipe, mas a Bounty ainda tá no mapa!', 'Respawn no Bayou. Agora é tryhard.'],
  },
};

/** Intervalo mínimo entre falas do mesmo jogador (s) e por tipo repetido (s). */
export const LINE_RULES = { minGap: 5, sameKindGap: 18, bubbleSeconds: 2.6 } as const;
