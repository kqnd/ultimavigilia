import type { VigiliaBridge } from '../shared/bridge.js';

declare global {
  interface Window {
    vigilia?: VigiliaBridge;
  }
}

export function getBridge(): VigiliaBridge {
  const b = window.vigilia;
  if (!b) throw new Error('Ponte do Electron indisponível (preload não carregou).');
  return b;
}
