import fs from 'node:fs';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import pg, { type Pool } from 'pg';
import { runMigrations, adoptRecognizedPreP3Database } from '../../src/db/migrate.js';
import { canonicalizeInventoryNumber } from '../../src/domain/inventoryIdentity.js';
import { migrationChecksum } from '../../src/db/migrationChecksum.js';

const enabled = process.env.P3_POSTGRES_INTEGRATION === 'true';
const baseConfig = {
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 5432),
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
  database: process.env.DB_NAME || 'lighting_faults',
};
const createdDatabases = new Set<string>();
const maintenancePool = new pg.Pool(baseConfig);
const legacySchema = fs.readFileSync(path.resolve(process.cwd(), '../database/schema.sql'), 'utf8');

function testDatabaseName(): string {
  return `p3_case_${process.pid}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

async function createDatabase(): Promise<{ name: string; pool: Pool }> {
  const name = testDatabaseName();
  await maintenancePool.query(`CREATE DATABASE "${name}"`);
  createdDatabases.add(name);
  return { name, pool: new pg.Pool({ ...baseConfig, database: name }) };
}

async function createNonUtf8Database(): Promise<{ name: string; pool: Pool }> {
  const name = testDatabaseName();
  await maintenancePool.query(`CREATE DATABASE "${name}" WITH TEMPLATE template0 ENCODING 'LATIN1' LC_COLLATE 'C' LC_CTYPE 'C'`);
  createdDatabases.add(name);
  return { name, pool: new pg.Pool({ ...baseConfig, database: name }) };
}

async function createLegacyDatabase(): Promise<{ name: string; pool: Pool }> {
  const database = await createDatabase();
  await database.pool.query(legacySchema);
  return database;
}

async function addLegacyPoint(pool: Pool, values: { id: number; inventory: string | null; lat?: number; lng?: number }) {
  await pool.query(
    `INSERT INTO light_points(id, external_id, latitude, longitude, status)
     VALUES ($1, $2, $3, $4, 'active')`,
    [values.id, values.inventory, values.lat ?? 48.7164, values.lng ?? 21.2611]
  );
}

afterAll(async () => {
  for (const name of createdDatabases) {
    await maintenancePool.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  }
  await maintenancePool.end();
});

describe.skipIf(!enabled)('P3 PostgreSQL/PostGIS migrations', () => {
  it('rejects non-UTF8 encoding before creating any application schema', async () => {
    const { pool } = await createNonUtf8Database();
    try {
      const { rows: encoding } = await pool.query<{ server_encoding: string }>(
        'SELECT current_setting(\'server_encoding\') AS server_encoding'
      );
      expect(encoding[0].server_encoding).toBe('LATIN1');
      await expect(runMigrations(pool)).rejects.toThrow(/P3 requires UTF8 server_encoding; found LATIN1/i);
      const { rows } = await pool.query<{ ledger: string | null; light_points: string | null; app_tables: string }>(
        `SELECT to_regclass('public.schema_migrations')::text AS ledger,
                to_regclass('public.light_points')::text AS light_points,
                (SELECT COUNT(*)::text FROM pg_tables WHERE schemaname='public') AS app_tables`
      );
      expect(rows[0]).toEqual({ ledger: null, light_points: null, app_tables: '0' });
    } finally {
      await pool.end();
    }
  });

  it('migrates a fresh database, replays as a no-op, and enforces direct-SQL invariants', async () => {
    const { pool } = await createDatabase();
    try {
      await runMigrations(pool);
      const firstLedger = await pool.query('SELECT version, name, checksum FROM schema_migrations ORDER BY version');
      expect(firstLedger.rows.map((row) => row.version)).toEqual(['0001', '0002']);
      const sourceMigration = fs.readFileSync(path.resolve(process.cwd(), 'src/db/migrations/0001_initial_schema.sql'), 'utf8');
      expect(firstLedger.rows[0].checksum).toBe(migrationChecksum(sourceMigration));
      await runMigrations(pool);
      const replayLedger = await pool.query('SELECT version, name, checksum FROM schema_migrations ORDER BY version');
      expect(replayLedger.rows).toEqual(firstLedger.rows);

      const { rows: versionRows } = await pool.query<{ version: string }>('SELECT postgis_full_version() AS version');
      expect(versionRows[0].version).toContain('POSTGIS="3.5');
      const { rows: indexRows } = await pool.query<{ indexname: string }>(
        `SELECT indexname FROM pg_indexes WHERE schemaname='public' AND indexname='light_points_geom_gist_idx'`
      );
      expect(indexRows).toHaveLength(1);

      await pool.query(
        `INSERT INTO light_points(inventory_number, external_id, geom, status)
         VALUES ('Café', 'duplicate-is-allowed', ST_SetSRID(ST_MakePoint(21, 48),4326), 'active'),
                ('00123', 'duplicate-is-allowed', ST_SetSRID(ST_MakePoint(22, 49),4326), 'active'),
                ('123', NULL, ST_SetSRID(ST_MakePoint(23, 50),4326), 'active'),
                ('ABC', NULL, ST_SetSRID(ST_MakePoint(24, 51),4326), 'active'),
                ('abc', NULL, ST_SetSRID(ST_MakePoint(25, 52),4326), 'active')`
      );
      await expect(pool.query(
        `INSERT INTO light_points(inventory_number, geom) VALUES (' Café ', ST_SetSRID(ST_MakePoint(21,48),4326))`
      )).rejects.toThrow();
      await expect(pool.query(
        `INSERT INTO light_points(inventory_number, geom) VALUES ('ABC', ST_SetSRID(ST_MakePoint(21,48),4326))`
      )).rejects.toThrow();
      const vector = edgeTrimVector();
      const { rows: parityRows } = await pool.query<{ canonical: string }>(
        `SELECT canonical_inventory_number($1) AS canonical`, [vector.input]
      );
      expect(parityRows[0].canonical).toBe(vector.expected);
      expect(vector.expected).toBe(canonicalizeInventoryNumber(vector.input));
      const nonMember = '\u0085P3-NEL\u0085';
      const { rows: nonMemberRows } = await pool.query<{ canonical: string }>(
        'SELECT canonical_inventory_number($1) AS canonical', [nonMember]
      );
      expect(nonMemberRows[0].canonical).toBe(nonMember);
      expect(canonicalizeInventoryNumber(nonMember)).toBe(nonMember);
      await pool.query(
        'INSERT INTO light_points(inventory_number, geom) VALUES ($1, ST_SetSRID(ST_MakePoint(20,48),4326))', [nonMember]
      );
      await expect(pool.query(
        `INSERT INTO light_points(inventory_number, geom) VALUES ('P3-BAD-LON', ST_SetSRID(ST_MakePoint(181,48),4326))`
      )).rejects.toThrow();
      await expect(pool.query(
        `INSERT INTO light_points(inventory_number, geom) VALUES ('P3-EMPTY', ST_GeomFromText('POINT EMPTY',4326))`
      )).rejects.toThrow();
      await expect(pool.query(
        `INSERT INTO light_points(inventory_number, geom) VALUES ('P3-BAD-SRID', ST_SetSRID(ST_MakePoint(20,48),3857))`
      )).rejects.toThrow();
    } finally {
      await pool.end();
    }
  });

  it('adopts the exact recognized pre-P3 schema and preserves ids and coordinates', async () => {
    const { pool } = await createLegacyDatabase();
    try {
      await addLegacyPoint(pool, { id: 42, inventory: 'INV-42', lat: 48.7164, lng: 21.2611 });
      await pool.query("SELECT setval(pg_get_serial_sequence('light_points','id'), 42)");
      await adoptRecognizedPreP3Database(pool);
      const { rows } = await pool.query<{
        id: number; inventory_number: string; external_id: string | null; longitude: number; latitude: number;
      }>(
        `SELECT id, inventory_number, external_id, ST_X(geom) AS longitude, ST_Y(geom) AS latitude
           FROM light_points WHERE id=42`
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ id: 42, inventory_number: 'INV-42', external_id: null, longitude: 21.2611, latitude: 48.7164 });
      const { rows: columns } = await pool.query<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns WHERE table_name='light_points'`
      );
      expect(columns.map((row) => row.column_name)).not.toContain('latitude');
      expect(columns.map((row) => row.column_name)).not.toContain('longitude');
      expect(columns.map((row) => row.column_name)).toContain('geom');
    } finally {
      await pool.end();
    }
  });

  it('atomically rolls back a failed adoption stamp, then retries safely', async () => {
    const legacy = await createLegacyDatabase();
    try {
      await addLegacyPoint(legacy.pool, { id: 43, inventory: 'INV-43' });
      await legacy.pool.query(`CREATE FUNCTION p3_test_fail_ledger_create() RETURNS event_trigger LANGUAGE plpgsql AS $$
        BEGIN
          IF EXISTS (SELECT 1 FROM pg_event_trigger_ddl_commands() WHERE object_identity = 'public.schema_migrations') THEN
            RAISE EXCEPTION 'injected adoption ledger create failure';
          END IF;
        END
      $$`);
      await legacy.pool.query(`CREATE EVENT TRIGGER p3_test_fail_ledger_create ON ddl_command_end
        WHEN TAG IN ('CREATE TABLE') EXECUTE FUNCTION p3_test_fail_ledger_create()`);
      await expect(adoptRecognizedPreP3Database(legacy.pool)).rejects.toThrow(/atomically record.*can be retried/i);
      const { rows: failedState } = await legacy.pool.query<{ ledger: string | null; lightPointCount: string }>(
        `SELECT to_regclass('public.schema_migrations')::text AS ledger,
                (SELECT COUNT(*)::text FROM light_points) AS "lightPointCount"`
      );
      expect(failedState[0]).toEqual({ ledger: null, lightPointCount: '1' });

      await legacy.pool.query('DROP EVENT TRIGGER p3_test_fail_ledger_create');
      await legacy.pool.query('DROP FUNCTION p3_test_fail_ledger_create()');
      await adoptRecognizedPreP3Database(legacy.pool);
      const { rows: recovered } = await legacy.pool.query<{ version: string }>('SELECT version FROM schema_migrations ORDER BY version');
      expect(recovered.map((row) => row.version)).toEqual(['0001', '0002']);
    } finally {
      await legacy.pool.query('DROP EVENT TRIGGER IF EXISTS p3_test_fail_ledger_create').catch(() => undefined);
      await legacy.pool.query('DROP FUNCTION IF EXISTS p3_test_fail_ledger_create()').catch(() => undefined);
      await legacy.pool.end();
    }
  });

  it('keeps a committed baseline marker recoverable if P3 migration fails after adoption', async () => {
    const legacy = await createLegacyDatabase();
    try {
      await addLegacyPoint(legacy.pool, { id: 44, inventory: 'INV-44' });
      await legacy.pool.query(`CREATE FUNCTION p3_test_fail_p3_alter() RETURNS event_trigger LANGUAGE plpgsql AS $$
        BEGIN
          IF EXISTS (SELECT 1 FROM pg_event_trigger_ddl_commands() WHERE object_identity = 'public.light_points') THEN
            RAISE EXCEPTION 'injected P3 migration failure after baseline stamp';
          END IF;
        END
      $$`);
      await legacy.pool.query(`CREATE EVENT TRIGGER p3_test_fail_p3_alter ON ddl_command_end
        WHEN TAG IN ('ALTER TABLE') EXECUTE FUNCTION p3_test_fail_p3_alter()`);
      await expect(adoptRecognizedPreP3Database(legacy.pool)).rejects.toThrow(/HTTP startup is blocked/i);
      const { rows: baseline } = await legacy.pool.query<{ version: string }>('SELECT version FROM schema_migrations ORDER BY version');
      expect(baseline).toEqual([{ version: '0001' }]);

      await legacy.pool.query('DROP EVENT TRIGGER p3_test_fail_p3_alter');
      await legacy.pool.query('DROP FUNCTION p3_test_fail_p3_alter()');
      await runMigrations(legacy.pool);
      const { rows: recovered } = await legacy.pool.query<{ version: string }>('SELECT version FROM schema_migrations ORDER BY version');
      expect(recovered.map((row) => row.version)).toEqual(['0001', '0002']);
    } finally {
      await legacy.pool.query('DROP EVENT TRIGGER IF EXISTS p3_test_fail_p3_alter').catch(() => undefined);
      await legacy.pool.query('DROP FUNCTION IF EXISTS p3_test_fail_p3_alter()').catch(() => undefined);
      await legacy.pool.end();
    }
  });

  it('serializes concurrent legacy adoption into one consistent migration ledger', async () => {
    const { name, pool } = await createLegacyDatabase();
    const second = new pg.Pool({ ...baseConfig, database: name });
    try {
      await addLegacyPoint(pool, { id: 45, inventory: 'INV-45' });
      const results = await Promise.allSettled([
        adoptRecognizedPreP3Database(pool), adoptRecognizedPreP3Database(second),
      ]);
      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
      const { rows } = await pool.query<{ version: string; name: string; checksum: string }>(
        'SELECT version, name, checksum FROM schema_migrations ORDER BY version'
      );
      expect(rows.map((row) => row.version)).toEqual(['0001', '0002']);
      expect(rows.every((row) => /^[a-f0-9]{64}$/.test(row.checksum))).toBe(true);
    } finally {
      await second.end();
      await pool.end();
    }
  });

  it('fails closed for unsafe legacy data and unknown schemas without applying target DDL', async () => {
    const legacy = await createLegacyDatabase();
    try {
      await addLegacyPoint(legacy.pool, { id: 1, inventory: null });
      await expect(adoptRecognizedPreP3Database(legacy.pool)).rejects.toThrow(/preflight/i);
      const { rows: ledger } = await legacy.pool.query("SELECT to_regclass('public.schema_migrations') AS ledger");
      const { rows: geom } = await legacy.pool.query(
        `SELECT to_regclass('public.light_points') IS NOT NULL AS table_exists,
                EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='light_points' AND column_name='geom') AS geom_exists`
      );
      expect(ledger[0].ledger).toBeNull();
      expect(geom[0].geom_exists).toBe(false);

      const unknown = await createDatabase();
      try {
        await unknown.pool.query('CREATE TABLE unrelated_state(id INTEGER PRIMARY KEY)');
        await expect(runMigrations(unknown.pool)).rejects.toThrow(/unversioned non-empty/i);
        const { rows } = await unknown.pool.query("SELECT to_regclass('public.schema_migrations') AS ledger");
        expect(rows[0].ledger).toBeNull();
      } finally {
        await unknown.pool.end();
      }
    } finally {
      await legacy.pool.end();
    }
  });

  it('serializes concurrent migration runners and rejects applied checksum drift', async () => {
    const { name, pool } = await createDatabase();
    const second = new pg.Pool({ ...baseConfig, database: name });
    try {
      await Promise.all([runMigrations(pool), runMigrations(second)]);
      const before = await pool.query('SELECT version FROM schema_migrations ORDER BY version');
      expect(before.rows.map((row) => row.version)).toEqual(['0001', '0002']);
      await pool.query("UPDATE schema_migrations SET checksum=repeat('0',64) WHERE version='0001'");
      await expect(runMigrations(pool)).rejects.toThrow(/checksum\/name mismatch/i);
      const after = await pool.query('SELECT version FROM schema_migrations ORDER BY version');
      expect(after.rows).toEqual(before.rows);
    } finally {
      await second.end();
      await pool.end();
    }
  });

  it('rolls back a failed transactional migration and leaves startup state fail-closed', async () => {
    const { pool } = await createDatabase();
    try {
      const baseline = fs.readFileSync(path.resolve(process.cwd(), 'src/db/migrations/0001_initial_schema.sql'), 'utf8');
      await pool.query(baseline);
      await pool.query(`CREATE TABLE schema_migrations (
        version TEXT PRIMARY KEY, name TEXT NOT NULL, checksum CHAR(64) NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`);
      const checksum = migrationChecksum(baseline);
      await pool.query('INSERT INTO schema_migrations(version, name, checksum) VALUES ($1, $2, $3)', ['0001', 'initial_schema', checksum]);
      await pool.query('CREATE INDEX light_points_geom_gist_idx ON admins(id)');

      await expect(runMigrations(pool)).rejects.toThrow(/HTTP startup is blocked/i);
      const { rows: targetColumns } = await pool.query<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns WHERE table_name='light_points' AND column_name IN ('inventory_number','geom')`
      );
      expect(targetColumns).toHaveLength(0);
      const { rows: ledger } = await pool.query<{ version: string }>('SELECT version FROM schema_migrations ORDER BY version');
      expect(ledger).toEqual([{ version: '0001' }]);
      const { rows: extension } = await pool.query<{ extension: string | null }>(
        `SELECT (SELECT extname FROM pg_extension WHERE extname='postgis') AS extension`
      );
      expect(extension[0].extension).toBeNull();
    } finally { await pool.end(); }
  });
});

function edgeTrimVector(): { input: string; expected: string } {
  const points = [0x0009, 0x000a, 0x000b, 0x000c, 0x000d, 0x0020, 0x00a0, 0x1680,
    ...Array.from({ length: 11 }, (_, index) => 0x2000 + index), 0x2028, 0x2029, 0x202f, 0x205f, 0x3000, 0xfeff];
  const edges = points.map((point) => String.fromCodePoint(point)).join('');
  return { input: `${edges}Cafe\u0301${edges}`, expected: 'Café' };
}
