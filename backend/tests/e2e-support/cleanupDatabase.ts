import pg from 'pg';
import path from 'node:path';

const { Pool } = pg;
const databaseName = process.env.DB_NAME ?? '';
if (
  process.env.NODE_ENV !== 'test' ||
  process.env.P5_E2E_ALLOW_DB_RESET !== 'true' ||
  !/^p5_e2e_[a-z0-9_]+$/.test(databaseName) ||
  !path.isAbsolute(process.env.DB_HOST ?? '')
) {
  throw new Error('Refusing P5 E2E cleanup without explicit disposable PostGIS settings.');
}

const pool = new Pool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT ?? 5432),
  database: databaseName,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});
try {
  await pool.query(`
    TRUNCATE TABLE
      import_batch_rows,
      inventory_audit_events,
      import_batches,
      admin_activity_logs,
      admin_refresh_sessions,
      integration_logs,
      light_points,
      admins
    RESTART IDENTITY CASCADE
  `);
  console.log(`P5_E2E_DISPOSABLE_DATABASE_CLEANED database=${databaseName}`);
} finally {
  await pool.end();
}
