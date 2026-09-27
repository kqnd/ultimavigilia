/**
 * Verificador de atualizações: comparação de versões e o contrato que a interface consome.
 * A parte de rede vive no processo principal (src/main/updater.ts) e não é exercitada aqui;
 * o que se garante é a regra que decide SE uma versão é nova e como ela é apresentada.
 */
import { describe, expect, it } from 'vitest';
import { GAME_VERSION } from '../src/shared/constants.js';
import { compareVersions, formatBytes, UPDATE_REPO, UPDATE_REPO_URL } from '../src/shared/update.js';

describe('comparação de versões', () => {
  it('reconhece versão mais nova, mais antiga e igual', () => {
    expect(compareVersions('1.4.0', '1.3.0')).toBeGreaterThan(0);
    expect(compareVersions('1.3.0', '1.4.0')).toBeLessThan(0);
    expect(compareVersions('1.3.0', '1.3.0')).toBe(0);
  });

  it('compara número a número, não texto (1.10 é mais novo que 1.9)', () => {
    expect(compareVersions('1.10.0', '1.9.0')).toBeGreaterThan(0);
    expect(compareVersions('2.0.0', '1.99.99')).toBeGreaterThan(0);
  });

  it('aceita a tag com "v" na frente, como o GitHub costuma publicar', () => {
    expect(compareVersions('v1.4.0', '1.3.0')).toBeGreaterThan(0);
    expect(compareVersions('V1.3.0', '1.3.0')).toBe(0);
  });

  it('partes faltando valem zero (1.4 == 1.4.0)', () => {
    expect(compareVersions('1.4', '1.4.0')).toBe(0);
    expect(compareVersions('1.4.1', '1.4')).toBeGreaterThan(0);
  });

  it('ignora sufixos de pré-lançamento na comparação do núcleo', () => {
    expect(compareVersions('1.4.0-beta.1', '1.3.0')).toBeGreaterThan(0);
    expect(compareVersions('1.4.0-beta.1', '1.4.0')).toBe(0);
  });

  it('texto inválido não derruba a comparação (vale zero)', () => {
    expect(compareVersions('', GAME_VERSION)).toBeLessThan(0);
    expect(compareVersions('abc', '0.0.0')).toBe(0);
  });

  it('a versão atual do jogo nunca é "mais nova que ela mesma"', () => {
    expect(compareVersions(GAME_VERSION, GAME_VERSION)).toBe(0);
  });
});

describe('repositório observado', () => {
  it('é fixo no código e aponta para o repositório do jogo', () => {
    expect(UPDATE_REPO.owner).toBe('kqnd');
    expect(UPDATE_REPO.repo).toBe('ultimavigilia');
    expect(UPDATE_REPO_URL).toBe('https://github.com/kqnd/ultimavigilia');
  });
});

describe('tamanhos na barra de progresso', () => {
  it('mostra bytes, KB e MB conforme a escala', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2 KB');
    expect(formatBytes(110 * 1024 * 1024)).toBe('110,0 MB');
  });
});
