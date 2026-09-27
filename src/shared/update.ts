/**
 * Contrato do verificador de atualizações.
 *
 * O jogo consulta um repositório público do GitHub ao abrir. Há dois casos, com tratamentos
 * diferentes de propósito:
 *
 * - **Release nova**: é a única que dá para instalar sozinha. A release traz o instalador (.exe)
 *   anexado, o jogo baixa esse arquivo e o executa. É o caminho de verdade para quem joga.
 * - **Commits novos sem release**: o repositório está à frente desta build, mas o que há lá é
 *   código-fonte — um jogo empacotado não consegue aplicar isso sozinho (precisaria de `npm
 *   install` e compilar). Então este caso só avisa e abre a página do repositório. Prometer
 *   "baixar" aqui seria mentira.
 */

/** Repositório observado. Fixo no código de propósito: nada vindo da interface escolhe a origem. */
export const UPDATE_REPO = { owner: 'kqnd', repo: 'ultimavigilia', branch: 'master' } as const;

export const UPDATE_REPO_URL = `https://github.com/${UPDATE_REPO.owner}/${UPDATE_REPO.repo}`;

/** Release mais nova que esta build, com o instalador anexado quando existir. */
export interface ReleaseUpdate {
  kind: 'release';
  /** Versão da tag, já sem o "v" (ex.: "1.4.0"). */
  version: string;
  title: string;
  /** Notas da release (cortadas: a interface mostra um trecho). */
  notes: string;
  publishedAt: string;
  /** Instalador desta plataforma. `null` = a release não anexou instalador: só dá para abrir a página. */
  asset: { name: string; size: number } | null;
  url: string;
}

/** O repositório andou, mas sem release nova: só dá para avisar. */
export interface CommitUpdate {
  kind: 'commits';
  /** Commits à frente desta build; 0 quando o GitHub não soube comparar (build sem carimbo). */
  ahead: number;
  /** SHA curto do commit mais recente. */
  sha: string;
  /** Primeira linha da mensagem do commit. */
  message: string;
  date: string;
  url: string;
}

export type UpdateFound = ReleaseUpdate | CommitUpdate;

export type UpdateStatus =
  /** Ainda não se procurou nada nesta sessão. */
  | { state: 'idle' }
  | { state: 'checking' }
  /** Procurou e não há nada novo. */
  | { state: 'current' }
  | { state: 'found'; update: UpdateFound }
  | { state: 'downloading'; update: ReleaseUpdate; received: number; total: number }
  /** Instalador baixado e conferido, pronto para rodar. */
  | { state: 'ready'; update: ReleaseUpdate }
  | { state: 'error'; message: string };

/** Build local sem carimbo de commit (rodando do código, não de um pacote). */
export const DEV_COMMIT = 'dev';

/**
 * Compara duas versões no formato "1.4.0" (partes não numéricas contam como 0).
 * Devolve >0 se `a` for mais nova que `b`, 0 se forem iguais e <0 se for mais antiga.
 */
export function compareVersions(a: string, b: string): number {
  const parts = (v: string): number[] => {
    const core = v.trim().replace(/^v/i, '').split(/[-+]/)[0] ?? '';
    return core.split('.').map((n) => {
      const x = Number.parseInt(n, 10);
      return Number.isFinite(x) ? x : 0;
    });
  };
  const pa = parts(a);
  const pb = parts(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/** Tamanho legível para a barra de progresso ("12,4 MB"). */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`;
}
