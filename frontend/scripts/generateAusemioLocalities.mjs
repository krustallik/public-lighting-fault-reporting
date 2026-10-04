import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const scriptPath = fileURLToPath(import.meta.url);
const repositoryRoot = resolve(dirname(scriptPath), '../..');
const sourceCatalogPath = 'docs/research/ausemio/ausemio-public-field-catalog-2026-10-03.json';
const sourcePath = resolve(repositoryRoot, sourceCatalogPath);
const frontendPath = resolve(
  repositoryRoot,
  'frontend/src/config/data/ausemioVoLocalities.generated.ts'
);
const backendPath = resolve(
  repositoryRoot,
  'backend/src/config/data/ausemioVoLocalities.generated.ts'
);

function quote(value) {
  return JSON.stringify(value);
}

function renderModule(localities, metadata) {
  const localityRows = localities
    .map(({ value, label }) => `  { value: ${quote(value)}, label: ${quote(label)} },`)
    .join('\n');

  return `export const AUSEMIO_VO_LOCALITIES_METADATA = {
  configurationVersion: ${quote(metadata.configurationVersion)},
  capturedAtUtc: ${quote(metadata.capturedAtUtc)},
  sourceCatalogPath: ${quote(metadata.sourceCatalogPath)},
  sourceSha256: ${quote(metadata.sourceSha256)},
  choiceCount: ${metadata.choiceCount},
} as const;

export const AUSEMIO_VO_LOCALITIES = [
${localityRows}
] as const;
`;
}

export function generateAusemioLocalityModules(source, catalogPath = sourceCatalogPath) {
  const catalog = JSON.parse(source);
  const assignment = catalog.publicForm?.fieldAssignments?.find(
    (field) => field.key === 'ulica_miesto_poruchy_lokalita'
  );
  if (!assignment || assignment.condition?.field_key !== 'vyber_sluzby') {
    throw new Error('Approved catalog is missing the service-conditioned locality assignment');
  }

  const localities = Object.entries(assignment.options ?? {})
    .filter(([value]) => assignment.condition.value?.[value]?.includes('2'))
    .map(([value, label]) => {
      if (typeof label !== 'string') {
        throw new Error(`Locality label is not a string: ${value}`);
      }
      return { value, label };
    });

  if (localities.length === 0 || new Set(localities.map(({ value }) => value)).size !== localities.length) {
    throw new Error('Approved catalog has an empty or duplicate service-2 locality list');
  }

  const metadata = {
    configurationVersion: String(catalog.capture?.configurationVersion ?? ''),
    capturedAtUtc: String(catalog.capture?.capturedAtUtc ?? ''),
    sourceCatalogPath: catalogPath.replaceAll('\\', '/'),
    sourceSha256: createHash('sha256').update(source, 'utf8').digest('hex'),
    choiceCount: localities.length,
  };

  if (!metadata.configurationVersion || !metadata.capturedAtUtc) {
    throw new Error('Approved catalog is missing version or capture provenance');
  }

  return {
    localities,
    metadata,
    frontendModule: renderModule(localities, metadata),
    backendModule: renderModule(localities, metadata),
  };
}

function writeOrCheck(path, content, checkOnly) {
  if (checkOnly) {
    try {
      if (readFileSync(path, 'utf8') === content) return true;
    } catch {
      // Report a missing generated snapshot via the same drift path as changed contents.
    }
    console.error(`Generated locality snapshot is missing or stale: ${path}`);
    return false;
  }

  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, 'utf8');
  return true;
}

export function generate(writeFiles = true) {
  const source = readFileSync(sourcePath, 'utf8');
  const generated = generateAusemioLocalityModules(source, sourceCatalogPath);
  const checkOnly = !writeFiles;
  const frontendMatches = writeOrCheck(frontendPath, generated.frontendModule, checkOnly);
  const backendMatches = writeOrCheck(backendPath, generated.backendModule, checkOnly);
  if (!frontendMatches || !backendMatches) process.exitCode = 1;
  else console.log(`Verified ${generated.metadata.choiceCount} VO localities (${generated.metadata.sourceSha256}).`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  generate(!process.argv.includes('--check'));
}
