# TASKS — Última Vigília

Legenda: `[ ]` pendente · `[~]` parcial / depende de outro ambiente · `[x]` concluído com evidência.
IDs referem-se a `SPEC.md`. Evidências: **T** = teste automatizado (`npm test`), **E2E** = cenário do
app Electron real (`tools/e2e.mjs`), **B** = medição (`npm run bench`), **V** = inspeção visual de captura.
Detalhes e números em `docs/TESTES.md`.

## Etapa 1 — Estrutura Electron, arena e movimento
- [x] T1.1 Estrutura main/preload/renderer/server/shared/art, build Vite + esbuild (ARQ-01, ARQ-02) — `npm run build`
- [x] T1.2 Mapa compartilhado 64×40 tiles de 32 px e colisão única cliente/servidor (ARQ-04, ESC-01) — T `shared.test.ts › mapa e colisão`
- [x] T1.3 Movimento compartilhado com deslizamento em paredes (NET-13) — T `movimento rápido não atravessa paredes`
- [x] T1.4 Janela segura: contextIsolation, sandbox, sem nodeIntegration, CSP, IPC com remetente validado, navegação bloqueada, URL de dev ignorada no app empacotado (ARQ-05)

## Etapa 2 — Host e dois clientes reais
- [x] T2.1 Protocolo tipado + validação runtime + versão (NET-10, VAL-05) — T `rejeita payloads inválidos`, `versão incompatível…`
- [x] T2.2 Lobby: apelido, senha, limite, pronto, só o anfitrião inicia (NET-02, NET-07, NET-08) — T `só o anfitrião inicia`, E2E `duo`
- [x] T2.3 Disputa de classe resolvida pelo servidor (CLS-01, VAL-01) — T `dois clientes disputando a mesma classe`, E2E `duo`
- [x] T2.4 Servidor em utilityProcess; loopback no solo, interface escolhida ou todas (explícito) no multiplayer (ARQ-03, NET-05) — E2E `duo` no app empacotado
- [x] T2.5 Lista IPv4, copiar IP:porta, nunca 0.0.0.0/localhost para amigos, erros claros (NET-04, NET-17) — E2E `duo` (verifica o endereço exibido)
- [x] T2.6 Tick 30 Hz, snapshots 15 Hz, fila de envio que substitui snapshots obsoletos sem perder eventos (NET-12, NET-14) — B (15 snapshots/s/cliente)
- [x] T2.7 Predição + reconciliação + interpolação (NET-13, VAL-06) — T `latency.test.ts` (RTT 120 ms)
- [x] T2.8 Heartbeat, timeout, reconexão 60 s, host encerrando (NET-15, NET-16, VAL-03) — T `desconexão e reconexão…`, `anfitrião encerrando…`, E2E `duo`

## Etapa 3 — Combate autoritativo, inimigos e ondas
- [x] T3.1 Antecipação/ativa/recuperação; hitboxes em arco/círculo/projétil (CMB-04, CMB-09) — T `classes: habilidades confirmadas no servidor`
- [x] T3.2 Stamina, esquiva com i-frames no servidor, buffer de input (CMB-02, CMB-05, CMB-06) — T `i-frames da esquiva evitam dano`, `cooldown e esquiva confirmados pelo servidor`
- [x] T3.3 Stagger/poise, resistência a controle com retornos decrescentes (CMB-08) — T `chefes resistem a controle…`
- [x] T3.4 Campo de fluxo para navegação, anti-travamento (ENM-06, ENM-07) — T `todos os portões são alcançáveis`, `inimigo preso é reposicionado`
- [x] T3.5 Diretor de ondas com orçamento, limite simultâneo e avisos de spawn (ENM-04, ENM-05) — `tools/simulate.ts`, V

## Etapa 4 — Seis classes (v0.1; na v0.2 o Guerreiro foi substituído pelo Berserker e entrou o Necromante)
- [x] T4.1 Caçador (CLS-02) — T + E2E `showcase hunter`
- [x] T4.2 Mago (CLS-03) — T + E2E `showcase mage`
- [x] T4.3 Tank (CLS-04) — T `tank bloqueia pela frente e sofre quebra de guarda` + E2E
- [x] T4.4 Vampiro (CLS-05) — T + E2E
- [x] T4.5 ~~Guerreiro~~ → Berserker na v0.2 (CLS-06) — ver T7.4
- [x] T4.6 Dog (CLS-07) — T `Pulso Magnético interrompe acólito, mas não chefe` + E2E
- [x] T4.7 Config tipada central em `src/shared/config/` (CLS-08)

## Etapa 5 — Conteúdo e ciclo
- [x] T5.1 Cinco inimigos (ENM-01) — E2E `enemies`, V
- [x] T5.2 Devorador da Lua e Patriarca do Abismo com segunda fase (ENM-02, ENM-03) — E2E `boss 5`, `boss 10`
- [x] T5.3 Melhorias: sorteio no servidor, limites, escolha padrão (LOOP-02, LOOP-03) — T `sorteio de melhorias…`, `10 ondas → vitória, melhorias padrão aplicadas`
- [x] T5.4 Caído/reviver/espectador/retorno (LOOP-04) — T `reviver: caído, aliado segura F e dano interrompe`, `caído sangra até morrer e volta na próxima onda`
- [x] T5.5 Vitória/derrota/jogar novamente sem estado residual (LOOP-05, ESC-06, VAL-04) — T + E2E `flow`

## Etapa 6 — Arte, áudio, UI, otimização, empacotamento
- [x] T6.1 Gerador de pixel art por matrizes + exportação PNG em `assets/sprites` (ART-01..03, ART-13) — `npm run sprites`
- [x] T6.2 Arena: praça, cemitério, mausoléu, ruínas, casas, árvores, fogueira, tochas, névoa, luz (ART-04, ART-05) — V (`tools/map-preview.ts`)
- [x] T6.3 Y-sort e transparência de objetos altos (ART-06, ART-07)
- [x] T6.4 Animações de classes (idle, andar em 4 direções, ataque, habilidade, dano, esquiva, queda em 3 quadros) e inimigos; mira visível (ART-10) — V
- [x] T6.5 Efeitos de impacto + opções de tremor/flash; hitstop só local (ART-11, ART-12, CMB-12)
- [x] T6.6 Menus pixelados, seleção de classe, HUD, feedbacks (UI-01..04) — V (HUD reposicionado para não cortar rótulos)
- [x] T6.7 Configurações persistentes (inclui escala inteira/preencher), remapeamento, foco limpa inputs, pausa só no solo (UI-05, UI-06, CMB-01) — T `modo solo: pausa só no solo`, `configurações salvas`
- [x] T6.8 Áudio procedural com barramentos e ducking de alertas (AUD-01)
- [x] T6.9 Indicadores de aliados fora da tela + ping (LOOP-06)
- [x] T6.10 Broad-phase espacial, medição com 6 clientes e ~100 inimigos (VAL-08) — B, E2E `perf`
- [x] T6.11 electron-builder Windows: instalador NSIS + portátil gerados; servidor fora do asar (ESC-08, ARQ-07) — E2E `duo` com `E2E_EXE` no pacote Linux equivalente
- [x] T6.12 README, `docs/TESTES.md`, `docs/DECISOES.md`, roteiro Radmin (VAL-10, NET-18)

## Etapa 7 — v0.2 (itens 1–15 do pedido)
Prioridade 1
- [x] T7.1 Confirmação de melhoria: destacar → "Confirmar escolha" → travado; escolha automática da 1ª opção válida no fim do tempo; servidor recusa segunda confirmação e lados de bifurcação já excluídos (item 8) — T `bifurcações…`, `30 ondas…`, rede `v0.2 em rede…`, E2E `flow`/`chapter`
- [x] T7.2 Apelidos legíveis com contorno e fundo, local destacado, seguem queda/morte, contorno no observado (item 7) — V
- [x] T7.3 Pai de Família com 32 falas, sem repetir a anterior (item 2)
- [x] T7.4 Mordida do Vampiro em cone, tetos por uso e por segundo; Pulso do Dog mais responsivo (itens 4 e 5) — T `Mordida em cone…`, `Pulso do Dog…`
Prioridade 2
- [x] T7.5 Caixas/barris destrutíveis, item de cura sincronizado, coleta única, limite, navegação/tiros liberados (item 1) — T `caixas, barris e itens de cura` (3 testes)
- [x] T7.6 Berserker substitui o Guerreiro em código, arte, ícones, textos, testes e docs: Fúria, combo, Rasgo, Salto, Loucura, melhorias próprias (item 3) — T `berserker: fúria…`, `classes: habilidades…`, E2E `showcase berserker`
Prioridade 3
- [x] T7.7 Afixos Sangrento/Blindado/Furioso: config, sincronizados, visíveis, um por inimigo, recompensa (item 10) — T `afixos de elite`, V
- [x] T7.8 Eventos: fogueira, ritual, escolta, carrinho com estado no servidor e HUD (item 11) — T `ritual…`, `carrinho…`, E2E `wave 12`
- [x] T7.9 Bifurcações exclusivas validadas no servidor e explicadas na interface (item 12) — T `bifurcações de melhorias`
Prioridade 4
- [x] T7.10 30 ondas, 3 capítulos/mapas com climas (noite, nevasca, cinzas), horda adaptada, tempestades, chão lento compartilhado (item 6) — T `30 ondas em 3 capítulos…`, `mapas dos três capítulos`, `troca de capítulo…`
- [x] T7.11 Cinemática de viagem em pixel art (letterbox, parallax, troca de clima, grupo caminhando, cartão do capítulo) — E2E `chapter 10`
- [x] T7.12 Votação de rota com tempo e desempate seguro (item 13) — T `votação…`, rede `v0.2 em rede…`
- [x] T7.13 Desafios opcionais com recompensa (item 14) — T `desafio "ninguém cai"…`
- [x] T7.14 Luas Falsas do Devorador e Totens do Patriarca; Noiva do Inverno (item 9) — T `mecânicas de chefe`, E2E `wave 30`
Item 15
- [x] T7.15 Necromante: Essência, Rajada Óssea, Erguer Morto, Mão da Sepultura, Exército, servos autoritativos com limites e limpeza, melhorias e bifurcação (item 15) — T `Necromante: …` (6 testes), rede `v0.2 em rede…`, E2E `necro`, `showcase necromancer`
- [x] T7.16 `BALANCEAMENTO.md` com todos os números novos/alterados; typecheck, testes e build

## Validações que dependem de outro ambiente
- [~] Executar o `.exe` em Windows real (o Chromium do Electron não roda sob Wine) — roteiro em `docs/TESTES.md §4`
- [~] Dois computadores via Radmin VPN — roteiro em `docs/TESTES.md §5`
- [~] 60 FPS com GPU real — medido apenas com renderização por software (llvmpipe); ver `docs/TESTES.md §3`

## Etapa 9 — v1.3 (dificuldade, Vampiro, missões, Lapanha, raridades)
- [x] T9.1 Cura central (`healing.ts`): dano válido, retorno decrescente, cartas, Ferida, teto por uso e por segundo — T `v13 cura central`
- [x] T9.2 Ferida Profana do Acólito Sombrio (telegraph, evitável, -70%, bloqueio inicial 0,75 s) — T `v13 Ferida`, E2E `v13`
- [x] T9.3 Atordoamento raro com resistência de 2,5 s — T `v13 atordoamento`
- [x] T9.4 Especiais mais frequentes (presença mínima, pares, trio raro), log do diretor — `tools/specials.ts`
- [x] T9.5 Escolta com emboscadas e atacantes; fogueira e altar com pressão por categoria, rampa, teto, assaltos e estados — E2E `v13`
- [x] T9.6 Classe Lapanha (servidor, protocolo, sprites, HUD, F1, áudio, falas, cartas) — T `v13 Lapanha`, rede `v1.3 em rede`, E2E `showcase lapanha`, `v13`
- [x] T9.7 Raridades 60/27/11/2, lendária única, tetos globais, cartas com moldura/tipo/comparação — T `v13 raridades`
- [x] T9.8 Telemetria (`telemetry.ts`, comando `tele`) e simulações (`tools/sim.ts`)
