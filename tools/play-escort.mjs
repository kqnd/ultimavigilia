// Abre uma partida local de teste na onda 7. Feche a janela para encerrar o processo.
import { _electron as electron } from 'playwright-core';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const app = await electron.launch({
  executablePath: require('electron'),
  args: ['.', '--profile=teste-escolta', '--no-sandbox', '--disable-gpu-sandbox'],
  env: { ...process.env, UV_DEBUG: '1' },
});

try {
  const page = await app.firstWindow();
  await page.waitForFunction(() => !!window.__app, null, { timeout: 20000 });
  await page.locator('input[placeholder="Seu apelido"]').fill('Teste Escolta');
  await page.locator('button', { hasText: 'Jogar sozinho' }).first().click();
  await page.waitForSelector('.classcard', { timeout: 15000 });
  await page.evaluate(() => window.__app.session.send({ t: 'cls', cls: 'berserker' }));
  await page.locator('button', { hasText: 'Começar' }).first().click();
  await page.waitForFunction(() => window.__app.session.phase.phase === 'wave', null, { timeout: 20000 });
  await page.evaluate(() => {
    const send = window.__app.session.send.bind(window.__app.session);
    send({ t: 'dbg', c: 'god', n: 0, s: '' });
    send({ t: 'dbg', c: 'ult', n: 0, s: '' });
    send({ t: 'dbg', c: 'wave', n: 7, s: '' });
  });
  await page.waitForFunction(() => window.__app.session.phase.wave === 7, null, { timeout: 10000 });
  await page.bringToFront();
  console.log('Onda 7 pronta: Berserker invulnerável, suprema carregada. Feche a janela para encerrar.');
  await new Promise((resolve) => app.on('close', resolve));
} catch (error) {
  await app.close();
  throw error;
}
