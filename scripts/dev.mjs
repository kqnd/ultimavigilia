// Desenvolvimento: Vite (renderer com HMR) + esbuild em modo watch (main/preload/servidor) + Electron.
// Uso: npm run dev            (uma janela)
//      npm run dev:two        (duas janelas com perfis independentes: jogador1 e jogador2)
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { createServer } from 'vite';

const require = createRequire(import.meta.url);
const electronPath = require('electron');
const two = process.argv.includes('--two');
// argumentos extras repassados ao Electron (ex.: npm run dev -- --no-sandbox em Linux como root)
const extra = process.argv.slice(2).filter((a) => a !== '--two');

const build = spawn(process.execPath, ['scripts/build-node.mjs', '--watch'], { stdio: ['ignore', 'pipe', 'inherit'] });
await new Promise((resolve) => {
  build.stdout.on('data', (d) => {
    process.stdout.write(d);
    if (String(d).includes('observando')) resolve();
  });
});
const vite = await createServer({ configFile: 'vite.config.ts' });
await vite.listen();
const url = `http://localhost:${vite.config.server.port ?? 5173}/`;
console.log(`[dev] renderer em ${url}`);

const procs = [];
const launch = (profile) => {
  const p = spawn(electronPath, ['.', ...(profile ? [`--profile=${profile}`] : []), ...extra], { stdio: 'inherit', env: { ...process.env, VITE_DEV_URL: url } });
  procs.push(p);
  p.on('exit', () => {
    if (procs.every((x) => x.exitCode !== null)) shutdown();
  });
};
const shutdown = () => {
  build.kill();
  void vite.close().then(() => process.exit(0));
};
if (two) {
  launch('jogador1');
  launch('jogador2');
} else launch('');
process.on('SIGINT', shutdown);
