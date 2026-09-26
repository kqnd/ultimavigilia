import { describe, expect, it } from 'vitest';
import { bardSpatial } from '../src/renderer/audio.js';

describe('áudio espacial do bardo', () => {
  it('centraliza fontes à frente/atrás e separa esquerda/direita', () => {
    expect(bardSpatial(0, -100, 0, 0).pan).toBe(0);
    expect(bardSpatial(0, 100, 0, 0).pan).toBe(0);
    expect(bardSpatial(-200, 0, 0, 0).pan).toBeLessThan(-0.8);
    expect(bardSpatial(200, 0, 0, 0).pan).toBeGreaterThan(0.8);
  });

  it('atenua continuamente com a distância e silencia além do alcance', () => {
    const near = bardSpatial(10, 0, 0, 0).gain;
    const middle = bardSpatial(250, 0, 0, 0).gain;
    const far = bardSpatial(500, 0, 0, 0).gain;
    expect(near).toBeGreaterThan(middle);
    expect(middle).toBeGreaterThan(far);
    expect(far).toBeGreaterThan(0);
    expect(bardSpatial(600, 0, 0, 0).gain).toBe(0);
  });
});
