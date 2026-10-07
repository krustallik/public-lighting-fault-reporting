import { pool } from '../db/pool.js';
import { runMigrations } from '../db/migrate.js';

try {
  await runMigrations();
  console.info('Database migration chain is current.');
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Database migration failed');
  process.exitCode = 1;
} finally {
  await pool.end();
}
