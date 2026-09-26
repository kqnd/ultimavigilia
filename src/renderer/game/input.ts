/** Captura de teclado/mouse com remapeamento. Perder o foco limpa todos os inputs. */
import type { Keybinds } from '../../shared/bridge.js';
import { BTN } from '../../shared/movement.js';

export class InputCapture {
  private down = new Set<string>();
  private mouse = false;
  private pressedAcc = 0;
  enabled = false;
  binds: Keybinds;
  mouseX = 320;
  mouseY = 180;
  onKey: ((code: string, down: boolean, e: KeyboardEvent) => void) | null = null;

  constructor(binds: Keybinds) {
    this.binds = binds;
    window.addEventListener('keydown', (e) => this.key(e, true));
    window.addEventListener('keyup', (e) => this.key(e, false));
    window.addEventListener('mousedown', (e) => {
      if (e.button !== 0 || !this.enabled || !(e.target instanceof HTMLCanvasElement)) return;
      this.mouse = true;
      this.pressedAcc |= BTN.attack;
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouse = false;
    });
    window.addEventListener('blur', () => this.clear());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.clear();
    });
    window.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  clear(): void {
    this.down.clear();
    this.mouse = false;
    this.pressedAcc = 0;
  }

  private key(e: KeyboardEvent, isDown: boolean): void {
    const t = e.target as HTMLElement | null;
    const typing = t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA');
    if (typing) return;
    if (e.code === 'Tab' || e.code === 'F1' || e.code === 'F9' || e.code === 'Space' || (this.enabled && e.code === this.binds.team)) e.preventDefault();
    this.onKey?.(e.code, isDown, e);
    if (!this.enabled) return;
    if (isDown) {
      if (!this.down.has(e.code) && !e.repeat) {
        const b = this.buttonFor(e.code);
        if (b) this.pressedAcc |= b;
      }
      this.down.add(e.code);
    } else this.down.delete(e.code);
  }

  private buttonFor(code: string): number {
    const k = this.binds;
    if (code === k.dodge) return BTN.dodge;
    if (code === k.q) return BTN.q;
    if (code === k.e) return BTN.e;
    if (code === k.r) return BTN.r;
    if (code === k.interact) return BTN.interact;
    return 0;
  }

  isDown(code: string): boolean {
    return this.down.has(code);
  }

  /** Coleta o estado para um tick: movimento, botões segurados e bordas acumuladas. */
  sample(): { mx: number; my: number; held: number; pressed: number } {
    if (!this.enabled) {
      this.pressedAcc = 0;
      return { mx: 0, my: 0, held: 0, pressed: 0 };
    }
    const k = this.binds;
    const mx = (this.down.has(k.right) ? 1 : 0) - (this.down.has(k.left) ? 1 : 0);
    const my = (this.down.has(k.down) ? 1 : 0) - (this.down.has(k.up) ? 1 : 0);
    let held = 0;
    if (this.mouse) held |= BTN.attack;
    if (this.down.has(k.dodge)) held |= BTN.dodge;
    if (this.down.has(k.q)) held |= BTN.q;
    if (this.down.has(k.e)) held |= BTN.e;
    if (this.down.has(k.r)) held |= BTN.r;
    if (this.down.has(k.interact)) held |= BTN.interact;
    // segurar o botão de ataque repete golpes (o servidor encadeia quando possível)
    let pressed = this.pressedAcc;
    if (this.mouse) pressed |= BTN.attack;
    this.pressedAcc = 0;
    const l = Math.hypot(mx, my);
    return { mx: l > 0 ? mx / l : 0, my: l > 0 ? my / l : 0, held, pressed };
  }
}

/** Nome legível de uma tecla (e.code). */
export function keyLabel(code: string): string {
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  const map: Record<string, string> = {
    Space: 'Espaço', Tab: 'Tab', ShiftLeft: 'Shift', ShiftRight: 'Shift D', ControlLeft: 'Ctrl', ControlRight: 'Ctrl D', AltLeft: 'Alt',
    ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Escape: 'Esc', Enter: 'Enter', Backquote: '`', CapsLock: 'Caps',
  };
  return map[code] ?? code.replace('Numpad', 'Num ');
}
