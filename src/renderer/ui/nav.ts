/**
 * Navegação de menus por teclado e gamepad.
 *
 * Atua apenas dentro do "escopo" ativo (o painel/tela de menu no topo, informado pelo app) e fica
 * inerte durante a partida. Garante sempre um controle focado ao abrir uma tela, move o foco
 * espacialmente (setas / D-pad / analógico), ativa com Enter/Espaço/A, volta com Esc/B e ajusta
 * sliders e seletores com esquerda/direita.
 */

const FOCUSABLE = 'button:not([disabled]), [tabindex="0"]:not([aria-disabled="true"]), input:not([type=hidden]):not([disabled]), select:not([disabled])';

export interface NavHooks {
  /** Elemento do menu no topo (null = nenhum menu aberto, ex.: em combate). */
  scope(): HTMLElement | null;
  /** Voltar/fechar (Esc, B). */
  back(): void;
  /** Botão Start do gamepad (ex.: pausar em partida). */
  start(): void;
  /** Identifica a tela atual: mudou = foco inicial novo (não tenta restaurar o item anterior). */
  token?(): string;
  /** Som de movimento de foco. */
  moved(): void;
}

type Dir = 'up' | 'down' | 'left' | 'right';

export class MenuNav {
  private lastScope: HTMLElement | null = null;
  private lastKey = '';
  private lastToken = '';
  private lastIdx = 0;
  private raf = 0;
  private padHeld = new Map<string, number>();
  /** Teclas/botões em remapeamento: a navegação se cala. */
  suspended = false;

  constructor(
    private readonly root: HTMLElement,
    private readonly hooks: NavHooks,
  ) {
    window.addEventListener('keydown', (e) => this.onKey(e), true);
    window.addEventListener('mousemove', () => this.setKbd(false));
    root.addEventListener('focusin', () => this.remember());
    new MutationObserver(() => this.schedule()).observe(root, { childList: true, subtree: true });
    const loop = (): void => {
      this.pollPad();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  private setKbd(on: boolean): void {
    this.root.classList.toggle('kbd', on);
  }

  private items(scope: HTMLElement): HTMLElement[] {
    return [...scope.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.getClientRects().length > 0);
  }

  private remember(): void {
    const scope = this.hooks.scope();
    const a = document.activeElement as HTMLElement | null;
    if (!scope || !a || !scope.contains(a)) return;
    this.lastKey = (a.textContent ?? '').trim();
    this.lastIdx = this.items(scope).indexOf(a);
  }

  private schedule(): void {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      this.ensureFocus();
    });
  }

  /** Sempre há algo focado quando um menu está aberto; se o foco se perdeu (tela redesenhada), recupera. */
  private ensureFocus(): void {
    const scope = this.hooks.scope();
    if (!scope) {
      this.lastScope = null;
      return;
    }
    const a = document.activeElement as HTMLElement | null;
    const token = this.hooks.token?.() ?? '';
    const changed = scope !== this.lastScope || token !== this.lastToken;
    this.lastScope = scope;
    this.lastToken = token;
    if (!changed && a && scope.contains(a) && a.isConnected) return;
    if (a && scope.contains(a) && a.isConnected) return;
    const items = this.items(scope);
    if (!items.length) return;
    let target: HTMLElement | undefined;
    if (!changed) {
      // mesma tela redesenhada (ex.: lobby): volta ao mesmo item
      target = items.find((el) => (el.textContent ?? '').trim() === this.lastKey && this.lastKey !== '');
      if (!target && items[this.lastIdx]) target = items[this.lastIdx];
    }
    target ??= scope.querySelector<HTMLElement>('[data-autofocus]') ?? scope.querySelector<HTMLElement>('.btn.primary:not([disabled])') ?? items[0];
    target?.focus({ preventScroll: true });
  }

  private move(dir: Dir): void {
    const scope = this.hooks.scope();
    if (!scope) return;
    this.setKbd(true);
    const items = this.items(scope);
    if (!items.length) return;
    const cur = document.activeElement as HTMLElement | null;
    if (!cur || !scope.contains(cur) || !items.includes(cur)) {
      items[0]?.focus();
      return;
    }
    const r = cur.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    let best: HTMLElement | null = null;
    let bestScore = Infinity;
    for (const el of items) {
      if (el === cur) continue;
      const b = el.getBoundingClientRect();
      const dx = b.left + b.width / 2 - cx;
      const dy = b.top + b.height / 2 - cy;
      const along = dir === 'right' ? dx : dir === 'left' ? -dx : dir === 'down' ? dy : -dy;
      const across = dir === 'left' || dir === 'right' ? Math.abs(dy) : Math.abs(dx);
      if (along <= 0.5) continue;
      const score = along + across * 2.2;
      if (score < bestScore) {
        bestScore = score;
        best = el;
      }
    }
    if (!best) return;
    best.focus({ preventScroll: true });
    best.scrollIntoView({ block: 'nearest' });
    this.hooks.moved();
  }

  /** Esquerda/direita sobre slider ou seletor ajusta o valor. Retorna se tratou. */
  private adjust(el: HTMLElement, delta: number): boolean {
    if (el instanceof HTMLInputElement && el.type === 'range') {
      const step = 5 * delta;
      el.value = String(Math.max(Number(el.min || 0), Math.min(Number(el.max || 100), Number(el.value) + step)));
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }
    if (el instanceof HTMLSelectElement) {
      const i = Math.max(0, Math.min(el.options.length - 1, el.selectedIndex + delta));
      if (i !== el.selectedIndex) {
        el.selectedIndex = i;
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }
      return true;
    }
    return false;
  }

  private activate(): void {
    const a = document.activeElement as HTMLElement | null;
    const scope = this.hooks.scope();
    if (!a || !scope || !scope.contains(a)) return;
    if (a instanceof HTMLInputElement && a.type !== 'checkbox') return;
    a.click();
  }

  private onKey(e: KeyboardEvent): void {
    if (this.suspended) return;
    const scope = this.hooks.scope();
    if (!scope) return;
    const a = document.activeElement as HTMLElement | null;
    const inText = a instanceof HTMLInputElement && a.type !== 'range';
    const dirs: Record<string, Dir> = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };
    const dir = dirs[e.code];
    if (dir) {
      if (inText && (dir === 'left' || dir === 'right')) return;
      if (a && (dir === 'left' || dir === 'right') && this.adjust(a, dir === 'right' ? 1 : -1)) {
        e.preventDefault();
        e.stopPropagation();
        this.setKbd(true);
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      this.move(dir);
      return;
    }
    if ((e.code === 'Enter' || e.code === 'NumpadEnter' || e.code === 'Space') && a && scope.contains(a) && !(a instanceof HTMLInputElement) && !(a instanceof HTMLSelectElement)) {
      // Enter/Espaço ativam o item focado (Espaço é engolido pela captura de teclado do jogo)
      e.preventDefault();
      e.stopPropagation();
      if (!e.repeat) {
        this.setKbd(true);
        this.activate();
      }
    }
  }

  // ---------------------------------------------------------------- gamepad

  private fire(key: string, down: boolean, now: number, action: () => void): void {
    if (!down) {
      this.padHeld.delete(key);
      return;
    }
    const next = this.padHeld.get(key);
    if (next === undefined) {
      this.padHeld.set(key, now + 380);
      action();
    } else if (now >= next) {
      this.padHeld.set(key, now + 120);
      action();
    }
  }

  private pollPad(): void {
    if (typeof navigator.getGamepads !== 'function') return;
    const pad = [...navigator.getGamepads()].find((p) => p && p.connected);
    if (!pad) return;
    const now = performance.now();
    const b = (i: number): boolean => !!pad.buttons[i]?.pressed;
    const ax = pad.axes[0] ?? 0;
    const ay = pad.axes[1] ?? 0;
    const edge = (key: string, down: boolean, action: () => void): void => this.fire(key, down, now, action);
    const scope = this.hooks.scope();
    // Start sempre disponível (pausa em partida); o resto só com menu aberto
    this.press('start', b(9), () => this.hooks.start());
    if (!scope) return;
    const step = (dir: Dir): void => {
      this.setKbd(true);
      const a = document.activeElement as HTMLElement | null;
      if (a && scope.contains(a) && (dir === 'left' || dir === 'right') && this.adjust(a, dir === 'right' ? 1 : -1)) return;
      this.move(dir);
    };
    edge('up', b(12) || ay < -0.55, () => step('up'));
    edge('down', b(13) || ay > 0.55, () => step('down'));
    edge('left', b(14) || ax < -0.55, () => step('left'));
    edge('right', b(15) || ax > 0.55, () => step('right'));
    this.press('a', b(0), () => {
      this.setKbd(true);
      this.activate();
    });
    this.press('b', b(1), () => this.hooks.back());
  }

  /** Botão sem repetição (A, B, Start). */
  private press(key: string, down: boolean, action: () => void): void {
    if (!down) {
      this.padHeld.delete(key);
      return;
    }
    if (this.padHeld.has(key)) return;
    this.padHeld.set(key, Infinity);
    action();
  }
}
