import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const catalogPath = resolve(
  repositoryRoot,
  'docs/research/ausemio/ausemio-public-field-catalog-2026-10-03.json'
);
const sourceCatalogPath = 'docs/research/ausemio/ausemio-public-field-catalog-2026-10-03.json';
const frontendSnapshotPath = resolve(
  repositoryRoot,
  'frontend/src/config/data/ausemioVoLocalities.generated.ts'
);
const backendSnapshotPath = resolve(
  repositoryRoot,
  'backend/src/config/data/ausemioVoLocalities.generated.ts'
);

function normalizeCheckoutLineEndings(value: string): string {
  return value.replace(/\r\n/g, '\n');
}

describe('generated AUSEMIO VO locality snapshots', () => {
  it('uses LF-canonical provenance while preserving source-content changes', async () => {
    const source = readFileSync(catalogPath, 'utf8');
    const generatorPath = resolve(repositoryRoot, 'frontend/scripts/generateAusemioLocalities.mjs');
    const generator = await import(pathToFileURL(generatorPath).href);
    const generated = generator.generateAusemioLocalityModules(source, sourceCatalogPath);
    const expectedHash = createHash('sha256').update(normalizeCheckoutLineEndings(source)).digest('hex');
    const lfSource = normalizeCheckoutLineEndings(source);
    const generatedFromLf = generator.generateAusemioLocalityModules(lfSource, sourceCatalogPath);
    const generatedFromCrlf = generator.generateAusemioLocalityModules(
      lfSource.replace(/\n/g, '\r\n'),
      sourceCatalogPath
    );

    expect(expectedHash).toBe('786bad2f37b0e7cd67e1b73bf03ee04ab9ab4a6d49d518952a3fac5c7a06a5cb');
    expect(generatedFromLf.metadata.sourceSha256).toBe(expectedHash);
    expect(generatedFromCrlf.metadata.sourceSha256).toBe(expectedHash);
    expect(generatedFromLf.frontendModule).toBe(generatedFromCrlf.frontendModule);
    expect(generatedFromLf.backendModule).toBe(generatedFromCrlf.backendModule);
    expect(generated.localities).toHaveLength(928);
    expect(generated.metadata).toMatchObject({
      configurationVersion: '2024.11.4',
      capturedAtUtc: '2026-10-03T17:11:36.434Z',
      sourceCatalogPath,
      sourceSha256: expectedHash,
      choiceCount: 928,
    });
    const frontendSnapshot = normalizeCheckoutLineEndings(readFileSync(frontendSnapshotPath, 'utf8'));
    const backendSnapshot = normalizeCheckoutLineEndings(readFileSync(backendSnapshotPath, 'utf8'));
    expect(frontendSnapshot).toBe(generated.frontendModule);
    expect(backendSnapshot).toBe(generated.backendModule);
    expect(frontendSnapshot).toBe(backendSnapshot);

    const repeated = generator.generateAusemioLocalityModules(source, sourceCatalogPath);
    expect(repeated.frontendModule).toBe(generated.frontendModule);
    expect(repeated.backendModule).toBe(generated.backendModule);

    const changedSource = source.replace('Hlavná', 'Hlavná synthetic change');
    expect(changedSource).not.toBe(source);
    const changed = generator.generateAusemioLocalityModules(changedSource, sourceCatalogPath);
    expect(changed.metadata.sourceSha256).not.toBe(expectedHash);
    expect(changed.frontendModule).not.toBe(generated.frontendModule);
    expect(changed.backendModule).not.toBe(generated.backendModule);
  });

  it('passes the generator CLI check against LF/CRLF-equivalent checked-in snapshots', async () => {
    const { execFileSync } = await import('node:child_process');
    const generatorPath = resolve(repositoryRoot, 'frontend/scripts/generateAusemioLocalities.mjs');

    expect(() => execFileSync(process.execPath, [generatorPath, '--check'], { cwd: repositoryRoot }))
      .not.toThrow();
  });
});
