import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createBootstrapPool } from '../../src/db/bootstrapPool.js';
import { createMigrationPool } from '../../src/db/migrationPool.js';
import { runMigrations } from '../../src/db/migrate.js';
import { createFirstAdmin } from '../../src/services/bootstrapAdmin.service.js';

const { Pool } = pg;
const enabled = process.env.PRODUCTION_FOUNDATION_POSTGRES === 'true';
const syntheticRolePasswords = {
  migrator: 'synthetic-migrator-password-only-for-disposable-tests',
  runtime: 'synthetic-runtime-password-only-for-disposable-tests',
  bootstrap: 'synthetic-bootstrap-password-only-for-disposable-tests',
};

type TestPools = {
  admin: pg.Pool;
  migration: pg.Pool;
  runtime: pg.Pool;
  bootstrap: pg.Pool;
  databaseName: string;
};

let pools: TestPools | undefined;

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required for disposable PostgreSQL production-foundation integration tests.`);
  return value;
}

function createAdminPool(database: string): pg.Pool {
  return new Pool({
    host: required('DB_HOST'),
    port: Number(required('DB_PORT')),
    database,
    user: required('DB_USER'),
    password: required('DB_PASSWORD'),
    max: 2,
    connectionTimeoutMillis: 5000,
  });
}

async function clearBootstrapRows(): Promise<void> {
  await pools?.admin.query('TRUNCATE admin_activity_logs, admin_refresh_sessions, admins RESTART IDENTITY CASCADE');
}

const grantSqlPath = path.resolve(process.cwd(), '../database/production/grant-application-roles.sql');
const grantSql = fs.readFileSync(grantSqlPath, 'utf8');

async function applyRoleGrants(): Promise<void> {
  await pools?.admin.query(grantSql);
}

describe.skipIf(!enabled)('production database-role and first-admin foundation', () => {
  beforeAll(async () => {
    const configuredDatabase = required('DB_NAME');
    if (!configuredDatabase.endsWith('_test')) {
      throw new Error('Production-foundation integration may run only when DB_NAME ends with _test.');
    }
    const databaseName = `lighting_pf_${process.pid}_${Math.random().toString(36).slice(2, 8)}`;
    const maintenance = createAdminPool('postgres');
    const roles = ['lighting_migrator', 'lighting_runtime', 'lighting_bootstrap'];
    try {
      const existingRoles = await maintenance.query<{ rolname: string }>(
        'SELECT rolname FROM pg_roles WHERE rolname = ANY($1::text[])', [roles]
      );
      if (existingRoles.rows.length > 0) {
        throw new Error('Refusing to modify pre-existing production role names in the test cluster.');
      }
      await maintenance.query(`CREATE ROLE lighting_migrator LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD '${syntheticRolePasswords.migrator}'`);
      await maintenance.query(`CREATE ROLE lighting_runtime LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD '${syntheticRolePasswords.runtime}'`);
      await maintenance.query(`CREATE ROLE lighting_bootstrap LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD '${syntheticRolePasswords.bootstrap}'`);
      await maintenance.query(`CREATE DATABASE ${databaseName}`);
    } catch (error) {
      await maintenance.end();
      throw error;
    }

    const admin = createAdminPool(databaseName);
    await admin.query('CREATE EXTENSION IF NOT EXISTS pgcrypto');
    await admin.query('CREATE EXTENSION IF NOT EXISTS postgis');
    await admin.query(`GRANT CONNECT ON DATABASE ${databaseName} TO lighting_migrator`);
    await admin.query('GRANT USAGE, CREATE ON SCHEMA public TO lighting_migrator');

    const host = required('DB_HOST');
    const port = required('DB_PORT');
    const migration = createMigrationPool({
      NODE_ENV: 'production',
      MIGRATION_DB_HOST: host,
      MIGRATION_DB_PORT: port,
      MIGRATION_DB_NAME: databaseName,
      MIGRATION_DB_USER: 'lighting_migrator',
      MIGRATION_DB_PASSWORD: syntheticRolePasswords.migrator,
    });
    pools = {
      admin,
      migration,
      runtime: new Pool({
        host, port: Number(port), database: databaseName, user: 'lighting_runtime',
        password: syntheticRolePasswords.runtime, max: 2,
      }),
      bootstrap: createBootstrapPool({
        NODE_ENV: 'production',
        BOOTSTRAP_DB_HOST: host,
        BOOTSTRAP_DB_PORT: port,
        BOOTSTRAP_DB_NAME: databaseName,
        BOOTSTRAP_DB_USER: 'lighting_bootstrap',
        BOOTSTRAP_DB_PASSWORD: syntheticRolePasswords.bootstrap,
      }),
      databaseName,
    };

    await runMigrations(migration);
    await applyRoleGrants();
    await maintenance.end();
  }, 120_000);

  afterAll(async () => {
    if (!pools) return;
    const { databaseName } = pools;
    await Promise.all([pools.bootstrap.end(), pools.runtime.end(), pools.migration.end(), pools.admin.end()]);
    const maintenance = createAdminPool('postgres');
    try {
      await maintenance.query(`DROP DATABASE IF EXISTS ${databaseName} WITH (FORCE)`);
      await maintenance.query('DROP ROLE lighting_bootstrap');
      await maintenance.query('DROP ROLE lighting_runtime');
      await maintenance.query('DROP ROLE lighting_migrator');
    } finally {
      await maintenance.end();
    }
    pools = undefined;
  }, 30_000);

  it('runs the canonical migration chain as lighting_migrator and restricts runtime DDL/admin creation', async () => {
    const ledger = await pools!.runtime.query('SELECT version, name, checksum FROM schema_migrations ORDER BY version');
    expect(ledger.rows.map((row) => row.version)).toEqual(['0001', '0002']);
    await expect(pools!.runtime.query('CREATE TABLE public.runtime_must_not_ddl (id integer)'))
      .rejects.toMatchObject({ code: '42501' });
    await expect(pools!.runtime.query(
      "INSERT INTO admins (username, password_hash) VALUES ('forbidden', 'synthetic')"
    )).rejects.toMatchObject({ code: '42501' });
    const roles = await pools!.admin.query<{ rolname: string; rolsuper: boolean; rolcreatedb: boolean; rolcreaterole: boolean }>(
      'SELECT rolname, rolsuper, rolcreatedb, rolcreaterole FROM pg_roles WHERE rolname = ANY($1::text[])',
      [['lighting_migrator', 'lighting_runtime', 'lighting_bootstrap']]
    );
    expect(roles.rows).toHaveLength(3);
    expect(roles.rows.every((role) => !role.rolsuper && !role.rolcreatedb && !role.rolcreaterole)).toBe(true);
    const migratorCreate = await pools!.admin.query<{ allowed: boolean }>(
      'SELECT has_database_privilege($1, current_database(), $2) AS allowed',
      ['lighting_migrator', 'CREATE']
    );
    expect(migratorCreate.rows[0]?.allowed).toBe(false);
  });

  it('creates one administrator with a NULL-actor audit event and refuses a second bootstrap', async () => {
    const created = await createFirstAdmin(pools!.bootstrap, {
      username: 'synthetic.first', password: 'synthetic-first-password-123', fullName: 'Synthetic First',
    });
    const admin = await pools!.admin.query<{ id: number; password_hash: string }>(
      'SELECT id, password_hash FROM admins WHERE id = $1', [created.id]
    );
    expect(admin.rows).toHaveLength(1);
    expect(admin.rows[0].password_hash).not.toBe('synthetic-first-password-123');
    expect(admin.rows[0].password_hash).toMatch(/^\$2[aby]\$/);
    const audit = await pools!.admin.query<{ admin_id: number | null; action: string; entity_id: number }>(
      "SELECT admin_id, action, entity_id FROM admin_activity_logs WHERE action = 'bootstrap_admin_created'"
    );
    expect(audit.rows).toEqual([{ admin_id: null, action: 'bootstrap_admin_created', entity_id: created.id }]);

    await expect(createFirstAdmin(pools!.bootstrap, {
      username: 'synthetic.second', password: 'synthetic-second-password-123',
    })).rejects.toMatchObject({ code: 'already_initialized' });
    expect((await pools!.admin.query('SELECT id FROM admins')).rows).toHaveLength(1);
  });

  it('uses the advisory lock so concurrent bootstrap processes create at most one admin', async () => {
    await clearBootstrapRows();
    const env = {
      NODE_ENV: 'production',
      BOOTSTRAP_DB_HOST: required('DB_HOST'),
      BOOTSTRAP_DB_PORT: required('DB_PORT'),
      BOOTSTRAP_DB_NAME: pools!.databaseName,
      BOOTSTRAP_DB_USER: 'lighting_bootstrap',
      BOOTSTRAP_DB_PASSWORD: syntheticRolePasswords.bootstrap,
    };
    const secondBootstrap = createBootstrapPool(env);
    try {
      const results = await Promise.allSettled([
        createFirstAdmin(pools!.bootstrap, { username: 'synthetic.concurrent.a', password: 'synthetic-concurrent-password-a' }),
        createFirstAdmin(secondBootstrap, { username: 'synthetic.concurrent.b', password: 'synthetic-concurrent-password-b' }),
      ]);
      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
      expect((await pools!.admin.query('SELECT id FROM admins')).rows).toHaveLength(1);
      expect((await pools!.admin.query("SELECT id FROM admin_activity_logs WHERE action = 'bootstrap_admin_created'")).rows)
        .toHaveLength(1);
    } finally {
      await secondBootstrap.end();
    }
  });

  it('rolls back admin creation if bootstrap audit insertion is denied', async () => {
    await clearBootstrapRows();
    await pools!.admin.query(
      'REVOKE INSERT (admin_id, action, entity_type, entity_id, details) ON TABLE public.admin_activity_logs FROM lighting_bootstrap'
    );
    await expect(createFirstAdmin(pools!.bootstrap, {
      username: 'synthetic.audit.fail', password: 'synthetic-audit-failure-password',
    })).rejects.toMatchObject({ code: 'failed' });
    expect((await pools!.admin.query('SELECT id FROM admins')).rows).toHaveLength(0);
    expect((await pools!.admin.query('SELECT id FROM admin_activity_logs')).rows).toHaveLength(0);
    await applyRoleGrants();
  });
});
