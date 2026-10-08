import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcrypt';
import { config } from '../config/index.js';
import { pool } from '../db/pool.js';
import { createMigrationPool } from '../db/migrationPool.js';
import { runMigrations } from '../db/migrate.js';

const dbName = config.db.database;
if (process.env.ALLOW_DESTRUCTIVE_SEED !== 'true' || (!dbName.endsWith('_dev') && !dbName.endsWith('_test'))) {
  console.error('Seed refused: require ALLOW_DESTRUCTIVE_SEED=true and a database name ending in _dev or _test.');
  process.exitCode = 1;
} else {
  try {
    const migrationPool = createMigrationPool(process.env);
    try {
      await runMigrations(migrationPool);
    } finally {
      await migrationPool.end();
    }
    const seedPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../database/seed.sql');
    await pool.query(fs.readFileSync(seedPath, 'utf8'));
    const initialPassword = process.env.ADMIN_INITIAL_PASSWORD;
    if (initialPassword) {
      const hash = await bcrypt.hash(initialPassword, 10);
      await pool.query(
        `UPDATE admins SET password_hash = $1 WHERE username = 'admin' AND password_hash = 'PLACEHOLDER_HASH'`,
        [hash]
      );
    }
    console.info(`Development seed loaded into ${dbName}.`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Development seed failed');
    process.exitCode = 1;
  }
}
await pool.end();
