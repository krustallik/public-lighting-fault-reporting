import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from '../db/pool.js';
import { runMigrations } from '../db/migrate.js';
import { migrationChecksum } from '../db/migrationChecksum.js';

const migrationsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '../db/migrations');
const sourceMigrationsDir = path.resolve(migrationsDir, '../../../src/db/migrations');
try {
  const files = fs.readdirSync(migrationsDir).filter((file) => file.endsWith('.sql')).sort();
  if (!files.length || files[0] !== '0001_initial_schema.sql' || !files.includes('0002_p3_postgis_inventory.sql')) {
    throw new Error('Compiled SQL migration assets are missing from dist/db/migrations.');
  }
  for (const file of files) {
    const packagedSql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    const sourceSql = fs.readFileSync(path.join(sourceMigrationsDir, file), 'utf8');
    if (migrationChecksum(packagedSql) !== migrationChecksum(sourceSql)) {
      throw new Error(`Compiled migration checksum contract differs from source for ${file}.`);
    }
  }
  await runMigrations();
  const { rows } = await pool.query<{ postgis_full_version: string }>('SELECT postgis_full_version()');
  if (!rows[0]?.postgis_full_version) throw new Error('Compiled runtime could not verify PostGIS.');
  console.info(`Compiled migration smoke passed (${files.length} assets; ${rows[0].postgis_full_version.split(' ')[0]}).`);
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Compiled migration smoke failed');
  process.exitCode = 1;
} finally {
  await pool.end();
}
