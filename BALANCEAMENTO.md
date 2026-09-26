# Balanceamento — Última Vigília v0.2

Todos os números abaixo vêm de `src/shared/config/` (fonte única; nada de valor "mágico" espalhado
pelo código). Tempos em segundos, salvo quando indicado em **ticks** (30 ticks = 1 s). Distâncias
em pixels do mundo (1 tile = 32 px). O servidor é a autoridade para todo dano, cura, drop, objetivo,
escolha e progressão; o cliente só desenha.

Legenda: **novo** = não existia na v0.1 · **alterado** = valor antigo → novo.

---

## 1. Campanha: 30 ondas em 3 capítulos (`waves.ts`, `chapters.ts`)

| Capítulo | Ondas | Mapa / clima | Adaptação da horda | Tempestade |
|---|---|---|---|---|
| I — A Vila Amaldiçoada | 1–10 | vila, noite | — | — |
| II — O Cemitério Congelado | 11–20 | labirinto de sebes, neve | **Congelados**: vida ×1,15, velocidade ×0,92, golpes aplicam **Frio** (−22% de velocidade por 1,6 s), ignoram neve funda | **Nevasca** a cada 50 s por 9 s: inimigos +15% de velocidade |
| III — A Mansão no Deserto de Cinzas | 21–30 | mansão + deserto, cinzas | **Ressecados**: vida ×0,92, velocidade ×1,12, golpes aplicam **Queimadura** (3 de dano/s por 3 s), ignoram areia movediça | **Tempestade de cinzas** a cada 45 s por 8 s: inimigos +15% de velocidade |

- Chão lento (neve funda / areia movediça): jogadores a **×0,8** de velocidade (mesma regra na
  predição do cliente e no servidor).
- Curva (**alterada**): a vida cresce **+5% por onda dentro do capítulo** (antes +7% por onda em 10
  ondas) e o dano **+3,5%** (antes +5%). Cada capítulo aplica um degrau: vida ×1 / ×1,3 / ×1,6 e dano
  ×1 / ×1,2 / ×1,4. Resultado: um comum da onda 30 tem 1,6 × 1,45 × 0,92 (Ressecados) ≈ **2,1×** a vida
  da onda 1 (em vez de crescer sem parar por 30 ondas), porque o crescimento reinicia a cada capítulo
  sobre um degrau maior — sustentável até o fim.
- Orçamento por jogador: +70% por jogador extra (inalterado). Limite absoluto de 110 inimigos vivos.
- Respiros: ondas 11 e 21 (primeira de cada capítulo) têm orçamento menor e sem desafio.
- Chefes: onda 10 **Devorador da Lua**, onda 20 **Noiva do Inverno** (novo), onda 30 **Patriarca do
  Abismo**. Minichefes (novos): onda 5 **Lobisomem Alfa** (900 de vida, dano ×1,4), onda 15
  **Acólito Supremo** (720, ×1,3, leque de 3 orbes), onda 25 **Pai Ancestral** (1150, ×1,35).
  Vida de chefe: +85% por jogador extra; minichefe +50% por jogador extra.

### Transição de capítulo
Intervalo da onda 10/20 (cartas) → **votação de rota** (20 s) → **viagem** (9 s de cinemática; o
servidor troca o mapa no início, reposiciona os jogadores nos pontos de início livres e limpa
inimigos, projéteis, zonas, itens, cadáveres e servos) → primeira onda do capítulo.

### Rotas (novo — `ROUTE`)
| Rota | Efeito no capítulo |
|---|---|
| **Portal de Risco** | orçamento ×1,3, +15% de chance de afixo, +1 elite garantido por onda; recompensa: +1 carta por intervalo (4 opções) e desafios valem o dobro |
| **Rota Segura** | na hora: todos de pé, vida cheia e +30% de suprema; inimigos com −10% de vida; 3 cartas |

Maioria decide; **empate ou ninguém votando = Rota Segura**. Voto pode ser trocado até o fim; a
votação termina antes se todos os conectados votarem.

---

## 2. Classes

### Berserker (novo — substitui o Guerreiro em todo o jogo)
Vida 135 · Stamina 110 (regen 34/s) · Velocidade 108 · Dificuldade ★★☆

| Ação | Valores |
|---|---|
| Básico — Machado Brutal (combo 3) | 18 / 20 / 40 de dano; alcance 38/38/44; arco 120°/120°/**190°**; 3º golpe: preparação 11, recuperação 17 ticks, empurrão 150; janela de combo 9 ticks |
| Q — Rasgo Frenético | 4 cortes de 11 (44 total) em cone 120° / 40 px, um a cada 4 ticks; anda a 60%; recarga 6 s; 16 de stamina |
| E — Salto Brutal | até 150 px em 12 ticks com 8 ticks de invulnerabilidade; pouso: 28 de dano em 46 px, poise 42, empurrão 160; recarga 7 s; 18 de stamina; telegrafado no chão |
| R — Loucura (suprema) | 8 s: Fúria travada em 100, **+35% de dano**, **+30% de velocidade de ataque**, **+20% de dano recebido**; ao fim, **3 s de Exaustão** (velocidade ×0,6) |
| Passiva — Fúria (0–100) | +0,35 por dano causado e +0,9 por dano recebido; começa a cair 2,5 s sem combate (−8/s). Escala linear até: +35% de dano, +20% de velocidade de ataque, **+25% de dano recebido**. Acima de 60: stamina custa ×1,25 |

Riscos claros: mais dano recebido com Fúria alta, custo de stamina maior e exaustão após a suprema.
Não reutiliza aparo/contra-ataque do Guerreiro.

### Necromante (novo)
Vida 84 · Stamina 95 (regen 32/s) · Velocidade 100 · Dificuldade ★★★ — fraco sem Essência e sem servos.

| Ação | Valores |
|---|---|
| Básico — Rajada Óssea | projétil 300 px/s, 12 de dano, atravessa 1 inimigo, alcance 300; marca com **Ossos** por 5 s (morte marcada: +1 de Essência; Mão da Sepultura causa mais dano). Moderado de propósito: abaixo do DPS do Caçador/Mago |
| Q — Erguer Morto | custa **2 de Essência**; precisa de um **cadáver** a até 150 px da mira (ou de você); recarga 2,5 s; ergue 1 servo (máx. **3** ativos — o 4º sacrifica o mais antigo). Nega com mensagem clara: "Essência insuficiente", "Nenhum cadáver por perto", "Sem espaço" |
| Servo | 60 de vida, 16 s, 92 px/s, 11 de dano (ataque telegrafado, 1,2 s entre golpes), atrai inimigos a até 80 px; volta para perto do dono se passar de 260 px |
| E — Mão da Sepultura | área de 54 px a até 220 px, telegrafada por 12 ticks; dura 3 s; comuns ficam **presos 1,6 s**, elites **−40%**, chefes **−20%** de velocidade (resistem); 4 de dano a cada 0,5 s (10 em marcados); recarga 10 s |
| R — Exército dos Sem Nome | consome **toda** a Essência: 2 + 1 por Essência (máx. **9**) mortos de 40 de vida por 9 s, a 120 px/s; ao sumir explodem (30 de dano em 38 px). Contra chefes: dano ×0,35 e **teto de 360 por conjuração** |
| Passiva — Restos Mortais | mortes a até 170 px: comum +1, elite +2, chefe +3 de Essência (máx. **7**). Mortes causadas por aliados contam; quedas de aliados **não** geram nada |

Limites de entidades: 12 servos por Necromante, **16 invocações no mundo** (inclui horda); servos não
contam para escalonamento, objetivos nem para o fim da onda e são removidos no fim da onda, na queda
ou desconexão do dono, na troca de mapa, na vitória/derrota e ao voltar ao lobby. Cadáveres duram
12 s (máx. 16 guardados).

### Vampiro — Mordida (alterado)
| Valor | v0.1 → v0.2 |
|---|---|
| Forma | alvo único → **cone** |
| Arco / alcance | 60° / 26 px → **110° / 42 px** |
| Dano | 26 → **30** (em **cada** inimigo do cone) |
| Preparação / recuperação | 5 / 9 ticks → 6 / 8 ticks |
| Recarga / stamina | 5 s / 8 → 5,5 s / 12 |
| Cura | 45% do dano, teto 22 → **35%** do dano, **teto 32 por uso** |
| Teto de cura por segundo (todas as curas com limite) | 28 → **36** |

Cura teórica: com 3 alvos, 3 × 30 × 0,35 = 31,5 ≈ teto de 32 por uso; sustentado só pela Mordida
≈ 32 / 5,5 s ≈ **5,8 de vida/s**. O teto por segundo (36) impede somar Banquete + Mordida acima disso.

### Dog — Pulso Magnético (alterado)
Preparação 6 → **3** ticks, recuperação 10 → **5** ticks, agora anda a **70%** durante o golpe; raio
92 → 100, dano 12 → 14. **Não aplica lentidão** (só empurrão e interrupção).

### Caçador, Mago, Tank
Sem alteração de números base; ganharam interação com caixas/barris (virotes, Chuva de Prata e
Ruptura quebram) e o Caçador ganhou uma bifurcação (abaixo).

---

## 3. Melhorias (`upgrades.ts`)

- **Confirmação** (novo): clicar destaca a carta; só **"Confirmar escolha"** envia ao servidor. Uma
  confirmação por intervalo (a segunda é recusada). Ao fim dos 30 s, quem não confirmou recebe a
  **primeira opção válida**. Contagem "Prontos x/y" sincronizada; tudo é aplicado só ao fim do intervalo.
- 3 cartas por intervalo; **4** com bônus (Rota de Risco ou recompensa de evento/desafio).

### Bifurcações (novo — mutuamente exclusivas, validadas no servidor)
Depois de tomar um lado, o outro deixa de ser sorteado; o servidor recusa se for enviado mesmo assim.
A interface mostra "Caminho X — exclui Y" e marca "Incompatível" se a regra se aplicar.

| Classe | Lado A | Lado B |
|---|---|---|
| Caçador | **Virote Ricocheteante**: 1 ricochete a até 110 px com 60% do dano | **Armadilha Explosiva**: 34 de dano em 48 px ao disparar |
| Vampiro | **Mordida da Revoada**: +40° de arco e +35% de alcance | **Presa Nobre**: +40% de dano em elites/chefes, cura ×2, teto por uso ×1,5 |
| Berserker | **Fúria Ofensiva**: +20% de dano com Fúria > 60 | **Mente de Ferro**: na Loucura recebe −35% (em vez de +20%) e não sofre exaustão |
| Necromante | **Senhor dos Mortos** (2×): servos +40% de vida e +4 s | **Ceifador de Almas**: servos explodem ao morrer/expirar (30 de dano, ×2 em elites) e curam 5 |

### Outras novas / alteradas
- Vampiro · **Presas Afiadas**: +10 de dano → **+8 de dano e +6 no teto por uso** (a Mordida já ficou mais forte).
- Berserker: **Sangue Fervente** (+40% de Fúria gerada, 2×), **Machado Largo** (+15% de alcance, 2×),
  **Salto Sísmico** (+30% de raio e −1 s de recarga, 2×).
- Necromante: **Ossos Afiados** (+1 perfuração e +3 de dano, 2×), **Ritualista** (com 3+ de Essência a
  Mão gasta 1: +25% de raio e inimigos dentro causam −20% de dano).
- Melhorias do Guerreiro removidas.

---

## 4. Caixas, barris e itens (`loot.ts`) — novo

| Valor | |
|---|---|
| Vida | caixa 30, barril 40 (qualquer ataque de jogador no alcance quebra) |
| Chance de item de cura | 40% |
| Item de cura | **+22 de vida atual** (nunca aumenta a máxima), raio de coleta 14 px, some em 25 s; só jogador **ferido** coleta; um jogador por item |
| Máximo no chão | 6 (o mais antigo some) |
| Reposição | no intervalo, 50% dos destruídos voltam (só se ninguém estiver em cima) |
| Suprema | +1 ao quebrar |

Destruídos deixam de bloquear movimento, navegação e tiros (o tile é liberado no servidor e o
cliente aplica a mesma lista do snapshot ao seu clone do mapa).

---

## 5. Afixos de elite (`affixes.ts`) — novo

Um afixo por inimigo, visível (anel colorido + nome acima) e sincronizado. Aparecem a partir da onda
4: chance 20% + 1,5% por onda (máx. 60%; +15% na Rota de Risco); minichefes sempre têm.

| Afixo | Em | Efeito |
|---|---|---|
| **Sangrento** | Lobisomem, Alfa | cura 8% da vida máxima a cada acerto em jogador |
| **Blindado** | Acólito, Supremo | recebe só 35% do poise (quase não é desequilibrado) |
| **Furioso** | Pai, Ancestral | abaixo de 40% de vida: +50% de velocidade e ataques 40% mais frequentes |

Recompensa ao matar: item de cura garantido e +8% de suprema para jogadores a até 220 px.

---

## 6. Eventos de onda (`objectives.ts`) — novo

| Evento | Ondas | Regras | Sucesso | Falha |
|---|---|---|---|---|
| Proteja a fogueira | 3, 24 | 100 de "vida"; cada inimigo a até 72 px tira 2,2/s (máx. 12/s) | equipe cura 30% e +1 carta | inimigos +15% de dano até o fim da onda |
| Interrompa o ritual | 12, 27 | matar o Acólito Ritualista (240 de vida, parado) em 40 s | +25% de suprema | surgem 2 lobisomens |
| Escolte o sobrevivente | 7, 18 | 120 de vida; anda 46 px/s perto de alguém (a 40% sozinho), raio 90 | cura 30% e +1 carta | inimigos +15% de dano |
| Detenha o carrinho | 14, 22 | carrinho de 460 de vida vai até a fogueira a 24 px/s | +25% de suprema | 6 inimigos surgem no centro |

Escolta, carrinho e ritual impedem o fim da onda até serem resolvidos (sempre têm solução no tempo).

## 7. Desafios opcionais — novo
Chance de 65% em ondas comuns (nunca em chefe, respiro ou primeira do capítulo). Não são necessários
para vencer; a recompensa dobra na Rota de Risco.

| Desafio | Regra | Recompensa |
|---|---|---|
| Ninguém cai nesta onda | falha na primeira queda | +1 carta |
| Limpe a onda a tempo | 45 s + 1,1 s por ponto de orçamento | +30% de suprema |
| Proteja o altar | altar de 80 de vida (−3/s por inimigo a até 48 px) | equipe cura 35% |
| Nada toca a fogueira | nenhum inimigo a até 72 px | +1 carta |
| Elimine o elite marcado | matar o "! ALVO !" em 45 s | +30% de suprema |

---

## 8. Chefes

### Devorador da Lua (onda 10) — Luas Falsas (novo)
Vida 2300. Ao surgir acende **3 Luas Falsas** (170 de vida, paradas). Cada lua de pé reduz o dano que
o chefe recebe em **20%** (mínimo ×0,2). Cada lua pulsa a cada 6 s (telegrafado por 1,2 s, 60 px, 12
de dano). Quebrar todas deixa o chefe **EXPOSTO** por 12 s: recebe **+30%** de dano. Depois de 25 s as
luas reacendem. O HUD mostra "Luas Falsas x/3" ou "EXPOSTO".

### Noiva do Inverno (onda 20) — novo
Vida 2800. Leque de 7 estilhaços (13 cada), nova de gelo a 84 px (24), linha de espinhos de gelo (8
segmentos de 22) e, na fase 2 (≤ 50%), mais estilhaços, velocidade ×1,2 e invocações (4, máx. 10 vivos).

### Patriarca do Abismo (onda 30) — Totens (alterado)
Vida 4300 → **3400** (a luta agora tem objetivo, não é esponja). Ergue **3 Totens do Abismo** (280 de
vida, disparam orbes de 12 a cada 4 s). Enquanto houver totem, o Patriarca recebe só **15%** do dano;
derrubar os três abre a **fase 2** (padrão diferente e mais agressivo). Salvaguarda: fase 2 à força
em 35% da vida.

---

## 9. Falas do Pai de Família
32 falas no total (antes 8), sorteadas sem repetir a fala imediatamente anterior.

---

## 10. Simulações (bots simples, `npm run simulate`)

| Composição | Resultado |
|---|---|
| Berserker solo (bot) | vitória na onda 30 em ~41 min simulados |
| Necromante solo (bot) | vitória na onda 30 em ~31,5 min simulados (ondas de 30–98 s; chefe final 287 s) |
| 7 classes a partir da onda 18 | vitória; onda da Noiva a mais longa |

Os bots só andam até o alvo mais próximo e apertam botões em ciclo — servem para verificar fluxo,
estabilidade e duração, não dificuldade real. O ajuste fino com pessoas continua recomendado,
principalmente: tempo da luta do Patriarca com totens, Noiva do Inverno com 5–7 jogadores e o
Necromante em mãos humanas.

## v1.2 — Anti-kite, Vampiro, Necromante e chefes

Todos os números vivem em `src/shared/config/enemies.ts` (ATK.shadowAcolyte / mistStalker / ossuaryBearer, SPECIAL_CAPS, BOSS_AI) e `classes.ts` (VAMPIRE, NECRO, MELEE_RULES, CLASS_RANGE).

| Inimigo | Tier | Vida | Vel. | Custo | Papel |
|---|---|---|---|---|---|
| Acólito Sombrio | comum | 58 | 60 | 4,5 | Canaliza "Marcha" (5 s, raio 150): +20% vel. comuns / +10% elites / +8% chefes; interrompível; foge de melee; virote 7 dano |
| Caçador de Névoa | elite | 95 | 100 | 5,5 | Caça quem atira: salto 20 dano (70–175 px, previsão 0,45 s), recuperação longa com poise ×2 vulnerável; garras 9 |
| Portador do Ossário | elite | 190 | 36 | 7 | Escudo frontal 160 (arco 120°): projéteis 10% no corpo, melee 40%, área 60%; quebrado → vel. 64 e recargas ×0,6; golpe 16 |

Limites simultâneos: 2 Acólitos, 2 Caçadores, 3 Portadores. Introdução: O4 Acólito, O6 Portador, O8 Caçador, O19 trio; nunca em ondas de chefe/minichefe.

Chefes/minichefes: prioridade ranged 3 > médio 2 > melee 1 (peso de distância 0,004); alvo travado até morrer/sair; Provocar transfere e trava 6 s; se o alvo fica > 200 px por 1,5 s, perseguição ×1,3.
Melee recebe 12% menos dano (MELEE_RULES).

Vampiro (125 HP): E = Redemoinho Rubro (cd 8 s, 5 pulsos × 12 dano, raio 72, puxa 45, cura 18% capada em 30, -30% dano recebido durante); R Banquete com explosão 42 em raio 96 e cura 6/alvo (máx. 36); mordida 34.
Necromante: exército até 6 unidades por 6 s, dano a chefes ×0,3 (teto 220); Suprema selada 22 s após uso; carga de Suprema por lacaios ×0,35.

## v1.3 — Dificuldade, Vampiro, Ferida Profana, missões e Lapanha

### Por que o Vampiro se sustentava demais
- A Mordida curava 35% do dano **bruto** de cada inimigo do cone, sem retorno decrescente: 3 alvos ≈ 3× a cura de 1.
- Dano excedente sobre alvos quase mortos contava como cura; Sede e Banquete (+35%) aumentavam o dano e, junto, a cura.
- O teto de 40/s era alto o bastante para Mordida + Redemoinho + explosão do Banquete não se limitarem na prática.

Agora toda cura passa por `healPlayer` (`src/server/world/healing.ts`), nesta ordem: dano válido → retorno decrescente
(100% / 60% / 35% / 15%) → bônus de cartas (somados, teto) → Ferida Profana → teto por uso → teto por segundo → vida máxima.
Bônus de dano acima de +25% não aumentam a cura. Objetivos e alvos imunes (Luas Falsas, Totens) não curam.

| Vampiro | antes | agora |
|---|---|---|
| Mordida: cura do dano | 35% (bruto, cada alvo) | 28% do dano válido, 1º alvo integral e extras 60/35/15% |
| Mordida: teto por uso | 34 | 24 |
| Teto de cura/s | 40 | 28 |
| Banquete: roubo de vida | 15% | 11% (respeita o teto por segundo) |
| Banquete: cura máx. da explosão | 36 | 24 |
| Vida | 125 | 125 (sem mudança: a sustentação foi corrigida primeiro) |
| Presas Afiadas | +8 dano, +6 teto | +6 dano, +3 teto |
| Banquete Longo | +3s | +1,5s |
| Redemoinho Faminto | +20% raio, -1s | +15% raio, -0,5s (teto de área) |

Simulação (bot sem esquiva, `tools/sim.ts vampire 20 <seed> --immortal`, 5 sementes, até a onda 20):
cura/min 196–240 → 156–181; cura/dano 0,78–0,81 → 0,54–0,67; tempo abaixo de 30% 4,5–7,1% → 9–17%.

### Ferida Profana (Acólito Sombrio)
Canaliza 0,9 s (símbolo sobre o alvo + linha até o Acólito), trava a mira nos últimos 7 ticks e lança um pulso reto
(230 px/s, 260 px, não teleguiado). Acerto: 0,75 s de bloqueio total, depois -70% de cura até 4 s. Não acumula,
só renova; recarga 11 s; nunca junto com a Marcha; dois Acólitos não miram o mesmo jogador. Prefere quem curou ≥ 6
nos últimos 3 s. Não afeta escudo, sacrifício, reviver, invulnerabilidade; some ao cair, na troca de onda e de mapa.

### Atordoamento (raro)
Pouso direto do Caçador de Névoa (0,5 s, a até 12 px do centro), golpe do Portador sem escudo (0,5 s, preparação maior)
e golpes de minichefes com telegraph longo (0,6 s). Máximo 0,75 s. Depois: 2,5 s de resistência (novos viram lentidão).

### Especiais (frequência média em 20 sementes, 1 jogador)
| até a onda | v1.2 (Acólito/Caçador/Portador) | v1.3 |
|---|---|---|
| 10 | 2 / 1 / 2 | 3,0 / 1,0 / 2,0 |
| 20 | 4 / 4 / 5 | 9,8 / 8,1 / 8,7 |
| 30 | 7 / 8 / 10 | 19,0 / 16,0 / 18,4 |
Ondas comuns 9–29 sem nenhum especial: 160/340 → 0/340. Limites solo 2/2/3, +1 a cada 2 jogadores extras.

### Missões
- Fogueira: vida 100 → 140; pressão por categoria (comum 1, elite 2,2, minichefe 3,5), rampa 0,6→1,6 em 6 s dentro da área,
  teto 10/s (solo), recuperação lenta após 2,5 s limpa; assaltos anunciados em 30% e 70% da onda.
- Altar: vida 80 → 120; teto 8/s; assalto a partir da onda 12; canalização à distância interrompível a partir da onda 12.
- Escolta: sobrevivente 120 → 150; regeneração só fora de combate (até 70%); 40% dos comuns caçam o sobrevivente;
  emboscadas anunciadas (2,5 s) em 30/60/85% da rota, a última mais pesada, com 5 s de calma entre elas.
- Estados SEGURO / AMEAÇADO / CRÍTICO no círculo e no HUD, com o número de inimigos pressionando.

### Lapanha (105 de vida, 100 de stamina, 32/s, velocidade 105)
- Básico: 18 no centro (11 px), 10 na borda (30 px), 9 de stamina, 260 px, 290 px/s, arco só visual.
- Q Melancia Madura: segura até 1,2 s; custo 3–12% da vida máxima (nunca abaixo de 1); dano 28–70, raio 36–58 px,
  curva de força ^0,7; chefes: metade do bônus e teto de 55 por lançamento; soltar antes da carga mínima não custa.
- E Casca Traiçoeira: 8 s, 7 s no chão, máx. 2; comuns escorregam 16 ticks e ficam +15% vulneráveis por 0,6 s;
  elites escorregam metade e ficam 25% lentos; minichefes e chefes só ficam lentos. E de novo: esmaga por 5% da vida (22 em 38 px).
- R Safra Abençoada: 8 s de regeneração, 4% a 6% da vida máxima por segundo (mais com pouca vida), +15% de velocidade
  de arremesso, custos de vida -25%, acerto central cura 2 (máx. 8/s); Ferida reduz normalmente; não gera Polpa.
- Polpa: centro 3, borda 1 (elite/chefe ×1,5), teto 8 por ação; sacrifício dá 0,5 por ponto de vida (máx. 6 por ação).

### Cartas
Raridades comum 60% · incomum 27% · rara 11% · lendária 2%; no máximo 1 lendária por build; nenhuma oferta repete família.
Tetos globais: recarga 25%, velocidade 15%, velocidade de ataque 12%, dano de cartas 30%, redução de dano 16%,
bônus de cura 20%, alcance 15%, área 30%.
