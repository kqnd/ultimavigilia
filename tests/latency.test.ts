/**
 * Predição/reconciliação sob latência simulada (120 ms de ida e volta) contra o servidor real.
 * Como cliente e servidor usam a mesma função de movimento e a mesma colisão, as correções
 * devem ser mínimas ao andar, esquivar e deslizar em paredes.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { Predictor } from '../src/renderer/game/predict.js';
import { type RunningServer, startServer } from '../src/server/net.js';
import { BTN, type InputFrame } from '../src/shared/movement.js';
import type { ServerMessage } from '../src/shared/protocol.js';
import { Bot, sleep } from './helpers/bot.js';

let srv: RunningServer | null = null;
afterAll(async () => {
  if (srv) await srv.close('fim');
});

describe('latência simulada', () => {
  it('movimento previsto converge com o autoritativo (RTT 120 ms)', async () => {
    srv = await startServer({ host: '127.0.0.1', port: 0, password: '', maxPlayers: 2, hostKey: 'k', solo: false, seed: 3 });
    const bot = new Bot(`ws://127.0.0.1:${srv.port}`, 'Lag', { hostKey: 'k' });
    await bot.join();
    bot.send({ t: 'cls', cls: 'vampire' });
    bot.send({ t: 'ready', r: true });
    await sleep(50);
    bot.send({ t: 'start' });
    const first = await bot.wait<Extract<ServerMessage, { t: 'snap' }>>((m) => m.t === 'snap');
    srv.room.world.god = true;
    const pred = new Predictor();
    const me = first.p.find((p) => p.id === bot.id);
    pred.reset(me?.x ?? 0, me?.y ?? 0, 'vampire');
    const HALF = 60;
    const errors: number[] = [];
    let reconciles = 0;
    bot.ws.on('message', (d: Buffer) => {
      const m = JSON.parse(d.toString()) as ServerMessage;
      if (m.t !== 'snap' || !m.you) return;
      const you = m.you;
      setTimeout(() => {
        const before = { x: pred.state.x, y: pred.state.y };
        pred.reconcile(you);
        errors.push(Math.hypot(before.x - pred.state.x, before.y - pred.state.y));
        reconciles++;
      }, HALF);
    });
    // roteiro: direita (até a parede/obstáculo), esquiva, baixo, diagonal
    const script = (t: number): Partial<InputFrame> => {
      if (t < 45) return { mx: 1, my: 0 };
      if (t === 45) return { mx: 1, my: 0, pressed: BTN.dodge };
      if (t < 90) return { mx: 0, my: 1 };
      return { mx: -0.7071, my: -0.7071 };
    };
    for (let t = 0; t < 130; t++) {
      pred.seq++;
      const f: InputFrame = { seq: pred.seq, mx: 0, my: 0, ax: pred.state.x + 50, ay: pred.state.y, held: 0, pressed: 0, ...script(t) };
      pred.step(f);
      const tuple = [f.seq, f.mx, f.my, f.ax, f.ay, f.held, f.pressed];
      setTimeout(() => bot.send({ t: 'in', i: [tuple] }), HALF);
      await sleep(33.3);
    }
    await sleep(400);
    bot.close();
    const sorted = [...errors].sort((a, b) => a - b);
    const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? 0;
    console.log(`reconciliações: ${reconciles}, correção média ${(errors.reduce((a, b) => a + b, 0) / errors.length).toFixed(3)}px, p95 ${p95.toFixed(3)}px, máx ${Math.max(...errors).toFixed(3)}px`);
    expect(reconciles).toBeGreaterThan(40);
    // tolera pequenas divergências de fase (ex.: o servidor agrupa 2 inputs num tick)
    expect(p95).toBeLessThan(1.5);
    // a posição final prevista coincide com a do servidor
    const sp = srv.room.world.players.get(bot.id);
    expect(Math.hypot((sp?.x ?? 0) - pred.state.x, (sp?.y ?? 0) - pred.state.y)).toBeLessThan(1);
  });
});
