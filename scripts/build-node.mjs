// Compila main, preload e servidor (Node) com esbuild. Uso: node scripts/build-node.mjs [--watch]
import * as esbuild from 'esbuild';

const watch = process.argv.includes('--watch');
const common = {
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  sourcemap: true,
  logLevel: 'info',
  legalComments: 'none',
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
