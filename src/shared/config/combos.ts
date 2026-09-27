/**
 * Combos entre classes: pequenos bônus situacionais quando efeitos de fontes DIFERENTES (duas
 * classes, ou uma classe + um controle de ambiente) se encontram no mesmo inimigo. Nenhum combo
 * aqui é um multiplicador de dano permanente nem empilha com si mesmo — todos passam pelos
 * sistemas de resistência/retorno decrescente já existentes (applyCC, poise) ou têm seu próprio
 * cooldown por inimigo, então não criam uma nova forma de "quebrar" o balanceamento: são
 * momentos de coordenação, não um multiplicador escondido.
 */
export const COMBOS = {
  /**
   * Combo Gélido: um alvo já lento (por qualquer fonte) que recebe uma SEGUNDA lentidão de uma
   * fonte diferente (classe/campo diferente) é brevemente atordoado. Roda pela mesma resistência
   * (`ccResist`) e retorno decrescente compartilhado com atordoamento/enraizamento (CC_DR) — chefes
   * e elites já resistem tanto quanto resistiriam a um atordoamento comum. `cooldown` evita reativar
   * no mesmo alvo repetidamente.
   */
  freeze: { seconds: 0.35, cooldown: 6 },
  /**
   * Casca Traiçoeira + acompanhamento: um golpe com postura alta (`poiseThreshold`) enquanto o
   * alvo ainda está tonto do escorregão (`vulnT`, já existente) atordoa na hora, sem precisar
   * estourar a barra de postura. Só afeta comuns/elites — minichefes e chefes já não escorregam
   * de verdade na Casca (design existente), então não têm essa janela.
   */
  slipFollowUp: { poiseThreshold: 30, stunSeconds: 0.45 },
  /**
   * Escudo do Portador do Ossário: ao ser destruído por dano de jogador, um pulso curto sem dano
   * atordoa comuns próximos por um instante — recompensa o time por focar o escudo junto, em vez
   * de ser só "mais uma barra de vida". Nunca afeta elites/minichefes/chefes.
   */
  shieldBreakPulse: { radius: 90, stunSeconds: 0.4 },
  /**
   * Provocação do Guardião + Casca Traiçoeira: um inimigo provocado (atenção travada no Guardião)
   * que escorrega empurra e machuca levemente quem estiver perto — só comuns, dano fracionário do
   * próprio esbarrão da Casca (nunca mais que ele).
   */
  tauntSlipChain: { radius: 70, damageMul: 0.5 },
  /**
   * Marca de Ossos (Necromante) + controle de equipe: atordoar/quebrar a postura de um alvo
   * marcado dá um pouco de Essência na hora para quem marcou, mesmo antes de matá-lo — a
   * recompensa por matar marcado (`HEAL_RULES`/`NECRO.essence.markedBonus`) continua igual, isso é
   * só um empurrãozinho por focar o alvo certo. `cooldown` por inimigo evita farm repetido.
   */
  markStagger: { essence: 1, cooldown: 4 },
  /**
   * Caçador de Névoa velado + acerto em área: um golpe em área (`kind:'aoe'`) o expõe por um
   * instante (perde o velamento e fica com um pequeno bônus de dano) — motivo para o time de área
   * ajudar quem está tentando acertar um inimigo que "desaparece".
   */
  exposeVeiled: { seconds: 1.1, mul: 1.15 },
} as const;
