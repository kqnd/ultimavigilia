/**
 * Controlador da aplicação: telas DOM (menu, criar/entrar, lobby, melhorias, resultados,
 * configurações, pausa) e integração com a sessão de rede e as cenas Phaser.
 */
import { ABILITY_ICONS } from '../../art/icons.js';
import { DEFAULT_KEYS, type HostStartResult, type Keybinds, type NetInterfaceInfo, type Settings, WINDOW_SIZES } from '../../shared/bridge.js';
import { CHAPTERS, type Climate, ROUTE, TRAVEL_SECONDS } from '../../shared/config/chapters.js';
import { CLASS_IDS, CLASSES, type ClassId } from '../../shared/config/classes.js';
import { ENEMIES, ENEMY_TYPES } from '../../shared/config/enemies.js';
import { CAP_TEXT, FORKS, KIND_INFO, RARITY_INFO, UPGRADE_BY_ID, UPGRADE_CAPS, type UpgradeDef } from '../../shared/config/upgrades.js';
import { TOTAL_WAVES, WAVES } from '../../shared/config/waves.js';
import { DEFAULT_PORT, GAME_VERSION, MAX_PLAYERS, VIEW_H, VIEW_W } from '../../shared/constants.js';
import type { GameEvent, LobbyPlayer, WaveInfo } from '../../shared/protocol.js';
import { formatBytes, type UpdateStatus } from '../../shared/update.js';
import { audio } from '../audio.js';
import type { TravelScene } from '../game/cinematic.js';
import type { HudScene } from '../game/hud.js';
import { type InputCapture, keyLabel } from '../game/input.js';
import type { GameScene } from '../game/scene.js';
import { tf } from '../game/textures.js';
import type { Session } from '../session.js';
import { classSprite, h, iconEl, stars } from './dom.js';
import { MenuNav } from './nav.js';

type Screen = 'menu' | 'host' | 'join' | 'connecting' | 'lobby' | 'match' | 'results';

/** Dica de mecânica exibida na apresentação de cada chefe/minichefe. */
const BOSS_TIPS: Partial<Record<string, string>> = {
  moonDevourer: 'Quebre as Luas Falsas para expô-lo.',
  frostBride: 'Fuja dos espinhos de gelo e da nova; os estilhaços vêm em leque.',
  patriarch: 'Derrube os três Totens do Abismo para romper a proteção.',
  alphaWolf: 'Esquive do bote: o Alfa salta sobre quem mantém distância.',
  highAcolyte: 'Interrompa as runas; os orbes vêm em leque.',
  elderFather: 'O chinelo vai e volta: saia da trajetória duas vezes.',
};

const IPV4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;

const DIAG =
  'Dicas:\n· Confira IP e porta com o anfitrião (ele vê o endereço no lobby).\n· Na Radmin VPN, os dois precisam estar na mesma rede e aparecer como online.\n· No PC do anfitrião, permita o Última Vigília no Firewall do Windows. A Radmin VPN costuma ser classificada como rede Pública: marque também essa opção, ou libere só a porta TCP escolhida. Não é preciso desativar o firewall.';

/** Primeira frase do efeito (curta) para a face da carta; o texto completo vai no tooltip. */
function shortDesc(desc: string): string {
  const t = desc.replace(/^BIFURCAÇÃO:\s*/, '');
  const first = t.split(/(?<=[.;])\s/)[0] ?? t;
  if (first.length <= 70) return first;
  const cut = first.slice(0, 68);
  return `${cut.slice(0, cut.lastIndexOf(' ') > 40 ? cut.lastIndexOf(' ') : 68)}…`;
}

/** Comparação simples na carta: valor atual → valor com mais um acúmulo. */
function compareLine(u: UpgradeDef, have: number): string {
  const sh = u.show;
  if (!sh) return '';
  const fmt = (n: number): string => {
    const v = sh.pct ? Math.round(n * 1000) / 10 : Math.round(n * 100) / 100;
    return `${sh.sign}${v}${sh.pct ? '%' : sh.unit}`;
  };
  return `${sh.label}: ${have > 0 ? fmt(u.value * have) : '0'} → ${fmt(u.value * (have + 1))}`;
}

export class App {
  private root: HTMLElement;
  private layer: HTMLElement;
  private overlay: HTMLElement;
  private toasts: HTMLElement;
  private screen: Screen = 'menu';
  private settingsOpen = false;
  private pauseOpen = false;
  private tabOpen = false;
  private skillsOpen = false;
  private introId = 0;
  private introShown = false;
  private interfaces: NetInterfaceInfo[] = [];
  private lastError = '';
  private userLeaving = false;
  /** Atualizações: estado atual, se já se procurou nesta sessão e se o jogador dispensou o aviso. */
  private update: UpdateStatus = { state: 'idle' };
  private updateChecked = false;
  private updateDismissed = false;
  private nav: MenuNav;
  /** Onda do último checkpoint salvo nesta partida (0 = nenhum ainda). */
  private checkpointWave = 0;

  constructor(
    private readonly session: Session,
    private settings: Settings,
    private readonly game: GameScene,
    private readonly hud: HudScene,
    private readonly input: InputCapture,
    private readonly travel: TravelScene,
  ) {
    this.root = document.getElementById('ui') as HTMLElement;
    this.layer = h('div', { class: 'layer' });
    this.overlay = h('div', { class: 'layer passthrough' });
    this.toasts = h('div', { class: 'layer passthrough' });
    this.root.append(this.layer, this.overlay, this.toasts);
    this.hud.hintsSeen = new Set(this.settings.hintsSeen);
    this.hud.onHintSeen = (id) => {
      if (this.settings.hintsSeen.includes(id)) return;
      this.settings.hintsSeen.push(id);
      void this.saveSettings();
    };
    this.nav = new MenuNav(this.root, {
      scope: () => this.menuScope(),
      back: () => this.back(),
      start: () => {
        if (this.screen === 'match' && !this.settingsOpen && !this.introId) this.togglePause();
      },
      token: () => this.screen,
      moved: () => audio.play('uiHover'),
    });
    this.wire();
    this.initUpdates();
    this.fit();
    window.addEventListener('resize', () => this.fit());
    this.go('menu');
  }

  // ---------------------------------------------------------------- infraestrutura

  /** Mesmo fator de escala do canvas: inteiro sempre que possível. */
  fit(): void {
    const w = window.innerWidth;
    const hgt = window.innerHeight;
    const fitK = Math.min(w / 640, hgt / 360);
    // Modo inteiro: tolera até 2% de corte para não cair um fator inteiro por 1–2 px
    // (ex.: janela 1919×1079 usa 3×). Modo "preencher": fator fracionário, sem bordas.
    const k = fitK < 1 || this.settings.pixelScale === 'fit' ? fitK : Math.floor(fitK * 1.02);
    this.game.scale.setZoom(k);
    this.root.style.transform = `scale(${k})`;
    this.root.style.left = `${Math.round((w - 640 * k) / 2)}px`;
    this.root.style.top = `${Math.round((hgt - 360 * k) / 2)}px`;
  }

  /** Converte coordenadas da janela usando o canvas exibido como referência exata. */
  toLogical(cx: number, cy: number): { x: number; y: number } {
    const canvas = document.querySelector('#game canvas');
    const r = canvas?.getBoundingClientRect() ?? this.root.getBoundingClientRect();
    return { x: (cx - r.left) * VIEW_W / r.width, y: (cy - r.top) * VIEW_H / r.height };
  }

  private toast(text: string, warn = false, ms = 3500): void {
    const t = h('div', { class: `toast fade-in${warn ? ' warn' : ''}`, text });
    t.style.top = `${46 + this.toasts.children.length * 16}px`;
    this.toasts.append(t);
    setTimeout(() => t.remove(), ms);
  }

  private async saveSettings(): Promise<void> {
    // Mescla no MESMO objeto: o painel de configurações mantém uma referência a ele,
    // e trocar a referência faria as alterações seguintes se perderem.
    Object.assign(this.settings, await this.session.bridge.settings.save(this.settings));
    this.applySettings();
  }

  applySettings(): void {
    const s = this.settings;
    audio.setVolumes(s.volumeMaster, s.volumeSfx, s.volumeAmbience);
    this.game.fx.settings = { shake: s.reduceMotion ? 0 : s.shake, flashes: s.reduceMotion ? Math.min(s.flashes, 0.3) : s.flashes, damageNumbers: s.damageNumbers, glow: s.skillGlow };
    this.game.brightness = s.brightness;
    this.game.setEnhancedLighting(s.enhancedLighting);
    this.input.binds = s.keys;
    // acessibilidade (HUD em Phaser + menus em DOM)
    this.hud.highContrast = s.highContrast;
    this.hud.reduceMotion = s.reduceMotion;
    this.hud.hintsOn = s.hints;
    document.body.classList.toggle('hc', s.highContrast);
    document.body.classList.toggle('rm', s.reduceMotion);
    this.root.style.setProperty('--uis', String(s.uiScale));
  }

  /** Menu no topo (recebe a navegação por teclado/gamepad); null durante o combate. */
  private menuScope(): HTMLElement | null {
    const byId = (id: string): HTMLElement | null => document.getElementById(id);
    const found = byId('settings') ?? byId('modal') ?? byId('pause') ?? this.overlay.querySelector<HTMLElement>('.upgrades, .routevote');
    if (found) return found;
    return this.screen === 'match' ? null : this.layer;
  }

  /** Voltar/fechar o menu atual (Esc e botão B). */
  private back(): void {
    const modal = document.getElementById('modal');
    if (this.settingsOpen) this.closeSettings();
    else if (modal) modal.remove();
    else if (this.screen === 'match' && !this.introId) this.togglePause();
    else if (this.screen === 'host' || this.screen === 'join') this.go('menu');
  }

  private wire(): void {
    const s = this.session;
    s.onLobby.on(() => {
      if (this.screen === 'lobby') this.renderLobby();
    });
    s.onWelcome.on((re) => {
      if (re) this.toast('Reconectado à partida.');
      if (s.phase.phase === 'lobby' || this.screen === 'connecting') this.go(s.phase.phase === 'lobby' ? 'lobby' : 'match');
    });
    s.onReject.on((msg) => {
      this.lastError = msg;
    });
    s.onClassDenied.on(({ cls, by }) => {
      this.toast(`${CLASSES[cls].name} já está ocupado por ${by}.`, true);
      audio.play('deny');
    });
    s.onPhase.on((p) => {
      if (p.phase !== 'wave') {
        this.hideBossIntro();
        audio.stopBossTheme();
      }
      if (p.phase === 'lobby') {
        this.checkpointWave = 0;
        this.game.toMenu();
        this.input.enabled = false;
        if (s.connected) this.go('lobby');
      } else if (p.phase === 'wave') {
        audio.stopBossTheme();
        if (this.screen !== 'match') {
          this.game.startMatch();
          this.go('match');
        }
        this.travel.finish();
        this.clearOverlayPanels();
        this.input.enabled = !this.pauseOpen;
        const def = WAVES[p.wave - 1];
        const ch = CHAPTERS[p.ch - 1];
        const first = ch && p.wave === ch.firstWave;
        const label = first && ch ? `${ch.name} — ${def?.title ?? ''}` : (def?.title ?? '');
        if (def?.boss) {
          this.hud.showBanner(`ONDA ${p.wave}`, label, 0xec6a5e, 3200, 'boss');
          audio.play('bossWarn');
        } else if (def?.miniboss) {
          this.hud.showBanner(`ONDA ${p.wave}`, label, 0xe07cff, 3000, 'mini');
          audio.play('waveStart');
        } else {
          this.hud.showBanner(`ONDA ${p.wave}`, label, 0xf6c257, first ? 3400 : 2600, 'wave');
          audio.play('waveStart');
        }
      } else if (p.phase === 'intermission') {
        if (this.screen !== 'match') {
          this.game.startMatch();
          this.go('match');
        }
        audio.play('waveClear');
        this.hud.showBanner('ONDA SUPERADA', 'Escolha uma melhoria', 0x7fc47a, 2200);
      } else if (p.phase === 'route') {
        if (this.screen !== 'match') {
          this.game.startMatch();
          this.go('match');
        }
        this.clearOverlayPanels();
        this.hud.showBanner('FIM DO CAPÍTULO', 'A equipe decide o caminho', 0xf6c257, 2400);
        this.renderRoute();
      } else if (p.phase === 'travel') {
        if (this.screen !== 'match') {
          this.game.startMatch();
          this.go('match');
        }
        this.clearOverlayPanels();
        this.startTravel(p.ch, p.route, p.tm);
      } else if (p.phase === 'victory' || p.phase === 'defeat') {
        this.travel.finish();
        audio.play(p.phase === 'victory' ? 'victory' : 'defeat');
        this.input.enabled = false;
        this.input.clear();
        setTimeout(() => this.go('results'), 1200);
      }
    });
    s.onOffer.on(() => this.renderUpgrades());
    s.onRoute.on(() => this.renderRoute());
    s.onNotice.on((n) => this.toast(n.text, n.kind === 'warn'));
    s.onPing.on((p) => this.game.ping(p.x, p.y, p.from));
    s.onPaused.on(() => undefined);
    s.onSnap.on((snap) => {
      this.game.onSnapshot(snap);
      this.syncBossIntro(snap.w.intro);
    });
    s.onEvents.on((evs) => this.onEvents(evs));
    s.onClosing.on((reason) => {
      this.lastError = reason;
    });
    s.onStatus.on((st) => {
      if (st.state === 'reconnecting') {
        this.showReconnect(st.secondsLeft);
      } else if (st.state === 'open') {
        document.getElementById('reconnect')?.remove();
      } else if (st.state === 'closed') {
        document.getElementById('reconnect')?.remove();
        if (this.userLeaving) {
          this.userLeaving = false;
          return;
        }
        const msg = this.lastError || st.reason;
        this.lastError = '';
        void this.leave(false).then(() => this.modal(st.code === 'host' ? 'Partida encerrada' : 'Conexão encerrada', msg + (st.code === 'refused' || st.code === 'lost' ? `\n\n${DIAG}` : '')));
      }
    });
    this.game.onLocalEvent = (ev) => this.onLocalEvent(ev);
    this.input.onKey = (code, down, e) => this.onKey(code, down, e);
    window.addEventListener('mousedown', (e) => {
      audio.unlock();
      if (this.screen === 'match' && this.input.enabled && e.button === 2 && e.target instanceof HTMLCanvasElement) {
        const p = this.toLogical(e.clientX, e.clientY);
        this.input.mouseX = Math.max(0, Math.min(640, p.x));
        this.input.mouseY = Math.max(0, Math.min(360, p.y));
        const wp = this.game.screenToWorld(this.input.mouseX, this.input.mouseY);
        this.game.setMoveTarget(Math.round(wp.x), Math.round(wp.y));
        e.preventDefault();
      }
      if (this.screen === 'match' && e.button === 0 && e.target instanceof HTMLCanvasElement) {
        const me = this.session.latest()?.p.find((p) => p.id === this.session.myId);
        if (me && me.s !== 0) this.game.cycleSpectate();
      }
    });
    window.addEventListener('mousemove', (e) => {
      const p = this.toLogical(e.clientX, e.clientY);
      this.input.mouseX = Math.max(0, Math.min(640, p.x));
      this.input.mouseY = Math.max(0, Math.min(360, p.y));
    });
    window.addEventListener('keydown', () => audio.unlock(), { once: true });
    window.addEventListener('blur', () => this.hideSkills());
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.hideSkills(); });
  }

  private onEvents(evs: GameEvent[]): void {
    this.game.onEvents(evs);
  }

  private onLocalEvent(ev: GameEvent): void {
    const me = this.session.myId;
    if (ev.k === 'die') {
      const type = ENEMY_TYPES[ev.et];
      if (type && (ENEMIES[type].miniboss || ENEMIES[type].tier === 'boss')) audio.stopBossTheme();
    }
    if (ev.k === 'deny' && ev.to === me) {
      this.hud.deny(ev.r);
      audio.play('deny');
    } else if (ev.k === 'down') {
      this.hud.message(ev.pi === me ? 'Você caiu!' : `${this.session.nameOf(ev.pi)} caiu!`, 0xec6a5e, 2000);
    } else if (ev.k === 'revived') {
      this.hud.message(`${this.session.nameOf(ev.pi)} foi revivido por ${this.session.nameOf(ev.by)}`, 0x7fc47a, 2000);
    } else if (ev.k === 'boss' && ev.ph === 2) {
      audio.setBossPhase(2);
      this.hud.showBanner('FASE 2', 'O chefe mudou de padrão!', 0xe07cff, 2200);
    } else if (ev.k === 'msg' && /^CHECKPOINT SALVO/.test(ev.txt)) {
      // checkpoint do servidor: aviso animado em vez de uma linha de texto
      this.checkpointWave = Number(/onda (\d+)/.exec(ev.txt)?.[1] ?? this.checkpointWave);
      this.hud.showBanner('CHECKPOINT SALVO', `Onda ${this.checkpointWave} · se a equipe cair, volta daqui`, 0x7fc47a, 3400, 'checkpoint');
      this.hud.hint('checkpoint', 'Se todos caírem, a equipe volta ao checkpoint: perde melhorias recentes e um pouco de vida máxima');
    } else if (ev.k === 'msg' && /^De volta ao checkpoint/.test(ev.txt)) {
      // "De volta ao checkpoint (onda N). -X% de vida máxima, M melhorias perdidas."
      const rest = ev.txt.replace(/^De volta ao checkpoint \(onda \d+\)\.\s*/, '');
      this.hud.showBanner('DE VOLTA AO CHECKPOINT', rest || 'Tentem de novo', 0xec6a5e, 4600, 'restore');
      this.hud.message(ev.txt, 0xec6a5e, 4200);
    } else if (ev.k === 'msg') {
      const col = ev.c === 'good' ? 0x7fc47a : ev.c === 'bad' ? 0xec6a5e : ev.c === 'boss' ? 0xe07cff : 0xf6c257;
      this.hud.message(ev.txt, col, 3200);
    }
  }

  private onKey(code: string, down: boolean, e: KeyboardEvent): void {
    audio.unlock();
    const k = this.settings.keys;
    if (code === 'Escape' && down && !e.repeat) {
      this.back();
      return;
    }
    // cartas de melhoria: 1–6 escolhem a carta (Enter/botão confirmam)
    if (down && !e.repeat && /^Digit[1-6]$/.test(code) && this.pickUpgradeByNumber(Number(code.slice(5)) - 1)) return;
    if (code === 'F9' && down && !e.repeat) {
      // depuração da mira: cursor no mundo, linha da mira, direção enviada e trajetória
      this.game.aimDebug = !this.game.aimDebug;
      this.toast(this.game.aimDebug ? 'Depuração da mira ligada (F9)' : 'Depuração da mira desligada');
      return;
    }
    if (code === 'F1') {
      if (!down) this.hideSkills();
      else if (!e.repeat && this.screen === 'match' && !this.pauseOpen && !this.settingsOpen && !this.introId) this.showSkills();
      return;
    }
    if (this.screen !== 'match' || this.pauseOpen || this.settingsOpen) return;
    if (code === k.team) {
      if (down && !this.tabOpen) this.showTab();
      if (!down) this.hideTab();
    }
    if (code === k.ping && down && !e.repeat) {
      const wp = this.game.screenToWorld(this.input.mouseX, this.input.mouseY);
      this.session.send({ t: 'ping', x: Math.round(wp.x), y: Math.round(wp.y) });
    }
    if (code === k.dodge && down) {
      const me = this.session.latest()?.p.find((p) => p.id === this.session.myId);
      if (me && me.s !== 0) this.game.cycleSpectate();
    }
  }

  private pickUpgradeByNumber(i: number): boolean {
    return this.upPick?.(i) ?? false;
  }

  private clearOverlayPanels(): void {
    this.upPick = null;
    this.overlay.querySelectorAll('.upgrades, .routevote').forEach((n) => n.remove());
    if (this.upTimer) {
      clearInterval(this.upTimer);
      this.upTimer = 0;
    }
  }

  /** Cinemática de viagem para o capítulo `ch` (mapa já trocado pelo servidor). */
  private startTravel(ch: number, route: number, tm: number): void {
    const chapter = CHAPTERS[ch - 1];
    if (!chapter) return;
    const from: Climate = CHAPTERS[ch - 2]?.climate ?? 'night';
    const s = this.session;
    const snap = s.latest();
    const party = (snap?.p ?? []).map((p) => ({ cls: p.c, name: s.nameOf(p.id), local: p.id === s.myId }));
    this.input.clear();
    this.travel.play({ from, to: chapter.climate, chapter, route: route === 1 ? 'risk' : route === 2 ? 'safe' : null, party, seconds: tm > 0 ? tm / 30 : TRAVEL_SECONDS });
  }

  private go(s: Screen): void {
    this.hideBossIntro();
    if (this.screen !== s) this.fadeScreen();
    if (s !== 'match') {
      audio.stopBossTheme();
      audio.stopBard();
    }
    audio.bardPaused = false;
    this.screen = s;
    this.layer.replaceChildren();
    this.pauseOpen = false;
    this.hideTab();
    this.hideSkills();
    this.input.enabled = s === 'match';
    this.input.clear();
    this.game.input.enabled = true;
    switch (s) {
      case 'menu':
        this.game.toMenu();
        this.renderMenu();
        break;
      case 'host':
        void this.renderHost();
        break;
      case 'join':
        this.renderJoin();
        break;
      case 'connecting':
        this.layer.append(
          h('div', { class: 'panel fade-in', style: 'left:220px;top:150px;width:200px;text-align:center' }, h('div', { class: 'blink', text: 'Conectando…' }), h('br'), h('button', { class: 'btn', onclick: () => void this.leave(true) }, 'Cancelar')),
        );
        break;
      case 'lobby':
        this.renderLobby();
        break;
      case 'match':
        this.overlay.replaceChildren();
        break;
      case 'results':
        this.renderResults();
        break;
    }
  }

  /** Cortina curta entre telas (suave, em degraus; some com "reduzir movimento"). */
  private fadeScreen(): void {
    if (this.settings.reduceMotion) return;
    const f = h('div', { class: 'screen-fade' });
    this.root.append(f);
    setTimeout(() => f.remove(), 340);
  }

  private modal(title: string, text: string): void {
    const m = h(
      'div',
      { id: 'modal', class: 'panel gold fade-in scalable', style: 'left:120px;top:90px;width:400px;z-index:50' },
      h('h2', { text: title }),
      h('div', { style: 'white-space:pre-wrap;max-height:150px', class: 'scroll', text }),
      h('br'),
      h('button', { class: 'btn primary', onclick: () => m.remove() }, 'OK'),
    );
    this.layer.append(m);
  }

  private showReconnect(left: number): void {
    let el = document.getElementById('reconnect');
    if (!el) {
      el = h('div', { id: 'reconnect', class: 'panel', style: 'left:200px;top:8px;width:240px;text-align:center;z-index:60' });
      this.overlay.append(el);
    }
    el.replaceChildren(h('div', { class: 'red blink', text: 'Conexão perdida' }), h('div', { text: `Tentando reconectar… ${left}s` }), h('button', { class: 'btn', onclick: () => void this.leave(true) }, 'Desistir'));
  }

  // ---------------------------------------------------------------- atualizações

  /**
   * Liga o aviso de atualização. O processo principal empurra o estado (inclusive o progresso do
   * download), e a primeira ida ao menu dispara a procura — uma vez por sessão, e só se o jogador
   * não tiver desligado isso nas configurações.
   */
  private initUpdates(): void {
    this.session.bridge.update.onStatus((st) => {
      this.update = st;
      if (this.screen === 'menu') this.renderUpdate();
    });
  }

  private maybeCheckUpdate(): void {
    if (this.updateChecked || !this.settings.autoUpdate) return;
    this.updateChecked = true;
    void this.session.bridge.update.check().then((st) => {
      // falha de rede na procura automática não vira aviso nem fica guardada: quem não pediu para
      // verificar não quer ver o erro agora nem ao voltar ao menu depois
      if (st.state === 'error') return;
      this.update = st;
      if (this.screen === 'menu') this.renderUpdate();
    });
  }

  /** Procura pedida pelo jogador (botão nas configurações): aí sim o resultado sempre aparece. */
  private async checkUpdateNow(): Promise<void> {
    this.updateChecked = true;
    this.updateDismissed = false;
    this.toast('Procurando atualizações…');
    const st = await this.session.bridge.update.check();
    this.update = st;
    if (st.state === 'current') this.toast('O jogo já está atualizado.');
    else if (st.state === 'error') this.toast(`Não deu para verificar: ${st.message}`, true);
    if (this.screen === 'menu') this.renderUpdate();
  }

  /** Desenha (ou remove) o painel de atualização do menu. */
  private renderUpdate(): void {
    document.getElementById('update')?.remove();
    if (this.screen !== 'menu' || this.updateDismissed) return;
    const st = this.update;
    if (st.state === 'idle' || st.state === 'checking' || st.state === 'current') return;

    const panel = h('div', { id: 'update', class: 'panel gold fade-in', style: 'left:8px;top:150px;width:206px;z-index:20' });
    const dismiss = (label = 'Agora não'): HTMLElement =>
      h('button', { class: 'btn', onclick: () => { this.updateDismissed = true; this.renderUpdate(); } }, label);
    const openPage = (label = 'Ver no GitHub'): HTMLElement =>
      h('button', { class: 'btn', onclick: () => void this.session.bridge.update.openPage() }, label);

    if (st.state === 'error') {
      panel.append(
        h('h2', { class: 'red', text: 'Falha na atualização' }),
        h('div', { class: 'small', style: 'white-space:pre-wrap', text: st.message }),
        h('div', { style: 'height:4px' }),
        h('button', { class: 'btn', onclick: () => void this.checkUpdateNow() }, 'Tentar de novo'),
        dismiss('Fechar'),
      );
      this.layer.append(panel);
      return;
    }

    if (st.state === 'downloading') {
      const frac = st.total > 0 ? Math.min(1, st.received / st.total) : 0;
      panel.append(
        h('h2', { text: `Baixando v${st.update.version}` }),
        h('div', { style: 'height:6px;background:#0b0a12;box-shadow:inset 0 0 0 1px #37507e;margin:2px 0' },
          h('div', { style: `height:100%;width:${Math.round(frac * 100)}%;background:#a8591a` })),
        h('div', { class: 'small hint', text: `${formatBytes(st.received)} de ${formatBytes(st.total)} · ${Math.round(frac * 100)}%` }),
      );
      this.layer.append(panel);
      return;
    }

    if (st.state === 'ready') {
      panel.append(
        h('h2', { class: 'ok', text: 'Atualização pronta' }),
        h('div', { class: 'small', text: `A versão ${st.update.version} foi baixada. Instalar fecha o jogo e abre o instalador.` }),
        h('div', { style: 'height:4px' }),
        h('button', { class: 'btn primary', onclick: () => void this.session.bridge.update.install().then((ok) => { if (!ok) this.toast('O instalador não pôde ser aberto.', true); }) }, 'Instalar e reiniciar'),
        dismiss('Instalar depois'),
      );
      this.layer.append(panel);
      return;
    }

    const u = st.update;
    if (u.kind === 'release') {
      panel.append(h('h2', { text: `Nova versão ${u.version}` }));
      if (u.title) panel.append(h('div', { class: 'small amber', text: u.title }));
      if (u.notes) panel.append(h('div', { class: 'small scroll', style: 'max-height:56px;white-space:pre-wrap;margin-top:2px', text: u.notes }));
      panel.append(h('div', { style: 'height:4px' }));
      if (u.asset) {
        panel.append(
          h('button', { class: 'btn primary', onclick: () => void this.session.bridge.update.download() }, `Baixar (${formatBytes(u.asset.size)})`),
          openPage(),
        );
      } else {
        // release sem instalador anexado: não há o que baixar, então não prometemos download
        panel.append(
          h('div', { class: 'small hint', text: 'Esta versão não trouxe instalador anexado.' }),
          openPage('Abrir página da versão'),
        );
      }
      panel.append(dismiss());
    } else {
      // commits novos: código-fonte, que um jogo já empacotado não consegue aplicar sozinho
      panel.append(
        h('h2', { text: u.ahead > 0 ? `${u.ahead} ${u.ahead === 1 ? 'novidade' : 'novidades'} no repositório` : 'Novidades no repositório' }),
        h('div', { class: 'small', style: 'white-space:pre-wrap', text: u.message }),
        h('div', { class: 'small hint', style: 'margin-top:2px', text: `commit ${u.sha} · ainda sem versão publicada para instalar` }),
        h('div', { style: 'height:4px' }),
        openPage(),
        dismiss(),
      );
    }
    this.layer.append(panel);
  }

  // ---------------------------------------------------------------- menu principal

  private renderMenu(): void {
    const nick = h('input', { type: 'text', maxlength: 16, value: this.settings.name, placeholder: 'Seu apelido' });
    nick.addEventListener('change', () => {
      this.settings.name = nick.value.trim().slice(0, 16);
      void this.saveSettings();
    });
    const need = (): boolean => {
      this.settings.name = nick.value.trim().slice(0, 16);
      if (!this.settings.name) {
        nick.focus();
        this.toast('Escolha um apelido primeiro.', true);
        return false;
      }
      void this.saveSettings();
      return true;
    };
    this.layer.append(
      h('div', { class: 'title fade-in', style: 'position:absolute;left:0;right:0;top:34px;text-align:center;font-size:33px;line-height:36px', text: 'ÚLTIMA VIGÍLIA' }),
      h('div', { class: 'subtitle', style: 'position:absolute;left:0;right:0;top:74px;text-align:center', text: 'A noite não termina. Mantenha a fogueira acesa.' }),
      h(
        'div',
        { class: 'panel fade-in', style: 'left:230px;top:104px;width:180px' },
        h('label', { text: 'Apelido' }),
        nick,
        h('div', { style: 'height:6px' }),
        h('button', { class: 'btn primary', onclick: () => need() && void this.startSolo() }, 'Jogar sozinho'),
        h('button', { class: 'btn', onclick: () => need() && this.go('host') }, 'Criar partida'),
        h('button', { class: 'btn', onclick: () => need() && this.go('join') }, 'Entrar por IP'),
        h('button', { class: 'btn', onclick: () => this.openSettings() }, 'Configurações'),
        h('button', { class: 'btn', onclick: () => void this.session.bridge.sys.quit() }, 'Sair'),
      ),
      h('div', { class: 'hint', style: 'position:absolute;left:6px;bottom:4px', text: `v${GAME_VERSION} · cooperativo 1–6 jogadores · LAN / Radmin VPN` }),
    );
    this.maybeCheckUpdate();
    this.renderUpdate();
  }

  private async startSolo(): Promise<void> {
    this.go('connecting');
    const r = await this.session.bridge.host.start({ port: 0, bind: '127.0.0.1', password: '', maxPlayers: 1, solo: true });
    if (!r.ok) {
      this.go('menu');
      this.modal('Não foi possível iniciar', r.message);
      return;
    }
    this.session.isHostProcess = true;
    this.session.solo = true;
    this.session.shareAddress = '';
    await this.session.connect({ host: r.connectHost, port: r.port, name: this.settings.name, password: '', token: null, hostKey: r.hostKey });
  }

  // ---------------------------------------------------------------- criar partida

  private async renderHost(): Promise<void> {
    this.interfaces = await this.session.bridge.host.interfaces();
    const port = h('input', { type: 'number', min: 1024, max: 65535, value: this.settings.port || DEFAULT_PORT });
    const sel = h('select');
    for (const i of this.interfaces) sel.append(h('option', { value: i.address, text: `${i.address} — ${i.label} (${i.name})` }));
    sel.append(h('option', { value: '0.0.0.0', text: 'Todas as interfaces (avançado)' }));
    if (!this.interfaces.length) sel.value = '0.0.0.0';
    const pw = h('input', { type: 'password', maxlength: 32, placeholder: 'opcional' });
    const max = h('select');
    for (let n = 2; n <= MAX_PLAYERS; n++) max.append(h('option', { value: n, text: `${n} jogadores` }));
    max.value = String(MAX_PLAYERS);
    const err = h('div', { class: 'err' });
    const btn = h('button', { class: 'btn primary' }, 'Criar partida');
    btn.addEventListener('click', () => void create());
    const create = async (): Promise<void> => {
      err.textContent = '';
      const p = Number(port.value);
      if (!Number.isInteger(p) || p < 1024 || p > 65535) {
        err.textContent = 'Porta inválida: use um número entre 1024 e 65535.';
        return;
      }
      btn.setAttribute('disabled', '');
      btn.textContent = 'Iniciando servidor…';
      const r: HostStartResult = await this.session.bridge.host.start({ port: p, bind: sel.value, password: pw.value, maxPlayers: Number(max.value), solo: false });
      btn.removeAttribute('disabled');
      btn.textContent = 'Criar partida';
      if (!r.ok) {
        err.textContent = `${r.message}${r.code === 'EADDRINUSE' ? '' : `\n${DIAG}`}`;
        return;
      }
      this.settings.port = p;
      void this.saveSettings();
      this.session.isHostProcess = true;
      this.session.solo = false;
      // endereço para os amigos: nunca 0.0.0.0/localhost
      const shareIp = r.bind === '0.0.0.0' ? (this.interfaces[0]?.address ?? '') : r.bind;
      this.session.shareAddress = shareIp ? `${shareIp}:${r.port}` : '';
      this.go('connecting');
      await this.session.connect({ host: r.connectHost, port: r.port, name: this.settings.name, password: pw.value, token: null, hostKey: r.hostKey });
    };
    const info = h('div', { class: 'hint', style: 'margin-top:4px' });
    const upd = (): void => {
      const i = this.interfaces.find((x) => x.address === sel.value);
      info.textContent =
        sel.value === '0.0.0.0'
          ? 'Escuta em todas as redes deste PC. Os amigos devem usar o IP da rede em comum (ex.: o da Radmin VPN).'
          : i?.radmin
            ? 'Radmin VPN: os amigos precisam estar na mesma rede Radmin.'
            : 'Rede local: os amigos precisam estar na mesma rede (Wi-Fi/cabo).';
    };
    sel.addEventListener('change', upd);
    upd();
    this.layer.append(
      h(
        'div',
        { class: 'panel fade-in', style: 'left:150px;top:36px;width:340px' },
        h('h2', { text: 'Criar partida (você será o anfitrião)' }),
        h('label', { text: 'Interface de rede (IPv4) que os amigos usarão' }),
        sel,
        info,
        !this.interfaces.length ? h('div', { class: 'err', text: 'Nenhuma rede encontrada. Conecte-se à rede local ou à Radmin VPN e volte a esta tela.' }) : null,
        h('div', { class: 'row' }, h('div', {}, h('label', { text: 'Porta TCP' }), port), h('div', {}, h('label', { text: 'Limite' }), max)),
        h('label', { text: 'Senha da sala' }),
        pw,
        err,
        h('div', { style: 'height:6px' }),
        btn,
        h('button', { class: 'btn', onclick: () => this.go('menu') }, 'Voltar'),
      ),
    );
  }

  // ---------------------------------------------------------------- entrar por IP

  private renderJoin(): void {
    const [lastIp, lastPort] = this.settings.lastHost.split(':');
    const ip = h('input', { type: 'text', maxlength: 64, placeholder: 'ex.: 26.12.34.56', value: lastIp ?? '' });
    const port = h('input', { type: 'number', min: 1, max: 65535, value: lastPort || DEFAULT_PORT });
    const pw = h('input', { type: 'password', maxlength: 32, placeholder: 'se houver' });
    const err = h('div', { class: 'err', text: this.lastError });
    this.lastError = '';
    ip.addEventListener('input', () => {
      // aceita colar "ip:porta"
      const m = /^(.+):(\d{2,5})$/.exec(ip.value.trim());
      if (m) {
        ip.value = m[1] as string;
        port.value = m[2] as string;
      }
    });
    const join = async (): Promise<void> => {
      const host = ip.value.trim();
      const p = Number(port.value);
      err.textContent = '';
      if (!IPV4.test(host)) {
        err.textContent = 'IP inválido. Use o formato 26.12.34.56 (peça ao anfitrião o endereço mostrado no lobby dele).';
        return;
      }
      if (host === '0.0.0.0' || host.startsWith('127.')) {
        err.textContent = host === '0.0.0.0' ? '0.0.0.0 não é um endereço de conexão. Use o IP do anfitrião.' : 'Esse endereço é o seu próprio computador. Use o IP do anfitrião na LAN/Radmin.';
        if (host === '0.0.0.0') return;
      }
      if (!Number.isInteger(p) || p < 1 || p > 65535) {
        err.textContent = 'Porta inválida.';
        return;
      }
      this.settings.lastHost = `${host}:${p}`;
      void this.saveSettings();
      this.session.isHostProcess = false;
      this.session.solo = false;
      this.session.shareAddress = `${host}:${p}`;
      this.go('connecting');
      try {
        await this.session.connect({ host, port: p, name: this.settings.name, password: pw.value, token: null, hostKey: null });
      } catch (e) {
        this.go('join');
        this.modal('Endereço inválido', e instanceof Error ? e.message : String(e));
      }
    };
    this.layer.append(
      h(
        'div',
        { class: 'panel fade-in', style: 'left:170px;top:60px;width:300px' },
        h('h2', { text: 'Entrar por IP' }),
        h('div', { class: 'row' }, h('div', { style: 'flex:3' }, h('label', { text: 'IP do anfitrião (LAN ou Radmin VPN)' }), ip), h('div', {}, h('label', { text: 'Porta' }), port)),
        h('label', { text: 'Senha' }),
        pw,
        err,
        h('div', { style: 'height:6px' }),
        h('button', { class: 'btn primary', onclick: () => void join() }, 'Entrar'),
        h('button', { class: 'btn', onclick: () => this.go('menu') }, 'Voltar'),
        h('div', { class: 'hint', style: 'margin-top:4px;white-space:pre-wrap', text: 'Sem descoberta automática: digite o endereço que o anfitrião mostrar.' }),
      ),
    );
    ip.focus();
  }

  // ---------------------------------------------------------------- lobby

  private selectedInfo: ClassId | null = null;

  private renderLobby(): void {
    const s = this.session;
    const me = s.me();
    const host = s.isHost();
    this.layer.replaceChildren();
    const taken = new Map<ClassId, LobbyPlayer>();
    for (const p of s.lobby) if (p.cls) taken.set(p.cls, p);
    const info = this.selectedInfo ?? me?.cls ?? 'hunter';

    // cartas de classe
    const grid = h('div', { style: 'display:grid;grid-template-columns:repeat(3,1fr);gap:4px' });
    for (const c of CLASS_IDS) {
      const owner = taken.get(c);
      const mine = owner?.id === s.myId;
      const card = h(
        'div',
        { class: `classcard${mine ? ' mine' : ''}${owner && !mine ? ' taken' : ''}`, tabindex: 0, role: 'button', 'aria-label': `${CLASSES[c].name}${owner ? (mine ? ' (sua classe)' : ` (ocupado por ${owner.name})`) : ''}`, 'data-autofocus': mine || (!me?.cls && c === info) },
        classSprite(c, 1, mine ? 'walk' : 'idle'),
        h('div', { text: CLASSES[c].name, class: mine ? 'amber' : '' }),
        h('div', { class: owner && !mine ? 'red' : 'hint', text: owner ? (mine ? 'você' : `ocupado: ${owner.name}`) : CLASSES[c].tag }),
      );
      const showInfo = (): void => {
        if (this.selectedInfo !== c) {
          this.selectedInfo = c;
          this.renderClassInfo(detail, c, taken);
        }
      };
      card.addEventListener('mouseenter', showInfo);
      card.addEventListener('focus', showInfo);
      card.addEventListener('click', () => {
        audio.play('uiClick');
        if (owner && !mine) {
          this.toast(`${CLASSES[c].name} já está ocupado por ${owner.name}.`, true);
          return;
        }
        s.send({ t: 'cls', cls: mine ? null : c });
      });
      // 7 classes em 3 colunas: a última fica centralizada
      if (c === CLASS_IDS[CLASS_IDS.length - 1] && CLASS_IDS.length % 3 === 1) card.style.gridColumn = '2';
      grid.append(card);
    }
    const detail = h('div', { class: 'panel scroll', style: 'left:246px;top:28px;width:236px;height:292px;overflow-y:auto' });
    this.renderClassInfo(detail, info, taken);

    // jogadores
    const list = h('div', { class: 'scroll', style: 'max-height:44px' });
    for (const p of s.lobby) {
      list.append(
        h(
          'div',
          { class: 'row', style: 'margin-bottom:2px' },
          h('div', { style: 'flex:3', class: p.id === s.myId ? 'amber' : '', text: `${p.host ? '♛ ' : ''}${p.name}${p.conn ? '' : ' (caiu)'}` }),
          h('div', { style: 'flex:2', class: 'hint', text: p.cls ? CLASSES[p.cls].name : '—' }),
          h('div', { style: 'flex:1', class: p.ready ? 'ok' : 'hint', text: p.ready ? 'pronto' : '…' }),
        ),
      );
    }
    for (let i = s.lobby.length; i < s.maxPlayers; i++) list.append(h('div', { class: 'hint', text: '· vaga livre' }));
    const allReady = s.lobby.length > 0 && s.lobby.every((p) => p.ready && p.cls);
    const readyBtn = h('button', { class: `btn${me?.ready ? ' sel' : ''}`, disabled: !me?.cls }, me?.ready ? '✓ Pronto (clique para cancelar)' : 'Marcar pronto');
    readyBtn.addEventListener('click', () => {
      audio.play('uiClick');
      s.send({ t: 'ready', r: !me?.ready });
    });
    const startBtn = h('button', { class: 'btn primary', disabled: !allReady }, s.solo ? 'Começar' : allReady ? 'Iniciar partida' : 'Aguardando todos ficarem prontos');
    startBtn.addEventListener('click', () => {
      audio.play('uiClick');
      s.send({ t: 'start' });
    });
    if (s.solo && me?.cls && !me.ready) s.send({ t: 'ready', r: true });

    const left = h(
      'div',
      { class: 'panel fade-in', style: 'left:8px;top:28px;width:228px;height:292px' },
      h('h2', { text: s.solo ? 'Modo solo — escolha sua classe' : 'Escolha sua classe' }),
      grid,
      h('div', { style: 'height:6px' }),
      s.solo ? null : h('h2', { text: `Jogadores ${s.lobby.length}/${s.maxPlayers}` }),
      s.solo ? null : list,
    );
    const right = h('div', { class: 'panel', style: 'left:492px;top:28px;width:140px;height:292px' });
    if (!s.solo) {
      if (host && s.shareAddress) {
        right.append(
          h('h2', { text: 'Endereço da sala' }),
          h('div', { class: 'mono-box', text: s.shareAddress }),
          h('button', {
            class: 'btn',
            style: 'margin-top:3px',
            onclick: async () => {
              const ok = await s.bridge.sys.copy(s.shareAddress);
              this.toast(ok ? 'Endereço copiado!' : 'Não foi possível copiar.', !ok);
            },
          }, 'Copiar IP:porta'),
          h('div', { class: 'hint', style: 'margin-bottom:6px', text: 'Envie para seus amigos. Eles usam “Entrar por IP”.' }),
        );
      } else if (!host) right.append(h('h2', { text: 'Sala' }), h('div', { class: 'mono-box', text: s.shareAddress }), h('div', { class: 'hint', style: 'margin:3px 0 6px', text: 'Aguardando o anfitrião iniciar.' }));
    }
    const push = (...els: (HTMLElement | null)[]): void => {
      for (const e of els) if (e) right.append(e);
    };
    push(
      me?.cls ? null : h('div', { class: 'hint', style: 'margin-bottom:4px', text: 'Clique numa classe livre para escolher.' }),
      s.solo ? null : readyBtn,
      host ? startBtn : null,
      h('div', { style: 'height:6px' }),
      h('button', { class: 'btn', onclick: () => this.openSettings() }, 'Configurações'),
      h('button', { class: 'btn danger', onclick: () => void this.leave(true) }, host && !s.solo ? 'Fechar sala' : 'Sair'),
    );
    this.layer.append(h('div', { class: 'title', style: 'position:absolute;left:10px;top:6px;font-size:11px', text: s.solo ? 'ÚLTIMA VIGÍLIA — SOLO' : 'ÚLTIMA VIGÍLIA — LOBBY' }), left, detail, right, h('div', { class: 'hint', style: 'position:absolute;left:10px;bottom:6px', text: 'Setas / D-pad: navegar · Enter / A: escolher · Esc / B: voltar' }));
  }

  private renderClassInfo(el: HTMLElement, c: ClassId, taken: Map<ClassId, LobbyPlayer>): void {
    const def = CLASSES[c];
    const icons = ABILITY_ICONS[c] ?? [];
    const k = this.settings.keys;
    const rows: [string, string, string][] = [
      ['LMB', def.texts.basic.name, def.texts.basic.desc],
      [keyLabel(k.q), def.texts.q.name, def.texts.q.desc],
      [keyLabel(k.e), def.texts.e.name, def.texts.e.desc],
      [keyLabel(k.r), def.texts.r.name, def.texts.r.desc],
      ['Passiva', def.texts.passive.name, def.texts.passive.desc],
    ];
    const owner = taken.get(c);
    el.replaceChildren(
      h('div', { class: 'row', style: 'align-items:flex-start' }, h('div', { style: 'flex:0 0 64px' }, classSprite(c, 2, 'walk')), h('div', {}, h('div', { class: 'amber', text: def.name }), h('div', { class: 'hint', text: def.role }), h('div', {}, 'Dificuldade ', h('span', { class: 'stars', text: stars(def.difficulty) })), h('div', { class: 'hint', text: `Vida ${def.hp} · Stamina ${def.stamina}` }), owner ? h('div', { class: owner.id === this.session.myId ? 'ok' : 'red', text: owner.id === this.session.myId ? 'Sua classe' : `Ocupado por ${owner.name}` }) : null)),
      h('div', { class: 'hint', style: 'margin:3px 0', text: def.blurb }),
      ...rows.map(([key, name, desc], i) =>
        h('div', { class: 'row', style: 'align-items:flex-start;margin-bottom:3px' }, h('div', { style: 'flex:0 0 18px' }, iconEl(icons[i] ?? 'star')), h('div', {}, h('span', { class: 'keycap', text: key }), ' ', h('span', { class: 'amber', text: name }), h('div', { text: desc }))),
      ),
      h('div', { class: 'red', style: 'margin-top:2px', text: `Fraqueza: ${def.weakness}` }),
    );
  }

  // ---------------------------------------------------------------- melhorias

  /** Carta destacada (ainda não confirmada) e envio pendente de confirmação. */
  private upSel: string | null = null;
  private upSent: string | null = null;
  private rareSoundFor = '';
  private upKey = '';
  private upPick: ((i: number) => boolean) | null = null;
  private upTimer = 0;

  private renderUpgrades(): void {
    const off = this.session.offer;
    this.clearOverlayPanels();
    if (!off || this.session.phase.phase !== 'intermission') return;
    // nova oferta: limpa seleção local
    const key = off.options.join(',');
    if (key !== this.upKey) {
      this.upKey = key;
      this.upSel = null;
      this.upSent = null;
    }
    if (!off.picked && this.upSent) this.upSent = null; // servidor recusou: libera nova tentativa
    const locked = !!off.picked;
    const blockedBy = (id: string): string | null => {
      const u = UPGRADE_BY_ID.get(id);
      if (!u?.fork) return null;
      const other = Object.keys(off.mine).find((k) => k !== id && (off.mine[k] ?? 0) > 0 && UPGRADE_BY_ID.get(k)?.fork === u.fork);
      return other ? (UPGRADE_BY_ID.get(other)?.name ?? other) : null;
    };
    const panel = h('div', { class: 'panel gold upgrades fade-in', style: `left:${off.options.length > 3 ? 70 : 110}px;top:40px;width:${off.options.length > 3 ? 500 : 420}px` });
    panel.append(h('h2', { text: locked ? 'Melhoria confirmada — aguardando a equipe' : 'Escolha uma melhoria e confirme' }));
    if (off.bonus) panel.append(h('div', { class: 'ok', style: 'margin:-3px 0 4px', text: `Carta extra nesta escolha: ${off.bonus}` }));
    const row = h('div', { class: 'row', style: 'align-items:stretch' });
    const confirm = h('button', { class: 'btn primary', style: 'margin-top:6px', disabled: locked || !this.upSel || !!this.upSent, 'data-autofocus': !locked && !!this.upSel && !this.upSent }, locked ? '✓ Escolha confirmada' : this.upSent ? 'Enviando…' : this.upSel ? `Confirmar escolha: ${UPGRADE_BY_ID.get(this.upSel)?.name ?? ''}` : 'Confirmar escolha');
    // tooltip com os detalhes da carta sob o foco/mouse (a carta mostra só o essencial)
    const tip = h('div', { class: 'up-tip' });
    const showTip = (id: string): void => {
      const u = UPGRADE_BY_ID.get(id);
      if (!u) return;
      const have = off.mine[id] ?? 0;
      const forkName = u.fork ? (FORKS[u.fork]?.name ?? 'Bifurcação') : '';
      const rivals = u.fork ? [...UPGRADE_BY_ID.values()].filter((o) => o.fork === u.fork && o.id !== id).map((o) => o.name) : [];
      const blocked = blockedBy(id);
      tip.replaceChildren(...[
        h('div', {}, h('span', { class: `tipname rarity-tag rar-${u.rarity}`, text: RARITY_INFO[u.rarity].name }), ' ', h('span', { class: 'amber', text: u.name }), h('span', { class: 'hint', text: ` · ${KIND_INFO[u.kind]} · ${u.cls ? CLASSES[u.cls].name : 'Geral'}` })),
        h('div', { text: u.desc.replace(/^BIFURCAÇÃO:\s*/, '') }),
        u.fork ? h('div', { class: blocked ? 'red' : 'mag', text: blocked ? `Incompatível: você seguiu ${blocked}` : `${forkName} — exclui ${rivals.join(', ')}` }) : null,
        h('div', { class: 'hint', text: `Acúmulos: ${have} → ${have + 1} (máx. ${u.maxStacks})${u.cap ? ` · Teto global de ${CAP_TEXT[u.cap]}: ${Math.round(UPGRADE_CAPS[u.cap] * 100)}%` : ''}` }),
      ].filter((x): x is HTMLDivElement => !!x));
    };
    const cards: [string, HTMLElement, boolean][] = [];
    let n = 0;
    for (const id of off.options) {
      const u = UPGRADE_BY_ID.get(id);
      if (!u) continue;
      n++;
      const have = off.mine[id] ?? 0;
      const blocked = blockedBy(id);
      const chosen = locked ? off.picked === id : this.upSel === id;
      const dim = (locked && off.picked !== id) || (!locked && !!this.upSel && this.upSel !== id) || !!blocked;
      const card = h(
        'div',
        { class: `upcard rar-${u.rarity}${chosen ? ' sel' : dim ? ' dim' : ''}`, style: blocked ? 'cursor:not-allowed' : '', tabindex: blocked || locked ? undefined : 0, role: 'button', 'aria-label': `${RARITY_INFO[u.rarity].name}: ${u.name}` },
        h('div', { class: `rarity-tag rar-${u.rarity}`, text: RARITY_INFO[u.rarity].name }),
        h('div', { class: 'upnum', text: String(n) }),
        h('div', { class: 'row', style: 'margin-top:2px' }, h('div', { style: 'flex:0 0 34px' }, iconEl(u.icon, 2)), h('div', {}, h('div', { class: 'amber', text: u.name }), h('div', { class: 'hint', text: u.cls ? CLASSES[u.cls].name : 'Geral' }))),
        blocked ? h('div', { class: 'red', style: 'margin-top:3px', text: `Incompatível: ${blocked}` }) : u.fork ? h('div', { class: 'mag', style: 'margin-top:3px', text: 'Bifurcação' }) : null,
        h('div', { class: 'up-short', text: shortDesc(u.desc) }),
        compareLine(u, have) ? h('div', { class: 'ok', text: compareLine(u, have) }) : null,
        chosen ? h('div', { class: locked ? 'ok' : 'amber', style: 'margin-top:2px', text: locked ? '✓ confirmada' : '› selecionada' }) : h('div', { class: 'hint', style: 'margin-top:2px', text: `${have}/${u.maxStacks} acúmulos` }),
      );
      const pick = (): void => {
        if (locked || blocked || this.upSent) return;
        audio.play('uiClick');
        this.upSel = id;
        this.renderUpgrades();
      };
      card.addEventListener('mouseenter', () => showTip(id));
      card.addEventListener('focus', () => showTip(id));
      if (!locked && !blocked) card.addEventListener('click', pick);
      cards.push([id, card, !locked && !blocked]);
      row.append(card);
    }
    this.upPick = (i: number): boolean => {
      const c = cards[i];
      if (!c || !c[2]) return false;
      c[1].click();
      return true;
    };
    showTip(this.upSel ?? off.picked ?? cards[0]?.[0] ?? '');
    confirm.addEventListener('click', () => {
      const id = this.upSel;
      if (!id || locked || this.upSent) return;
      audio.play('upgrade');
      this.upSent = id;
      this.session.send({ t: 'upg', id });
      this.renderUpgrades();
    });
    const timer = h('div', { class: 'hint', style: 'margin-top:5px' });
    const tick = (): void => {
      const tm = this.session.latest()?.w.tm ?? 0;
      timer.textContent = `Prontos ${off.readyCount}/${off.total} · ${Math.ceil(tm / 30)}s · setas navegam · 1-${Math.max(1, off.options.length)} escolhe · Enter confirma · sem confirmar vale a 1ª opção`;
    };
    tick();
    this.upTimer = window.setInterval(tick, 250);
    panel.append(row, tip, confirm, timer);
    this.overlay.append(panel);
    // cartas fortes chamam atenção uma vez por oferta (sem pausar além do normal)
    const best = off.options.map((id) => UPGRADE_BY_ID.get(id)?.rarity).find((r) => r === 'legendary') ?? off.options.map((id) => UPGRADE_BY_ID.get(id)?.rarity).find((r) => r === 'rare');
    const offerKey = off.options.join(',');
    if (best && this.rareSoundFor !== offerKey) {
      this.rareSoundFor = offerKey;
      audio.play(best === 'legendary' ? 'cardLegendary' : 'cardRare');
    }
  }

  // ---------------------------------------------------------------- rota entre capítulos

  private renderRoute(): void {
    this.overlay.querySelectorAll('.routevote').forEach((n) => n.remove());
    const s = this.session;
    const r = s.route;
    if (s.phase.phase !== 'route' || !r) return;
    const next = CHAPTERS[s.phase.ch] ?? CHAPTERS[CHAPTERS.length - 1];
    const panel = h('div', { class: 'panel gold routevote fade-in', style: 'left:90px;top:62px;width:460px' });
    panel.append(h('h2', { text: r.result ? 'Rota decidida' : `A caminho de ${next?.name ?? 'um novo capítulo'} — escolham a rota` }));
    const row = h('div', { class: 'row', style: 'align-items:stretch' });
    const option = (id: 'risk' | 'safe'): HTMLElement => {
      const def = ROUTE[id];
      const votes = id === 'risk' ? r.risk : r.safe;
      const mine = r.mine === id;
      const won = r.result === id;
      const card = h(
        'div',
        { class: `upcard${mine || won ? ' sel' : r.result ? ' dim' : ''}` },
        h('div', { class: id === 'risk' ? 'red' : 'ok', text: def.name.toUpperCase() }),
        h('div', { style: 'margin-top:4px;min-height:48px', text: def.desc }),
        h('div', { class: 'hint', text: `Votos: ${votes}${mine ? ' (seu voto)' : ''}${won ? ' — ESCOLHIDA' : ''}` }),
      );
      if (!r.result)
        card.addEventListener('click', () => {
          audio.play('uiClick');
          s.send({ t: 'vote', r: id });
        });
      return card;
    };
    row.append(option('risk'), option('safe'));
    const timer = h('div', { class: 'hint', style: 'margin-top:5px' });
    const tick = (): void => {
      const left = Math.max(0, Math.ceil((r.tm - ((performance.now() - r.at) / 1000) * 30) / 30));
      timer.textContent = r.result ? 'Preparando a viagem…' : `Votos ${r.risk + r.safe}/${r.total} · ${left}s. Maioria decide; empate ou sem votos = ${ROUTE[ROUTE.tieBreak].name}. Clique para votar (pode mudar até o fim).`;
    };
    tick();
    if (this.upTimer) clearInterval(this.upTimer);
    this.upTimer = window.setInterval(tick, 250);
    panel.append(row, timer);
    this.overlay.append(panel);
  }

  // ---------------------------------------------------------------- resultados

  private renderResults(): void {
    const s = this.session;
    const p = s.phase;
    const win = p.phase === 'victory';
    const tbl = h('table', {}, h('tr', {}, h('th', { text: 'Jogador' }), h('th', { text: 'Classe' }), h('th', { text: 'Abates' }), h('th', { text: 'Dano' }), h('th', { text: 'Quedas' }), h('th', { text: 'Reviveu' })));
    // destaques da equipe (calculados só com os números já existentes)
    const best = (key: 'kills' | 'damage' | 'revives'): { name: string; v: number } | null => {
      let top: { name: string; v: number } | null = null;
      for (const lp of s.lobby) {
        const v = p.stats?.[lp.id]?.[key] ?? 0;
        if (v > 0 && (!top || v > top.v)) top = { name: lp.name, v };
      }
      return top;
    };
    const mvp = h('div', { class: 'mvp' });
    for (const [label, key] of [['Mais dano', 'damage'], ['Mais abates', 'kills'], ['Mais reviveu', 'revives']] as const) {
      const b = best(key);
      if (b) mvp.append(h('span', {}, `${label}: `, h('b', { text: `${b.name} (${b.v})` })));
    }
    let rowN = 0;
    for (const lp of s.lobby) {
      const st = p.stats?.[lp.id];
      tbl.append(h('tr', { class: 'row-in', style: `animation-delay:${300 + 90 * rowN++}ms` }, h('td', { text: lp.name, class: lp.id === s.myId ? 'amber' : '' }), h('td', { text: lp.cls ? CLASSES[lp.cls].name : '' }), h('td', { text: String(st?.kills ?? 0) }), h('td', { text: String(st?.damage ?? 0) }), h('td', { text: String(st?.downs ?? 0) }), h('td', { text: String(st?.revives ?? 0) })));
    }
    const mm = Math.floor(p.time / 60);
    const ss = String(p.time % 60).padStart(2, '0');
    this.layer.append(
      h(
        'div',
        { class: 'panel gold fade-in scalable', style: 'left:120px;top:50px;width:400px' },
        h('div', { class: 'title center title-pop', style: `color:${win ? '#f6c257' : '#ec6a5e'}`, text: win ? 'VITÓRIA' : 'DERROTA' }),
        h('div', { class: 'center hint', text: win ? `A fogueira resistiu às ${TOTAL_WAVES} ondas dos três capítulos.` : `A vigília caiu na onda ${p.wave}/${TOTAL_WAVES} (capítulo ${p.ch}).` }),
        h('div', { class: 'center', style: 'margin:4px 0', text: `Tempo de partida: ${mm}:${ss}` }),
        mvp,
        tbl,
        h('div', { style: 'height:8px' }),
        s.isHost() ? h('button', { class: 'btn primary', onclick: () => s.send({ t: 'again' }) }, s.solo ? 'Jogar novamente' : 'Jogar novamente (voltar ao lobby)') : h('div', { class: 'hint', text: 'Aguardando o anfitrião decidir jogar novamente…' }),
        h('button', { class: 'btn', onclick: () => void this.leave(true) }, 'Voltar ao menu'),
      ),
    );
  }

  // ---------------------------------------------------------------- pausa / Tab

  private togglePause(): void {
    if (this.pauseOpen) {
      document.getElementById('pause')?.remove();
      document.getElementById('pause-scrim')?.remove();
      this.pauseOpen = false;
      audio.bardPaused = false;
      this.input.enabled = true;
      if (this.session.solo) this.session.send({ t: 'pause', p: false });
      return;
    }
    this.hideSkills();
    this.pauseOpen = true;
    audio.bardPaused = true;
    this.input.enabled = false;
    this.input.clear();
    if (this.session.solo) this.session.send({ t: 'pause', p: true });
    const host = this.session.isHost() && !this.session.solo;
    const ph = this.session.phase;
    const pauseInfo = `Capítulo ${ph.ch} · Onda ${ph.wave}/${TOTAL_WAVES} · ${this.checkpointWave > 0 ? `checkpoint: onda ${this.checkpointWave}` : 'sem checkpoint ainda'}`;
    this.overlay.append(
      h('div', { id: 'pause-scrim', style: 'position:absolute;left:0;top:0;width:640px;height:360px;background:rgba(5,6,12,0.55);z-index:39;pointer-events:none' }),
      h(
        'div',
        { id: 'pause', class: 'panel fade-in', style: 'left:225px;top:92px;width:190px;z-index:40' },
        h('h2', { text: this.session.solo ? 'Pausado' : 'Menu (o jogo continua!)' }),
        h('div', { class: 'hint', style: 'margin-bottom:5px', text: pauseInfo }),
        h('button', { class: 'btn primary', onclick: () => this.togglePause() }, 'Continuar'),
        h('button', { class: 'btn', onclick: () => this.openSettings() }, 'Configurações'),
        h('button', { class: 'btn danger', onclick: () => void this.leave(true) }, host ? 'Encerrar sala para todos' : 'Sair para o menu'),
        h('div', { class: 'foot-keys', text: 'Esc / Start: continuar · setas / D-pad: navegar · Enter / A: confirmar' }),
      ),
    );
  }

  private showTab(): void {
    this.tabOpen = true;
    const s = this.session;
    const snap = s.latest();
    if (!snap) return;
    const panel = h('div', { id: 'tab', class: 'panel fade-in', style: 'left:90px;top:40px;width:460px;z-index:30' });
    panel.append(h('h2', { text: `Equipe — Capítulo ${snap.w.ch} · Onda ${snap.w.n}/${TOTAL_WAVES}` }));
    const t = h('table', {}, h('tr', {}, h('th', { text: 'Jogador' }), h('th', { text: 'Classe' }), h('th', { text: 'Vida' }), h('th', { text: 'Suprema' }), h('th', { text: 'Estado' })));
    for (const p of snap.p)
      t.append(h('tr', {}, h('td', { text: s.nameOf(p.id), class: p.id === s.myId ? 'amber' : '' }), h('td', { text: CLASSES[p.c].name }), h('td', { text: `${p.hp}/${p.mhp}` }), h('td', { text: `${p.u}%` }), h('td', { text: p.cn === 0 ? 'desconectado' : p.s === 1 ? 'caído' : p.s === 2 ? 'morto' : 'de pé' })));
    panel.append(t, h('div', { style: 'height:6px' }), h('h2', { text: 'Suas melhorias' }));
    const mine = s.offer?.mine ?? s.mods;
    const ids = Object.entries(mine).filter(([, n]) => n > 0);
    if (!ids.length) panel.append(h('div', { class: 'hint', text: 'Nenhuma ainda — escolha entre as ondas.' }));
    for (const [id, n] of ids) {
      const u = UPGRADE_BY_ID.get(id);
      if (u) panel.append(h('div', { class: 'row', style: 'margin-bottom:2px' }, h('div', { style: 'flex:0 0 18px' }, iconEl(u.icon)), h('div', {}, h('span', { class: 'amber', text: `${u.name} ×${n}` }), ` — ${u.desc}`)));
    }
    const me = snap.p.find((p) => p.id === s.myId);
    if (me) panel.append(h('div', { class: 'hint', style: 'margin-top:4px', text: `${CLASSES[me.c].texts.passive.name}: ${CLASSES[me.c].texts.passive.desc}` }));
    this.overlay.append(panel);
  }

  private hideTab(): void {
    this.tabOpen = false;
    document.getElementById('tab')?.remove();
  }

  /** Consulta rápida: só existe enquanto F1 está pressionado e nunca pausa o jogo. */
  private showSkills(): void {
    if (this.skillsOpen) return;
    const me = this.session.latest()?.p.find((p) => p.id === this.session.myId);
    if (!me) return;
    const def = CLASSES[me.c];
    const icons = ABILITY_ICONS[me.c] ?? [];
    const k = this.settings.keys;
    const skills = [
      { key: 'M1', ability: def.texts.basic },
      { key: keyLabel(k.q), ability: def.texts.q },
      { key: keyLabel(k.e), ability: def.texts.e },
      { key: keyLabel(k.r), ability: def.texts.r },
      { key: 'AUTO', ability: def.texts.passive },
    ];
    const card = (i: number): HTMLElement => h('div', { class: 'skill-guide-card' },
      h('div', { class: 'skill-guide-icon' }, iconEl(icons[i] ?? 'star')),
      h('div', { class: 'skill-guide-copy' },
        h('div', { class: 'skill-guide-name' }, h('span', { class: 'keycap', text: skills[i].key }), h('span', { text: skills[i].ability.name })),
        h('div', { class: 'skill-guide-desc', text: skills[i].ability.desc }),
      ),
    );
    const panel = h('div', { id: 'skill-guide', class: 'panel skill-guide' },
      h('div', { class: 'skill-guide-head' },
        h('div', {}, h('div', { class: 'skill-guide-eyebrow', text: 'GRIMÓRIO DE COMBATE' }), h('div', { class: 'skill-guide-title', text: def.name })),
        h('div', { class: 'skill-guide-role', text: def.role }),
      ),
      h('div', { class: 'skill-guide-grid' },
        h('div', { class: 'skill-guide-column' }, card(0), card(1), card(2)),
        h('div', { class: 'skill-guide-column' }, card(3), card(4),
          h('div', { class: 'skill-guide-tip', text: `FRAQUEZA  ${def.weakness}` }))),
      h('div', { class: 'skill-guide-foot' },
        h('span', { text: 'SEGURE F1 PARA CONSULTAR' }),
        h('span', { text: 'O JOGO CONTINUA' }),
      ),
    );
    panel.style.setProperty('--skill-accent', `#${def.color.toString(16).padStart(6, '0')}`);
    this.skillsOpen = true;
    this.overlay.append(panel);
  }

  private hideSkills(): void {
    this.skillsOpen = false;
    document.getElementById('skill-guide')?.remove();
  }

  private syncBossIntro(intro: WaveInfo['intro']): void {
    if (!intro || this.screen !== 'match') { this.hideBossIntro(); return; }
    if (this.introId !== intro.id) {
      this.hideBossIntro();
      this.introId = intro.id;
      this.introShown = false;
      this.hideSkills();
      this.hideTab();
      this.input.clear();
      this.input.enabled = false;
      const type = ENEMY_TYPES[intro.et];
      if (type) audio.startBossTheme(type, intro.t / 30);
    }
    // Primeiro o chefe se materializa no cenário; depois entram barras, retrato e título.
    if (this.introShown || intro.t > intro.d - intro.reveal) return;
    this.introShown = true;
    this.showBossIntro(intro);
  }

  private showBossIntro(intro: NonNullable<WaveInfo['intro']>): void {
    const type = ENEMY_TYPES[intro.et];
    if (!type) return;
    const def = ENEMIES[type];
    const mini = !!def.miniboss;
    // retrato em escala inteira (sem reamostragem): pixel art nítida como o resto da interface
    const [tex, fr] = tf(`${type}_walk_down_0`);
    const frame = this.game.textures.getFrame(tex, fr);
    const portrait = h('canvas', { class: 'boss-card-portrait' });
    if (frame) {
      const scale = frame.cutHeight <= 40 ? 2 : 1;
      portrait.width = frame.cutWidth;
      portrait.height = frame.cutHeight;
      portrait.style.width = `${frame.cutWidth * scale}px`;
      portrait.style.height = `${frame.cutHeight * scale}px`;
      portrait.getContext('2d')?.drawImage(frame.source.image as CanvasImageSource, frame.cutX, frame.cutY, frame.cutWidth, frame.cutHeight, 0, 0, frame.cutWidth, frame.cutHeight);
    }
    const chapter = ['', 'I', 'II', 'III'][this.session.phase.ch] ?? '';
    const panel = h('div', { id: 'boss-intro', class: `boss-intro${mini ? ' mini' : ''}` },
      h('div', { class: 'boss-intro-bar top' }),
      h('div', { class: 'boss-intro-bar bottom' }),
      h('div', { class: 'panel gold boss-card' },
        h('div', { class: 'boss-card-frame' }, portrait),
        h('div', { class: 'boss-card-copy' },
          h('div', { class: 'hint', text: mini ? `MINICHEFE · ONDA ${this.session.phase.wave}` : `CHEFE DO CAPÍTULO ${chapter} · ONDA ${this.session.phase.wave}` }),
          h('div', { class: 'boss-card-name', text: def.name.toUpperCase() }),
          h('div', { class: 'boss-card-rule' }),
          h('div', { class: 'amber', text: BOSS_TIPS[type] ?? 'Leia os ataques antes de agir.' }),
          h('div', { class: 'hint', text: 'Persegue quem ataca de longe. Provocar muda o alvo.' }),
        ),
      ),
    );
    this.overlay.append(panel);
  }

  private hideBossIntro(): void {
    if (!this.introId) return;
    this.introId = 0;
    this.introShown = false;
    document.getElementById('boss-intro')?.remove();
    this.input.clear();
    this.input.enabled = this.screen === 'match' && !this.pauseOpen && !this.settingsOpen && this.session.phase.phase === 'wave';
  }

  // ---------------------------------------------------------------- configurações

  private openSettings(): void {
    if (this.settingsOpen) return;
    this.hideSkills();
    this.settingsOpen = true;
    const s = this.settings;
    const slider = (label: string, get: () => number, set: (v: number) => void): HTMLElement => {
      const inp = h('input', { type: 'range', min: 0, max: 100, value: Math.round(get() * 100) });
      const val = h('span', { class: 'amber', text: `${Math.round(get() * 100)}%` });
      inp.addEventListener('input', () => {
        set(Number(inp.value) / 100);
        val.textContent = `${inp.value}%`;
        this.applySettings();
      });
      inp.addEventListener('change', () => void this.saveSettings());
      return h('div', {}, h('label', {}, `${label} `, val), inp);
    };
    const full = h('button', { class: 'btn' }, s.fullscreen ? 'Tela cheia: ligada' : 'Tela cheia: desligada');
    full.addEventListener('click', () => {
      s.fullscreen = !s.fullscreen;
      full.textContent = s.fullscreen ? 'Tela cheia: ligada' : 'Tela cheia: desligada';
      void this.session.bridge.sys.setFullscreen(s.fullscreen);
      void this.saveSettings();
      setTimeout(() => this.fit(), 300);
    });
    const size = h('select');
    for (const w of WINDOW_SIZES) size.append(h('option', { value: w, text: w.replace('x', '×') }));
    size.value = s.windowSize;
    size.addEventListener('change', () => {
      s.windowSize = size.value as Settings['windowSize'];
      void this.session.bridge.sys.setWindowSize(s.windowSize);
      void this.saveSettings();
      setTimeout(() => this.fit(), 300);
    });
    const scaleLbl = (): string => (s.pixelScale === 'fit' ? 'Escala: preencher janela' : 'Escala: inteira (nítida)');
    const scaleBtn = h('button', { class: 'btn' }, scaleLbl());
    scaleBtn.addEventListener('click', () => {
      s.pixelScale = s.pixelScale === 'fit' ? 'integer' : 'fit';
      scaleBtn.textContent = scaleLbl();
      void this.saveSettings();
      this.fit();
    });
    const dmg = h('button', { class: 'btn' }, `Números de dano: ${s.damageNumbers ? 'sim' : 'não'}`);
    dmg.addEventListener('click', () => {
      s.damageNumbers = !s.damageNumbers;
      dmg.textContent = `Números de dano: ${s.damageNumbers ? 'sim' : 'não'}`;
      void this.saveSettings();
    });
    const autoUp = h('button', { class: 'btn' }, `Procurar atualizações ao abrir: ${s.autoUpdate ? 'sim' : 'não'}`);
    autoUp.addEventListener('click', () => {
      s.autoUpdate = !s.autoUpdate;
      autoUp.textContent = `Procurar atualizações ao abrir: ${s.autoUpdate ? 'sim' : 'não'}`;
      void this.saveSettings();
    });
    const shaderBtn = h('button', { class: 'btn' }, `Shaders ambientais: ${s.enhancedLighting ? 'ligados' : 'desligados'}`);
    shaderBtn.addEventListener('click', () => {
      s.enhancedLighting = !s.enhancedLighting;
      shaderBtn.textContent = `Shaders ambientais: ${s.enhancedLighting ? 'ligados' : 'desligados'}`;
      this.applySettings();
      void this.saveSettings();
    });
    // acessibilidade
    const toggle = (label: string, get: () => boolean, set: (v: boolean) => void): HTMLElement => {
      const b = h('button', { class: 'btn' }, `${label}: ${get() ? 'ligado' : 'desligado'}`);
      b.addEventListener('click', () => {
        set(!get());
        b.textContent = `${label}: ${get() ? 'ligado' : 'desligado'}`;
        this.applySettings();
        void this.saveSettings();
      });
      return b;
    };
    const SCALES = [1, 1.15, 1.3];
    const scaleTxt = (): string => `Escala dos menus: ${Math.round(s.uiScale * 100)}%`;
    const uiScaleBtn = h('button', { class: 'btn' }, scaleTxt());
    uiScaleBtn.addEventListener('click', () => {
      const i = SCALES.findIndex((v) => Math.abs(v - s.uiScale) < 0.01);
      s.uiScale = SCALES[(i + 1) % SCALES.length] ?? 1;
      uiScaleBtn.textContent = scaleTxt();
      this.applySettings();
      void this.saveSettings();
    });
    const resetHints = h('button', { class: 'btn' }, 'Rever dicas de início');
    resetHints.addEventListener('click', () => {
      s.hintsSeen = [];
      this.hud.hintsSeen = new Set();
      s.hints = true;
      this.applySettings();
      void this.saveSettings();
      this.toast('As dicas vão aparecer de novo na próxima partida.');
    });
    const access = h(
      'div',
      { style: 'margin-bottom:6px' },
      h('label', { text: 'Acessibilidade' }),
      toggle('Alto contraste', () => s.highContrast, (v) => (s.highContrast = v)),
      toggle('Reduzir movimento (sem tremor/pisca)', () => s.reduceMotion, (v) => (s.reduceMotion = v)),
      toggle('Dicas contextuais', () => s.hints, (v) => (s.hints = v)),
      uiScaleBtn,
      resetHints,
    );
    const keys = h('div', { style: 'display:grid;grid-template-columns:1fr 1fr;gap:2px 8px' });
    const names: [keyof Keybinds, string][] = [
      ['up', 'Mover ↑'], ['down', 'Mover ↓'], ['left', 'Mover ←'], ['right', 'Mover →'], ['dodge', 'Esquiva'], ['q', 'Habilidade Q'],
      ['e', 'Habilidade E'], ['r', 'Suprema'], ['interact', 'Interagir/Reviver'], ['team', 'Equipe'], ['ping', 'Ping no mapa'],
    ];
    const renderKeys = (): void => {
      keys.replaceChildren();
      for (const [k, label] of names) {
        const b = h('button', { class: 'btn inline', style: 'min-width:54px;text-align:center' }, keyLabel(s.keys[k]));
        b.addEventListener('click', () => {
          b.textContent = '…tecla?';
          this.nav.suspended = true;
          const cap = (e: KeyboardEvent): void => {
            e.preventDefault();
            e.stopPropagation();
            window.removeEventListener('keydown', cap, true);
            this.nav.suspended = false;
            if (e.code !== 'Escape') {
              // troca se já estiver em uso
              const other = (Object.keys(s.keys) as (keyof Keybinds)[]).find((x) => x !== k && s.keys[x] === e.code);
              if (other) s.keys[other] = s.keys[k];
              s.keys[k] = e.code;
              void this.saveSettings();
            }
            renderKeys();
          };
          window.addEventListener('keydown', cap, true);
        });
        keys.append(h('div', { class: 'row' }, h('span', { style: 'flex:2', text: label }), h('span', { style: 'flex:0 0 auto' }, b)));
      }
    };
    renderKeys();
    const panel = h(
      'div',
      { id: 'settings', class: 'panel gold fade-in scroll', style: 'left:90px;top:12px;width:460px;height:336px;z-index:70' },
      h('h2', { text: 'Configurações' }),
      h(
        'div',
        { class: 'row', style: 'align-items:flex-start' },
        h(
          'div',
          {},
          slider('Volume geral', () => s.volumeMaster, (v) => (s.volumeMaster = v)),
          slider('Efeitos', () => s.volumeSfx, (v) => (s.volumeSfx = v)),
          slider('Ambiente', () => s.volumeAmbience, (v) => (s.volumeAmbience = v)),
          slider('Brilho do mapa', () => s.brightness, (v) => (s.brightness = v)),
          h('div', { class: 'hint', style: 'max-width:190px;margin:2px 0 4px', text: 'Luz cinematográfica e reflexos nos pisos. Pode reduzir o desempenho em GPUs antigas.' }),
          shaderBtn,
          slider('Tremor de câmera', () => s.shake, (v) => (s.shake = v)),
          slider('Intensidade de flashes', () => s.flashes, (v) => (s.flashes = v)),
          slider('Brilho das habilidades', () => s.skillGlow, (v) => (s.skillGlow = v)),
          h('label', { text: 'Tamanho da janela' }),
          size,
          h('div', { style: 'height:4px' }),
          full,
          scaleBtn,
          dmg,
          h('div', { style: 'height:6px' }),
          h('label', { text: 'Atualizações' }),
          autoUp,
          h('button', { class: 'btn', onclick: () => { this.closeSettings(); void this.checkUpdateNow(); } }, 'Procurar agora'),
        ),
        h('div', {}, access, h('label', { text: 'Controles (clique para trocar; Esc cancela)' }), keys, h('div', { class: 'hint', style: 'margin-top:3px', text: 'Mira: mouse · Ataque: botão esquerdo · Mover: botão direito (WASD cancela) · F1: habilidades · Esc: menu' }), h('button', { class: 'btn', style: 'margin-top:4px', onclick: () => { s.keys = { ...DEFAULT_KEYS }; void this.saveSettings(); renderKeys(); } }, 'Restaurar controles padrão')),
      ),
      h('div', { style: 'height:6px' }),
      h('button', { class: 'btn primary', onclick: () => this.closeSettings() }, 'Fechar'),
    );
    this.root.append(panel);
  }

  private closeSettings(): void {
    document.getElementById('settings')?.remove();
    this.settingsOpen = false;
    void this.saveSettings();
  }

  // ---------------------------------------------------------------- sair

  private async leave(user: boolean): Promise<void> {
    // o cliente de rede não emite 'closed' para saídas voluntárias
    this.userLeaving = false;
    void user;
    document.getElementById('pause')?.remove();
    this.overlay.replaceChildren();
    await this.session.disconnect();
    this.session.solo = false;
    this.session.shareAddress = '';
    this.go('menu');
  }
}
