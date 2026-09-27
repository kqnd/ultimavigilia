// Dirige o aplicativo Electron real (xvfb) para capturas de tela e testes de fumaça.
// Uso: xvfb-run -s "-screen 0 1920x1080x24" node tools/e2e.mjs <cenário> <pastaSaida>
import { _electron as electron } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const electronPath = require('electron');
const [scenario = 'menu', out = 'shots', ...rest] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function launch(profile, extra = []) {
  // E2E_EXE aponta para um executável empacotado (valida o caminho do app instalado)
  const packaged = process.env.E2E_EXE;
  const app = await electron.launch({
    executablePath: packaged || electronPath,
    args: [...(packaged ? [] : ['.']), `--profile=${profile}`, '--no-sandbox', '--disable-gpu-sandbox', ...extra],
    env: { ...process.env, ELECTRON_ENABLE_LOGGING: '1', UV_DEBUG: '1' },
  });
  const page = await app.firstWindow();
  const logs = [];
  page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
  page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
  try {
    await page.waitForFunction(() => !!window.__app, null, { timeout: 20000 });
  } catch (e) {
    await page.screenshot({ path: path.join(out, `fail-${profile}.png`) }).catch(() => {});
    console.error(logs.join('\n'));
    console.error(await page.content().catch(() => ''));
    await app.close();
    throw e;
  }
  return { app, page, logs };
}

async function shot(page, name) {
  await page.screenshot({ path: path.join(out, `${name}.png`) });
  console.log('captura', name);
}

async function clickText(page, text) {
  await page.locator('button', { hasText: text }).first().click();
}

async function setName(page, name) {
  const inp = page.locator('input[placeholder="Seu apelido"]');
  await inp.fill(name);
}

const scenarios = {
  async menu() {
    const { app, page, logs } = await launch('shot1');
    await sleep(2500);
    await shot(page, 'menu');
    fs.writeFileSync(path.join(out, 'logs-menu.txt'), logs.join('\n'));
    await app.close();
  },
  async solo() {
    const cls = rest[0] ?? 'berserker';
    const { app, page, logs } = await launch('shot-' + cls);
    await sleep(800);
    await setName(page, 'Álex');
    await clickText(page, 'Jogar sozinho');
    await page.waitForSelector('.classcard', { timeout: 15000 });
    await sleep(500);
    await shot(page, `lobby-solo-${cls}`);
    await page.evaluate((c) => window.__app.session.send({ t: 'cls', cls: c }), cls);
    await sleep(400);
    await clickText(page, 'Começar');
    await sleep(4500);
    await shot(page, `wave-start-${cls}`);
    // anda e ataca com teclado/mouse reais
    await page.mouse.move(900, 400);
    await page.keyboard.down('KeyD');
    await sleep(700);
    await page.keyboard.up('KeyD');
    for (let i = 0; i < 8; i++) {
      await page.mouse.down();
      await sleep(120);
      await page.mouse.up();
      await sleep(80);
    }
    await page.keyboard.press('KeyQ');
    await sleep(400);
    await shot(page, `combat-${cls}`);
    await page.keyboard.press('KeyE');
    await sleep(250);
    await shot(page, `ability-e-${cls}`);
    await page.evaluate(() => {
      // carrega a suprema via console de depuração? não: apenas espera combate
    });
    await sleep(6000);
    await shot(page, `later-${cls}`);
    fs.writeFileSync(path.join(out, `logs-${cls}.txt`), logs.join('\n'));
    await app.close();
  },
};

async function soloStart(page, cls) {
  await sleep(800);
  await setName(page, 'Álex');
  await clickText(page, 'Jogar sozinho');
  await page.waitForSelector('.classcard', { timeout: 15000 });
  await page.evaluate((c) => window.__app.session.send({ t: 'cls', cls: c }), cls);
  await sleep(500);
  await clickText(page, 'Começar');
  await sleep(3800);
}
const dbg = (page, c, n = 0, s = '') => page.evaluate(([c, n, s]) => window.__app.session.send({ t: 'dbg', c, n, s }), [c, n, s]);

// Painel de atualização: injeta cada estado no menu e fotografa (sem depender da rede).
scenarios.update = async () => {
  const { app, page, logs } = await launch('update', []);
  await sleep(600);
  // os estados são injetados direto no controlador (o mesmo objeto que o IPC alimentaria)
  const show = async (name, st) => {
    await page.evaluate((st) => {
      const a = window.__app.app;
      a.updateDismissed = false;
      a.update = st;
      a.renderUpdate();
    }, st);
    await sleep(250);
    await shot(page, `update-${name}`);
  };
  const release = {
    kind: 'release', version: '1.4.0', title: 'Redemoinho de Fúria e falas de todo o elenco',
    notes: 'Berserker: Q girante e Fúria como vantagem.\nLapanha: acerto das melancias corrigido.\nFalas para as oito classes.',
    publishedAt: '2026-09-27T00:00:00Z', asset: { name: 'UltimaVigilia-1.4.0-Instalador.exe', size: 116 * 1024 * 1024 },
    url: 'https://github.com/kqnd/ultimavigilia/releases/tag/v1.4.0',
  };
  await show('1-release', { state: 'found', update: release });
  await show('2-commits', {
    state: 'found',
    update: { kind: 'commits', ahead: 7, sha: 'cca65a3', message: 'ajustes de balanceamento do Berserker', date: '2026-09-27T00:00:00Z', url: 'https://github.com/kqnd/ultimavigilia/commits/master' },
  });
  await show('3-downloading', { state: 'downloading', update: release, received: 44 * 1024 * 1024, total: 116 * 1024 * 1024 });
  await show('4-ready', { state: 'ready', update: release });
  await show('5-error', { state: 'error', message: 'GitHub respondeu 403' });
  await show('6-sem-instalador', { state: 'found', update: { ...release, asset: null } });
  fs.writeFileSync(path.join(out, 'logs-update.txt'), logs.filter((l) => !l.includes('Security')).join('\n'));
  await app.close();
};

scenarios.clickmove = async () => {
  const { app, page, logs } = await launch('clickmove');
  try {
    await soloStart(page, 'hunter');
    await dbg(page, 'god');
    const start = await page.evaluate(() => {
      const game = window.__app.game;
      const p = game.predictor.state;
      const cam = game.cameras.main;
      const rect = document.querySelector('#game canvas').getBoundingClientRect();
      const wx = p.x + 90;
      const wy = p.y + 30;
      return { x: p.x, y: p.y, clickX: rect.left + ((wx - cam.scrollX) / 640) * rect.width, clickY: rect.top + ((wy - cam.scrollY) / 360) * rect.height };
    });
    await page.mouse.click(start.clickX, start.clickY, { button: 'right' });
    const target = await page.evaluate(() => window.__app.game.moveTarget);
    assert.ok(target && Math.abs(target.x - (start.x + 90)) < 4 && Math.abs(target.y - (start.y + 30)) < 4, `destino incorreto: ${JSON.stringify({ start, target })}`);
    await shot(page, 'clickmove-marker');
    await sleep(1250);
    const end = await page.evaluate(() => ({ x: window.__app.game.predictor.state.x, y: window.__app.game.predictor.state.y }));
    assert.ok(Math.hypot(end.x - start.x, end.y - start.y) > 12, `clique direito não moveu: ${JSON.stringify({ start, end })}`);
    await shot(page, 'clickmove-arrival');
    fs.writeFileSync(path.join(out, 'logs-clickmove.txt'), logs.join('\n'));
  } finally {
    await app.close();
  }
};

scenarios.skills = async () => {
  const cls = rest[0] ?? 'berserker';
  const { app, page, logs } = await launch(`skills-${cls}`);
  try {
    await soloStart(page, cls);
    await dbg(page, 'god');
    await page.keyboard.down('F1');
    await page.waitForSelector('#skill-guide');
    await sleep(300);
    const before = await page.evaluate(() => {
      const { session, app } = window.__app;
      const p = session.latest()?.p.find((p) => p.id === session.myId);
      return { x: p?.x, paused: session.paused, enabled: app.input.enabled,
        pointer: getComputedStyle(document.querySelector('#skill-guide')).pointerEvents,
        cards: document.querySelectorAll('.skill-guide-card').length };
    });
    assert.equal(before.paused, false);
    assert.equal(before.enabled, true);
    assert.equal(before.pointer, 'none');
    assert.equal(before.cards, 5);
    await shot(page, `skills-${cls}`);
    await page.keyboard.down('KeyD');
    await sleep(700);
    await page.keyboard.up('KeyD');
    const after = await page.evaluate(() => {
      const { session } = window.__app;
      return session.latest()?.p.find((p) => p.id === session.myId)?.x;
    });
    assert.ok(after > before.x, `F1 não deve pausar movimento: ${before.x} → ${after}`);
    await page.keyboard.up('F1');
    assert.equal(await page.locator('#skill-guide').count(), 0);
    console.log('F1 sem pausa:', JSON.stringify({ before, after }));
    if (logs.some((l) => l.includes('[pageerror]'))) throw new Error(logs.join('\n'));
  } finally {
    await app.close();
  }
};

scenarios.showcase = async () => {
  const cls = rest[0] ?? 'berserker';
  const { app, page, logs } = await launch('show-' + cls, []);
  await soloStart(page, cls);
  await dbg(page, 'god');
  await dbg(page, 'spawn', 8, 'shambler');
  await dbg(page, 'spawn', 4, 'runner');
  await sleep(700);
  await page.mouse.move(820, 420);
  for (let i = 0; i < 5; i++) {
    await page.mouse.down();
    await sleep(90);
    await page.mouse.up();
    await sleep(130);
  }
  await shot(page, `${cls}-1-basic`);
  await page.keyboard.down('KeyQ');
  await sleep(250);
  await shot(page, `${cls}-2-q`);
  await page.keyboard.up('KeyQ');
  await sleep(500);
  await page.mouse.move(700, 300);
  await page.keyboard.press('KeyE');
  await sleep(180);
  await shot(page, `${cls}-3-e`);
  await sleep(600);
  await dbg(page, 'ult');
  await sleep(200);
  await page.mouse.move(760, 360);
  await page.keyboard.press('KeyR');
  await sleep(cls === 'mage' ? 1300 : 450);
  await shot(page, `${cls}-4-r`);
  await sleep(900);
  await shot(page, `${cls}-5-after`);
  fs.writeFileSync(path.join(out, `logs-${cls}.txt`), logs.filter((l) => !l.includes('Security')).join('\n'));
  await app.close();
};

// Regressão da mira: durante a preparação, mover o cursor deve mudar a direção do projétil.
scenarios.aim = async () => {
  const cls = rest[0] ?? 'hunter';
  const projectileKind = { hunter: 0, mage: 2, necromancer: 7 }[cls];
  assert.notEqual(projectileKind, undefined, `Classe sem disparo de teste: ${cls}`);
  const height = 8; // SHOT_HEIGHT: projéteis no chão, desenhados 8 px acima
  const { app, page, logs } = await launch(`aim-regression-${cls}`);
  try {
    await soloStart(page, cls);
    await dbg(page, 'god');
    const geometry = await page.evaluate(() => {
      const { game, session } = window.__app;
      const me = game.rendered.find((p) => p.id === session.myId);
      const cam = game.cameras.main;
      const rect = document.querySelector('#game canvas').getBoundingClientRect();
      return {
        player: { x: me.x, y: me.y },
        cursor: {
          x: rect.left + (me.x - cam.scrollX + 150) * rect.width / 640,
          y: rect.top + (me.y - cam.scrollY) * rect.height / 360,
        },
      };
    });
    await page.mouse.move(geometry.cursor.x, geometry.cursor.y);
    await sleep(500);
    const before = await page.evaluate(() => {
      const { app, game, session } = window.__app;
      const me = game.rendered.find((p) => p.id === session.myId);
      const cam = game.cameras.main;
      return {
        target: { x: cam.scrollX + app.input.mouseX, y: cam.scrollY + app.input.mouseY },
        player: { x: me.x, y: me.y },
        aim: me.data.a / 1000,
      };
    });
    const oldIds = await page.evaluate(() => window.__app.session.latest().pr.map((p) => p[0]));
    await page.mouse.down();
    await sleep(65);
    await page.mouse.move(geometry.cursor.x, geometry.cursor.y + 60);
    await page.mouse.up();
    await page.waitForFunction(([ids, kind]) => window.__app.session.latest().pr.some((p) => p[6] > 0 && p[1] === kind && !ids.includes(p[0])), [oldIds, projectileKind], { timeout: 2500 });
    const after = await page.evaluate(([ids, kind]) => {
      const { app, game, session } = window.__app;
      const me = game.rendered.find((p) => p.id === session.myId);
      const cam = game.cameras.main;
      return {
        shots: session.latest().pr.filter((p) => p[6] > 0 && p[1] === kind && !ids.includes(p[0])).map((p) => ({ id: p[0], vx: p[4], vy: p[5] })),
        target: { x: cam.scrollX + app.input.mouseX, y: cam.scrollY + app.input.mouseY },
        player: { x: me.x, y: me.y },
        aim: me.data.a / 1000,
      };
    }, [oldIds, projectileKind]);
    console.log(JSON.stringify({ geometry, before, after, logs }, null, 2));
    assert.ok(after.shots.length > 0, 'O disparo do Caçador não apareceu no snapshot');
    const shot = after.shots[0];
    const expected = Math.atan2(after.target.y + height - after.player.y, after.target.x - after.player.x);
    const actual = Math.atan2(shot.vy, shot.vx);
    assert.ok(Math.abs(actual - expected) < 0.06, `Projétil não seguiu o cursor após a preparação: esperado ${expected}, recebido ${actual}`);
  } finally {
    await app.close();
  }
};

// Mira exata: cursor no centro e nas quatro bordas, com o jogador no meio e encostado num canto
// do mapa (câmera limitada). A trajetória desenhada tem de passar pelo ponto clicado.
scenarios.aimcheck = async () => {
  const cls = rest[0] ?? 'hunter';
  const H = 8;
  const { app, page, logs } = await launch(`aimcheck-${cls}`);
  const results = [];
  try {
    await soloStart(page, cls);
    await dbg(page, 'god');
    await page.keyboard.press('F9');
    const rect = await page.evaluate(() => { const r = document.querySelector('#game canvas').getBoundingClientRect(); return { l: r.left, t: r.top, w: r.width, h: r.height }; });
    const toClient = (sx, sy) => ({ x: rect.l + (sx * rect.w) / 640, y: rect.t + (sy * rect.h) / 360 });
    const points = [[320, 150], [40, 180], [600, 180], [320, 30], [320, 330], [70, 60], [590, 320]];
    const fireAt = async (tag) => {
      for (const [sx, sy] of points) {
        await dbg(page, 'kill');
        const c = toClient(sx, sy);
        await page.mouse.move(c.x, c.y);
        await sleep(250);
        const ids = await page.evaluate(() => window.__app.session.latest().pr.map((p) => p[0]));
        const click = await page.evaluate(() => { const { app, game } = window.__app; return game.screenToWorld(app.input.mouseX, app.input.mouseY); });
        let fired = false;
        for (let k = 0; k < 4 && !fired; k++) {
          await page.mouse.down();
          await sleep(40);
          await page.mouse.up();
          fired = await page.waitForFunction((old) => window.__app.session.latest().pr.some((p) => p[6] > 0 && !old.includes(p[0])), ids, { timeout: 1500 }).then(() => true, () => false);
          if (!fired) await sleep(800);
        }
        if (!fired) { results.push({ tag, sx, sy, perp: 0, ahead: true, skipped: true }); console.log('sem projétil', tag, sx, sy); continue; }
        const pr = await page.evaluate((old) => window.__app.session.latest().pr.find((p) => p[6] > 0 && !old.includes(p[0])), ids);
        const [, , x, y, vx, vy] = pr;
        const l = Math.hypot(vx, vy);
        const dx = click.x - x;
        const dy = click.y - (y - H);
        const perp = Math.abs(dx * (vy / l) - dy * (vx / l));
        const ahead = dx * vx + dy * vy > 0;
        results.push({ tag, sx, sy, perp: Number(perp.toFixed(2)), ahead });
        if (sx === 590 && sy === 320) await shot(page, `aim-${tag}`);
        await sleep(350);
      }
    };
    await fireAt('centro');
    // encosta no canto superior esquerdo (câmera presa nos limites do mapa)
    await page.keyboard.down('KeyA');
    await page.keyboard.down('KeyW');
    await sleep(6500);
    await page.keyboard.up('KeyA');
    await page.keyboard.up('KeyW');
    await sleep(300);
    const cam = await page.evaluate(() => { const c = window.__app.game.cameras.main; return { x: c.scrollX, y: c.scrollY }; });
    await fireAt('borda');
    console.log(JSON.stringify({ cam, results }, null, 1));
    const worst = Math.max(...results.map((r) => r.perp));
    // tolerância: raio do projétil + arredondamento do snapshot (1 px)
    if (worst > 3 || results.some((r) => !r.ahead)) throw new Error(`mira desviou: ${worst}px`);
    if (logs.some((l) => l.includes('[pageerror]'))) throw new Error(logs.join('\n'));
    console.log('mira OK: maior desvio', worst, 'px');
  } finally {
    await app.close();
  }
};

// Novos inimigos anti-kite: cada um isolado e os três juntos, contra classe à distância e corpo a corpo.
scenarios.antikite = async () => {
  const cls = rest[0] ?? 'hunter';
  const { app, page, logs } = await launch(`antikite-${cls}`);
  try {
    await soloStart(page, cls);
    await dbg(page, 'god');
    await dbg(page, 'hold');
    await dbg(page, 'kill');
    const clear = async () => { await dbg(page, 'kill'); await sleep(300); };
    // Acólito Sombrio com um grupo perseguindo
    await dbg(page, 'spawn', 6, 'shambler');
    await dbg(page, 'spawn', 1, 'shadowAcolyte');
    for (let i = 0; i < 12; i++) {
      await sleep(500);
      const march = await page.evaluate(() => window.__app.session.latest().e.some((e) => e[1] === 15 && e[7] === 25 && e[6] === 2));
      if (march) break;
    }
    await shot(page, `ak-${cls}-1-acolyte`);
    await sleep(1500);
    await shot(page, `ak-${cls}-2-hasted`);
    await clear();
    // Caçador de Névoa: dispara para provocar o salto
    await dbg(page, 'spawn', 1, 'mistStalker');
    await page.mouse.move(900, 500);
    for (let i = 0; i < 16; i++) {
      await page.mouse.down(); await sleep(60); await page.mouse.up(); await sleep(120);
      const leap = await page.evaluate(() => window.__app.session.latest().e.some((e) => e[1] === 16 && e[7] === 26 && e[6] === 2));
      if (leap) break;
    }
    await shot(page, `ak-${cls}-3-stalker-leap`);
    await sleep(900);
    await shot(page, `ak-${cls}-4-stalker-recover`);
    await clear();
    // Portador do Ossário: tiros no escudo
    await dbg(page, 'spawn', 2, 'ossuaryBearer');
    await sleep(1200);
    for (let i = 0; i < 10; i++) { await page.mouse.down(); await sleep(60); await page.mouse.up(); await sleep(140); }
    await shot(page, `ak-${cls}-5-bearer`);
    await clear();
    // os três juntos
    await dbg(page, 'spawn', 5, 'shambler');
    await dbg(page, 'spawn', 1, 'ossuaryBearer');
    await dbg(page, 'spawn', 1, 'shadowAcolyte');
    await dbg(page, 'spawn', 1, 'mistStalker');
    await sleep(2500);
    await shot(page, `ak-${cls}-6-combo`);
    const errors = logs.filter((l) => l.includes('[pageerror]') || l.includes('[error]'));
    console.log('erros de console:', errors.length);
    if (errors.length) console.log(errors.join('\n'));
  } finally {
    await app.close();
  }
};

// v1.3: Lapanha (seleção, F1, habilidades), Ferida Profana, atordoamento, missões em estado crítico e cartas.
scenarios.v13 = async () => {
  const { app, page, logs } = await launch('v13');
  try {
    await sleep(800);
    await setName(page, 'Álex');
    await clickText(page, 'Jogar sozinho');
    await page.waitForSelector('.classcard', { timeout: 15000 });
    await page.evaluate(() => window.__app.session.send({ t: 'cls', cls: 'lapanha' }));
    await sleep(700);
    const lapCard = page.locator('.classcard', { hasText: 'Lapanha' }).first();
    if (await lapCard.count()) await lapCard.hover();
    await sleep(300);
    await shot(page, 'v13-01-selecao');
    await clickText(page, 'Começar');
    await sleep(3800);
    await dbg(page, 'god');
    await dbg(page, 'hold');
    await dbg(page, 'kill');
    await page.keyboard.down('F1');
    await sleep(500);
    await shot(page, 'v13-02-f1');
    await page.keyboard.up('F1');
    await sleep(300);
    // grupo à frente e Melancia Madura carregada ao máximo (prévia de vida, raio e dano)
    await dbg(page, 'spawn', 6, 'shambler');
    await page.mouse.move(1180, 520);
    await sleep(400);
    await page.keyboard.down('KeyQ');
    await sleep(1150);
    await shot(page, 'v13-03-q-carga');
    await page.keyboard.up('KeyQ');
    await sleep(450);
    await shot(page, 'v13-04-q-explosao');
    await sleep(600);
    // básico e casca
    for (let i = 0; i < 4; i++) { await page.mouse.down(); await sleep(60); await page.mouse.up(); await sleep(260); }
    await shot(page, 'v13-05-basico');
    await page.mouse.move(1080, 520);
    await page.keyboard.press('KeyE');
    await sleep(900);
    await shot(page, 'v13-06-casca');
    // Safra Abençoada com vida baixa, depois Ferida Profana (bloqueio total e redução)
    await dbg(page, 'hp', 25);
    await dbg(page, 'ult');
    await sleep(200);
    await page.keyboard.press('KeyR');
    await sleep(1200);
    await shot(page, 'v13-07-safra');
    await dbg(page, 'wound', 1);
    await sleep(250);
    await shot(page, 'v13-08-ferida-bloqueio');
    await sleep(1100);
    await shot(page, 'v13-09-ferida-reducao');
    await dbg(page, 'stun', 6);
    await sleep(200);
    await shot(page, 'v13-10-atordoado');
    await dbg(page, 'kill');
    await sleep(1500);
    // telegraph da Ferida Profana (Acólito Sombrio mirando o jogador)
    await dbg(page, 'wound', 0);
    await dbg(page, 'spawn', 1, 'shadowAcolyte');
    let seen = false;
    for (let i = 0; i < 40 && !seen; i++) {
      await sleep(250);
      seen = await page.evaluate(() => window.__app.session.latest().e.some((e) => e[1] === 15 && e[7] === 28 && e[6] === 2));
    }
    await sleep(350);
    await shot(page, 'v13-11-ferida-telegraph');
    await dbg(page, 'kill');
    // fogueira em estado crítico com invasores
    await dbg(page, 'event', 30, 'bonfire');
    await dbg(page, 'spawn', 5, 'shambler');
    await dbg(page, 'spawn', 2, 'werewolf');
    await sleep(3500);
    await shot(page, 'v13-12-fogueira');
    await dbg(page, 'kill');
    await dbg(page, 'challenge', 20, 'altar');
    await dbg(page, 'spawn', 6, 'shambler');
    await dbg(page, 'spawn', 1, 'ossuaryBearer');
    await sleep(4000);
    await shot(page, 'v13-13-altar');
    // fim da onda → tela de cartas com raridade
    await dbg(page, 'hold');
    await dbg(page, 'kill');
    await sleep(2500);
    await shot(page, 'v13-14-cartas');
    const errors = logs.filter((l) => l.includes('[pageerror]') || l.includes('[error]'));
    console.log('erros de console:', errors.length);
    if (errors.length) console.log(errors.join('\n'));
  } finally {
    await app.close();
  }
};

scenarios.enemies = async () => {
  const { app, page, logs } = await launch('show-enemies', []);
  await soloStart(page, 'tank');
  await dbg(page, 'god');
  for (const t of ['werewolf', 'father', 'acolyte', 'acolyte', 'runner', 'shambler']) await dbg(page, 'spawn', t === 'shambler' ? 5 : 1, t);
  for (let i = 0; i < 6; i++) {
    await sleep(700);
    await shot(page, `enemies-${i}`);
  }
  fs.writeFileSync(path.join(out, 'logs-enemies.txt'), logs.join('\n'));
  await app.close();
};

scenarios.boss = async () => {
  const wave = Number(rest[0] ?? 5);
  const { app, page, logs } = await launch('show-boss' + wave, []);
  await soloStart(page, 'hunter');
  await dbg(page, 'god');
  await dbg(page, 'wave', wave);
  await sleep(6200);
  for (let i = 0; i < 6; i++) {
    await shot(page, `boss${wave}-${i}`);
    await sleep(900);
  }
  fs.writeFileSync(path.join(out, `logs-boss${wave}.txt`), logs.join('\n'));
  await app.close();
};

scenarios.bossintro = async () => {
  const wave = Number(rest[0] ?? 10);
  const { app, page, logs } = await launch(`boss-intro-${wave}`);
  try {
    await soloStart(page, 'hunter');
    await dbg(page, 'god');
    await dbg(page, 'wave', wave);
    await page.waitForFunction(() => {
      const i = window.__app.session.latest()?.w.intro;
      return i && i.t > i.d - i.reveal;
    }, null, { timeout: wave % 10 === 5 ? 45000 : 13000 });
    await sleep(650);
    const reveal = await page.evaluate(() => {
      const { session } = window.__app;
      const intro = session.latest()?.w.intro;
      const enemy = session.latest()?.e.find((e) => e[0] === intro?.id);
      return { stateT: enemy?.[8], titleVisible: !!document.querySelector('#boss-intro') };
    });
    assert.ok(reveal.stateT >= 12, 'o sprite real do chefe deve aparecer antes do cartão');
    assert.equal(reveal.titleVisible, false);
    await shot(page, `boss-reveal-${wave}`);
    await page.waitForSelector('#boss-intro', { timeout: wave % 10 === 5 ? 45000 : 13000 });
    const before = await page.evaluate(() => {
      const { session, app, game } = window.__app;
      return { tick: session.latest()?.tick, id: session.latest()?.w.intro?.id,
        t: session.latest()?.w.intro?.t, music: app ? true : false,
        input: app.input.enabled, zoom: game.cameras.main.zoom };
    });
    assert.ok(before.id > 0);
    assert.equal(before.input, false);
    await sleep(450);
    await shot(page, `boss-intro-${wave}`);
    const during = await page.evaluate(() => ({ intro: window.__app.session.latest()?.w.intro, zoom: window.__app.game.cameras.main.zoom }));
    assert.equal(during.intro?.id, before.id);
    assert.ok(during.intro.t < before.t);
    assert.ok(during.zoom > 1);
    await page.waitForSelector('#boss-intro', { state: 'detached', timeout: 8000 });
    const after = await page.evaluate(() => ({ input: window.__app.app.input.enabled, zoom: window.__app.game.cameras.main.zoom }));
    assert.equal(after.input, true);
    await sleep(500);
    await shot(page, `boss-fight-${wave}`);
    if (logs.some((l) => l.includes('[pageerror]'))) throw new Error(logs.join('\n'));
    console.log('cinemática:', JSON.stringify({ reveal, before, during, after }));
  } finally {
    await app.close();
  }
};

scenarios.bossphases = async () => {
  const { app, page, logs } = await launch('boss-phases');
  try {
    await soloStart(page, 'hunter');
    await dbg(page, 'god');
    for (const wave of [10, 20, 30]) {
      await dbg(page, 'wave', wave);
      await page.waitForFunction((n) => window.__app.session.latest()?.w.n === n && !!window.__app.session.latest()?.w.intro, wave, { timeout: 18000 });
      await page.waitForSelector('#boss-intro', { timeout: 8000 });
      await sleep(700);
      await shot(page, `chapter-boss-intro-${wave}`);
      await page.waitForSelector('#boss-intro', { state: 'detached', timeout: 10000 });
      await dbg(page, 'phase');
      await page.waitForFunction((n) => {
        const s = window.__app.session.latest();
        return s?.w.n === n && s.e.some((e) => e[0] === s.w.boss && (e[12] & 16) !== 0);
      }, wave, { timeout: 12000 });
      await sleep(350);
      await shot(page, `chapter-boss-phase2-${wave}`);
      assert.equal(await page.locator('#boss-intro').count(), 0);
    }
    if (logs.some((l) => l.includes('[pageerror]'))) throw new Error(logs.join('\n'));
    console.log('fases 2 verificadas nas ondas 10, 20 e 30');
  } finally {
    await app.close();
  }
};

scenarios.brightness = async () => {
  const { app, page, logs } = await launch('brightness');
  try {
    await soloStart(page, 'hunter');
    await dbg(page, 'god');
    await shot(page, 'brightness-default');
    await page.keyboard.press('Escape');
    await clickText(page, 'Configurações');
    const slider = page.locator('#settings input[type=range]').nth(3);
    await slider.evaluate((el) => { el.value = '85'; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); });
    assert.equal(await page.evaluate(() => window.__app.game.brightness), 0.85);
    await page.waitForFunction(async () => (await window.vigilia.settings.load()).brightness === 0.85);
    await shot(page, 'brightness-settings');
    await clickText(page, 'Fechar');
    await page.keyboard.press('Escape');
    await sleep(200);
    await shot(page, 'brightness-85');
    if (logs.some((l) => l.includes('[pageerror]'))) throw new Error(logs.join('\n'));
  } finally {
    await app.close();
  }
};

scenarios.shaders = async () => {
  const { app, page, logs } = await launch('shaders-check');
  try {
    await soloStart(page, 'hunter');
    await dbg(page, 'god');
    await dbg(page, 'wave', 7);
    await sleep(1400);
    await shot(page, 'shaders-classic-village');
    await page.keyboard.press('Escape');
    await clickText(page, 'Configurações');
    await clickText(page, 'Shaders ambientais: desligados');
    assert.equal(await page.evaluate(() => window.__app.game.enhancedLighting), true);
    await page.waitForFunction(async () => (await window.vigilia.settings.load()).enhancedLighting === true);
    await clickText(page, 'Fechar');
    await page.keyboard.press('Escape');
    await sleep(700);
    await shot(page, 'shaders-enhanced-village');
    for (const [wave, name] of [[18, 'winter'], [25, 'abyss']]) {
      await dbg(page, 'wave', wave);
      await sleep(1800);
      await shot(page, `shaders-enhanced-${name}`);
    }
    await page.keyboard.press('Escape');
    await clickText(page, 'Configurações');
    await clickText(page, 'Shaders ambientais: ligados');
    assert.equal(await page.evaluate(() => window.__app.game.enhancedLighting), false);
    await page.waitForFunction(async () => (await window.vigilia.settings.load()).enhancedLighting === false);
    await clickText(page, 'Fechar');
    await page.keyboard.press('Escape');
    await sleep(300);
    await shot(page, 'shaders-classic-abyss');
    assert.ok(!logs.some((l) => l.includes('[pageerror]')), logs.join('\n'));
    fs.writeFileSync(path.join(out, 'logs-shaders.txt'), logs.join('\n'));
  } finally {
    await app.close();
  }
};

scenarios.duo = async () => {
  const A = await launch('duoA', []);
  const B = await launch('duoB', []);
  await sleep(800);
  await setName(A.page, 'Anfitriã');
  await clickText(A.page, 'Criar partida');
  await A.page.waitForSelector('select');
  const opts = await A.page.$$eval('select option', (o) => o.map((x) => x.value));
  console.log('interfaces oferecidas:', opts.join(', '));
  await shot(A.page, 'duo-A-host-form');
  await clickText(A.page, 'Criar partida');
  await A.page.waitForSelector('.classcard', { timeout: 15000 });
  const addr = await A.page.evaluate(() => window.__app.session.shareAddress);
  console.log('endereço exibido para amigos:', addr);
  if (!addr || addr.startsWith('0.0.0.0') || addr.startsWith('127.')) throw new Error('endereço inválido exibido: ' + addr);
  await setName(B.page, 'Convidado');
  await clickText(B.page, 'Entrar por IP');
  const [ip, port] = addr.split(':');
  await B.page.fill('input[placeholder="ex.: 26.12.34.56"]', ip);
  await B.page.locator('input[type=number]').fill(port);
  await clickText(B.page, 'Entrar');
  await B.page.waitForSelector('.classcard', { timeout: 15000 });
  // disputa simultânea pela mesma classe
  await Promise.all([A.page.evaluate(() => window.__app.session.send({ t: 'cls', cls: 'dog' })), B.page.evaluate(() => window.__app.session.send({ t: 'cls', cls: 'dog' }))]);
  await sleep(600);
  const lobby = await A.page.evaluate(() => window.__app.session.lobby.map((p) => `${p.name}:${p.cls}`));
  console.log('lobby após disputa:', lobby.join(' | '));
  await shot(A.page, 'duo-A-lobby');
  await shot(B.page, 'duo-B-lobby');
  const bHas = await B.page.evaluate(() => window.__app.session.me()?.cls);
  if (!bHas) await B.page.evaluate(() => window.__app.session.send({ t: 'cls', cls: 'vampire' }));
  const aHas = await A.page.evaluate(() => window.__app.session.me()?.cls);
  if (!aHas) await A.page.evaluate(() => window.__app.session.send({ t: 'cls', cls: 'tank' }));
  await sleep(300);
  await A.page.evaluate(() => window.__app.session.send({ t: 'ready', r: true }));
  await B.page.evaluate(() => window.__app.session.send({ t: 'ready', r: true }));
  await sleep(400);
  await clickText(A.page, 'Iniciar partida');
  await sleep(4500);
  const bardA = await A.page.evaluate(() => window.__app.session.latest()?.w.bd);
  const bardB = await B.page.evaluate(() => window.__app.session.latest()?.w.bd);
  assert.ok(bardA && bardB && String(bardA) === String(bardB), `bardo divergente entre clientes: ${bardA} / ${bardB}`);
  // ambos se movem
  await A.page.keyboard.down('KeyD');
  await B.page.keyboard.down('KeyS');
  await sleep(800);
  await A.page.keyboard.up('KeyD');
  await B.page.keyboard.up('KeyS');
  await sleep(500);
  const posA = await A.page.evaluate(() => window.__app.session.latest().p.map((p) => [p.id, p.x.toFixed(1), p.y.toFixed(1)].join(',')));
  const posB = await B.page.evaluate(() => window.__app.session.latest().p.map((p) => [p.id, p.x.toFixed(1), p.y.toFixed(1)].join(',')));
  console.log('estado visto por A:', posA.join(' | '));
  console.log('estado visto por B:', posB.join(' | '));
  await shot(A.page, 'duo-A-game');
  await shot(B.page, 'duo-B-game');
  // host fecha: B precisa receber mensagem clara
  await A.app.close();
  await sleep(2500);
  await shot(B.page, 'duo-B-host-closed');
  const txt = await B.page.evaluate(() => document.getElementById('ui').innerText);
  console.log('B após host sair:', txt.replace(/\s+/g, ' ').slice(0, 160));
  await B.app.close();
};

scenarios.flow = async () => {
  const { app, page, logs } = await launch('flow', []);
  await soloStart(page, 'mage');
  await dbg(page, 'god');
  await dbg(page, 'kill');
  await sleep(1500);
  // força fim da onda 1 limpando o que surgir
  for (let i = 0; i < 12; i++) {
    await dbg(page, 'kill');
    await sleep(700);
    const ph = await page.evaluate(() => window.__app.session.phase.phase);
    if (ph === 'intermission') break;
  }
  await page.waitForSelector('.upcard', { timeout: 30000 });
  await sleep(400);
  await shot(page, 'flow-1-upgrades');
  await page.locator('.upcard').nth(1).click();
  await sleep(300);
  await shot(page, 'flow-1b-selected');
  await clickText(page, 'Confirmar escolha');
  await sleep(600);
  await page.keyboard.down('Tab');
  await sleep(300);
  await shot(page, 'flow-2-tab');
  await page.keyboard.up('Tab');
  await page.keyboard.press('Escape');
  await sleep(300);
  await shot(page, 'flow-3-pause');
  await page.keyboard.press('Escape');
  await dbg(page, 'wave', 30);
  await sleep(4000);
  for (let i = 0; i < 20; i++) {
    await dbg(page, 'kill');
    await sleep(600);
    const ph = await page.evaluate(() => window.__app.session.phase.phase);
    if (ph === 'victory') break;
  }
  await sleep(2000);
  await shot(page, 'flow-4-victory');
  await clickText(page, 'Jogar novamente');
  await page.waitForSelector('.classcard', { timeout: 10000 });
  await sleep(500);
  await shot(page, 'flow-5-lobby-again');
  await clickText(page, 'Começar');
  await sleep(4500);
  const st = await page.evaluate(() => { const s = window.__app.session.latest(); return { wave: s.w.n, hp: s.p[0].hp, mhp: s.p[0].mhp, enemies: s.e.length }; });
  console.log('nova partida:', JSON.stringify(st));
  await shot(page, 'flow-6-new-match');
  fs.writeFileSync(path.join(out, 'logs-flow.txt'), logs.join('\n'));
  await app.close();
};

// Fim do capítulo I: melhoria confirmada, votação de rota, cinemática e chegada ao capítulo II.
scenarios.chapter = async () => {
  const from = Number(rest[0] ?? 10);
  const { app, page, logs } = await launch('chapter' + from, []);
  await soloStart(page, rest[1] ?? 'necromancer');
  await dbg(page, 'god');
  await dbg(page, 'wave', from);
  await page.waitForFunction((n) => window.__app.session.latest()?.w.n === n && !!window.__app.session.latest()?.w.intro, from, { timeout: 18000 });
  await page.waitForFunction((n) => window.__app.session.latest()?.w.n === n && !window.__app.session.latest()?.w.intro, from, { timeout: 10000 });
  for (let i = 0; i < 40; i++) {
    await dbg(page, 'kill');
    await sleep(600);
    const ph = await page.evaluate(() => window.__app.session.phase.phase);
    if (ph === 'intermission') break;
  }
  await page.waitForSelector('.upcard', { timeout: 30000 });
  await page.locator('.upcard').first().click();
  await clickText(page, 'Confirmar escolha');
  await page.waitForSelector('.routevote', { timeout: 40000 });
  await sleep(500);
  await shot(page, `ch${from}-1-route`);
  await page.locator('.routevote .upcard').first().click();
  await sleep(300);
  for (let i = 0; i < 6; i++) {
    await sleep(i === 0 ? 700 : 1400);
    await shot(page, `ch${from}-2-travel-${i}`);
  }
  await page.waitForFunction(() => window.__app.session.phase.phase === 'wave', null, { timeout: 15000 });
  await sleep(2500);
  await shot(page, `ch${from}-3-arrival`);
  await dbg(page, 'spawn', 6, 'shambler');
  await dbg(page, 'spawn', 2, 'werewolf');
  await sleep(1500);
  await shot(page, `ch${from}-4-climate-enemies`);
  fs.writeFileSync(path.join(out, `logs-chapter${from}.txt`), logs.join('\n'));
  await app.close();
};

// Necromante: cadáveres → servos, exército, essência no HUD.
scenarios.necro = async () => {
  const { app, page, logs } = await launch('necro', []);
  await soloStart(page, 'necromancer');
  await dbg(page, 'god');
  await dbg(page, 'spawn', 8, 'shambler');
  await sleep(600);
  await dbg(page, 'kill');
  await sleep(500);
  await shot(page, 'necro-1-corpses');
  await page.mouse.move(760, 330);
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press('KeyQ');
    await sleep(900);
  }
  await dbg(page, 'spawn', 6, 'shambler');
  await sleep(1200);
  await shot(page, 'necro-2-thralls');
  await dbg(page, 'ult');
  await sleep(200);
  await page.keyboard.press('KeyR');
  await sleep(900);
  await shot(page, 'necro-3-army');
  await sleep(1500);
  await shot(page, 'necro-4-army-later');
  fs.writeFileSync(path.join(out, 'logs-necro.txt'), logs.join('\n'));
  await app.close();
};

// Captura de uma onda específica (mapas, chefes, eventos).
scenarios.wave = async () => {
  const wave = Number(rest[0] ?? 11);
  const cls = rest[1] ?? 'berserker';
  const { app, page, logs } = await launch(`wave${wave}-${cls}`, []);
  await soloStart(page, cls);
  await dbg(page, 'god');
  await dbg(page, 'wave', wave);
  for (let i = 0; i < 7; i++) {
    await sleep(i === 0 ? 3500 : 1600);
    if (i === 3) {
      await page.mouse.move(820, 420);
      for (let k = 0; k < 4; k++) {
        await page.mouse.down();
        await sleep(90);
        await page.mouse.up();
        await sleep(110);
      }
      await page.keyboard.press('KeyQ');
    }
    await shot(page, `wave${wave}-${cls}-${i}`);
  }
  fs.writeFileSync(path.join(out, `logs-wave${wave}.txt`), logs.join('\n'));
  await app.close();
};

scenarios.guardian = async () => {
  const { app, page, logs } = await launch('guardian-check');
  try {
    await soloStart(page, 'tank');
    await dbg(page, 'god');
    let oldBard = null;
    for (const wave of [7, 18]) {
      await dbg(page, 'wave', wave);
      await page.waitForFunction((n) => {
        const s = window.__app.session.latest();
        return s?.w.n === n && !!s.w.bd && (s.m ?? []).some((m) => m[1] === 2);
      }, wave, { timeout: 12000 });
      const bard = await page.evaluate(() => window.__app.session.latest().w.bd);
      assert.ok(bard && (oldBard === null || String(bard) !== String(oldBard)), 'bardo ausente ou não mudou de local');
      oldBard = bard;
      await shot(page, `guardian-wave-${wave}`);
      await page.keyboard.down('KeyQ');
      await sleep(320);
      await shot(page, `guardian-guard-${wave}`);
      await page.keyboard.up('KeyQ');
      await page.keyboard.press('KeyE');
      await sleep(240);
      await shot(page, `guardian-dash-${wave}`);
      await dbg(page, 'ult');
      await sleep(180);
      await page.keyboard.press('KeyR');
      await sleep(550);
      await shot(page, `guardian-ultimate-${wave}`);
      await page.keyboard.press('KeyR');
      await sleep(250);
      await shot(page, `guardian-detonate-${wave}`);
    }
    assert.ok(!logs.some((l) => l.includes('[pageerror]')), logs.join('\n'));
    fs.writeFileSync(path.join(out, 'logs-guardian.txt'), logs.join('\n'));
  } finally {
    await app.close();
  }
};

scenarios.sizes = async () => {
  const { app, page } = await launch('sizes', []);
  await soloStart(page, 'dog');
  await dbg(page, 'god');
  await dbg(page, 'spawn', 6, 'shambler');
  for (const [w, h] of [[960, 540], [1366, 768], [1920, 1080], [800, 600]]) {
    await app.evaluate(({ BrowserWindow }, [w, h]) => BrowserWindow.getAllWindows()[0].setContentSize(w, h), [w, h]);
    await sleep(900);
    const info = await page.evaluate(() => ({ w: innerWidth, h: innerHeight, zoom: window.__game.scale.zoom, ui: document.getElementById('ui').style.transform }));
    console.log(`janela ${w}x${h}:`, JSON.stringify(info));
    await shot(page, `size-${w}x${h}`);
  }
  await app.close();
};

// Medição de renderização: ~100 inimigos ativos na tela e ao redor, FPS amostrado por 10 s.
scenarios.perf = async () => {
  const { app, page } = await launch('perf', []);
  await soloStart(page, 'tank');
  if (rest[0] === 'shaders') await page.evaluate(() => window.__app.game.setEnhancedLighting(true));
  await dbg(page, 'god');
  for (const [n, t] of [[60, 'shambler'], [20, 'runner'], [8, 'acolyte'], [6, 'werewolf'], [6, 'father']]) await dbg(page, 'spawn', n, t);
  await sleep(1500);
  const samples = [];
  for (let i = 0; i < 20; i++) {
    await page.mouse.move(700 + (i % 2) * 200, 400);
    await page.mouse.down();
    await sleep(250);
    await page.mouse.up();
    await sleep(250);
    samples.push(await page.evaluate(() => {
      const gs = window.__app.game;
      const avg = gs.fpsSamples.reduce((s, v) => s + v, 0) / Math.max(1, gs.fpsSamples.length);
      return { fps: Math.round(1000 / Math.max(1, avg)), enemies: window.__app.session.latest().e.length };
    }));
  }
  await shot(page, 'perf-100');
  const gl = await page.evaluate(() => {
    const c = document.createElement('canvas').getContext('webgl');
    const ext = c && c.getExtension('WEBGL_debug_renderer_info');
    return ext ? c.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'desconhecido';
  });
  const fps = samples.map((s) => s.fps).sort((a, b) => a - b);
  console.log(JSON.stringify({ renderizador: gl, inimigosMedia: Math.round(samples.reduce((s, v) => s + v.enemies, 0) / samples.length), fpsMediana: fps[Math.floor(fps.length / 2)], fpsMin: fps[0], fpsMax: fps[fps.length - 1] }));
  await app.close();
};

const fn = scenarios[scenario];
if (!fn) {
  console.error('cenário desconhecido');
  process.exit(1);
}
await fn();
