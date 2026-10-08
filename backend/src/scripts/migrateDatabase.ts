import dotenv from 'dotenv';
import { createMigrationPool } from '../db/migrationPool.js';
import { runMigrations } from '../db/migrate.js';

dotenv.config();

const migrationPool = createMigrationPool(process.env);
try {
  await runMigrations(migrationPool);
  console.info('Database migration chain is current.');
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Database migration failed');
  process.exitCode = 1;
} finally {
  await migrationPool.end();
}
