import bcrypt from 'bcrypt';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from '../../src/db/pool.js';
import { runMigrations } from '../../src/db/migrate.js';

function assertDisposableContainer(env: NodeJS.ProcessEnv): void {
  if (env.NODE_ENV !== 'development' || env.LOCAL_UAT_MODE !== 'true' ||
    env.LOCAL_UAT_CONTAINER_MODE !== 'true' || env.DB_HOST !== 'db' || env.DB_PORT !== '5432' ||
    env.DB_NAME !== 'lighting_faults_local_uat_dev' || env.DB_USER !== 'plfr_uat' ||
    env.ALLOW_DESTRUCTIVE_SEED !== 'true' || !env.ADMIN_INITIAL_PASSWORD || !env.JWT_SECRET ||
    env.AUSEMIO_API_KEY?.trim() || env.RESEND_API_KEY?.trim() || env.GEOAPIFY_API_KEY?.trim() ||
    env.GEOAPIFY_ENABLED !== 'false') {
    throw new Error('Docker UAT initialization refused: only the isolated synthetic Compose database is allowed.');
  }
}

async function initialize(): Promise<void> {
  assertDisposableContainer(process.env);
  const ledger = await pool.query<{ exists: boolean }>(
    `SELECT to_regclass('public.schema_migrations') IS NOT NULL AS exists`
  );
  const isNewDatabase = !ledger.rows[0]?.exists;
  await runMigrations(pool);

  if (isNewDatabase) {
    const seedPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../database/seed.sql');
    await pool.query(fs.readFileSync(seedPath, 'utf8'));
    const passwordHash = await bcrypt.hash(process.env.ADMIN_INITIAL_PASSWORD!, 10);
    const updated = await pool.query(
      `UPDATE admins SET password_hash = $1
        WHERE username = 'admin' AND password_hash = 'PLACEHOLDER_HASH'`, [passwordHash]
    );
    if (updated.rowCount !== 1) throw new Error('Synthetic admin seed did not match its expected row.');
  }

  const state = await pool.query<{ admin_count: string; inventory_count: string }>(
    `SELECT (SELECT COUNT(*)::text FROM admins) AS admin_count,
            (SELECT COUNT(*)::text FROM light_points) AS inventory_count`
  );
  if (Number(state.rows[0]?.admin_count ?? 0) < 1 || Number(state.rows[0]?.inventory_count ?? 0) < 1) {
    throw new Error('The dedicated Docker UAT database has no synthetic admin or inventory fixture.');
  }
  console.info(`LOCAL_UAT_DOCKER_DATABASE_READY seeded=${isNewDatabase}`);
}

try {
  await initialize();
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Docker UAT initialization failed.');
  process.exitCode = 1;
} finally {
  await pool.end();
}
