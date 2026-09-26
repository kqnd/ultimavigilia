/**
 * Processo principal do Electron: janela segura, IPC validado, cliente de rede e
 * inicialização do servidor do anfitrião (utilityProcess).
 */
import path from 'node:path';
import { app, BrowserWindow, clipboard, ipcMain, type IpcMainEvent, type IpcMainInvokeEvent, Menu, session, shell } from 'electron';
import { type ConnectOptions, type HostStartOptions, type HostStartResult, type Settings, WINDOW_SIZES } from '../shared/bridge.js';
import { GAME_VERSION, PASSWORD_MAX } from '../shared/constants.js';
import { startHost, stopHost } from './hostManager.js';
import { isValidHost, listIPv4 } from './interfaces.js';
import { NetClient } from './netClient.js';
import { loadSettings, saveSettings } from './settings.js';

// Perfis separados (duas instâncias no mesmo PC): --profile=nome
const profileArg = process.argv.find((a) => a.startsWith('--profile='));
const profile = profileArg ? profileArg.slice('--profile='.length).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 24) : '';
if (profile) app.setPath('userData', path.join(app.getPath('appData'), `UltimaVigilia-${profile}`));

// Sem GPU compatível (drivers bloqueados, VMs), o WebGL cai para renderização por software.
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('enable-unsafe-swiftshader');

// Servidor do Vite só em desenvolvimento e só em localhost: no app empacotado a variável
// de ambiente é ignorada, para que ninguém faça o jogo carregar outra página com a ponte do preload.
const DEV_URL = !app.isPackaged && /^http:\/\/(localhost|127\.0\.0\.1):\d+\/$/.test(process.env.VITE_DEV_URL ?? '') ? (process.env.VITE_DEV_URL as string) : '';
const RENDERER_FILE = path.join(__dirname, '..', 'renderer', 'index.html');

let win: BrowserWindow | null = null;
let net: NetClient | null = null;

function expectedOrigin(url: string): boolean {
  if (DEV_URL) return url.startsWith(DEV_URL);
  return url.startsWith('file://') && decodeURIComponent(url).replace(/\\/g, '/').includes('/renderer/index.html');
}

/** Aceita IPC apenas da janela principal carregando o nosso renderer. */
function validSender(e: IpcMainInvokeEvent | IpcMainEvent): boolean {
  if (!win || e.sender !== win.webContents) return false;
  const url = e.senderFrame?.url ?? '';
  return expectedOrigin(url);
}

function handle<A extends unknown[], R>(channel: string, fn: (...args: A) => R | Promise<R>): void {
  ipcMain.handle(channel, (e, ...args: unknown[]) => {
    if (!validSender(e)) throw new Error('remetente IPC não autorizado');
    return fn(...(args as A));
  });
}

const str = (v: unknown, max: number): string => (typeof v === 'string' ? v.slice(0, max) : '');
const int = (v: unknown, lo: number, hi: number, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, Math.round(v))) : d);

function applyWindowSize(size: Settings['windowSize']): void {
  if (!win || win.isFullScreen()) return;
  const [w, h] = size.split('x').map(Number) as [number, number];
  win.setContentSize(w, h);
  win.center();
}

function createWindow(): void {
  const settings = loadSettings();
  const [w, h] = settings.windowSize.split('x').map(Number) as [number, number];
  win = new BrowserWindow({
    width: w,
    height: h,
    useContentSize: true,
    minWidth: 640,
    minHeight: 360,
    backgroundColor: '#07070d',
    title: `Última Vigília${profile ? ` — perfil ${profile}` : ''}`,
    show: false,
    autoHideMenuBar: true,
    fullscreen: settings.fullscreen,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      spellcheck: false,
      backgroundThrottling: false,
    },
  });
  Menu.setApplicationMenu(null);
  win.once('ready-to-show', () => win?.show());

  // navegação externa bloqueada; links http abrem no navegador do sistema apenas se explicitamente permitidos
  win.webContents.on('will-navigate', (ev, url) => {
    if (!expectedOrigin(url)) ev.preventDefault();
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url === 'https://www.radmin-vpn.com/') void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-attach-webview', (ev) => ev.preventDefault());

  const wc = win.webContents;
  net = new NetClient({
    msg: (m) => {
      if (!wc.isDestroyed()) wc.send('net:msg', m);
    },
    status: (s) => {
      if (!wc.isDestroyed()) wc.send('net:status', s);
    },
  });

  if (DEV_URL) void win.loadURL(DEV_URL);
  else void win.loadFile(RENDERER_FILE);

  win.on('closed', () => {
    win = null;
  });
}

function registerIpc(): void {
  handle('host:interfaces', () => listIPv4());
  handle('host:start', (raw: unknown): Promise<HostStartResult> | HostStartResult => {
    const r = (raw ?? {}) as Record<string, unknown>;
    const o: HostStartOptions = {
      port: int(r.port, 0, 65535, 7777),
      bind: str(r.bind, 15),
      password: str(r.password, PASSWORD_MAX),
      maxPlayers: int(r.maxPlayers, 1, 6, 6),
      solo: r.solo === true,
    };
    // o endereço de bind precisa ser uma interface real deste PC, loopback (solo) ou 0.0.0.0 (explícito)
    const allowed = new Set(['0.0.0.0', '127.0.0.1', ...listIPv4().map((i) => i.address)]);
    if (!o.solo && !allowed.has(o.bind)) return { ok: false, code: 'BADBIND', message: 'A interface escolhida não existe mais. Atualize a lista.' };
    return startHost(o);
  });
  handle('host:stop', () => stopHost('O anfitrião encerrou a partida.'));

  handle('net:connect', (raw: unknown) => {
    const r = (raw ?? {}) as Record<string, unknown>;
    const o: ConnectOptions = {
      host: str(r.host, 64).trim(),
      port: int(r.port, 1, 65535, 7777),
      name: str(r.name, 16),
      password: str(r.password, PASSWORD_MAX),
      token: typeof r.token === 'string' ? r.token.slice(0, 64) : null,
      hostKey: typeof r.hostKey === 'string' ? r.hostKey.slice(0, 64) : null,
    };
    if (!isValidHost(o.host)) throw new Error('Endereço IP inválido.');
    if (o.host === '0.0.0.0') throw new Error('0.0.0.0 não é um endereço para conectar. Use o IP do anfitrião.');
    net?.connect(o);
  });
  handle('net:disconnect', () => net?.disconnect());
  ipcMain.on('net:send', (e, m: unknown) => {
    if (!validSender(e)) return;
    if (typeof m !== 'object' || m === null) return;
    net?.send(m);
  });

  handle('settings:load', () => loadSettings());
  handle('settings:save', (raw: unknown) => saveSettings(raw));

  handle('sys:copy', (text: unknown) => {
    const t = str(text, 64);
    if (!t || /\b0\.0\.0\.0\b|localhost|127\.0\.0\.1/.test(t)) return false;
    clipboard.writeText(t);
    return true;
  });
  handle('sys:fullscreen', (on: unknown) => win?.setFullScreen(on === true));
  handle('sys:windowSize', (size: unknown) => {
    if (typeof size === 'string' && (WINDOW_SIZES as readonly string[]).includes(size)) applyWindowSize(size as Settings['windowSize']);
  });
  handle('sys:quit', () => app.quit());
  handle('sys:info', () => ({ version: GAME_VERSION, profile, platform: process.platform, electron: process.versions.electron }));
}

app.whenReady().then(() => {
  // nenhuma permissão de navegador é necessária (câmera, microfone, notificações...)
  session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  registerIpc();
  createWindow();
});

let quitting = false;
app.on('before-quit', (ev) => {
  if (quitting) return;
  quitting = true;
  ev.preventDefault();
  net?.disconnect();
  void stopHost('O anfitrião fechou o jogo.').finally(() => app.quit());
});

app.on('window-all-closed', () => app.quit());

app.on('web-contents-created', (_e, contents) => {
  contents.on('will-navigate', (ev, url) => {
    if (!expectedOrigin(url)) ev.preventDefault();
  });
});
