// Compila main, preload e servidor (Node) com esbuild. Uso: node scripts/build-node.mjs [--watch]
import { execSync } from 'node:child_process';
import * as esbuild from 'esbuild';

const watch = process.argv.includes('--watch');

// Commit de origem da build: o verificador de atualizações usa isso para saber se o repositório
// andou desde que este pacote foi gerado. Fora de um clone git (ou com a árvore suja) fica 'dev',
// e o verificador trata 'dev' como "rodando do código" — sem avisos de commit.
let buildCommit = 'dev';
try {
  const sha = execSync('git rev-parse HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  const dirty = execSync('git status --porcelain', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  if (/^[0-9a-f]{40}$/.test(sha) && !dirty) buildCommit = sha;
} catch {
  // sem git: segue como 'dev'
}
console.log(`[build-node] commit da build: ${buildCommit}`);
const common = {
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  sourcemap: true,
  logLevel: 'info',
  legalComments: 'none',
  define: { __BUILD_COMMIT__: JSON.stringify(buildCommit) },
};

const configs = [
  { ...common, entryPoints: ['src/main/main.ts'], outfile: 'dist/main/main.cjs', external: ['electron'] },
  { ...common, entryPoints: ['src/preload/preload.ts'], outfile: 'dist/preload/preload.cjs', external: ['electron'], sourcemap: false },
  // servidor: autocontido (ws embutido); dependências nativas opcionais do ws ficam de fora
  { ...common, entryPoints: ['src/server/entry.ts'], outfile: 'dist/server/server.cjs', external: ['bufferutil', 'utf-8-validate'] },
];

if (watch) {
  for (const c of configs) {
    const ctx = await esbuild.context(c);
    await ctx.watch();
  }
  console.log('[build-node] observando alterações...');
} else {
  await Promise.all(configs.map((c) => esbuild.build(c)));
}
