import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(fileURLToPath(new URL('../../backend/package.json', import.meta.url)));
const { Pool } = require('pg');
const bcrypt = require('bcrypt');

const env = process.env;
const allowedHosts = new Set(['127.0.0.1', 'localhost', '::1']);
if (env.PORTFOLIO_DEMO_APPROVED !== 'true') {
  console.error('Seed refused: set PORTFOLIO_DEMO_APPROVED=true for this disposable demo only.');
  process.exit(1);
}
if (env.NODE_ENV !== 'development' || !/_demo_dev$/.test(env.DB_NAME ?? '')) {
  console.error('Seed refused: require NODE_ENV=development and a database name ending in _demo_dev.');
  process.exit(1);
}
if (!allowedHosts.has(env.DB_HOST ?? '') || !env.DB_PASSWORD || !env.ADMIN_INITIAL_PASSWORD || env.ADMIN_INITIAL_PASSWORD.length < 24) {
  console.error('Seed refused: require a loopback DB host, DB password, and 24-character demo admin password.');
  process.exit(1);
}

const pool = new Pool({
  host: env.DB_HOST,
  port: Number(env.DB_PORT ?? '5432'),
  database: env.DB_NAME,
  user: env.DB_USER,
  password: env.DB_PASSWORD,
  connectionTimeoutMillis: 5000,
});

let client;
try {
  client = await pool.connect();
  await client.query('BEGIN');

  const tables = [
    'light_points', 'admins', 'admin_refresh_sessions', 'import_batches',
    'import_batch_rows', 'inventory_audit_events', 'admin_activity_logs',
    'integration_logs', 'fault_report_history', 'report_submission_attempts',
    'email_verification_challenges', 'email_verification_rate_limits',
  ];
  const existence = await client.query(
    "SELECT to_regclass('public.light_points') IS NOT NULL AS inventory_ready, to_regclass('public.admins') IS NOT NULL AS admin_ready"
  );
  if (!existence.rows[0]?.inventory_ready || !existence.rows[0]?.admin_ready) {
    throw new Error('The database schema is not migrated.');
  }

  for (const table of tables) {
    const result = await client.query(`SELECT count(*)::int AS count FROM public."${table}"`);
    if (result.rows[0].count !== 0) {
      throw new Error('The demo seed requires all application data tables to be empty.');
    }
  }

  const passwordHash = await bcrypt.hash(env.ADMIN_INITIAL_PASSWORD, 12);
  await client.query(
    'INSERT INTO admins (username, password_hash, full_name) VALUES ($1, $2, $3)',
    ['portfolio-demo', passwordHash, 'Portfolio Demo Admin']
  );
  const inserted = await client.query(
    `INSERT INTO light_points (inventory_number, geom, address, district, lamp_type, status)
     SELECT 'DEMO-' || lpad(n::text, 3, '0'),
            ST_SetSRID(ST_MakePoint(21.247 + ((n - 1) % 8) * 0.0035,
                                    48.708 + floor((n - 1) / 8) * 0.0030), 4326),
            'Demo Street ' || n,
            'Demo district',
            CASE WHEN n % 3 = 0 THEN 'LED' ELSE 'Sodium' END,
            CASE WHEN n % 11 = 0 THEN 'maintenance' ELSE 'active' END
       FROM generate_series(1, 48) AS n`
  );

  await client.query('COMMIT');
  console.log(JSON.stringify({ syntheticInventoryInserted: inserted.rowCount, demoAdminCreated: true }));
} catch {
  if (client) await client.query('ROLLBACK').catch(() => {});
  console.error('Demo seed failed or refused; no complete synthetic dataset was committed.');
  process.exitCode = 1;
} finally {
  client?.release();
  await pool.end();
}
