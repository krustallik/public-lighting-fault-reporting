import dotenv from 'dotenv';
import { createMigrationPool } from '../db/migrationPool.js';
import { adoptRecognizedPreP3Database } from '../db/migrate.js';

dotenv.config();

const migrationPool = createMigrationPool(process.env);
if (process.env.ALLOW_P3_SCHEMA_ADOPTION !== 'true') {
  console.error('Set ALLOW_P3_SCHEMA_ADOPTION=true only after reviewing the read-only preflight output.');
  process.exitCode = 1;
} else {
  try {
    await adoptRecognizedPreP3Database(migrationPool);
    console.info('Recognized pre-P3 schema adopted and upgraded.');
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'P3 schema adoption failed');
    process.exitCode = 1;
  }
}
await migrationPool.end();
