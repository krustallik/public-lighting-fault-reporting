import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const source = path.resolve(scriptDir, '../src/db/migrations');
const distRoot = path.resolve(scriptDir, '../dist');
const target = path.resolve(distRoot, 'db/migrations');
if (!target.startsWith(`${distRoot}${path.sep}`)) {
  throw new Error('Refusing to copy migration assets outside the backend dist directory.');
}
if (!fs.existsSync(source)) throw new Error(`Canonical migrations directory missing: ${source}`);
fs.rmSync(target, { recursive: true, force: true });
fs.mkdirSync(target, { recursive: true });
for (const file of fs.readdirSync(source).filter((name) => name.endsWith('.sql')).sort()) {
  fs.copyFileSync(path.join(source, file), path.join(target, file));
}
console.info(`Packaged ${fs.readdirSync(target).length} SQL migration assets.`);
