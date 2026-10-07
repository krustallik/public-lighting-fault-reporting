import { copyFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const backendRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const sourceDirectory = join(backendRoot, 'src', 'data', 'service-area');
const destinationDirectory = join(backendRoot, 'dist', 'data', 'service-area');
const runtimeAssets = [
  'kosice-city.geojson',
  'kosice-city.manifest.json',
];

await mkdir(destinationDirectory, { recursive: true });
for (const assetName of runtimeAssets) {
  await copyFile(join(sourceDirectory, assetName), join(destinationDirectory, assetName));
}

console.log(`Packaged ${runtimeAssets.length} Košice service-area runtime assets.`);
