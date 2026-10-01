# Última Vigília

Jogo cooperativo 2D top-down de sobrevivência por hordas, com combate inspirado em soulslikes e
pixel art. Uma campanha de **30 ondas em três capítulos** — a vila amaldiçoada, o cemitério
congelado e a mansão no deserto de cinzas — com uma fogueira que precisa continuar acesa.

- 1 a 6 jogadores; um deles hospeda a partida no próprio PC (LAN ou **Radmin VPN**).
- Dez classes (uma por jogador): **Caçador, Mago, Guardião (Tank), Vampiro, Berserker, Dog, Necromante,
  Lapanha, Maycon** (controle de área num tapete voador, citando Hunt: Showdown) **e Jota** (vibecoder de
  capuz, glass cannon de dano à distância: Prompt, Patch, Rewind e a suprema Modo Batman).
- **Checkpoints por chefe**: vencer um chefe ou minichefe salva o progresso. Se a equipe cair depois,
  volta para a onda seguinte ao checkpoint — perdendo as melhorias tomadas desde então e 10% da vida
  máxima por volta (acumula até 50%).
- Três mapas com climas próprios (noite, nevasca, tempestade de cinzas); a horda se adapta a cada
  clima. Entre capítulos, a equipe vota a rota (Portal de Risco × Rota Segura) e uma cinemática em
  pixel art leva o grupo ao próximo mapa.
- Cinco inimigos comuns/elites, **afixos de elite** (Sangrento, Blindado, Furioso), três minichefes e
  três chefes com mecânica própria: **Devorador da Lua** (luas falsas, onda 10), **Noiva do Inverno**
  (onda 20) e **Patriarca do Abismo** (totens, onda 30).
- Eventos de onda (proteger a fogueira, interromper ritual, escoltar sobrevivente, deter o carrinho
  funerário), desafios opcionais com recompensa, caixas/barris destrutíveis com itens de cura.
- Melhorias entre ondas com **confirmação** e **bifurcações** exclusivas; reviver aliados;
  vitória/derrota e “jogar novamente” sem reiniciar o app.
- Partida completa de ~35–60 min. Interface inteira em português brasileiro.
- Números de balanceamento documentados em [`BALANCEAMENTO.md`](BALANCEAMENTO.md).

Stack: TypeScript (strict) · Electron 44 · Phaser 4 · Node.js + `ws` · Vite 8 · esbuild · electron-builder.

---

## Para jogar (quem recebe o executável)

Não é preciso instalar Node.js nem usar terminal.

1. Baixe **um** dos arquivos:
   - `UltimaVigilia-<versão>-Instalador.exe` — instala e cria atalhos no menu Iniciar e na área de trabalho.
   - `UltimaVigilia-<versão>-Portatil.exe` — roda direto, sem instalar (pode ficar num pendrive).
2. O executável não é assinado digitalmente. Se o Windows SmartScreen avisar, clique em
   **Mais informações → Executar assim mesmo**.
3. Abra o jogo, digite seu **apelido** e escolha:
   - **Jogar sozinho** — o servidor roda só no seu PC (loopback), sem abrir portas.
   - **Criar partida** — você hospeda e joga normalmente.
   - **Entrar por IP** — você entra na partida de um amigo.

### Controles padrão (remapeáveis em Configurações)

| Tecla | Ação |
|---|---|
| W A S D | Mover |
| Mouse | Mirar |
| Botão esquerdo | Ataque básico |
| Espaço | Esquiva (invulnerabilidade breve) |
| Q / E | Habilidades |
| R | Suprema (quando a barra enche) |
| F (segurar) | Interagir / reviver aliado caído |
| G | Ping no mapa |
| Tab (segurar) | Equipe e melhorias |
| Esc | Menu (pausa **só** no modo solo) |

---

## Jogar com amigos pela Radmin VPN

A Radmin VPN só cria a rede virtual entre os computadores; o jogo tem o próprio servidor,
lobby e sincronização. Todos precisam da **mesma versão** do jogo.

### 1. Todos: entrar na mesma rede Radmin
1. Instale a Radmin VPN em <https://www.radmin-vpn.com/> e abra o programa.
2. **Quem vai hospedar:** menu *Rede → Criar rede*, defina nome e senha e passe-os aos amigos.
3. **Os amigos:** *Rede → Entrar em uma rede existente*, com o mesmo nome e senha.
4. Confira se todos aparecem **online** (ponto verde) dentro da rede.

### 2. Anfitrião: criar a partida
1. No jogo, **Criar partida**.
2. Em **Interface de rede**, escolha a que diz **Radmin VPN** (IP começando com `26.`).
   Numa rede de casa/escritório, escolha **Rede local** (ex.: `192.168.x.x`).
   A opção **Todas as interfaces (avançado)** existe, mas é explícita: use só se souber que precisa.
3. Porta TCP: deixe **7777** (ou outra entre 1024 e 65535). Limite de jogadores e senha são opcionais.
4. Clique em **Criar partida**. Na primeira vez, o **Firewall do Windows** perguntará se o
   Última Vigília pode se comunicar: permita. A Radmin VPN costuma aparecer para o Windows como
   **rede Pública** — marque também essa opção, senão os amigos não conseguem entrar.
   *Não é preciso desativar o firewall.*
5. No lobby, clique em **Copiar IP:porta** e mande para os amigos (ex.: `26.12.34.56:7777`).

### 3. Amigos: entrar
1. **Entrar por IP**, cole o IP e a porta que o anfitrião mandou, e a senha, se houver.
2. Escolha uma classe livre (cada classe é de uma pessoa só; o jogo avisa se já estiver ocupada)
   e clique **Marcar pronto**.
3. O anfitrião clica **Iniciar partida** quando todos estiverem prontos.

### Se não conectar
- Confira IP e porta exatamente como aparecem no lobby do anfitrião.
- Na Radmin VPN, ambos precisam estar na **mesma rede** e **online**. Teste com o botão direito
  sobre o nome do amigo → **Ping**.
- No PC do anfitrião: *Painel de Controle → Firewall do Windows Defender → Permitir um aplicativo*
  e marque **Privada** e **Pública** para o Última Vigília (ou crie uma regra de entrada para a porta TCP escolhida).
- Mensagens do jogo: *porta ocupada* (troque a porta ou feche a outra sala), *sala cheia*,
  *senha incorreta*, *versão incompatível* (atualizem para a mesma versão), *conexão perdida*.
- Se alguém cair durante a partida, o jogo tenta reconectar sozinho por até **60 segundos**,
  mantendo a classe e o estado. Se o anfitrião fechar o jogo, a partida termina para todos
  com uma mensagem clara.

Escopo: conexão direta em rede local ou virtual. O jogo **não** faz conexão automática por IP
público/internet sem uma VPN como a Radmin (isso exigiria redirecionamento de portas ou infraestrutura extra).

---

## Atualizações automáticas

Ao abrir, o jogo consulta o repositório `kqnd/ultimavigilia` no GitHub e avisa no menu quando há
novidade. São dois casos, com comportamentos diferentes de propósito:

- **Release nova** — é a única que o jogo consegue instalar sozinho. Se a release tiver o
  instalador (`.exe`) anexado, o menu mostra "Baixar", baixa com barra de progresso e, ao terminar,
  "Instalar e reiniciar" fecha o jogo e abre o instalador.
- **Commits novos sem release** — o menu apenas avisa e abre o repositório. O que há lá é
  código-fonte, e um jogo já instalado não consegue aplicá-lo sozinho (precisaria de `npm install`
  e compilar). Prometer "baixar" aqui seria mentira.

Ou seja: **para os jogadores receberem uma atualização, é preciso publicar uma release com o
instalador anexado.** `npm run release` confere o que falta e imprime os comandos exatos:

```bash
npm run release 1.5.0   # ajusta package.json e GAME_VERSION juntos
npm run dist:win        # gera release/UltimaVigilia-1.5.0-Instalador.exe
npm run release         # imprime os comandos de tag, push e gh release create
```

O jogador pode desligar a procura em Configurações → "Procurar atualizações ao abrir".

Detalhes de implementação: a verificação, o download e a execução acontecem só no processo
principal (`src/main/updater.ts`). O renderer não escolhe endereço, não baixa e não executa nada —
ele pede a ação pela ponte (`update.check/download/install`) e recebe o estado. Só HTTPS, só os
domínios do GitHub, redirecionamentos revalidados, teto de tamanho e conferência do tamanho
baixado contra o que a release anunciou.

## Para desenvolvedores

Requisitos: **Node.js 22 LTS** (≥ 20) e npm. Windows, Linux ou macOS para desenvolver; o pacote
final é para Windows x64.

| Objetivo | Comando |
|---|---|
| Instalar dependências (versões travadas no lockfile) | `npm ci` |
| Rodar em desenvolvimento (Vite com HMR + esbuild watch + Electron) | `npm run dev` |
| Duas janelas de desenvolvimento com perfis independentes | `npm run dev:two` |
| Compilar e abrir duas instâncias do build com perfis independentes | `npm run start:two` |
| Verificar tipos | `npm run typecheck` |
| Executar testes | `npm test` |
| Compilar (main, preload, servidor e renderer) | `npm run build` |
| Gerar o pacote Windows (instalador + portátil em `release/`) | `npm run dist:win` |
| Tipos + testes | `npm run check` |
| Medição: 6 clientes WebSocket + ~100 inimigos | `npm run bench` |
| Simular a campanha de 30 ondas com bots (duração por onda) | `npm run simulate -- berserker necromancer` |
| Servidor dedicado sem janela (depuração) | `npm run server` |
| Reexportar sprite sheets para `assets/sprites` | `npm run sprites` |
| Regenerar a fonte pixelada | `npm run font` |

Perfis: cada instância aceita `--profile=nome` e guarda configurações em uma pasta própria
(`%APPDATA%/UltimaVigilia-nome`), permitindo dois jogadores no mesmo PC para testes.

Argumentos extras são repassados ao Electron: `npm run dev -- --no-sandbox` (necessário só em
Linux rodando como root, por exemplo em contêineres).

**Gerar o pacote Windows fora do Windows:** o `electron-builder` precisa do Wine (64 e 32 bits)
para montar o instalador NSIS. No Ubuntu: `sudo dpkg --add-architecture i386 && sudo apt install wine64 wine32:i386`.
No Windows, `npm run dist:win` funciona direto.

### Testes de ponta a ponta (app Electron real)

`tools/e2e.mjs` dirige o aplicativo com Playwright e salva capturas. No Linux, use Xvfb:

```bash
xvfb-run -a -s "-screen 0 1920x1080x24" node tools/e2e.mjs <cenário> <pasta> [arg]
```

Cenários: `menu`, `solo <classe>`, `showcase <classe>`, `enemies`, `boss <onda>`, `duo` (dois apps em
rede real: disputa de classe, estado compartilhado, anfitrião saindo), `flow` (carta confirmada →
onda 30 → vitória → jogar novamente), `chapter <onda> <classe>` (fim de capítulo: carta, votação de
rota, cinemática e chegada ao novo mapa), `wave <onda> <classe>` (mapas, eventos e chefes), `necro`
(cadáveres, servos e exército), `sizes` (resoluções), `perf` (~100 inimigos). Com `E2E_EXE=<executável>` o cenário
roda contra o app **empacotado**. Os comandos de depuração usados nas capturas só funcionam com `UV_DEBUG=1`.

### Estrutura

```
src/
  main/       ciclo de vida do Electron, janela segura, IPC validado, cliente WebSocket, host
  preload/    ponte mínima e tipada (window.vigilia) — sem filesystem nem execução de comandos
  renderer/   Phaser (cena, HUD, predição, efeitos), interface DOM pixelada, áudio procedural
  server/     simulação autoritativa (30 Hz), salas, lobby, IA, diretor de ondas — sem DOM/Phaser
  shared/     protocolo + validação, mapa, colisão, movimento e configurações tipadas
  art/        gerador de pixel art por matrizes (personagens, inimigos, tiles, efeitos, ícones, fonte)
assets/       sprite sheets exportadas (PNG + JSON) e a fonte TTF
tests/        vitest: rede real (ws), latência simulada, combate, ciclo da partida
tools/        e2e, bench, simulate, prévias de arte, exportadores
docs/         DECISOES.md, TESTES.md
```

Toda a simulação (posições, colisão, dano, vida, stamina, recargas, inimigos, ondas, melhorias,
resultados) roda no servidor; os clientes enviam apenas intenções (movimento, mira, botões,
escolhas). O modo solo usa o mesmo servidor em loopback.

Os números de balanceamento ficam em `src/shared/config/` (`classes.ts`, `enemies.ts`,
`waves.ts`, `upgrades.ts`, `chapters.ts`, `affixes.ts`, `objectives.ts`, `loot.ts`) e estão
explicados em `BALANCEAMENTO.md`.

### Arte, áudio e licenças

Toda a arte é original, desenhada como matrizes de pixels em `src/art/` e montada em sprite
sheets na inicialização (reproduzível; `npm run sprites` exporta os PNGs). A fonte
“Vigilia Pixel” também é própria (`npm run font`). O áudio é 100% sintetizado em tempo real
(WebAudio), sem arquivos externos. Dependências de terceiros: Electron, Phaser e ws (licença MIT).

Mais detalhes: `BALANCEAMENTO.md` (valores e justificativas), `SPEC.md` (requisitos rastreáveis), `TASKS.md` (estado e evidências),
`docs/DECISOES.md` (escolhas de design) e `docs/TESTES.md` (o que foi testado, resultados e roteiros).
