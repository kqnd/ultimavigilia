/**
 * Verificador de atualizações (processo principal).
 *
 * Tudo acontece aqui, fora do renderer: a interface não escolhe endereço, não baixa nada e não
 * executa nada — ela só pede "procure", "baixe" e "instale" e recebe o estado de volta. Isso
 * mantém o modelo de segurança do app (renderer em sandbox, sem rede e sem disco).
 *
 * Regras de rede, todas fixas no código:
 * - só HTTPS, só os domínios do GitHub listados em `ALLOWED_HOSTS`;
 * - só o repositório de `UPDATE_REPO`;
 * - no máximo `MAX_REDIRECTS` redirecionamentos, cada um revalidado contra a lista;
 * - o instalador baixado tem nome saneado, tamanho conferido com o que a release anunciou e
 *   teto de `MAX_ASSET_BYTES`.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import https from 'node:https';
import path from 'node:path';
import { app, shell } from 'electron';
import { GAME_VERSION } from '../shared/constants.js';
import {
  compareVersions, DEV_COMMIT, type ReleaseUpdate, UPDATE_REPO, UPDATE_REPO_URL, type UpdateStatus,
} from '../shared/update.js';

/** Commit desta build, carimbado por scripts/build-node.mjs. */
declare const __BUILD_COMMIT__: string;
const BUILD_COMMIT = typeof __BUILD_COMMIT__ === 'string' ? __BUILD_COMMIT__ : DEV_COMMIT;

const API = 'https://api.github.com';
const ALLOWED_HOSTS = new Set(['api.github.com', 'github.com', 'objects.githubusercontent.com', 'release-assets.githubusercontent.com']);
const MAX_REDIRECTS = 5;
const MAX_JSON_BYTES = 2 * 1024 * 1024;
const MAX_ASSET_BYTES = 600 * 1024 * 1024;
const TIMEOUT_MS = 15000;
const USER_AGENT = `UltimaVigilia/${GAME_VERSION}`;

type Listener = (s: UpdateStatus) => void;
let listener: Listener | null = null;
let status: UpdateStatus = { state: 'idle' };
let downloading = false;
/** Arquivo já baixado e conferido nesta sessão (só ele pode ser executado). */
let readyFile = '';

export function onUpdateStatus(fn: Listener | null): void {
  listener = fn;
}
function setStatus(s: UpdateStatus): UpdateStatus {
  status = s;
  listener?.(s);
  return s;
}
export function currentStatus(): UpdateStatus {
  return status;
}

// ------------------------------------------------------------------ rede

function checkUrl(raw: string): URL {
  const u = new URL(raw);
  if (u.protocol !== 'https:' || !ALLOWED_HOSTS.has(u.hostname)) throw new Error('endereço de atualização não autorizado');
  return u;
}

/** GET seguindo redirecionamentos, com a lista de domínios revalidada a cada salto. */
function get(url: string, headers: Record<string, string>, redirects = 0): Promise<{ res: import('node:http').IncomingMessage; url: string }> {
  return new Promise((resolve, reject) => {
    const u = checkUrl(url);
    const req = https.get(u, { headers: { 'User-Agent': USER_AGENT, ...headers } }, (res) => {
      const code = res.statusCode ?? 0;
      if (code >= 300 && code < 400 && res.headers.location) {
        res.resume();
        if (redirects >= MAX_REDIRECTS) return reject(new Error('redirecionamentos demais'));
        const next = new URL(res.headers.location, u).toString();
        // credenciais nunca seguem para outro domínio
        return resolve(get(next, {}, redirects + 1));
      }
      if (code !== 200) {
        res.resume();
        return reject(new Error(code === 404 ? 'não encontrado' : `GitHub respondeu ${code}`));
      }
      resolve({ res, url: u.toString() });
    });
    req.setTimeout(TIMEOUT_MS, () => req.destroy(new Error('tempo esgotado')));
    req.on('error', reject);
  });
}

async function getJson<T>(url: string): Promise<T> {
  const { res } = await get(url, { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' });
  return new Promise<T>((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    res.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_JSON_BYTES) {
        res.destroy();
        reject(new Error('resposta grande demais'));
        return;
      }
      chunks.push(c);
    });
    res.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')) as T);
      } catch {
        reject(new Error('resposta ilegível'));
      }
    });
    res.on('error', reject);
  });
}

// ------------------------------------------------------------------ procurar

interface GhAsset { name?: unknown; size?: unknown; browser_download_url?: unknown; url?: unknown }
interface GhRelease { tag_name?: unknown; name?: unknown; body?: unknown; published_at?: unknown; html_url?: unknown; draft?: unknown; prerelease?: unknown; assets?: unknown }
interface GhCommit { sha?: unknown; html_url?: unknown; commit?: { message?: unknown; author?: { date?: unknown } } }

/** Extensão do instalador desta plataforma (vazio = plataforma sem instalação automática). */
function installerExt(): string {
  return process.platform === 'win32' ? '.exe' : '';
}

/** Nome de arquivo seguro para gravar em disco (sem caminho, sem caractere estranho). */
function safeName(raw: string): string {
  return path.basename(raw).replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 96);
}

function pickAsset(release: GhRelease): { name: string; size: number; url: string } | null {
  const ext = installerExt();
  if (!ext || !Array.isArray(release.assets)) return null;
  for (const raw of release.assets as GhAsset[]) {
    const name = typeof raw.name === 'string' ? raw.name : '';
    const url = typeof raw.browser_download_url === 'string' ? raw.browser_download_url : '';
    const size = typeof raw.size === 'number' ? raw.size : 0;
    if (!name.toLowerCase().endsWith(ext) || !url || size <= 0 || size > MAX_ASSET_BYTES) continue;
    // entre vários .exe, o instalador ganha do portátil (o portátil não se instala sozinho)
    if (/instalador|setup|install/i.test(name)) return { name, size, url };
  }
  for (const raw of release.assets as GhAsset[]) {
    const name = typeof raw.name === 'string' ? raw.name : '';
    const url = typeof raw.browser_download_url === 'string' ? raw.browser_download_url : '';
    const size = typeof raw.size === 'number' ? raw.size : 0;
    if (name.toLowerCase().endsWith(ext) && url && size > 0 && size <= MAX_ASSET_BYTES) return { name, size, url };
  }
  return null;
}

/** Endereço do instalador da release encontrada (guardado aqui, nunca exposto ao renderer). */
let pendingAssetUrl = '';

async function findRelease(): Promise<ReleaseUpdate | null> {
  const r = await getJson<GhRelease>(`${API}/repos/${UPDATE_REPO.owner}/${UPDATE_REPO.repo}/releases/latest`).catch((e: Error) => {
    // repositório ainda sem nenhuma release: não é erro, só não há o que instalar
    if (e.message === 'não encontrado') return null;
    throw e;
  });
  if (!r || r.draft === true || r.prerelease === true) return null;
  const tag = typeof r.tag_name === 'string' ? r.tag_name : '';
  const version = tag.replace(/^v/i, '').trim();
  if (!version || compareVersions(version, GAME_VERSION) <= 0) return null;
  const asset = pickAsset(r);
  pendingAssetUrl = asset?.url ?? '';
  return {
    kind: 'release',
    version,
    title: (typeof r.name === 'string' && r.name.trim()) || `Versão ${version}`,
    notes: (typeof r.body === 'string' ? r.body : '').trim().slice(0, 1200),
    publishedAt: typeof r.published_at === 'string' ? r.published_at : '',
    asset: asset ? { name: asset.name, size: asset.size } : null,
    url: typeof r.html_url === 'string' ? r.html_url : `${UPDATE_REPO_URL}/releases`,
  };
}

/** Quantos commits o repositório está à frente desta build (0 quando não dá para comparar). */
async function commitsAhead(latestSha: string): Promise<number> {
  if (BUILD_COMMIT === DEV_COMMIT || !/^[0-9a-f]{7,40}$/i.test(BUILD_COMMIT)) return 0;
  try {
    const cmp = await getJson<{ ahead_by?: unknown }>(`${API}/repos/${UPDATE_REPO.owner}/${UPDATE_REPO.repo}/compare/${BUILD_COMMIT}...${latestSha}`);
    return typeof cmp.ahead_by === 'number' ? cmp.ahead_by : 0;
  } catch {
    // build feita de outro histórico (fork, cópia local): o GitHub não consegue comparar
    return 0;
  }
}

export async function checkForUpdate(): Promise<UpdateStatus> {
  if (status.state === 'checking' || downloading) return status;
  setStatus({ state: 'checking' });
  try {
    const release = await findRelease();
    if (release) return setStatus({ state: 'found', update: release });

    const c = await getJson<GhCommit>(`${API}/repos/${UPDATE_REPO.owner}/${UPDATE_REPO.repo}/commits/${UPDATE_REPO.branch}`);
    const sha = typeof c.sha === 'string' ? c.sha : '';
    if (!sha || sha.toLowerCase() === BUILD_COMMIT.toLowerCase()) return setStatus({ state: 'current' });
    // sem carimbo de commit (jogo rodando do código), avisar de cada commit do repositório seria
    // ruído constante — nesse caso não há o que dizer de útil
    if (BUILD_COMMIT === DEV_COMMIT) return setStatus({ state: 'current' });

    const message = String(c.commit?.message ?? '').split('\n')[0]?.slice(0, 120) ?? '';
    return setStatus({
      state: 'found',
      update: {
        kind: 'commits',
        ahead: await commitsAhead(sha),
        sha: sha.slice(0, 7),
        message,
        date: String(c.commit?.author?.date ?? ''),
        url: typeof c.html_url === 'string' ? c.html_url : `${UPDATE_REPO_URL}/commits/${UPDATE_REPO.branch}`,
      },
    });
  } catch (err) {
    return setStatus({ state: 'error', message: err instanceof Error ? err.message : 'falha ao consultar o GitHub' });
  }
}

// ------------------------------------------------------------------ baixar e instalar

function updatesDir(): string {
  return path.join(app.getPath('userData'), 'updates');
}

export async function downloadUpdate(): Promise<UpdateStatus> {
  if (downloading) return status;
  const found = status.state === 'found' ? status.update : null;
  if (!found || found.kind !== 'release' || !found.asset || !pendingAssetUrl) {
    return setStatus({ state: 'error', message: 'Esta atualização não traz instalador para baixar.' });
  }
  const release = found;
  const asset = found.asset;
  downloading = true;
  readyFile = '';
  const dir = updatesDir();
  const file = path.join(dir, safeName(asset.name));
  const partial = `${file}.part`;
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.rmSync(partial, { force: true });
    setStatus({ state: 'downloading', update: release, received: 0, total: asset.size });

    const { res } = await get(pendingAssetUrl, { Accept: 'application/octet-stream' });
    await new Promise<void>((resolve, reject) => {
      const out = fs.createWriteStream(partial);
      let received = 0;
      let lastTick = 0;
      res.on('data', (c: Buffer) => {
        received += c.length;
        if (received > MAX_ASSET_BYTES) {
          res.destroy();
          out.destroy();
          reject(new Error('arquivo maior que o esperado'));
          return;
        }
        // no máximo ~20 avisos por segundo para a interface
        const now = Date.now();
        if (now - lastTick > 50) {
          lastTick = now;
          setStatus({ state: 'downloading', update: release, received, total: asset.size });
        }
      });
      res.on('error', reject);
      out.on('error', reject);
      out.on('finish', () => {
        if (received !== asset.size) reject(new Error('download incompleto'));
        else resolve();
      });
      res.pipe(out);
    });

    // confere o tamanho em disco antes de deixar o arquivo executável ao alcance do botão
    const stat = fs.statSync(partial);
    if (stat.size !== asset.size) throw new Error('arquivo baixado não confere');
    fs.rmSync(file, { force: true });
    fs.renameSync(partial, file);
    readyFile = file;
    downloading = false;
    return setStatus({ state: 'ready', update: release });
  } catch (err) {
    downloading = false;
    fs.rmSync(partial, { force: true });
    return setStatus({ state: 'error', message: err instanceof Error ? err.message : 'falha ao baixar' });
  }
}

/**
 * Executa o instalador baixado e fecha o jogo. Só roda o arquivo que esta sessão baixou e
 * conferiu — nada de caminho vindo da interface.
 */
export async function installUpdate(): Promise<boolean> {
  if (status.state !== 'ready' || !readyFile || !fs.existsSync(readyFile)) return false;
  if (process.platform === 'win32') {
    const child = spawn(readyFile, [], { detached: true, stdio: 'ignore' });
    child.unref();
  } else {
    const err = await shell.openPath(readyFile);
    if (err) return false;
  }
  setTimeout(() => app.quit(), 400);
  return true;
}

/** Abre no navegador a página da atualização encontrada (endereço do GitHub, conferido). */
export async function openUpdatePage(): Promise<void> {
  const raw = status.state === 'found' ? status.update.url
    : status.state === 'downloading' || status.state === 'ready' ? status.update.url
      : UPDATE_REPO_URL;
  try {
    const u = new URL(raw);
    if (u.protocol === 'https:' && (u.hostname === 'github.com' || u.hostname === 'api.github.com')) {
      await shell.openExternal(u.toString());
      return;
    }
  } catch { /* endereço estranho: cai no repositório */ }
  await shell.openExternal(UPDATE_REPO_URL);
}

/** Commit desta build, para mostrar nas informações do jogo. */
export function buildCommit(): string {
  return BUILD_COMMIT === DEV_COMMIT ? DEV_COMMIT : BUILD_COMMIT.slice(0, 7);
}
