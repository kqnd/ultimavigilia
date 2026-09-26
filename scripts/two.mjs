// Abre duas instâncias do build atual com perfis (configurações) independentes.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const electronPath = require('electron');
for (const profile of ['jogador1', 'jogador2']) {
  spawn(electronPath, ['.', `--profile=${profile}`, ...process.argv.slice(2)], { stdio: 'inherit', env: { ...process.env } });
}
