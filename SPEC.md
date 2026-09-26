# ÚLTIMA VIGÍLIA — Especificação rastreável

Jogo desktop 2D top-down cooperativo (1–6 jogadores) de sobrevivência por hordas, combate inspirado em soulslikes, pixel art, TypeScript + Electron + Phaser + ws.

Prioridades (em ordem): **multiplayer funcionando → qualidade do combate → identidade visual → variedade de conteúdo.**

Cada requisito tem um ID. `TASKS.md` referencia estes IDs e registra o estado e a evidência (teste, captura ou verificação manual).

---

## 1. Escopo da versão 0.1

| ID | Requisito |
|---|---|
| ESC-01 | Uma arena completa (vila amaldiçoada: praça, cemitério, ruínas, árvores retorcidas, fogueira central). |
| ESC-02 | Seis classes jogáveis desde o início (Caçador, Mago, Tank, Vampiro, Guerreiro, Dog). **v0.2:** sete classes — Guerreiro substituído pelo Berserker; Necromante adicionado (V2-03, V2-15). |
| ESC-03 | Cinco arquétipos de inimigos (Zumbi Cambaleante, Zumbi Corredor, Lobisomem, Acólito Corrompido, Pai de Família Amaldiçoado). |
| ESC-04 | Dez ondas; chefes nas ondas 5 (Devorador da Lua) e 10 (Patriarca do Abismo). |
| ESC-05 | Melhorias escolhidas entre ondas. |
| ESC-06 | Lobby, seleção de classe, vitória, derrota e jogar novamente sem reiniciar o aplicativo. |
| ESC-07 | Modo solo usando exatamente a mesma simulação e o mesmo servidor do multiplayer (em loopback). |
| ESC-08 | Aplicativo Electron empacotável para Windows (sem Node.js nem terminal para o jogador). |
| ESC-09 | Meta de duração: 15–25 min por partida (meta de design; ajustada em testes). |

## 2. Direção de arte

| ID | Requisito |
|---|---|
| ART-01 | Pixel art em todos os elementos: personagens, cenário, animações, efeitos, ícones, interface. |
| ART-02 | Paleta controlada: azul profundo, cinza frio, roxo escuro, vermelho sangue, âmbar de fogo. |
| ART-03 | Silhuetas distintas por classe e inimigo. |
| ART-04 | Fundo menos contrastado; personagens, perigos e itens se destacam. |
| ART-05 | Detalhes ambientais animados: tochas, folhas, brasas, névoa pixelada. |
| ART-06 | Ordenação por posição dos pés (y-sort). |
| ART-07 | Objetos altos ficam semitransparentes quando escondem o jogador. |
| ART-08 | Tiles 32×32; resolução lógica 640×360; ampliação inteira quando possível; letterboxing; nearest-neighbor; `pixelArt: true` no Phaser. |
| ART-09 | Câmera individual suave; arredondamento apenas na renderização. |
| ART-10 | Cada classe: idle, movimento (≥4 direções), ataque, habilidade, dano, queda. Mira visível. |
| ART-11 | Efeitos de impacto: flashes, partículas pixeladas, arcos de arma, rastros, tremor de câmera. |
| ART-12 | Opções para reduzir tremor e flashes. |
| ART-13 | Todos os assets locais, originais, gerados por matrizes de pixels reproduzíveis (sem temporários). |

## 3. Combate e controles

| ID | Requisito |
|---|---|
| CMB-01 | Controles padrão WASD / mouse / LMB / Espaço / Q / E / R / F / Tab / Esc, com remapeamento. |
| CMB-02 | Vida e stamina para todos; custos coerentes de ataque, esquiva e bloqueio. |
| CMB-03 | Cooldowns por habilidade; suprema carrega por dano, proteção e controle de grupo. |
| CMB-04 | Hitboxes coerentes com a animação; antecipação → janela ativa → recuperação. |
| CMB-05 | Esquiva com invulnerabilidade breve calculada pelo servidor. |
| CMB-06 | Buffer curto de inputs e feedback imediato. |
| CMB-07 | Aparos (Guerreiro) e bloqueios (Tank). **v0.2:** aparo removido junto com o Guerreiro; bloqueio do Tank mantido. |
| CMB-08 | Stagger e resistência a controle; chefes não podem ser travados indefinidamente. |
| CMB-09 | Alcance/direção legíveis nos golpes corpo a corpo. |
| CMB-10 | Telegraphs claros para investidas, explosões e ataques fortes. |
| CMB-11 | Sem dano aliado; aliados não bloqueiam uns aos outros. |
| CMB-12 | Hitstop apenas visual e local; a simulação compartilhada não para. |
| CMB-13 | Comuns morrem rápido; elites e chefes exigem leitura de padrões. |

## 4. Classes

| ID | Requisito |
|---|---|
| CLS-01 | Uma pessoa por classe; servidor resolve disputas simultâneas e informa ocupação; troca apenas no lobby. |
| CLS-02 | Caçador: besta; Armadilha de Prata; Recuo Preciso; Chuva de Prata; passiva Presa Marcada; fraqueza cercado. |
| CLS-03 | Mago: projétil arcano; Selo Glacial; Passo Etéreo (destino validado); Ruptura Arcana; passiva Convergência; fraqueza vida baixa. |
| CLS-04 | Tank: maça; Guarda de Ferro (segurar; quebra de guarda); Provocação (aggro; chefes resistem); Bastião; passiva Muralha. |
| CLS-05 | Vampiro: garras em sequência; Mordida (cura ao acertar); Névoa Rubra; Banquete; passiva Sede (limite de acúmulos). |
| CLS-06 | ~~Guerreiro~~ **v0.2: Berserker** — combo de machado (3º golpe amplo e lento), Q Rasgo Frenético, E Salto Brutal, R Loucura (com custo: +dano recebido e exaustão), passiva Fúria. |
| CLS-07 | Dog (criança humana): grito em cone; Pulso Magnético (interrompe habilidades vulneráveis); Polaridade; GRITO DO FIM (3 pulsos, destrói projéteis); passiva Ressonância. Sem microfone. |
| CLS-08 | Todos os números (dano, alcance, cooldown, stamina, duração, limites) centralizados em configurações tipadas (`src/shared/config/`). |
| CLS-09 | Sinergias emergentes; toda classe joga solo. |

## 5. Inimigos, ondas e chefes

| ID | Requisito |
|---|---|
| ENM-01 | Cinco arquétipos com comportamentos distintos (cerco, investida antecipada, salto contornando obstáculos, ataque à distância, golpes pesados + chinelo anunciado). |
| ENM-02 | Devorador da Lua (onda 5): saltos, golpes em arco, mudança de padrão. |
| ENM-03 | Patriarca do Abismo (onda 10): ataques de área, reforços limitados, segunda fase. |
| ENM-04 | Diretor de ondas: composições, orçamento, limite de unidades simultâneas, escala por nº de jogadores no início da onda. |
| ENM-05 | Spawns com aviso visual e distância segura. |
| ENM-06 | Navegação por toda a arena contornando obstáculos. |
| ENM-07 | Onda termina quando todos os obrigatórios morrem; proteção contra inimigos presos/fora do mapa. |

## 6. Ciclo e cooperação

| ID | Requisito |
|---|---|
| LOOP-01 | menu → criar/entrar → lobby → classe → pronto → combate → melhorias → próxima onda → vitória/derrota → jogar novamente. |
| LOOP-02 | 3 melhorias sorteadas pelo servidor por jogador; gerais + de classe; ≥3 por classe; valores exatos; limites de acúmulo; sem duplicatas indevidas. |
| LOOP-03 | Próxima onda quando todos prontos ou contador termina; escolha padrão para quem não selecionar. |
| LOOP-04 | Caído por tempo limitado; reviver segurando F; dano interrompe; mortos observam e voltam na próxima onda. |
| LOOP-05 | Todos incapacitados = derrota; no solo, vida zero encerra. |
| LOOP-06 | Indicadores de aliados fora da tela; ping de localização. |

## 7. Multiplayer (host, LAN, Radmin VPN)

| ID | Requisito |
|---|---|
| NET-01 | Host executa o servidor e joga como cliente normal. Amigos conectam por IP (LAN / Radmin VPN). |
| NET-02 | 1–6 jogadores. Botões “Criar partida” e “Entrar por IP”. |
| NET-03 | Porta TCP configurável (padrão 7777). |
| NET-04 | Lista interfaces IPv4 para o host escolher; botão copiar IP:porta; nunca mostrar 0.0.0.0/localhost para amigos. |
| NET-05 | Solo vincula ao loopback; multiplayer vincula à interface escolhida ou a todas (opção explícita). |
| NET-06 | Sem descoberta automática de salas. |
| NET-07 | Apelido, classe, pronto, limite de jogadores, senha opcional; só o host inicia. |
| NET-08 | Novos jogadores apenas no lobby; durante a partida apenas reconexões. |
| NET-09 | Servidor autoritativo (posições, colisões, inimigos, ondas, dano, vida, recursos, cooldowns, melhorias, resultados). |
| NET-10 | Clientes enviam apenas intenções; validação de payload em runtime, sequência, frequência e limites. |
| NET-11 | IDs estáveis, ticks e eventos identificados (sem efeitos duplicados). |
| NET-12 | Tick 30 Hz, snapshots 15 Hz, render meta 60 FPS. |
| NET-13 | Predição de movimento local, reconciliação, interpolação dos demais. |
| NET-14 | ws no lado Node; filas de envio; clientes lentos não acumulam snapshots obsoletos; eventos essenciais nunca descartados. |
| NET-15 | Heartbeat, timeout, reconexão até 60 s com identidade de sessão; estado completo ao reconectar. |
| NET-16 | Host saindo encerra a sessão dos demais com mensagem clara. |
| NET-17 | Erros compreensíveis: IP inválido, porta ocupada, sala cheia, senha errada, versão incompatível, conexão perdida; diagnóstico sugere VPN/firewall sem mandar desativar firewall. |
| NET-18 | Documentação LAN/Radmin; sem prometer IP público. |

## 8. Stack e arquitetura

| ID | Requisito |
|---|---|
| ARQ-01 | TypeScript strict; Electron; Phaser; Node + ws; Vite; electron-builder. |
| ARQ-02 | Separação main / preload / renderer / server / shared / assets. |
| ARQ-03 | Servidor em `utilityProcess`, sem DOM/Phaser. |
| ARQ-04 | Mesma geometria de mapa e mesma colisão na simulação e na apresentação. |
| ARQ-05 | contextIsolation + sandbox ativos, nodeIntegration off, CSP, preload mínimo e validado, IPC com remetente validado, navegação externa bloqueada. |
| ARQ-06 | Sockets só no Node; renderer recebe dados tipados. |
| ARQ-07 | Servidor, dependências e assets incluídos no pacote; encerramento limpo de conexões e processos. |

## 9. Interface e áudio

| ID | Requisito |
|---|---|
| UI-01 | Interface pixelada integrada ao jogo, inteiramente em pt-BR. |
| UI-02 | Seleção de classe com sprite animado, função, habilidades, dificuldade, aviso de ocupação. |
| UI-03 | HUD: vida, stamina, cooldowns, suprema, onda, inimigos restantes, aliados. |
| UI-04 | Feedback para recarga, stamina insuficiente, interação fora de alcance. |
| UI-05 | Configurações: volume, tela cheia, resolução, controles, tremor, flashes — salvas localmente. |
| UI-06 | Esc pausa só no solo; perder foco limpa inputs. |
| AUD-01 | Sons distintos (golpes, esquiva, bloqueio, gritos, dano, habilidades, início de onda, alertas) com mixagem priorizando avisos. |

## 10. Validação

| ID | Requisito |
|---|---|
| VAL-01 | Disputa de classe entre dois clientes. |
| VAL-02 | Dano/cooldown/esquiva confirmados no servidor. |
| VAL-03 | Desconexão, reconexão, fechamento do host. |
| VAL-04 | Vitória, derrota, reviver, reinício sem estado residual. |
| VAL-05 | Inputs repetidos, payloads inválidos, versão incompatível. |
| VAL-06 | Movimento sob latência simulada. |
| VAL-07 | Duas instâncias locais com perfis separados. |
| VAL-08 | Medição com 6 clientes e ~100 inimigos (hardware e resultados registrados). |
| VAL-09 | Inspeção visual em resoluções diferentes. |
| VAL-10 | README com comandos reais e roteiro de validação entre dois computadores via Radmin. |

---

## 11. Versão 0.2 (pedido de 15 itens)

O servidor continua sendo a autoridade para dano, drops, cura, objetivos, escolhas e progressão;
solo e multiplayer usam o mesmo código. Números em `BALANCEAMENTO.md`.

| ID | Requisito |
|---|---|
| V2-01 | Caixas e barris destrutíveis com chance configurável de item de cura (cura só a vida atual, sincronizado, coleta única, efeito + número, limite no chão); destruídos não bloqueiam movimento, navegação nem tiros. |
| V2-02 | Mais falas do Pai de Família (32), sem repetir a anterior. |
| V2-03 | Berserker substitui o Guerreiro em todo o jogo (código, arte, ícones, textos, melhorias, testes e docs). |
| V2-04 | Mordida do Vampiro em cone com mais alcance/dano/cura e tetos por uso e por segundo. |
| V2-05 | Pulso do Dog mais responsivo (menos preparação/recuperação, movimento parcial), sem lentidão. |
| V2-06 | 30 ondas em 3 capítulos com mapas e climas distintos, transição com pausa, cinemática, troca real de mapa, reposicionamento seguro, limpeza de entidades e o mesmo mapa ativo em servidor e clientes; curva sustentável; novos títulos, composições, chefes e minichefes. |
| V2-07 | Apelidos legíveis acima dos personagens (contorno/fundo, local destacado, seguem queda/morte/observação). |
| V2-08 | Confirmação de melhoria (destacar → confirmar → travado), escolha automática no tempo, validação no servidor, sem confirmação dupla, aplicação só no fim, contagem de prontos sincronizada. |
| V2-09 | Luas Falsas do Devorador (reduzem defesa quando destruídas, telegrafadas, com contra-jogo) e 3 Totens do Patriarca (protegem até caírem, depois fase distinta). |
| V2-10 | Afixos de elite (Sangrento, Blindado, Furioso): configuráveis, sincronizados, visíveis, um por inimigo, recompensa melhor. |
| V2-11 | Eventos de onda (fogueira, ritual, escolta, carrinho) com estado no servidor, HUD de progresso/tempo e efeito em recompensa/dificuldade. |
| V2-12 | Bifurcações de melhorias mutuamente exclusivas, validadas no servidor, com incompatibilidade na interface. |
| V2-13 | Escolha de rota entre capítulos com votação, tempo limite e regra de empate; muda algo relevante. |
| V2-14 | Desafios opcionais no HUD com recompensa (carta extra, recurso de rota/suprema, cura), nunca obrigatórios. |
| V2-15 | Necromante: Essência, Rajada Óssea, Erguer Morto, Mão da Sepultura, Exército dos Sem Nome; servos autoritativos com limites e limpeza (onda, queda, mapa, vitória/derrota, desconexão); melhorias Senhor dos Mortos / Ceifador de Almas / Ritualista. |
| V2-16 | Manter o padrão visual da interface e da pixel art existentes. |

## Decisões registradas (escolhas razoáveis onde a especificação era aberta)

Ver `docs/DECISOES.md` para a lista completa e justificativas; resultados de testes em `docs/TESTES.md`.
