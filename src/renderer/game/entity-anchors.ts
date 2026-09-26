/** Ponto central da chama carregada pelo sobrevivente, em coordenadas do mundo. */
export function survivorTorchAnchor(x: number, y: number, flicker = 0): { x: number; y: number } {
  return { x: x + 10, y: y - 32 - flicker };
}
