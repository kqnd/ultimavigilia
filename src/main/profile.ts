import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import { CLASS_IDS, type ClassId } from '../shared/config/classes.js';
import { applyRun, buyPerk, EMPTY_PROFILE, MEMORY, normalizeProfile, type Profile } from '../shared/config/meta.js';

/** Perfil persistente (v1.6): vive em userData/profile.json, separado das configurações. */
const file = (): string => path.join(app.getPath('userData'), 'profile.json');

export function loadProfile(): Profile {
  try {
    return normalizeProfile(JSON.parse(fs.readFileSync(file(), 'utf8')));
  } catch {
    return normalizeProfile(EMPTY_PROFILE);
  }
}

function saveProfile(p: Profile): Profile {
  try {
    fs.mkdirSync(path.dirname(file()), { recursive: true });
    const tmp = `${file()}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(p, null, 2), 'utf8');
    fs.renameSync(tmp, file());
  } catch (err) {
    console.error('falha ao salvar perfil', err);
  }
  return p;
}

/** Valida o resultado vindo do renderer antes de somar ao perfil. */
export function awardRun(raw: unknown): Profile {
  const cur = loadProfile();
  if (typeof raw !== 'object' || raw === null) return cur;
  const r = raw as Record<string, unknown>;
  const num = (v: unknown, hi: number): number => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(0, Math.floor(v))) : 0);
  const cls = typeof r.cls === 'string' && (CLASS_IDS as readonly string[]).includes(r.cls) ? (r.cls as ClassId) : null;
  return saveProfile(applyRun(cur, { memories: num(r.memories, MEMORY.maxPerMatch * 2), wave: num(r.wave, 999), victory: r.victory === true, cls }));
}

export function buyProfilePerk(id: string): { ok: boolean; profile: Profile } {
  const res = buyPerk(loadProfile(), id);
  return { ok: res.ok, profile: res.ok ? saveProfile(res.profile) : res.profile };
}
