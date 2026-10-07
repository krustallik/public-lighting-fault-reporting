import { pool } from '../db/pool.js';
import { runReadOnlyP3Preflight } from '../db/migrate.js';

try {
  const summary = await runReadOnlyP3Preflight();
  console.info(JSON.stringify(summary, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : 'P3 preflight failed');
  process.exitCode = 1;
} finally {
  await pool.end();
}
