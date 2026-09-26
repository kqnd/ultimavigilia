/**
 * Preload (sandbox): expõe uma API mínima e tipada. Sem acesso a filesystem, shell ou Node.
 */
import { contextBridge, ipcRenderer } from 'electron';
import type { NetStatus, VigiliaBridge } from '../shared/bridge.js';
import type { ServerMessage } from '../shared/protocol.js';

const api: VigiliaBridge = {
  net: {
    connect: (o) => ipcRenderer.invoke('net:connect', o),
    send: (m) => ipcRenderer.send('net:send', m),
    disconnect: () => ipcRenderer.invoke('net:disconnect'),
    onMessage: (cb) => {
      const fn = (_e: unknown, m: ServerMessage): void => cb(m);
      ipcRenderer.on('net:msg', fn);
      return () => ipcRenderer.removeListener('net:msg', fn);
    },
    onStatus: (cb) => {
      const fn = (_e: unknown, s: NetStatus): void => cb(s);
      ipcRenderer.on('net:status', fn);
      return () => ipcRenderer.removeListener('net:status', fn);
    },
  },
  host: {
    interfaces: () => ipcRenderer.invoke('host:interfaces'),
    start: (o) => ipcRenderer.invoke('host:start', o),
    stop: () => ipcRenderer.invoke('host:stop'),
  },
  settings: {
    load: () => ipcRenderer.invoke('settings:load'),
    save: (s) => ipcRenderer.invoke('settings:save', s),
  },
  sys: {
    copy: (t) => ipcRenderer.invoke('sys:copy', String(t)),
    setFullscreen: (on) => ipcRenderer.invoke('sys:fullscreen', on === true),
    setWindowSize: (s) => ipcRenderer.invoke('sys:windowSize', s),
    quit: () => ipcRenderer.invoke('sys:quit'),
    info: () => ipcRenderer.invoke('sys:info'),
  },
};

contextBridge.exposeInMainWorld('vigilia', api);
