/** Contrato da ponte IPC exposta pelo preload (window.vigilia). */
import type { Profile, RunResult } from './config/meta.js';
import type { ServerMessage } from './protocol.js';
import type { UpdateStatus } from './update.js';

export interface NetInterfaceInfo {
  name: string;
  address: string;
  /** Rótulo amigável: "Radmin VPN", "Rede local", etc. */
  label: string;
  radmin: boolean;
}

export interface HostStartOptions {
  port: number;
  /** IP da interface escolhida, "0.0.0.0" (todas, opção explícita) ou "127.0.0.1" (solo). */
  bind: string;
  password: string;
  maxPlayers: number;
  solo: boolean;
}

export type HostStartResult =
  | { ok: true; port: number; bind: string; hostKey: string; connectHost: string }
  | { ok: false; code: string; message: string };

export interface ConnectOptions {
  host: string;
  port: number;
  name: string;
  password: string;
  token: string | null;
  hostKey: string | null;
}

export type NetStatus =
  | { state: 'connecting'; attempt: number }
  | { state: 'open' }
  | { state: 'reconnecting'; attempt: number; secondsLeft: number }
  | { state: 'closed'; reason: string; code: 'normal' | 'refused' | 'timeout' | 'lost' | 'host' | 'invalid' | 'rejected' | 'error' }
  | { state: 'rtt'; ms: number };

export interface Keybinds {
  up: string;
  down: string;
  left: string;
  right: string;
  dodge: string;
  q: string;
  e: string;
  r: string;
  interact: string;
  team: string;
  ping: string;
}

export interface Settings {
  name: string;
  lastHost: string;
  port: number;
  volumeMaster: number;
  volumeSfx: number;
  volumeAmbience: number;
  fullscreen: boolean;
  windowSize: '960x540' | '1280x720' | '1600x900' | '1920x1080';
  shake: number;
  flashes: number;
  /** Intensidade da camada de luz das habilidades (0 = só pixels, 1 = brilho total). */
  skillGlow: number;
  damageNumbers: boolean;
  /** Clareia apenas o mapa (0 = atmosfera original, 1 = iluminação máxima). */
  brightness: number;
  /** Filtros WebGL de ambientação e reflexos em pisos apropriados. */
  enhancedLighting: boolean;
  /** 'integer': ampliação inteira com letterbox (pixels perfeitos); 'fit': preenche a janela (fator fracionário). */
  pixelScale: 'integer' | 'fit';
  /** Procurar atualizações no GitHub ao abrir o jogo. */
  autoUpdate: boolean;
  keys: Keybinds;
}

export const DEFAULT_KEYS: Keybinds = {
  up: 'KeyW',
  down: 'KeyS',
  left: 'KeyA',
  right: 'KeyD',
  dodge: 'Space',
  q: 'KeyQ',
  e: 'KeyE',
  r: 'KeyR',
  interact: 'KeyF',
  team: 'Tab',
  ping: 'KeyG',
};

export const DEFAULT_SETTINGS: Settings = {
  name: '',
  lastHost: '',
  port: 7777,
  volumeMaster: 0.8,
  volumeSfx: 0.9,
  volumeAmbience: 0.6,
  fullscreen: false,
  windowSize: '1280x720',
  shake: 1,
  flashes: 1,
  skillGlow: 1,
  damageNumbers: true,
  brightness: 0,
  enhancedLighting: false,
  pixelScale: 'integer',
  autoUpdate: true,
  keys: { ...DEFAULT_KEYS },
};

export const WINDOW_SIZES: readonly Settings['windowSize'][] = ['960x540', '1280x720', '1600x900', '1920x1080'];

/** Valida/normaliza configurações vindas do disco ou do renderer. */
export function normalizeSettings(raw: unknown): Settings {
  const s: Settings = { ...DEFAULT_SETTINGS, keys: { ...DEFAULT_KEYS } };
  if (typeof raw !== 'object' || raw === null) return s;
  const r = raw as Record<string, unknown>;
  const num = (v: unknown, lo: number, hi: number, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
  if (typeof r.name === 'string') s.name = r.name.slice(0, 16);
  if (typeof r.lastHost === 'string') s.lastHost = r.lastHost.slice(0, 64);
  s.port = Math.round(num(r.port, 1024, 65535, 7777));
  s.volumeMaster = num(r.volumeMaster, 0, 1, s.volumeMaster);
  s.volumeSfx = num(r.volumeSfx, 0, 1, s.volumeSfx);
  s.volumeAmbience = num(r.volumeAmbience, 0, 1, s.volumeAmbience);
  s.fullscreen = r.fullscreen === true;
  if (typeof r.windowSize === 'string' && (WINDOW_SIZES as readonly string[]).includes(r.windowSize)) s.windowSize = r.windowSize as Settings['windowSize'];
  s.shake = num(r.shake, 0, 1, 1);
  s.flashes = num(r.flashes, 0, 1, 1);
  s.skillGlow = num(r.skillGlow, 0, 1, 1);
  s.damageNumbers = r.damageNumbers !== false;
  s.brightness = num(r.brightness, 0, 1, 0);
  s.enhancedLighting = r.enhancedLighting === true;
  s.pixelScale = r.pixelScale === 'fit' ? 'fit' : 'integer';
  s.autoUpdate = r.autoUpdate !== false;
  if (typeof r.keys === 'object' && r.keys !== null) {
    const k = r.keys as Record<string, unknown>;
    for (const key of Object.keys(DEFAULT_KEYS) as (keyof Keybinds)[]) {
      const v = k[key];
      if (typeof v === 'string' && /^[A-Za-z0-9]{1,24}$/.test(v)) s.keys[key] = v;
    }
  }
  return s;
}

export interface AppInfo {
  version: string;
  profile: string;
  platform: string;
  electron: string;
  /** Commit de onde esta build saiu ('dev' quando rodando do código). */
  commit: string;
}

export interface VigiliaBridge {
  net: {
    connect(o: ConnectOptions): Promise<void>;
    send(m: unknown): void;
    disconnect(): Promise<void>;
    onMessage(cb: (m: ServerMessage) => void): () => void;
    onStatus(cb: (s: NetStatus) => void): () => void;
  };
  host: {
    interfaces(): Promise<NetInterfaceInfo[]>;
    start(o: HostStartOptions): Promise<HostStartResult>;
    stop(): Promise<void>;
  };
  settings: {
    load(): Promise<Settings>;
    save(s: Settings): Promise<Settings>;
  };
  /** v1.6: perfil persistente (Lembranças e desbloqueios), validado no processo principal. */
  profile: {
    load(): Promise<Profile>;
    award(run: RunResult): Promise<Profile>;
    buy(perkId: string): Promise<{ ok: boolean; profile: Profile }>;
  };
  sys: {
    copy(text: string): Promise<boolean>;
    setFullscreen(on: boolean): Promise<void>;
    setWindowSize(size: Settings['windowSize']): Promise<void>;
    quit(): Promise<void>;
    info(): Promise<AppInfo>;
  };
  /**
   * Atualizações. A interface não escolhe endereço nem toca em arquivo: pede a ação e recebe o
   * estado. O que baixar e o que executar é decidido no processo principal (ver main/updater.ts).
   */
  update: {
    /** Procura no GitHub. Devolve o estado final da procura. */
    check(): Promise<UpdateStatus>;
    /** Estado atual, sem consultar a rede. */
    status(): Promise<UpdateStatus>;
    /** Baixa o instalador da release encontrada. */
    download(): Promise<UpdateStatus>;
    /** Executa o instalador baixado e fecha o jogo. false = não havia nada pronto. */
    install(): Promise<boolean>;
    /** Abre a página da atualização no navegador. */
    openPage(): Promise<void>;
    onStatus(cb: (s: UpdateStatus) => void): () => void;
  };
}
