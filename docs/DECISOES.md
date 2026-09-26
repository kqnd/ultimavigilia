# Decisões registradas

Escolhas feitas onde a especificação deixava espaço. Os valores numéricos citados vivem nas
configurações tipadas de `src/shared/config/` e podem ser ajustados sem mexer na lógica.

## Arquitetura e rede

| Tema | Decisão | Motivo |
|---|---|---|
| Processo do servidor | `utilityProcess` do Electron executando `dist/server/server.cjs` (bundle esbuild com `ws` embutido), fora do asar (`asarUnpack`). | Isola a simulação da interface, não exige Node instalado e funciona empacotado. |
| Sockets | Tanto o servidor quanto o **cliente** WebSocket rodam em Node (processo main); o renderer recebe dados tipados por IPC. | Requisito de manter sockets fora do renderer e não relaxar a CSP. |
| Formato das mensagens | JSON com tuplas compactas para inimigos/projéteis/zonas; `PROTOCOL_VERSION` + versão do jogo no `hello`. | Simples de validar e depurar; ~6,7 KB por snapshot com ~100 inimigos (medido). |
| Frequências | Tick 30 Hz; snapshot a cada 2 ticks (15 Hz); renderização com meta de 60 FPS e interpolação. | Faixa pedida (15–20 Hz) no limite inferior para caber bem em VPN. |
| Clientes lentos | Se o buffer de envio passa de um limite, o snapshot da vez é descartado (fica obsoleto), mas os **eventos** continuam na fila e seguem no próximo; acima de um limite maior o cliente é desconectado. | Não acumula snapshots velhos e não perde dano/mortes/efeitos. |
| Eventos | IDs sequenciais por partida; o cliente ignora IDs já vistos. | Evita efeitos duplicados após reconexão/reenvio. |
| Validação de inputs | Até 8 inputs por mensagem, sequência monotônica (repetidos ignorados), faixas numéricas, limite de mensagens por segundo (balde de fichas) e tamanho máximo de 4 KB; abuso → desconexão. | Requisito de validar payload, sequência, frequência e limites. |
| Reconexão | Token de sessão de 60 s. Enquanto desconectado, o personagem fica parado e vulnerável; ao voltar, recebe estado completo. Durante a partida só entram tokens conhecidos. | Especificação. |
| Endereço para amigos | O lobby mostra o IP da interface escolhida; com “todas as interfaces”, mostra o primeiro IP real (Radmin primeiro). Nunca `0.0.0.0` nem `127.0.0.1`. | Especificação. |
| Solo | Servidor em `127.0.0.1`, porta aleatória, limite 1 jogador; Esc pausa a simulação. | Mesma simulação do multiplayer, sem abrir portas. |
| Anfitrião sai | O servidor envia `closing` com motivo a todos antes de fechar; não há migração de host. | Especificação. |
| Firewall | O diagnóstico orienta permitir o app (inclusive em rede **Pública**, que é como a Radmin costuma aparecer) ou liberar só a porta; nunca sugere desativar o firewall. | Causa mais comum de falha na Radmin. |

## Combate

| Tema | Decisão |
|---|---|
| Tempos | Golpes em ticks (antecipação → ativo → recuperação); hitbox só na janela ativa, com o arco e o alcance desenhados na arma e no telegraph. |
| Esquiva | 22 de stamina, 9 ticks de deslocamento, 7 ticks de invulnerabilidade, recarga curta; tudo calculado no servidor. Tank tem esquiva mais cara e curta. |
| Buffer de input | 7 ticks (~230 ms): um comando pressionado durante uma recuperação sai assim que possível. |
| Stagger | Poise por inimigo; chefes ganham 5 s de imunidade após um stagger. Controles (raiz, lentidão, puxão, provocação) têm retornos decrescentes numa janela de 6 s (cada novo controle vale 50% do anterior, mínimo 15%) e chefes têm resistência própria. |
| Aliados | Sem dano aliado e sem colisão entre jogadores. Inimigos se separam entre si e são afastados dos jogadores. |
| Hitstop | Apenas visual e local: congela as animações por 40–90 ms na tela de quem acertou um golpe forte; posições continuam interpoladas e o servidor nunca para. |
| Suprema | Carrega por dano causado, controle de grupo, reviver, dano recebido e (Tank) bloqueios. |
| Fraquezas | Caçador cercado por 4+ inimigos a ≤52 px recebe +25% de dano; Mago e Dog têm pouca vida; Vampiro não regenera sozinho e a cura é limitada por segundo; Guerreiro fica exposto ao errar aparos. |

## Conteúdo e ritmo

| Tema | Decisão |
|---|---|
| Arena | 64 × 40 tiles de 32 px (2048 × 1280): praça de pedra com fogueira no centro, casas a oeste, ruínas ao norte, cemitério com mausoléu a nordeste, bosque de árvores retorcidas ao sul, estradas e portões nas bordas para os spawns. |
| Ondas | Orçamento de pontos por onda (`waves.ts`), grupos com aviso visual de 1,2 s, distância mínima de 220 px dos jogadores, limite simultâneo por onda e teto absoluto de 110. |
| Escala por jogadores | Calculada no início de cada onda: orçamento × (1 + 0,7 por jogador extra), vida +30% por jogador extra (chefes +85%), +7% de vida e +5% de dano por onda. |
| Inimigos presos | Um vigia detecta inimigos sem progresso e os reposiciona num portão; a navegação usa campo de fluxo sobre o mesmo mapa da colisão. |
| Intervalo | 30 s. Termina antes se todos escolherem. Quem não escolher recebe a **primeira** das três opções. Vivos recuperam 35% da vida; mortos voltam com 60%. |
| Melhorias | 9 gerais + 4–5 por classe, com limites de acúmulo; o sorteio nunca oferece duplicatas nem melhorias já no máximo. O texto mostra o valor exato e o acúmulo atual. |
| Caído | 22 s sangrando; um aliado revive segurando F por 3 s a até 44 px; qualquer dano no reanimador interrompe. Quem morre observa aliados (clique troca o alvo) e volta na próxima onda. |
| Duração | Simulação com bots (sem intervalos): ~14 min solo e ~17 min com 6 jogadores de combate; somando intervalos, a partida fica na faixa de 15–25 min. Bots jogam pior que pessoas, então os tempos são um limite superior aproximado. |
| Humor | O Pai de Família grita frases curtas (“VOU CONTAR ATÉ TRÊS!”) de vez em quando e arremessa chinelos com trajetória anunciada; o restante mantém o tom sombrio. |

## Apresentação

| Tema | Decisão |
|---|---|
| Arte | Tudo desenhado como matrizes de pixels em `src/art/` e montado em sprite sheets na inicialização (reproduzível, sem arquivos temporários). `npm run sprites` exporta os PNGs para `assets/sprites`. |
| Animações | Idle, andar e ataque em 3 direções (lateral espelhada = 4 direções), habilidade, dano, esquiva e queda em 3 quadros (joelhos cedem → tomba → caído). Armas desenhadas à parte e giradas para a mira. |
| Escala | Resolução lógica 640 × 360. Padrão “inteira (nítida)”: maior fator inteiro que cabe, tolerando até 2% de corte (uma janela de 1919 × 1079 usa 3×); o resto vira letterbox. Opção “preencher janela” usa fator fracionário. Abaixo de 640 × 360, reduz proporcionalmente. |
| Fonte | Fonte pixelada própria com acentos do português, usada no Phaser (bitmap) e na interface DOM (TTF gerado). O zero não tem barra/ponto, para não parecer “8” em tamanho pequeno. |
| Interface | Menus em DOM dentro de uma caixa lógica de 640 × 360 com a mesma escala do canvas; HUD em Phaser. |
| Áudio | Síntese procedural em WebAudio; barramentos separados para efeitos, ambiente, interface e alertas; alertas abaixam os efeitos (ducking) e há limite de vozes por som. |
| Acessibilidade | Controles de tremor de câmera e intensidade de flashes (0–100%), números de dano opcionais, remapeamento de teclas. |

## v0.2

| Tema | Decisão |
|---|---|
| Autoridade | Tudo o que é novo (quebráveis, itens, cadáveres, Essência, servos, afixos, eventos, desafios, rotas, capítulos) é decidido no servidor e só espelhado no snapshot (`m`, `it`, `bk`, `w.ev`, `w.cg`, `w.bo`). |
| Mapas por capítulo | Cada mundo usa um **clone** do mapa (obstáculos mutáveis). Quebrar uma caixa libera o tile no servidor; o cliente aplica a lista `bk` ao próprio clone, então a predição, a colisão e as linhas de tiro continuam idênticas nos dois lados. |
| Troca de capítulo | Acontece no **início** da viagem (9 s). O servidor limpa entidades, reposiciona jogadores nos inícios livres e só então libera a onda; o cliente troca o mapa ao ver `w.mp` mudar, por baixo da cinemática. |
| Climas | Os inimigos "se adaptam" com multiplicadores simples e legíveis (vida, velocidade, efeito ao acertar) e ignoram o chão lento do próprio capítulo; a tempestade é periódica e anunciada no HUD. As variantes de cor dos inimigos (inverno/cinzas) são recolorações das mesmas matrizes. |
| Cinemática | Cena Phaser separada, desenhada proceduralmente em pixel art (céu, montanhas/dunas, árvores, chão e marco de chegada por clima), com barras de cinema e cartão no estilo dos banners do HUD. Não usa assets externos. |
| Servos | Um único tipo de entidade (`Minion`) para servos, horda e sobrevivente da escolta; os inimigos escolhem entre jogador e servo por distância (`Target`). Limites por dono e global (16); dano da horda em chefes é multiplicado e tem teto por conjuração. |
| Melhorias | Confirmação explícita no cliente; o servidor aceita uma escolha por intervalo e valida bifurcações (`canTake`). No tempo esgotado, primeira opção válida. |
| Rotas | Empate e ausência de votos resolvem para a Rota Segura (não pune quem não votou). |
| Escala | O crescimento por onda reinicia a cada capítulo sobre um degrau maior (vida ×1/×1,3/×1,6), para 30 ondas não virarem esponjas de vida. |
| Chefes | Os objetivos (luas/totens) mudam a luta: o chefe resiste enquanto eles existem e fica exposto/entra na fase 2 quando caem. O Patriarca perdeu vida base (4300 → 3400) porque a proteção dos totens já alonga a luta. |

