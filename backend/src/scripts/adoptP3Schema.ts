import { pool } from '../db/pool.js';
import { adoptRecognizedPreP3Database } from '../db/migrate.js';

if (process.env.ALLOW_P3_SCHEMA_ADOPTION !== 'true') {
  console.error('Set ALLOW_P3_SCHEMA_ADOPTION=true only after reviewing the read-only preflight output.');
  process.exitCode = 1;
} else {
  try {
    await adoptRecognizedPreP3Database();
    console.info('Recognized pre-P3 schema adopted and upgraded.');
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'P3 schema adoption failed');
    process.exitCode = 1;
  }
}
await pool.end();
