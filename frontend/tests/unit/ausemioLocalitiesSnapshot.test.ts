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

describe('generated AUSEMIO VO locality snapshots', () => {
  it('matches the approved source catalog with deterministic provenance and ordering', async () => {
    const source = readFileSync(catalogPath, 'utf8');
    const generatorPath = resolve(repositoryRoot, 'frontend/scripts/generateAusemioLocalities.mjs');
    const generator = await import(pathToFileURL(generatorPath).href);
    const generated = generator.generateAusemioLocalityModules(source, sourceCatalogPath);
    const expectedHash = createHash('sha256').update(source).digest('hex');

    expect(generated.localities).toHaveLength(928);
    expect(generated.metadata).toMatchObject({
      configurationVersion: '2024.11.4',
      capturedAtUtc: '2026-10-03T17:11:36.434Z',
      sourceCatalogPath,
      sourceSha256: expectedHash,
      choiceCount: 928,
    });
    expect(readFileSync(frontendSnapshotPath, 'utf8')).toBe(generated.frontendModule);
    expect(readFileSync(backendSnapshotPath, 'utf8')).toBe(generated.backendModule);

    const repeated = generator.generateAusemioLocalityModules(source, sourceCatalogPath);
    expect(repeated.frontendModule).toBe(generated.frontendModule);
    expect(repeated.backendModule).toBe(generated.backendModule);
  });
});
