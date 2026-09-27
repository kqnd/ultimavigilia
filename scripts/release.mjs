/**
 * Prepara uma versão para o verificador de atualizações do jogo.
 *
 * O jogo só consegue instalar sozinho o que estiver anexado a uma *release* do GitHub: commits
 * soltos são código-fonte e um pacote já instalado não consegue aplicá-los. Este script confere
 * o que precisa estar certo e imprime os comandos exatos para publicar.
 *
 * Uso: node scripts/release.mjs [nova-versão]      (ex.: node scripts/release.mjs 1.4.0)
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const pkgPath = 'package.json';
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
const constants = fs.readFileSync('src/shared/constants.ts', 'utf8');
const inCode = /GAME_VERSION = '([^']+)'/.exec(constants)?.[1] ?? '';

const target = process.argv[2];
const version = target ?? pkg.version;

if (!/^\d+\.\d+\.\d+$/.test(version)) {
  console.error(`versão inválida: ${version} (use algo como 1.4.0)`);
  process.exit(1);
}

if (target) {
  // package.json e GAME_VERSION têm de andar juntos: é GAME_VERSION que o jogo compara
  pkg.version = target;
  fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8');
  fs.writeFileSync('src/shared/constants.ts', constants.replace(/GAME_VERSION = '[^']+'/, `GAME_VERSION = '${target}'`), 'utf8');
  console.log(`versão ajustada para ${target} em package.json e src/shared/constants.ts`);
} else if (inCode !== pkg.version) {
  console.error(`package.json (${pkg.version}) e GAME_VERSION (${inCode}) estão diferentes.`);
  console.error(`Rode: node scripts/release.mjs ${pkg.version}`);
  process.exit(1);
}

const installer = path.join('release', `UltimaVigilia-${version}-Instalador.exe`);
const portable = path.join('release', `UltimaVigilia-${version}-Portatil.exe`);
const built = fs.existsSync(installer);

let dirty = '';
try {
  dirty = execSync('git status --porcelain', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
} catch { /* fora de um clone git */ }

console.log(`\n--- versão ${version} ---`);
console.log(`instalador: ${built ? `pronto em ${installer}` : `AINDA NÃO — rode "npm run dist:win"`}`);
console.log(`árvore git: ${dirty ? 'com alterações não commitadas' : 'limpa'}`);
console.log('\nPara publicar (o jogo só enxerga atualizações a partir daqui):\n');
if (dirty) console.log(`  git add -A && git commit -m "v${version}"`);
if (!built) console.log('  npm run dist:win');
console.log(`  git tag v${version}`);
console.log(`  git push origin master --tags`);
console.log(`  gh release create v${version} "${installer}" "${portable}" --title "v${version}" --notes "o que mudou"\n`);
console.log('Sem o gh instalado: crie a release em https://github.com/kqnd/ultimavigilia/releases/new,');
console.log(`escolha a tag v${version} e anexe o instalador — o nome precisa terminar em .exe.\n`);
