import bcrypt from 'bcrypt';
import pg from 'pg';
import path from 'node:path';
import { runMigrations } from '../../src/db/migrate.js';
import { pool as applicationPool } from '../../src/db/pool.js';

const { Pool } = pg;
const databaseName = process.env.DB_NAME ?? '';

function assertDisposableConfiguration(): void {
  if (
    process.env.NODE_ENV !== 'test' ||
    process.env.P5_E2E_ALLOW_DB_RESET !== 'true' ||
    !/^p5_e2e_[a-z0-9_]+$/.test(databaseName) ||
    !path.isAbsolute(process.env.DB_HOST ?? '') ||
    !process.env.DB_USER ||
    !process.env.DB_PASSWORD
  ) {
    throw new Error('Refusing P5 E2E database preparation without explicit test-only disposable PostGIS settings.');
  }
}

async function prepare(): Promise<void> {
  assertDisposableConfiguration();
  const connection = {
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT ?? 5432),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
  };
  const control = new Pool({ ...connection, database: 'postgres' });
  try {
    const { rows } = await control.query<{ exists: boolean }>(
      'SELECT EXISTS (SELECT 1 FROM pg_database WHERE datname = $1) AS exists',
      [databaseName]
    );
    if (!rows[0]?.exists) {
      await control.query(`CREATE DATABASE "${databaseName}"`);
    }
  } finally {
    await control.end();
  }

  await runMigrations(applicationPool);
  const postgis = await applicationPool.query<{ version: string | null }>(
    'SELECT postgis_full_version() AS version'
  );
  const migrations = await applicationPool.query<{ version: string }>(
    'SELECT version FROM schema_migrations ORDER BY version'
  );
  const versions = migrations.rows.map(({ version }) => version);
  if (!postgis.rows[0]?.version || versions.join(',') !== '0001,0002') {
    throw new Error(`P5 E2E requires the canonical PostGIS migration chain; found ${versions.join(',') || 'none'}.`);
  }

  await applicationPool.query(`
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
  const passwordHash = await bcrypt.hash('p5-e2e-synthetic-password', 4);
  await applicationPool.query(
    `INSERT INTO admins (username, password_hash, full_name)
     VALUES ('p5-e2e-synthetic-admin', $1, 'P5 Synthetic Admin')`,
    [passwordHash]
  );
  await applicationPool.query(
    `INSERT INTO light_points (inventory_number, geom, address, district, lamp_type, status)
     VALUES ('P5-E2E-SEED-1', ST_SetSRID(ST_MakePoint(21.2611, 48.7164), 4326),
             'Synthetic test street', 'Synthetic district', 'LED', 'active')`
  );
  console.log(`P5_E2E_DISPOSABLE_POSTGIS_READY database=${databaseName} migrations=${versions.join(',')} postgis=true synthetic_admin=true synthetic_inventory=true`);
}

try {
  await prepare();
} finally {
  await applicationPool.end();
}
