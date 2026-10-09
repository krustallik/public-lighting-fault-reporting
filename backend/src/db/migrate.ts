import fs from 'node:fs';
import path from 'node:path';
import type { Pool as PgPool, PoolClient } from 'pg';
import { fileURLToPath } from 'node:url';
import { assertP3MigrationPreflight, assertP3MigrationPreflightEncoding, inspectP3MigrationPreflight } from './migrationPreflight.js';
import { migrationChecksum } from './migrationChecksum.js';
import { MIGRATION_ADVISORY_LOCK } from './advisoryLockIds.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

interface Migration {
  version: string;
  name: string;
  filename: string;
  checksum: string;
  sql: string;
}
interface AppliedMigration {
  version: string;
  name: string;
  checksum: string;
}

export class MigrationError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'MigrationError';
  }
}

function loadMigrations(): Migration[] {
  if (!fs.existsSync(MIGRATIONS_DIR)) {
    throw new MigrationError(`Migration directory missing: ${MIGRATIONS_DIR}`);
  }
  const migrations = fs.readdirSync(MIGRATIONS_DIR)
    .filter((filename) => /^\d{4}_[a-z0-9_-]+\.sql$/.test(filename))
    .sort()
    .map((filename) => {
      const [version, ...rest] = filename.replace(/\.sql$/, '').split('_');
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, filename), 'utf8');
      return {
        version,
        name: rest.join('_'),
        filename,
        checksum: migrationChecksum(sql),
        sql,
      };
    });
  if (!migrations.length || migrations[0].version !== '0001') {
    throw new MigrationError('Canonical migration chain must begin at 0001.');
  }
  for (let i = 1; i < migrations.length; i += 1) {
    if (Number(migrations[i].version) !== Number(migrations[i - 1].version) + 1) {
      throw new MigrationError(`Migration sequence gap before ${migrations[i].filename}.`);
    }
  }
  return migrations;
}

async function hasMigrationLedger(client: PoolClient): Promise<boolean> {
  const { rows } = await client.query<{ exists: boolean }>(
    `SELECT to_regclass('public.schema_migrations') IS NOT NULL AS exists`
  );
  return rows[0].exists;
}

async function applicationTables(client: PoolClient): Promise<string[]> {
  const { rows } = await client.query<{ table_name: string }>(
    `SELECT c.relname AS table_name
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
        AND c.relname <> 'schema_migrations'
        AND NOT EXISTS (
          SELECT 1 FROM pg_depend d
           JOIN pg_extension e ON e.oid = d.refobjid
           WHERE d.classid = 'pg_class'::regclass AND d.objid = c.oid AND d.deptype = 'e'
             AND e.extname IN ('postgis', 'postgis_topology', 'postgis_tiger_geocoder', 'fuzzystrmatch', 'plpgsql')
        )
      ORDER BY c.relname`
  );
  return rows.map((row) => row.table_name);
}

async function createLedger(client: PoolClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      checksum CHAR(64) NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function readApplied(client: PoolClient): Promise<AppliedMigration[]> {
  const { rows } = await client.query<AppliedMigration>(
    'SELECT version, name, checksum FROM schema_migrations ORDER BY version'
  );
  return rows;
}

async function applyRemaining(client: PoolClient, migrations: Migration[]): Promise<void> {
  await createLedger(client);
  const applied = await readApplied(client);
  const appliedByVersion = new Map(applied.map((row) => [row.version, row]));

  for (const row of applied) {
    const migration = migrations.find((candidate) => candidate.version === row.version);
    if (!migration || migration.name !== row.name || migration.checksum !== row.checksum) {
      throw new MigrationError(`Applied migration checksum/name mismatch at version ${row.version}.`);
    }
  }
  if (applied.length > 0 && !appliedByVersion.has('0001')) {
    throw new MigrationError('Migration ledger does not contain the canonical baseline.');
  }

  for (const migration of migrations) {
    if (appliedByVersion.has(migration.version)) continue;
    try {
      await client.query('BEGIN');
      if (migration.version === '0002') {
        await client.query('LOCK TABLE light_points IN ACCESS EXCLUSIVE MODE');
        await assertP3MigrationPreflight(client);
      }
      await client.query(migration.sql);
      await client.query(
        `INSERT INTO schema_migrations(version, name, checksum)
         VALUES ($1, $2, $3)`,
        [migration.version, migration.name, migration.checksum]
      );
      await client.query('COMMIT');
      console.info(`Database migration applied: ${migration.version}_${migration.name}`);
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw new MigrationError(`Database migration ${migration.filename} failed; HTTP startup is blocked.`, { cause: error });
    }
  }
}

async function withMigrationLock<T>(database: Pick<PgPool, 'connect'>, run: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await database.connect();
  let locked = false;
  try {
    await client.query('SELECT pg_advisory_lock($1, $2)', [MIGRATION_ADVISORY_LOCK.namespace, MIGRATION_ADVISORY_LOCK.key]);
    locked = true;
    return await run(client);
  } finally {
    if (locked) await client.query('SELECT pg_advisory_unlock($1, $2)', [MIGRATION_ADVISORY_LOCK.namespace, MIGRATION_ADVISORY_LOCK.key]).catch(() => undefined);
    client.release();
  }
}

/** Startup migrations are automatic only for an empty DB or a database with our ledger. */
export async function runMigrations(database: Pick<PgPool, 'connect'>): Promise<void> {
  const migrations = loadMigrations();
  await withMigrationLock(database, async (client) => {
    await assertP3MigrationPreflightEncoding(client);
    const ledgerExists = await hasMigrationLedger(client);
    if (!ledgerExists) {
      const tables = await applicationTables(client);
      if (tables.length > 0) {
        throw new MigrationError('Unversioned non-empty database detected. Run the explicit read-only preflight and approved adoption command.');
      }
      await createLedger(client);
    }
    await applyRemaining(client, migrations);
  });
}

/** Explicitly adopt the exact recognized pre-P3 schema after a read-only data preflight. */
export async function adoptRecognizedPreP3Database(database: Pick<PgPool, 'connect'>): Promise<void> {
  const migrations = loadMigrations();
  const baseline = migrations.find((migration) => migration.version === '0001');
  if (!baseline) throw new MigrationError('Canonical baseline migration 0001 is missing.');

  await withMigrationLock(database, async (client) => {
    await assertP3MigrationPreflightEncoding(client);
    if (await hasMigrationLedger(client)) {
      throw new MigrationError('Database already has a migration ledger; use the normal runner instead of adoption.');
    }
    await client.query('BEGIN READ ONLY');
    let preflight;
    try {
      preflight = await inspectP3MigrationPreflight(client);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    }
    if (preflight.state !== 'recognized-pre-p3') {
      throw new MigrationError('Adoption requires the recognized pre-P3 schema, not an empty database.');
    }
    try {
      await client.query('BEGIN');
      await createLedger(client);
      await client.query(
        `INSERT INTO schema_migrations(version, name, checksum)
         VALUES ($1, $2, $3)`,
        [baseline.version, baseline.name, baseline.checksum]
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw new MigrationError('Could not atomically record the recognized pre-P3 baseline; adoption can be retried.', { cause: error });
    }
    await applyRemaining(client, migrations);
  });
}

export async function runReadOnlyP3Preflight(database: Pick<PgPool, 'connect'>) {
  const client = await database.connect();
  try {
    await client.query('BEGIN READ ONLY');
    const result = await inspectP3MigrationPreflight(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/** Runtime-only check: assert every packaged migration has already been applied by the release step. */
export async function assertMigrationsCurrent(database: Pick<PgPool, 'connect'>): Promise<void> {
  const expected = loadMigrations();
  const client = await database.connect();
  try {
    let applied: AppliedMigration[];
    try {
      const result = await client.query<AppliedMigration>(
        'SELECT version, name, checksum FROM schema_migrations ORDER BY version'
      );
      applied = result.rows;
    } catch {
      throw new MigrationError('Migration ledger is unavailable; run the controlled migration command before HTTP startup.');
    }
    if (applied.length !== expected.length || expected.some((migration, index) => {
      const row = applied[index];
      return !row || row.version !== migration.version || row.name !== migration.name || row.checksum !== migration.checksum;
    })) {
      throw new MigrationError('Database migration ledger does not match the packaged migration chain.');
    }
  } finally {
    client.release();
  }
}
