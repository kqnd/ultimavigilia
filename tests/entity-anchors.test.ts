import { describe, expect, it } from 'vitest';
import { survivorTorchAnchor } from '../src/renderer/game/entity-anchors.js';

describe('âncoras visuais de entidades', () => {
  it('mantém a luz presa ao centro da chama da tocha do sobrevivente', () => {
    expect(survivorTorchAnchor(400, 300)).toEqual({ x: 410, y: 268 });
    expect(survivorTorchAnchor(400, 300, 1)).toEqual({ x: 410, y: 267 });
  });
});
