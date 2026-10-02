# Última Vigília

Jogo cooperativo 2D top-down de sobrevivência por hordas (1–6 jogadores), combate inspirado em
soulslikes, pixel art. Electron + Phaser + Node/ws + TypeScript strict. Interface inteira em pt-BR.

Leia primeiro: [SPEC.md](SPEC.md) (requisitos com ID), [BALANCEAMENTO.md](BALANCEAMENTO.md) (números),
[docs/DECISOES.md](docs/DECISOES.md) (decisões onde a spec era aberta), [docs/TESTES.md](docs/TESTES.md).

## Arquitetura

- `src/main` — processo Electron principal (janela, host do servidor via `utilityProcess`).
- `src/preload` — bridge IPC mínimo, contextIsolation ligado.
- `src/server` — simulação autoritativa (Node, sem DOM/Phaser): mundo, IA, ondas, net.
- `src/renderer` — Phaser + UI do jogador; recebe só dados tipados do servidor, nunca acessa sockets.
- `src/shared` — código e **configuração** usados por servidor e renderer (mesma simulação em
  solo e multiplayer).
- `src/shared/config/*.ts` — todos os números do jogo (inimigos, ondas, classes, upgrades,
  afixos, sinergias, loot). Mudar balanceamento = editar aqui, não hardcode em lógica.
- `src/art` — pixel art gerada por código (paletas, sprites, fontes), sem assets binários temporários.

Regra de ouro: servidor é autoridade (dano, drops, cura, ondas, resultados); cliente só envia
intenções. Solo usa o mesmo servidor em loopback — nunca duplicar lógica para o modo solo.

## Comandos

```bash
npm run dev          # electron + servidor em dev
npm run dev:two       # dois clientes locais (teste multiplayer)
npm run typecheck     # tsc --noEmit (node + web)
npm test              # vitest run
npm run check         # typecheck + test — rodar antes de considerar algo pronto
npm run e2e           # testes end-to-end (tools/e2e.mjs)
npm run build         # build de produção
npm run dist:win      # instalador/portátil Windows
```

## Convenções

- TypeScript strict; sem `any` solto. Tipos e constantes de jogo centralizados em `src/shared/config/`.
- Sem dano aliado nem bloqueio entre aliados. Hitboxes seguem antecipação → janela ativa → recuperação.
- Novo inimigo/classe: adicionar em `src/shared/config/enemies.ts` ou `classes.ts`, IA em
  `src/server/world/ai/`, depois arte em `src/art/`. Ver padrão dos existentes antes de criar.
- Textos de UI e falas de personagens: pt-BR, sem gírias de outros países.
- `.claude/worktrees/` contém cópias de agentes antigos — não é código do projeto, ignorar ao buscar.
