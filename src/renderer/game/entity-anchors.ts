/** Pontos de ancoragem visuais compartilhados (luzes presas a partes do sprite). */
export function survivorTorchAnchor(x: number, y: number, lift = 0): { x: number; y: number } {
  return { x: Math.round(x) + 10, y: Math.round(y) - 32 - lift };
}
