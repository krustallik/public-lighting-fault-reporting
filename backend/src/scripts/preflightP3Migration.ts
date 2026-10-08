import dotenv from 'dotenv';
import { createMigrationPool } from '../db/migrationPool.js';
import { runReadOnlyP3Preflight } from '../db/migrate.js';

dotenv.config();

const migrationPool = createMigrationPool(process.env);
try {
  const summary = await runReadOnlyP3Preflight(migrationPool);
  console.info(JSON.stringify(summary, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : 'P3 preflight failed');
  process.exitCode = 1;
} finally {
  await migrationPool.end();
}
