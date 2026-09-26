/** Inicialização do renderer: configurações, Phaser (pixel art 640×360) e interface. */
import Phaser from 'phaser';
import { normalizeSettings } from '../shared/bridge.js';
import { VIEW_H, VIEW_W } from '../shared/constants.js';
import { audio } from './audio.js';
import { getBridge } from './bridge.js';
import { TravelScene } from './game/cinematic.js';
import { HudScene } from './game/hud.js';
import { InputCapture } from './game/input.js';
import { GameScene } from './game/scene.js';
import { Session } from './session.js';
import { App } from './ui/app.js';

async function boot(): Promise<void> {
  const bridge = getBridge();
  const settings = normalizeSettings(await bridge.settings.load());
  await document.fonts.load("11px 'Vigilia Pixel'").catch(() => undefined);
  const session = new Session();
  const input = new InputCapture(settings.keys);
  const game = new GameScene();
  const hud = new HudScene();
  const travel = new TravelScene();
  game.session = session;
  game.input2 = input;
  hud.game2 = game;
  hud.session = session;
  await new Promise<void>((resolve) => {
    const g = new Phaser.Game({
      type: Phaser.WEBGL,
      parent: 'game',
      width: VIEW_W,
      height: VIEW_H,
      backgroundColor: '#07070d',
      pixelArt: true,
      roundPixels: true,
      antialias: false,
      banner: false,
      audio: { noAudio: true },
      fps: { target: 60, smoothStep: true },
      scale: { mode: Phaser.Scale.NONE, zoom: 2 },
      input: { mouse: { preventDefaultWheel: false }, keyboard: false },
      scene: [],
      callbacks: {
        postBoot: () => {
          g.scene.add('game', game, true);
          g.scene.add('hud', hud, true);
          g.scene.add('travel', travel, true);
          resolve();
        },
      },
    });
    (window as unknown as { __game?: Phaser.Game }).__game = g;
  });
  const app = new App(session, settings, game, hud, input, travel);
  hud.keys = () => input.binds;
  app.applySettings();
  (window as unknown as { __app?: unknown }).__app = { app, session, game };
  audio.setVolumes(settings.volumeMaster, settings.volumeSfx, settings.volumeAmbience);
}

boot().catch((err: unknown) => {
  document.body.innerHTML = `<pre style="color:#ec6a5e;padding:16px;font-family:monospace">Falha ao iniciar: ${String(err instanceof Error ? err.stack : err)}</pre>`;
});
