import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import { normalizeSettings, type Settings } from '../shared/bridge.js';

const file = (): string => path.join(app.getPath('userData'), 'settings.json');

export function loadSettings(): Settings {
  try {
    return normalizeSettings(JSON.parse(fs.readFileSync(file(), 'utf8')));
  } catch {
    return normalizeSettings(null);
  }
}

export function saveSettings(raw: unknown): Settings {
  const s = normalizeSettings(raw);
  try {
    fs.mkdirSync(path.dirname(file()), { recursive: true });
    fs.writeFileSync(file(), JSON.stringify(s, null, 2), 'utf8');
  } catch (err) {
    console.error('falha ao salvar configurações', err);
  }
  return s;
}
