import { access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const backendRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const runtimeDirectory = join(backendRoot, 'dist', 'data', 'service-area');
const runtimeAssets = [
  'kosice-city.geojson',
  'kosice-city.manifest.json',
];

for (const assetName of runtimeAssets) {
  await access(join(runtimeDirectory, assetName), constants.R_OK);
}

const compiledModuleUrl = pathToFileURL(join(backendRoot, 'dist', 'domain', 'serviceArea.js')).href;
const { KOSICE_REPRESENTATIVE_POINT, kosiceServiceAreaClassifier } = await import(compiledModuleUrl);

if (
  !Array.isArray(KOSICE_REPRESENTATIVE_POINT) ||
  KOSICE_REPRESENTATIVE_POINT.length !== 2 ||
  !KOSICE_REPRESENTATIVE_POINT.every(Number.isFinite)
) {
  throw new Error('Compiled service-area module did not load a finite representative point.');
}

const [longitude, latitude] = KOSICE_REPRESENTATIVE_POINT;
const representativeResult = kosiceServiceAreaClassifier({ longitude, latitude });
if (representativeResult !== 'inside') {
  throw new Error(`Representative point should be inside Košice, received: ${representativeResult}`);
}

// (0, 0) is in the Gulf of Guinea, far outside the Košice municipal boundary.
const outsideResult = kosiceServiceAreaClassifier({ longitude: 0, latitude: 0 });
if (outsideResult !== 'outside') {
  throw new Error(`The deterministic outside point should be outside, received: ${outsideResult}`);
}

console.log(JSON.stringify({
  runtimeAssets,
  representativePoint: { longitude, latitude },
  representativeClassification: representativeResult,
  outsidePoint: { longitude: 0, latitude: 0 },
  outsideClassification: outsideResult,
}, null, 2));
