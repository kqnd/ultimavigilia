# Testes, medições e roteiros de validação

Registro honesto do que foi verificado, onde e com quais resultados — e do que ainda depende
de outro ambiente. Rodadas: v0.1 em 25/09/2026; v0.2 em 26/09/2026 (seções marcadas **v0.2**).

**Ambiente de verificação:** contêiner Linux (Ubuntu 24.04, kernel 6.18), Intel Xeon @ 2,80 GHz,
2 núcleos, 8 GB de RAM, **sem GPU** (WebGL por software: ANGLE/Mesa llvmpipe), Node 22.22.2,
Electron 44.4.5, tela virtual Xvfb 1920×1080.

## 1. Testes automatizados — `npm test` (67/67 passando na v0.2)

| Arquivo | O que cobre |
|---|---|
| `tests/net.test.ts` | Servidor `ws` real com clientes reais: **v0.2** — servos no snapshot dos dois clientes, carta confirmada (segunda ignorada), votação empatada → Rota Segura, fase de viagem com capítulo 2/mapa 1 e servos limpos; disputa simultânea da mesma classe (um vence, o outro recebe `clsDenied`); recusa por versão incompatível, senha errada e sala cheia com motivo; só o anfitrião inicia e só com todos prontos; payloads inválidos ignorados e cliente abusivo desconectado; duas conexões vendo o mesmo estado, movimento validado e inputs repetidos ignorados; recarga e esquiva confirmadas pelo servidor; desconexão → reconexão preservando classe e estado com snapshot completo; anfitrião encerrando avisa os demais; vitória/derrota → jogar novamente sem estado residual; pausa só no solo. |
| `tests/latency.test.ts` | Predição + reconciliação contra o servidor real com 120 ms de ida e volta simulados: posição prevista converge com a autoritativa. |
| `tests/world.test.ts` | As 7 classes: básico, Q, E e R causam efeito, recarga e suprema negadas quando indevidas; i-frames da esquiva; bloqueio frontal e quebra de guarda do Tank; Fúria/Loucura/exaustão do Berserker; resistência de chefes e retornos decrescentes; Pulso Magnético interrompe acólito e não chefe; sem dano aliado; reviver e interrupção por dano; derrota (todos caídos / solo); caído sangra e volta na próxima onda; **30 ondas em 3 capítulos → vitória** (votações, viagens, três mapas, três chefes, carta confirmada sem confirmação dupla, reinício limpo); sorteio de melhorias; inimigo preso reposicionado; 3 ondas com bots em todas as classes sem exceções. |
| `tests/shared.test.ts` | Mapa (64×40, spawns livres, portões alcançáveis), colisão sem atravessar paredes, stamina/recarga da esquiva, validação do protocolo, limpeza de apelidos, contagem de conteúdo (7 classes sem Guerreiro, 30 ondas, chefes em 10/20/30), **os três mapas** (inícios livres, portões alcançáveis, quebráveis indexados, pontos de objetivo livres), chão lento na predição compartilhada e normalização das configurações salvas. |
| `tests/v02.test.ts` (**v0.2**) | Caixas/barris: quebra libera o tile, item cura só a vida atual, coleta única, limite de 6, ataques quebram no alcance. Mordida em cone (3 alvos) com teto por uso e por segundo; Pulso do Dog responsivo. Necromante: Essência (perto/longe, elite, teto, queda de aliado não conta), Erguer Morto nega sem Essência/cadáver e sacrifica o mais antigo no limite, servos atacam/atraem/expiram e não seguram a onda, limpeza na queda/desconexão/troca de mapa/derrota, Exército consome Essência com teto de unidades e de dano em chefe, limite global de invocações. Bifurcações (oferta e validação). Afixos (chance, Sangrento, Blindado). Eventos (ritual falha/sucesso, carrinho), desafio "ninguém cai". Capítulos (troca de mapa segura) e votação (maioria, empate e sem votos = segura). Luas Falsas e Totens. |

`npm run typecheck` (TypeScript strict, processos Node e web separados): sem erros.

## 2. App Electron real — `tools/e2e.mjs` (Playwright + Xvfb)

| Cenário | Resultado |
|---|---|
| `menu` | Abre, menu funcional, sem erros no console. |
| `showcase <classe>` ×6 | Básico, Q, E e R de cada classe executados com teclado/mouse reais; capturas inspecionadas. |
| `enemies` | Os 5 inimigos em cena, telegraphs de investida/golpe/chinelo e fala do Pai de Família. |
| `boss 5` / `boss 10` | Devorador da Lua e Patriarca do Abismo com barra de chefe; telegraph em arco do Devorador. |
| `duo` | **Duas instâncias com perfis separados**, uma cria a sala na interface de rede (endereço mostrado `192.0.2.2:7777`, nunca 0.0.0.0/localhost), a outra entra por IP; disputa simultânea pelo Dog → um fica com a classe e o outro vê “Dog já está ocupado por …”; ambos se movem e **veem posições idênticas**; anfitrião fecha → o convidado volta ao menu com “Partida encerrada — O anfitrião fechou o jogo.” |
| `duo` com `E2E_EXE` | O mesmo cenário contra o **app empacotado** (`release/linux-unpacked`, mesmo asar e `asarUnpack` do pacote Windows): servidor em utilityProcess sobe a partir de `app.asar.unpacked` e tudo funciona. |
| `flow` | Onda 1 → intervalo com 3 melhorias → **carta destacada → Confirmar escolha** → Tab (equipe) → Esc (pausa solo) → onda 30 → **vitória** com tempo e estatísticas → **Jogar novamente** → nova partida limpa (onda 1, vida cheia). |
| `solo necromancer` (**v0.2**) | Lobby com 7 classes (Necromante centralizado), HUD com Essência e servos, apelido legível. |
| `showcase berserker/necromancer/vampire` (**v0.2**) | Combo e arco do 3º golpe, Rasgo Frenético, Salto com pouso telegrafado, Loucura; Rajada Óssea, Mão da Sepultura (telegraph e mãos), Exército; Mordida em cone. |
| `necro` (**v0.2**) | Cadáveres visíveis, servo erguido, exército distinguível dos inimigos (tons verde-osso). |
| `chapter 10 necromancer` (**v0.2**) | Carta confirmada → votação de rota (painel no estilo da interface) → cinemática (barras, parallax, noite → nevasca, cartão "CAPÍTULO II", rota escolhida, portão do cemitério) → chegada ao mapa congelado com inimigos recoloridos e afixo "Sangrento" visível. |
| `wave 12/21/30` (**v0.2**) | Painel de evento (ritual com tempo), mapa da mansão (cap. III), Patriarca com "Totens 3/3" no HUD. |
| `sizes` | 960×540 → 1×; 1366×768 → 2× com letterbox; 1919×1079 → 3× (tolerância de 2%); 800×600 → 1×. HUD inteiro visível em todas. |
| `perf` | Ver §3. |

Correções feitas a partir da inspeção visual: rótulos da barra de habilidades cortados na borda
inferior; janela de 1919×1079 caindo para 2×; zero da fonte parecendo “8”; queda sem transição.

## 3. Desempenho

**Servidor — `npm run bench` (6 clientes WebSocket reais em loopback, alvo de 100 inimigos, 30 s):**

| Métrica | Resultado |
|---|---|
| Inimigos ativos (média) | 103 |
| Tempo de tick médio | 1,6 ms (orçamento: 33,3 ms) |
| Tempo de tick p95 / pior segundo | ~9–10 ms / ~16 ms |
| Snapshots por cliente | 15/s |
| Tamanho médio do snapshot | ~6,7 KB |
| Tráfego por cliente | ~105 KB/s (~0,85 Mbit/s) |
| Maior atraso do laço de eventos | ~10 ms |

**Cliente — cenário `perf` (~105 inimigos na tela e ao redor, 10 s de combate):**
mediana de **31 FPS** (mín. 30, máx. 36) com **renderização por software (llvmpipe)** em 2
núcleos que também rodavam o servidor e o Xvfb. Nas mesmas condições, a cena quase vazia fica
em ~40–45 FPS, então o limite observado é o renderizador sem GPU, não o número de inimigos.
**A meta de 60 FPS não foi comprovada aqui**: exige medição num PC com GPU (roteiro §4, passo 6).

**Duração (`npm run simulate`, bots invulneráveis, intervalo reduzido a 2 s):**
solo Guerreiro 14,1 min de combate; 6 classes 16,7 min. Com intervalos reais (até 30 s cada),
estimativa de 15–22 min. Bots posicionam-se pior que pessoas.

## 4. Roteiro — validação no Windows (pendente)

O pacote Windows (`UltimaVigilia-0.1.0-Instalador.exe` e `UltimaVigilia-0.1.0-Portatil.exe`,
~111 MB cada) foi **gerado e inspecionado** (conteúdo do asar e servidor fora do asar),
mas **não executado**: o Chromium do Electron não roda sob Wine (falha de página ao iniciar),
e não havia Windows disponível. Em um PC Windows 10/11 x64:

1. Rodar o instalador → atalhos criados → o jogo abre no menu (sem Node.js instalado).
2. Rodar o portátil numa pasta qualquer → abre igual.
3. **Jogar sozinho** com duas classes diferentes até a onda 2; Esc pausa.
4. **Criar partida** → o Firewall do Windows pergunta → permitir (Privada e Pública).
5. Configurações: mudar volume, tela cheia, tamanho da janela, escala, uma tecla → fechar e
   reabrir o jogo → valores mantidos.
6. Medir FPS (canto superior esquerdo) numa onda cheia e anotar GPU/CPU e o valor aqui.
7. Fechar o jogo durante uma partida hospedada → nenhum `UltimaVigilia.exe` sobra no Gerenciador de Tarefas.
8. Duas instâncias no mesmo PC: `UltimaVigilia.exe --profile=a` e `--profile=b` (atalho com
   argumento) → uma cria a sala na **Rede local**, a outra entra por `IP:7777`.

## 5. Roteiro — dois computadores via Radmin VPN (pendente)

Um teste em localhost **não** comprova a conexão entre dois computadores. Para validar:

| # | Passo | Esperado |
|---|---|---|
| 1 | PC A e PC B instalam a mesma versão do jogo e a Radmin VPN. | — |
| 2 | A cria uma rede na Radmin; B entra nela. | Ambos online (ponto verde). |
| 3 | B clica com o botão direito em A → **Ping**. | Respostas com latência. Se falhar, é problema de VPN, não do jogo. |
| 4 | A: **Criar partida**, interface **Radmin VPN** (`26.x.x.x`), porta 7777, senha `teste`. Permitir no firewall (Privada **e** Pública). | Lobby abre com `26.x.x.x:7777`. |
| 5 | B: **Entrar por IP** com senha errada. | “Senha incorreta.” |
| 6 | B: entra com a senha certa. | B aparece na lista de A. |
| 7 | A e B clicam na mesma classe quase juntos. | Só um fica com ela; o outro recebe aviso. |
| 8 | Ambos prontos → A inicia. Jogar 2 ondas andando, esquivando, usando habilidades. | Movimento local fluido; inimigos, dano e mortes iguais nas duas telas. |
| 9 | B cai em combate; A segura F perto dele. | Barra de reviver enche; B volta com 40% da vida. |
| 10 | B desativa a rede (ou desconecta da Radmin) por ~20 s e reativa. | A vê “desconectou”; B reconecta sozinho com classe e estado. |
| 11 | B fecha o jogo e abre de novo durante a partida, tentando entrar. | Recusado: “A partida já começou…” |
| 12 | A fecha o jogo. | B volta ao menu com “O anfitrião fechou o jogo.” |
| 13 | Repetir com 3–6 pessoas até o fim da onda 5 (chefe). | Anotar RTT (canto superior esquerdo) e qualquer engasgo. |

Resultados: preencher aqui (data, versões do Windows, ping médio da Radmin, observações).

## 5b. Simulações da campanha v0.2 (`npm run simulate`)

| Composição | Resultado |
|---|---|
| Berserker (bot solo) | vitória na onda 30, ~41 min simulados |
| Necromante (bot solo) | vitória na onda 30, ~31,5 min simulados; ondas de 30–98 s; Patriarca 287 s |
| 7 classes a partir da onda 18 | vitória; Noiva do Inverno é a onda mais longa |
| Caçador + Vampiro + Tank | chegou à onda 17 dentro do limite de 60 min simulados (bots lentos; sem falhas) |

## 6. Limitações conhecidas

- Sem migração de host: se o anfitrião sair, a partida termina (conforme a especificação).
- O executável não é assinado; o SmartScreen pode pedir confirmação.
- Conexão apenas em LAN ou rede virtual (Radmin); sem descoberta de salas nem NAT traversal.
- Balanceamento ajustado com bots e testes curtos; precisa de partidas reais para refinar
  (os números estão centralizados em `src/shared/config/` e explicados em `BALANCEAMENTO.md`).
- v0.2: o executável distribuído continua sendo o da v0.1 (pedido explícito de não gerar/publicar
  pacote). Clientes v0.1 e v0.2 não se conectam entre si (protocolo 2).
