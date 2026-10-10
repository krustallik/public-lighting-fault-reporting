import fs from 'node:fs';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { PassThrough, Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { LocalFakeStorageAdapter } from '../../src/backup/localFakeStorage.js';
import type { BackupManifestV1 } from '../../src/backup/manifest.js';
import { parseBackupConfig } from '../../src/backup/config.js';
import { runBackupOnce } from '../../src/backup/runner.js';
import { restoreExactBackupToFreshDatabase } from '../../src/operations/controlledRestore.js';
import { runSyntheticRecoveryDrill } from '../../src/operations/recoveryDrill.js';
import { runRetentionOnce, utcCalendarYearCutoff } from '../../src/operations/retention.js';
import { evaluateMonitoring } from '../../src/operations/monitoring.js';
import { persistOperationsRecord } from '../../src/operations/fileEvidence.js';
import { FileSchedulerJournal } from '../../src/operations/fileSchedulerJournal.js';
import { runScheduledBackup } from '../../src/operations/scheduler.js';
import { BACKUP_ADVISORY_LOCK, MIGRATION_ADVISORY_LOCK, RETENTION_ADVISORY_LOCK } from '../../src/db/advisoryLockIds.js';
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
  backup: 'synthetic-backup-password-only-for-disposable-tests',
  retention: 'synthetic-retention-password-only-for-disposable-tests',
};
const reservedRoleNames = ['lighting_migrator', 'lighting_runtime', 'lighting_bootstrap'];
const maintenanceRoleNames = ['lighting_backup', 'lighting_retention'];
const protectedRoleNames = [...reservedRoleNames, ...maintenanceRoleNames];
const pgDumpVersion = spawnSync('pg_dump', ['--version'], { encoding: 'utf8', windowsHide: true });
const pgDump16Available = pgDumpVersion.error === undefined
  && pgDumpVersion.status === 0
  && /\b16\./.test(pgDumpVersion.stdout);
const phaseBIntegrationEnabled = enabled && process.env.PHASE_B_BACKUP_POSTGRES === 'true' && pgDump16Available;
const phaseCGPostgresEnabled = enabled && process.env.DATABASE_OPERATIONS_CG_POSTGRES === 'true';

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => { resolve = resolvePromise; reject = rejectPromise; });
  return { promise, resolve, reject };
}

async function within<T>(promise: Promise<T>, milliseconds: number, reason: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => { timer = setTimeout(() => reject(new Error(reason)), milliseconds); }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function restoreEncryptedArchive(archivePath: string, identityFile: string, targetDatabase: string): Promise<void> {
  const age = spawn('age', ['--decrypt', '--identity', identityFile, archivePath], {
    shell: false,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PATH: process.env.PATH },
  });
  const restore = spawn('pg_restore', [
    '--exit-on-error', '--no-owner', '--no-privileges', `--dbname=${targetDatabase}`,
  ], {
    shell: false,
    windowsHide: true,
    stdio: ['pipe', 'ignore', 'pipe'],
    env: {
      ...process.env,
      PGHOST: required('DB_HOST'),
      PGPORT: required('DB_PORT'),
      PGUSER: required('DB_USER'),
      PGPASSWORD: required('DB_PASSWORD'),
    },
  });
  let ageError = '';
  let restoreError = '';
  age.stderr.on('data', (chunk: Buffer) => { if (ageError.length < 4096) ageError += chunk.toString('utf8').slice(0, 4096 - ageError.length); });
  restore.stderr.on('data', (chunk: Buffer) => { if (restoreError.length < 4096) restoreError += chunk.toString('utf8').slice(0, 4096 - restoreError.length); });
  const exit = (child: typeof age | typeof restore) => new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => resolve({ code, signal }));
  });
  const ageExit = exit(age);
  const restoreExit = exit(restore);
  try {
    await pipeline(age.stdout, restore.stdin);
  } catch (error) {
    age.kill('SIGKILL');
    restore.kill('SIGKILL');
    throw error;
  }
  const [ageResult, restoreResult] = await Promise.all([ageExit, restoreExit]);
  if (ageResult.code !== 0 || restoreResult.code !== 0) {
    throw new Error(`synthetic archive restore failed (age=${ageResult.code}, pg_restore=${restoreResult.code}; ${ageError.slice(0, 256)} ${restoreError.slice(0, 256)})`);
  }
}

async function countDecryptedArchiveBytes(archivePath: string, identityFile: string): Promise<number> {
  const age = spawn('age', ['--decrypt', '--identity', identityFile, archivePath], {
    shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'], env: { ...process.env, PATH: process.env.PATH },
  });
  let bytes = 0;
  age.stdout.on('data', (chunk: Buffer) => { bytes += chunk.length; });
  const closed = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
    age.once('error', reject);
    age.once('close', (code, signal) => resolve({ code, signal }));
  });
  const result = await closed;
  if (result.code !== 0 || result.signal !== null) throw new Error('synthetic_archive_measurement_failed');
  return bytes;
}

type TestPools = {
  admin: pg.Pool;
  migration: pg.Pool;
  runtime: pg.Pool;
  bootstrap: pg.Pool;
  backup: pg.Pool;
  retention: pg.Pool;
  databaseName: string;
};

let pools: TestPools | undefined;
let firstAdminId: number | undefined;

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
const freshRolesSqlPath = path.resolve(process.cwd(), '../database/production/assert-fresh-application-roles.sql');
const freshRolesSql = fs.readFileSync(freshRolesSqlPath, 'utf8');
const createRolesSqlPath = path.resolve(process.cwd(), '../database/production/create-application-roles.sql');
const createRolesSql = fs.readFileSync(createRolesSqlPath, 'utf8');
const initialProvisioningSql = `BEGIN;\n${freshRolesSql}\n${createRolesSql}\nCOMMIT;`;
const maintenanceGrantSqlPath = path.resolve(process.cwd(), '../database/production/grant-maintenance-roles.sql');
const maintenanceGrantSql = fs.readFileSync(maintenanceGrantSqlPath, 'utf8');
const freshMaintenanceRolesSqlPath = path.resolve(process.cwd(), '../database/production/assert-fresh-maintenance-roles.sql');
const freshMaintenanceRolesSql = fs.readFileSync(freshMaintenanceRolesSqlPath, 'utf8');
const createMaintenanceRolesSqlPath = path.resolve(process.cwd(), '../database/production/create-maintenance-roles.sql');
const createMaintenanceRolesSql = fs.readFileSync(createMaintenanceRolesSqlPath, 'utf8');
const initialMaintenanceProvisioningSql = `BEGIN;\n${freshMaintenanceRolesSql}\n${createMaintenanceRolesSql}\nCOMMIT;`;

async function applyRoleGrants(): Promise<void> {
  await pools?.admin.query(grantSql);
}

async function expectRoleGrantRejection(database: pg.Pool, code: string): Promise<void> {
  const client = await database.connect();
  try {
    await expect(client.query(grantSql)).rejects.toMatchObject({ code });
    await client.query('ROLLBACK');
  } finally {
    client.release();
  }
}

async function expectMaintenanceGrantRejection(database: pg.Pool, code: string): Promise<void> {
  const client = await database.connect();
  try {
    await expect(client.query(maintenanceGrantSql)).rejects.toMatchObject({ code });
    await client.query('ROLLBACK');
  } finally {
    client.release();
  }
}

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

describe.skipIf(!enabled)('production role-provisioning collision guard', () => {
  const parentRole = `pf_collision_parent_${process.pid}`;
  let maintenance: pg.Pool | undefined;
  let createdParentRole = false;
  let createdRuntimeRole = false;

  beforeAll(async () => {
    const configuredDatabase = required('DB_NAME');
    if (!configuredDatabase.endsWith('_test')) {
      throw new Error('Production-foundation integration may run only when DB_NAME ends with _test.');
    }
    maintenance = createAdminPool('postgres');
    const existing = await maintenance.query<{ rolname: string }>(
      'SELECT rolname FROM pg_roles WHERE rolname = ANY($1::text[])',
      [[...reservedRoleNames, parentRole]]
    );
    if (existing.rows.length) throw new Error('Refusing to alter pre-existing role names in the test cluster.');

    await maintenance.query(`CREATE ROLE ${parentRole} NOLOGIN CREATEDB`);
    createdParentRole = true;
    await maintenance.query('CREATE ROLE lighting_runtime LOGIN NOINHERIT CREATEDB NOSUPERUSER NOCREATEROLE NOREPLICATION NOBYPASSRLS');
    createdRuntimeRole = true;
    await maintenance.query(`GRANT ${parentRole} TO lighting_runtime`);
  }, 30_000);

  afterAll(async () => {
    if (!maintenance) return;
    try {
      if (createdRuntimeRole) {
        await maintenance.query(`REVOKE ${parentRole} FROM lighting_runtime`);
        await maintenance.query('DROP ROLE lighting_runtime');
      }
      if (createdParentRole) await maintenance.query(`DROP ROLE ${parentRole}`);
    } finally {
      await maintenance.end();
      maintenance = undefined;
    }
  }, 30_000);

  it('rejects the canonical provisioning assertion without adopting a hostile existing role', async () => {
    const before = await maintenance!.query<{ rolcreatedb: boolean; member: boolean }>(
      `SELECT runtime.rolcreatedb,
              EXISTS (
                SELECT 1 FROM pg_auth_members m
                JOIN pg_roles granted ON granted.oid = m.roleid
                JOIN pg_roles member ON member.oid = m.member
                WHERE granted.rolname = $1 AND member.rolname = 'lighting_runtime'
              ) AS member
         FROM pg_roles runtime WHERE runtime.rolname = 'lighting_runtime'`, [parentRole]
    );
    expect(before.rows).toEqual([{ rolcreatedb: true, member: true }]);

    const client = await maintenance!.connect();
    try {
      await expect(client.query(initialProvisioningSql)).rejects.toMatchObject({ code: 'P0001' });
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }

    const after = await maintenance!.query<{ rolcreatedb: boolean; member: boolean; role_count: string }>(
      `SELECT runtime.rolcreatedb,
              EXISTS (
                SELECT 1 FROM pg_auth_members m
                JOIN pg_roles granted ON granted.oid = m.roleid
                JOIN pg_roles member ON member.oid = m.member
                WHERE granted.rolname = $1 AND member.rolname = 'lighting_runtime'
              ) AS member,
              (SELECT count(*)::text FROM pg_roles WHERE rolname = ANY($2::text[])) AS role_count
         FROM pg_roles runtime WHERE runtime.rolname = 'lighting_runtime'`,
      [parentRole, reservedRoleNames]
    );
    expect(after.rows).toEqual([{ rolcreatedb: true, member: true, role_count: '1' }]);
  });
});

describe.skipIf(!enabled)('maintenance role-provisioning collision guard', () => {
  const parentRole = `pf_maintenance_collision_parent_${process.pid}`;
  let maintenance: pg.Pool | undefined;
  let applicationRolesProvisioned = false;
  let parentRoleProvisioned = false;
  const hostileRoles = new Set<string>();

  beforeAll(async () => {
    const configuredDatabase = required('DB_NAME');
    if (!configuredDatabase.endsWith('_test')) {
      throw new Error('Production-foundation integration may run only when DB_NAME ends with _test.');
    }
    maintenance = createAdminPool('postgres');
    const existing = await maintenance.query<{ rolname: string }>(
      'SELECT rolname FROM pg_roles WHERE rolname = ANY($1::text[])',
      [[...protectedRoleNames, parentRole]]
    );
    if (existing.rows.length) throw new Error('Refusing to alter pre-existing application or maintenance role names in the test cluster.');

    await maintenance.query(initialProvisioningSql);
    applicationRolesProvisioned = true;
    await maintenance.query(`CREATE ROLE ${parentRole} NOLOGIN CREATEDB`);
    parentRoleProvisioned = true;
  }, 30_000);

  afterAll(async () => {
    if (!maintenance) return;
    try {
      for (const roleName of hostileRoles) {
        await maintenance.query(`REVOKE ${parentRole} FROM ${roleName}`);
        await maintenance.query(`DROP ROLE ${roleName}`);
      }
      if (parentRoleProvisioned) await maintenance.query(`DROP ROLE ${parentRole}`);
      if (applicationRolesProvisioned) {
        await maintenance.query('DROP ROLE lighting_bootstrap');
        await maintenance.query('DROP ROLE lighting_runtime');
        await maintenance.query('DROP ROLE lighting_migrator');
      }
    } finally {
      await maintenance.end();
      maintenance = undefined;
    }
  }, 30_000);

  it.each(maintenanceRoleNames)('rejects a hostile pre-existing %s without changing it', async (roleName) => {
    await maintenance!.query(
      `CREATE ROLE ${roleName} LOGIN NOINHERIT CREATEDB NOCREATEROLE NOSUPERUSER NOREPLICATION NOBYPASSRLS`
    );
    hostileRoles.add(roleName);
    await maintenance!.query(`GRANT ${parentRole} TO ${roleName}`);

    const before = await maintenance!.query<{ can_create_db: boolean; member: boolean }>(
      `SELECT role.rolcreatedb AS can_create_db,
              EXISTS (
                SELECT 1 FROM pg_auth_members membership
                JOIN pg_roles granted ON granted.oid = membership.roleid
                JOIN pg_roles member ON member.oid = membership.member
                WHERE granted.rolname = $2 AND member.rolname = role.rolname
              ) AS member
         FROM pg_roles role WHERE role.rolname = $1`, [roleName, parentRole]
    );
    expect(before.rows).toEqual([{ can_create_db: true, member: true }]);

    const client = await maintenance!.connect();
    try {
      await expect(client.query(initialMaintenanceProvisioningSql)).rejects.toMatchObject({ code: 'P0001' });
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }

    const after = await maintenance!.query<{ can_create_db: boolean; member: boolean; role_count: string }>(
      `SELECT role.rolcreatedb AS can_create_db,
              EXISTS (
                SELECT 1 FROM pg_auth_members membership
                JOIN pg_roles granted ON granted.oid = membership.roleid
                JOIN pg_roles member ON member.oid = membership.member
                WHERE granted.rolname = $3 AND member.rolname = role.rolname
              ) AS member,
              (SELECT count(*)::text FROM pg_roles WHERE rolname = ANY($2::text[])) AS role_count
         FROM pg_roles role WHERE role.rolname = $1`, [roleName, maintenanceRoleNames, parentRole]
    );
    expect(after.rows).toEqual([{ can_create_db: true, member: true, role_count: '1' }]);

    await maintenance!.query(`REVOKE ${parentRole} FROM ${roleName}`);
    await maintenance!.query(`DROP ROLE ${roleName}`);
    hostileRoles.delete(roleName);
  });
});

describe.skipIf(!enabled)('production database-role and first-admin foundation', () => {
  beforeAll(async () => {
    const configuredDatabase = required('DB_NAME');
    if (!configuredDatabase.endsWith('_test')) {
      throw new Error('Production-foundation integration may run only when DB_NAME ends with _test.');
    }
    const databaseName = `lighting_pf_${process.pid}_${Math.random().toString(36).slice(2, 8)}_test`;
    const maintenance = createAdminPool('postgres');
    const roles = protectedRoleNames;
    let applicationRolesProvisioned = false;
    let maintenanceRolesProvisioned = false;
    let databaseProvisioned = false;
    try {
      const existingRoles = await maintenance.query<{ rolname: string }>(
        'SELECT rolname FROM pg_roles WHERE rolname = ANY($1::text[])', [roles]
      );
      if (existingRoles.rows.length > 0) {
        throw new Error('Refusing to modify pre-existing application or maintenance role names in the test cluster.');
      }
      await maintenance.query(initialProvisioningSql);
      applicationRolesProvisioned = true;
      await maintenance.query(`ALTER ROLE lighting_migrator PASSWORD '${syntheticRolePasswords.migrator}'`);
      await maintenance.query(`ALTER ROLE lighting_runtime PASSWORD '${syntheticRolePasswords.runtime}'`);
      await maintenance.query(`ALTER ROLE lighting_bootstrap PASSWORD '${syntheticRolePasswords.bootstrap}'`);
      await maintenance.query(initialMaintenanceProvisioningSql);
      maintenanceRolesProvisioned = true;
      await maintenance.query(`CREATE DATABASE ${databaseName}`);
      databaseProvisioned = true;
    } catch (error) {
      try {
        if (databaseProvisioned) await maintenance.query(`DROP DATABASE IF EXISTS ${databaseName} WITH (FORCE)`);
        if (maintenanceRolesProvisioned) {
          await maintenance.query('DROP ROLE lighting_retention');
          await maintenance.query('DROP ROLE lighting_backup');
        }
        if (applicationRolesProvisioned) {
          await maintenance.query('DROP ROLE lighting_bootstrap');
          await maintenance.query('DROP ROLE lighting_runtime');
          await maintenance.query('DROP ROLE lighting_migrator');
        }
      } finally {
        await maintenance.end();
      }
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
      backup: new Pool({
        host, port: Number(port), database: databaseName, user: 'lighting_backup',
        password: syntheticRolePasswords.backup, max: 2,
      }),
      retention: new Pool({
        host, port: Number(port), database: databaseName, user: 'lighting_retention',
        password: syntheticRolePasswords.retention, max: 2,
      }),
      databaseName,
    };

    try {
      await runMigrations(migration);
      await applyRoleGrants();
    } finally {
      await maintenance.end();
    }
  }, 120_000);

  afterAll(async () => {
    if (!pools) return;
    const { databaseName } = pools;
    await Promise.all([
      pools.bootstrap.end(), pools.runtime.end(), pools.migration.end(),
      pools.backup.end(), pools.retention.end(), pools.admin.end(),
    ]);
    const maintenance = createAdminPool('postgres');
    try {
      await maintenance.query(`DROP DATABASE IF EXISTS ${databaseName} WITH (FORCE)`);
      await maintenance.query('DROP ROLE lighting_retention');
      await maintenance.query('DROP ROLE lighting_backup');
      await maintenance.query('DROP ROLE lighting_bootstrap');
      await maintenance.query('DROP ROLE lighting_runtime');
      await maintenance.query('DROP ROLE lighting_migrator');
    } finally {
      await maintenance.end();
    }
    pools = undefined;
  }, 30_000);

  it('reproduces interrupted maintenance-role provisioning and completes the documented least-privilege recovery', async () => {
    const partialState = await pools!.admin.query<{
      rolname: string;
      password_unset: boolean;
      safe_attributes: boolean;
      memberships: string;
      owned_objects: string;
      database_create: boolean;
      database_temp: boolean;
      schema_create: boolean;
      backup_select_before_grants: boolean;
      retention_delete_before_grants: boolean;
    }>(
      `SELECT role.rolname,
              auth.rolpassword IS NULL AS password_unset,
              role.rolcanlogin AND NOT role.rolsuper AND NOT role.rolcreatedb
                AND NOT role.rolcreaterole AND NOT role.rolreplication
                AND NOT role.rolbypassrls AND NOT role.rolinherit AS safe_attributes,
              (SELECT count(*)::text FROM pg_auth_members membership
                WHERE membership.roleid = role.oid OR membership.member = role.oid) AS memberships,
              (SELECT count(*)::text FROM pg_shdepend dependency
                WHERE dependency.refclassid = 'pg_authid'::regclass
                  AND dependency.refobjid = role.oid AND dependency.deptype = 'o') AS owned_objects,
              has_database_privilege(role.rolname, current_database(), 'CREATE') AS database_create,
              has_database_privilege(role.rolname, current_database(), 'TEMP') AS database_temp,
              has_schema_privilege(role.rolname, 'public', 'CREATE') AS schema_create,
              has_table_privilege(role.rolname, 'public.light_points', 'SELECT') AS backup_select_before_grants,
              has_table_privilege(role.rolname, 'public.admin_activity_logs', 'DELETE') AS retention_delete_before_grants
         FROM pg_roles role JOIN pg_authid auth ON auth.oid = role.oid
        WHERE role.rolname = ANY($1::text[]) ORDER BY role.rolname`,
      [maintenanceRoleNames],
    );
    expect(partialState.rows).toHaveLength(2);
    expect(partialState.rows.every((role) => role.password_unset && role.safe_attributes
      && role.memberships === '0' && role.owned_objects === '0'
      && !role.database_create && !role.database_temp && !role.schema_create
      && !role.backup_select_before_grants && !role.retention_delete_before_grants)).toBe(true);

    const collisionClient = await pools!.admin.connect();
    try {
      await expect(collisionClient.query(initialMaintenanceProvisioningSql)).rejects.toMatchObject({ code: 'P0001' });
      await collisionClient.query('ROLLBACK');
    } finally { collisionClient.release(); }

    // Test credentials are synthetic. Production recovery uses psql's hidden \\password prompts.
    for (const [roleName, password] of [
      ['lighting_backup', syntheticRolePasswords.backup],
      ['lighting_retention', syntheticRolePasswords.retention],
    ]) {
      const passwordCommand = await pools!.admin.query<{ command: string }>(
        'SELECT format(\'ALTER ROLE %I PASSWORD %L\', $1::text, $2::text) AS command', [roleName, password],
      );
      await pools!.admin.query(passwordCommand.rows[0]!.command);
    }
    await pools!.admin.query(maintenanceGrantSql);

    const recovered = await pools!.admin.query<{
      rolname: string;
      password_set: boolean;
      safe_attributes: boolean;
      memberships: string;
      owned_objects: string;
      backup_select: boolean;
      retention_allowed_delete_count: string;
      retention_import_delete: boolean;
      any_create: boolean;
    }>(
      `SELECT role.rolname,
              auth.rolpassword IS NOT NULL AS password_set,
              role.rolcanlogin AND NOT role.rolsuper AND NOT role.rolcreatedb
                AND NOT role.rolcreaterole AND NOT role.rolreplication
                AND NOT role.rolbypassrls AND NOT role.rolinherit AS safe_attributes,
              (SELECT count(*)::text FROM pg_auth_members membership
                WHERE membership.roleid = role.oid OR membership.member = role.oid) AS memberships,
              (SELECT count(*)::text FROM pg_shdepend dependency
                WHERE dependency.refclassid = 'pg_authid'::regclass
                  AND dependency.refobjid = role.oid AND dependency.deptype = 'o') AS owned_objects,
              has_table_privilege(role.rolname, 'public.light_points', 'SELECT') AS backup_select,
              (SELECT count(*)::text FROM pg_class relation
                JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
                WHERE namespace.nspname = 'public' AND relation.relkind IN ('r', 'p')
                  AND has_table_privilege(role.rolname, relation.oid, 'DELETE')) AS retention_allowed_delete_count,
              has_table_privilege(role.rolname, 'public.import_batches', 'DELETE') AS retention_import_delete,
              has_database_privilege(role.rolname, current_database(), 'CREATE')
                OR has_database_privilege(role.rolname, current_database(), 'TEMP')
                OR EXISTS (SELECT 1 FROM pg_namespace namespace
                            WHERE has_schema_privilege(role.rolname, namespace.oid, 'CREATE')) AS any_create
         FROM pg_roles role JOIN pg_authid auth ON auth.oid = role.oid
        WHERE role.rolname = ANY($1::text[]) ORDER BY role.rolname`,
      [maintenanceRoleNames],
    );
    expect(recovered.rows).toEqual([
      {
        rolname: 'lighting_backup', password_set: true, safe_attributes: true, memberships: '0', owned_objects: '0',
        backup_select: true, retention_allowed_delete_count: '0', retention_import_delete: false, any_create: false,
      },
      {
        rolname: 'lighting_retention', password_set: true, safe_attributes: true, memberships: '0', owned_objects: '0',
        backup_select: false, retention_allowed_delete_count: '3', retention_import_delete: false, any_create: false,
      },
    ]);
  });

  it('runs canonical migrations and proves the three roles have distinct, restricted PostgreSQL identities', async () => {
    const ledger = await pools!.runtime.query('SELECT version, name, checksum FROM schema_migrations ORDER BY version');
    expect(ledger.rows.map((row) => row.version)).toEqual(['0001', '0002']);

    const roleIdentities = await Promise.all([
      pools!.migration.query<{ current_user: string }>('SELECT current_user'),
      pools!.runtime.query<{ current_user: string }>('SELECT current_user'),
      pools!.bootstrap.query<{ current_user: string }>('SELECT current_user'),
    ]);
    expect(roleIdentities.map((result) => result.rows[0]?.current_user)).toEqual([
      'lighting_migrator', 'lighting_runtime', 'lighting_bootstrap',
    ]);

    await expect(pools!.runtime.query('CREATE TABLE public.runtime_must_not_ddl (id integer)'))
      .rejects.toMatchObject({ code: '42501' });
    await expect(pools!.runtime.query('ALTER TABLE public.light_points ADD COLUMN runtime_must_not_ddl integer'))
      .rejects.toMatchObject({ code: '42501' });
    await expect(pools!.runtime.query('CREATE SCHEMA runtime_must_not_ddl'))
      .rejects.toMatchObject({ code: '42501' });
    await expect(pools!.runtime.query(
      "INSERT INTO admins (username, password_hash) VALUES ('forbidden', 'synthetic')"
    )).rejects.toMatchObject({ code: '42501' });
    await expect(pools!.bootstrap.query('SELECT * FROM light_points'))
      .rejects.toMatchObject({ code: '42501' });
    await expect(pools!.bootstrap.query('CREATE TABLE public.bootstrap_must_not_ddl (id integer)'))
      .rejects.toMatchObject({ code: '42501' });
    await expect(pools!.bootstrap.query(
      "INSERT INTO admins (username, password_hash, is_active) VALUES ('forbidden.bootstrap', 'synthetic', TRUE)"
    )).rejects.toMatchObject({ code: '42501' });

    const extension = await pools!.admin.query<{ name: string }>(
      `SELECT versions.name
         FROM pg_available_extension_versions versions
         LEFT JOIN pg_extension installed ON installed.extname = versions.name
        WHERE versions.superuser AND installed.extname IS NULL
        ORDER BY versions.name LIMIT 1`
    );
    expect(extension.rows).toHaveLength(1);
    const safeExtensionName = extension.rows[0].name.replace(/"/g, '""');
    await expect(pools!.runtime.query(`CREATE EXTENSION "${safeExtensionName}"`))
      .rejects.toMatchObject({ code: '42501' });

    const roles = await pools!.admin.query<{
      rolname: string; rolcanlogin: boolean; rolsuper: boolean; rolcreatedb: boolean;
      rolcreaterole: boolean; rolreplication: boolean; rolbypassrls: boolean; rolinherit: boolean;
    }>(
      `SELECT rolname, rolcanlogin, rolsuper, rolcreatedb, rolcreaterole,
              rolreplication, rolbypassrls, rolinherit
         FROM pg_roles WHERE rolname = ANY($1::text[]) ORDER BY rolname`, [reservedRoleNames]
    );
    expect(roles.rows).toHaveLength(3);
    expect(roles.rows.every((role) => role.rolcanlogin && !role.rolsuper && !role.rolcreatedb
      && !role.rolcreaterole && !role.rolreplication && !role.rolbypassrls && !role.rolinherit)).toBe(true);

    const memberships = await pools!.admin.query<{ count: string }>(
      `SELECT count(*)::text AS count
         FROM pg_auth_members membership
         JOIN pg_roles granted ON granted.oid = membership.roleid
         JOIN pg_roles member ON member.oid = membership.member
        WHERE granted.rolname = ANY($1::text[]) OR member.rolname = ANY($1::text[])`, [reservedRoleNames]
    );
    expect(memberships.rows[0]?.count).toBe('0');

    const effective = await pools!.admin.query<{ role: string; db_create: boolean; schema_create: boolean }>(
      `SELECT role_name AS role,
              has_database_privilege(role_name, current_database(), 'CREATE') AS db_create,
              has_schema_privilege(role_name, 'public', 'CREATE') AS schema_create
         FROM unnest($1::text[]) AS roles(role_name) ORDER BY role_name`, [reservedRoleNames]
    );
    expect(effective.rows).toEqual([
      { role: 'lighting_bootstrap', db_create: false, schema_create: false },
      { role: 'lighting_migrator', db_create: false, schema_create: true },
      { role: 'lighting_runtime', db_create: false, schema_create: false },
    ]);

    await expectRoleGrantRejection(pools!.runtime, 'P0001');
    await expectRoleGrantRejection(pools!.bootstrap, 'P0001');
    await pools!.admin.query('ALTER ROLE lighting_runtime CREATEDB');
    await expectRoleGrantRejection(pools!.admin, 'P0001');
    await pools!.admin.query('ALTER ROLE lighting_runtime NOCREATEDB');
    await applyRoleGrants();
  });

  it('rejects privileged role membership and proves runtime cannot SET ROLE into it', async () => {
    const privilegedParent = `pf_privileged_parent_${process.pid}`;
    const runtimeClient = await pools!.runtime.connect();
    let parentCreated = false;
    try {
      await pools!.admin.query(`CREATE ROLE ${privilegedParent} NOLOGIN CREATEDB`);
      parentCreated = true;
      await pools!.admin.query(`GRANT ${privilegedParent} TO lighting_runtime`);
      await expectRoleGrantRejection(pools!.admin, 'P0001');
      const membership = await pools!.admin.query<{ member: boolean; can_create_db: boolean }>(
        `SELECT pg_has_role('lighting_runtime', $1, 'MEMBER') AS member,
                (SELECT rolcreatedb FROM pg_roles WHERE rolname = $1) AS can_create_db`, [privilegedParent]
      );
      expect(membership.rows).toEqual([{ member: true, can_create_db: true }]);

      await runtimeClient.query(`SET ROLE ${privilegedParent}`);
      expect((await runtimeClient.query<{ current_user: string }>('SELECT current_user')).rows[0]?.current_user)
        .toBe(privilegedParent);
      await runtimeClient.query('RESET ROLE');
    } finally {
      try {
        await runtimeClient.query('RESET ROLE');
        if (parentCreated) {
          await pools!.admin.query(`REVOKE ${privilegedParent} FROM lighting_runtime`);
          await expect(runtimeClient.query(`SET ROLE ${privilegedParent}`))
            .rejects.toMatchObject({ code: '42501' });
        }
      } finally {
        if (parentCreated) await pools!.admin.query(`DROP ROLE ${privilegedParent}`);
        runtimeClient.release();
      }
    }
    await applyRoleGrants();
  });

  it('provisions distinct maintenance identities with no elevation, memberships, or runtime grants', async () => {
    const roles = await pools!.admin.query<{
      rolname: string; rolcanlogin: boolean; rolsuper: boolean; rolcreatedb: boolean;
      rolcreaterole: boolean; rolreplication: boolean; rolbypassrls: boolean; rolinherit: boolean;
    }>(
      `SELECT rolname, rolcanlogin, rolsuper, rolcreatedb, rolcreaterole,
              rolreplication, rolbypassrls, rolinherit
         FROM pg_roles WHERE rolname = ANY($1::text[]) ORDER BY rolname`, [maintenanceRoleNames]
    );
    expect(roles.rows).toHaveLength(2);
    expect(roles.rows.every((role) => role.rolcanlogin && !role.rolsuper && !role.rolcreatedb
      && !role.rolcreaterole && !role.rolreplication && !role.rolbypassrls && !role.rolinherit)).toBe(true);

    const identities = await Promise.all([
      pools!.admin.query<{ session_user: string; current_user: string }>('SELECT session_user, current_user'),
      pools!.backup.query<{ session_user: string; current_user: string }>('SELECT session_user, current_user'),
      pools!.retention.query<{ session_user: string; current_user: string }>('SELECT session_user, current_user'),
    ]);
    expect(identities.map((result) => result.rows[0]?.current_user)).toEqual([
      required('DB_USER'), 'lighting_backup', 'lighting_retention',
    ]);
    expect(new Set(identities.map((result) => result.rows[0]?.current_user)).size).toBe(3);
    expect(identities.slice(1).every((result) => result.rows[0]?.session_user === result.rows[0]?.current_user)).toBe(true);

    const memberships = await pools!.admin.query<{ count: string }>(
      `SELECT count(*)::text AS count
         FROM pg_auth_members membership
         JOIN pg_roles granted ON granted.oid = membership.roleid
         JOIN pg_roles member ON member.oid = membership.member
        WHERE granted.rolname = ANY($1::text[]) OR member.rolname = ANY($1::text[])`, [protectedRoleNames]
    );
    expect(memberships.rows[0]?.count).toBe('0');

    await expectMaintenanceGrantRejection(pools!.runtime, 'P0001');
    await expectMaintenanceGrantRejection(pools!.bootstrap, 'P0001');
    await expectMaintenanceGrantRejection(pools!.backup, 'P0001');
    await expectMaintenanceGrantRejection(pools!.retention, 'P0001');

    await pools!.admin.query('ALTER ROLE lighting_backup CREATEDB');
    await expectMaintenanceGrantRejection(pools!.admin, 'P0001');
    expect((await pools!.admin.query<{ rolcreatedb: boolean }>(
      "SELECT rolcreatedb FROM pg_roles WHERE rolname = 'lighting_backup'"
    )).rows[0]?.rolcreatedb).toBe(true);
    await pools!.admin.query('ALTER ROLE lighting_backup NOCREATEDB');

    const ownedSchema = `pf_maintenance_owned_schema_${process.pid}`;
    await pools!.admin.query(`CREATE SCHEMA ${ownedSchema} AUTHORIZATION lighting_backup`);
    try {
      await expectMaintenanceGrantRejection(pools!.admin, 'P0001');
    } finally {
      await pools!.admin.query(`DROP SCHEMA ${ownedSchema}`);
    }

    const privilegedParent = `pf_maintenance_privileged_parent_${process.pid}`;
    await pools!.admin.query(`CREATE ROLE ${privilegedParent} NOLOGIN CREATEDB`);
    try {
      await pools!.admin.query(`GRANT ${privilegedParent} TO lighting_retention`);
      await expectMaintenanceGrantRejection(pools!.admin, 'P0001');
      expect((await pools!.admin.query<{ member: boolean }>(
        `SELECT pg_has_role('lighting_retention', $1, 'MEMBER') AS member`, [privilegedParent]
      )).rows[0]?.member).toBe(true);

      const retentionClient = await pools!.retention.connect();
      try {
        await retentionClient.query(`SET ROLE ${privilegedParent}`);
        expect((await retentionClient.query<{ current_user: string }>('SELECT current_user')).rows[0]?.current_user)
          .toBe(privilegedParent);
        await retentionClient.query('RESET ROLE');
      } finally {
        await retentionClient.query('RESET ROLE');
        retentionClient.release();
      }
    } finally {
      await pools!.admin.query(`REVOKE ${privilegedParent} FROM lighting_retention`);
      await expect(pools!.retention.query(`SET ROLE ${privilegedParent}`)).rejects.toMatchObject({ code: '42501' });
      await pools!.admin.query(`DROP ROLE ${privilegedParent}`);
    }
    await pools!.admin.query(maintenanceGrantSql);
  });

  it('creates one administrator with a NULL-actor audit event and refuses a second bootstrap', async () => {
    const created = await createFirstAdmin(pools!.bootstrap, {
      username: 'synthetic.first', password: 'synthetic-first-password-123', fullName: 'Synthetic First',
    });
    firstAdminId = created.id;
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

  it('supports representative inventory, import, audit, and export operations as lighting_runtime', async () => {
    expect(firstAdminId).toBeDefined();
    const envKeys = ['NODE_ENV', 'DB_HOST', 'DB_PORT', 'DB_NAME', 'DB_USER', 'DB_PASSWORD', 'NOMINATIM_AUTO_GEOCODE'] as const;
    const previousEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
    process.env.NODE_ENV = 'test';
    process.env.DB_HOST = required('DB_HOST');
    process.env.DB_PORT = required('DB_PORT');
    process.env.DB_NAME = pools!.databaseName;
    process.env.DB_USER = 'lighting_runtime';
    process.env.DB_PASSWORD = syntheticRolePasswords.runtime;
    process.env.NOMINATIM_AUTO_GEOCODE = 'false';
    vi.resetModules();

    let workerStarted = false;
    let runtimePool: pg.Pool | undefined;
    try {
      const [{ pool }, inventory, adminInventory, imports, worker, exports, activity] = await Promise.all([
        import('../../src/db/pool.js'),
        import('../../src/services/lightPoints.service.js'),
        import('../../src/services/adminStreetLights.service.js'),
        import('../../src/services/streetLightsImport.service.js'),
        import('../../src/services/importQueueWorker.service.js'),
        import('../../src/services/streetLightsExport.service.js'),
        import('../../src/services/adminActivity.service.js'),
      ]);
      runtimePool = pool;
      const inventoryNumber = `PF-RUNTIME-${process.pid}-${Date.now()}`;
      const point = await inventory.createLightPoint({
        inventory_number: inventoryNumber,
        latitude: 48.7164,
        longitude: 21.2611,
        address: 'Synthetic runtime address',
        district: 'Synthetic district',
        lamp_type: 'Synthetic lamp',
      }, firstAdminId!, 'synthetic.runtime');
      expect((await inventory.getLightPointById(point.id))?.inventory_number).toBe(inventoryNumber);
      expect((await inventory.getLightPointsInViewport([21.2, 48.6, 21.4, 48.8]))
        .some((row) => row.id === point.id)).toBe(true);
      const updated = await inventory.updateLightPoint(point.id, { status: 'maintenance' }, firstAdminId!, 'synthetic.runtime');
      expect(updated.status).toBe('maintenance');
      expect((await adminInventory.listStreetLights({ search: inventoryNumber })).items[0]?.id).toBe(point.id);

      await activity.logAdminActivity(firstAdminId!, 'production_foundation_runtime_probe', 'light_point', point.id, {
        evidence: 'synthetic disposable PostgreSQL integration',
      });
      expect((await activity.listAdminActivityLogs(20)).some((entry) => entry.action === 'production_foundation_runtime_probe'))
        .toBe(true);

      const importNumber = `${inventoryNumber}-IMPORT`;
      const parsedRows = imports.parseImportSource(Buffer.from(JSON.stringify([{
        inventory_number: importNumber,
        latitude: 48.717,
        longitude: 21.262,
        address: 'Synthetic imported address',
      }])), 'application/json', 'runtime-probe.json');
      const preview = await imports.buildImportPreview(firstAdminId!, 'runtime-probe.json', parsedRows, 'synthetic.runtime');
      expect(preview.summary.toCreate).toBe(1);
      const queued = await imports.confirmImport(firstAdminId!, preview.previewId, false);
      expect(queued.status).toBe('queued');
      await worker.startImportQueueWorker();
      workerStarted = true;

      let batch: Awaited<ReturnType<typeof imports.getImportBatch>> = null;
      const deadline = Date.now() + 15_000;
      while (Date.now() < deadline) {
        batch = await imports.getImportBatch(queued.batchId);
        if (batch?.status === 'completed' || batch?.status === 'completed_with_errors') break;
        await delay(100);
      }
      expect(batch?.status).toBe('completed');
      const importedRows = await imports.listImportBatchRows(queued.batchId, undefined, 20, 0);
      expect(importedRows.items[0]).toMatchObject({ outcome: 'created', inventory_number: importNumber });
      const imported = await adminInventory.listStreetLights({ search: importNumber });
      expect(imported.items).toHaveLength(1);

      const response = new PassThrough() as PassThrough & {
        statusCode: number;
        setHeader: (name: string, value: string) => void;
        socket?: { destroyed?: boolean };
      };
      const responseHeaders = new Map<string, string>();
      response.setHeader = (name, value) => { responseHeaders.set(name, value); };
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
      await exports.streamStreetLightsExport('json', { search: inventoryNumber },
        response as unknown as Parameters<typeof exports.streamStreetLightsExport>[2]);
      const exportBody = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
        items: Array<{ inventory_number: string; status: string }>;
      };
      expect(response.statusCode).toBe(200);
      expect(responseHeaders.get('Content-Type')).toMatch('application/json');
      expect(exportBody.items.map((row) => row.inventory_number)).toEqual([inventoryNumber, importNumber]);
      expect(exportBody.items.find((row) => row.inventory_number === inventoryNumber)?.status).toBe('maintenance');

      const runtimeIdentity = await runtimePool.query<{ current_user: string }>('SELECT current_user');
      expect(runtimeIdentity.rows[0]?.current_user).toBe('lighting_runtime');
    } finally {
      if (workerStarted) {
        const workerModule = await import('../../src/services/importQueueWorker.service.js');
        await workerModule.stopImportQueueWorker();
      }
      await runtimePool?.end();
      vi.resetModules();
      for (const key of envKeys) {
        const value = previousEnv[key];
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  }, 30_000);

  it('allows backup reads of every current application object and denies mutation, DDL, and role escalation', async () => {
    await pools!.admin.query(
      `INSERT INTO public.integration_logs (integration_type, request_payload, response_payload, status)
       VALUES ('synthetic.backup_probe', '{"synthetic":true}'::jsonb, '{"ok":true}'::jsonb, 'completed')`
    );

    const tables = [
      'schema_migrations', 'light_points', 'admins', 'admin_refresh_sessions',
      'integration_logs', 'import_batches', 'admin_activity_logs',
      'import_batch_rows', 'inventory_audit_events',
    ];
    for (const table of tables) {
      const result = await pools!.backup.query(`SELECT * FROM public.${table} LIMIT 1`);
      expect(Array.isArray(result.rows)).toBe(true);
    }

    const sequences = [
      'light_points_id_seq', 'admins_id_seq', 'integration_logs_id_seq',
      'import_batches_id_seq', 'admin_activity_logs_id_seq',
      'import_batch_rows_id_seq', 'inventory_audit_events_id_seq',
    ];
    for (const sequence of sequences) {
      const result = await pools!.backup.query(`SELECT last_value, is_called FROM public.${sequence}`);
      expect(result.rows).toHaveLength(1);
    }

    await expect(pools!.backup.query(
      "INSERT INTO public.admins (username, password_hash) VALUES ('forbidden.backup', 'synthetic')"
    )).rejects.toMatchObject({ code: '42501' });
    await expect(pools!.backup.query("UPDATE public.light_points SET status = 'maintenance' WHERE false"))
      .rejects.toMatchObject({ code: '42501' });
    await expect(pools!.backup.query('DELETE FROM public.light_points WHERE false'))
      .rejects.toMatchObject({ code: '42501' });
    await expect(pools!.backup.query('TRUNCATE public.light_points'))
      .rejects.toMatchObject({ code: '42501' });
    await expect(pools!.backup.query('CREATE TABLE public.backup_must_not_ddl (id integer)'))
      .rejects.toMatchObject({ code: '42501' });
    await expect(pools!.backup.query('ALTER TABLE public.light_points ADD COLUMN backup_must_not_ddl integer'))
      .rejects.toMatchObject({ code: '42501' });
    await expect(pools!.backup.query('CREATE SCHEMA backup_must_not_ddl'))
      .rejects.toMatchObject({ code: '42501' });
    await expect(pools!.backup.query('CREATE TEMP TABLE backup_must_not_temp (id integer)'))
      .rejects.toMatchObject({ code: '42501' });
    await expect(pools!.backup.query(`CREATE DATABASE pf_backup_must_not_create_${process.pid}`))
      .rejects.toMatchObject({ code: '42501' });
    await expect(pools!.backup.query(`CREATE ROLE pf_backup_must_not_create_${process.pid}`))
      .rejects.toMatchObject({ code: '42501' });

    const extension = await pools!.admin.query<{ name: string }>(
      `SELECT versions.name
         FROM pg_available_extension_versions versions
         LEFT JOIN pg_extension installed ON installed.extname = versions.name
        WHERE versions.superuser AND installed.extname IS NULL
        ORDER BY versions.name LIMIT 1`
    );
    expect(extension.rows).toHaveLength(1);
    const safeExtensionName = extension.rows[0].name.replace(/"/g, '""');
    await expect(pools!.backup.query(`CREATE EXTENSION "${safeExtensionName}"`))
      .rejects.toMatchObject({ code: '42501' });

    for (const targetRole of protectedRoleNames.filter((roleName) => roleName !== 'lighting_backup')) {
      await expect(pools!.backup.query(`SET ROLE ${targetRole}`)).rejects.toMatchObject({ code: '42501' });
    }
    await expect(pools!.backup.query('SET ROLE pg_read_all_data')).rejects.toMatchObject({ code: '42501' });

    const newTable = `pf_future_table_${process.pid}`;
    await pools!.admin.query(`CREATE TABLE public.${newTable} (id integer PRIMARY KEY, content text)`);
    try {
      await expect(pools!.backup.query(`SELECT * FROM public.${newTable}`)).rejects.toMatchObject({ code: '42501' });
      await expect(pools!.retention.query(`SELECT * FROM public.${newTable}`)).rejects.toMatchObject({ code: '42501' });
      await expect(pools!.retention.query(`DELETE FROM public.${newTable} WHERE false`))
        .rejects.toMatchObject({ code: '42501' });
    } finally {
      await pools!.admin.query(`DROP TABLE public.${newTable}`);
    }
  });

  it.skipIf(!pgDump16Available)('creates a complete PostgreSQL 16 custom-format archive as lighting_backup', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'production-foundation-pgdump-'));
    const archivePath = path.join(tempDir, 'synthetic-backup.dump');
    try {
      const dump = spawnSync('pg_dump', [
        '--format=custom', '--no-owner', '--no-privileges',
        '--file', archivePath,
        '--host', required('DB_HOST'),
        '--port', required('DB_PORT'),
        '--username', 'lighting_backup',
        '--dbname', pools!.databaseName,
      ], {
        encoding: 'utf8',
        timeout: 60_000,
        maxBuffer: 5 * 1024 * 1024,
        windowsHide: true,
        env: { ...process.env, PGPASSWORD: syntheticRolePasswords.backup },
      });
      expect(dump.error).toBeUndefined();
      expect(dump.status, dump.stderr).toBe(0);
      expect(fs.statSync(archivePath).size).toBeGreaterThan(0);

      const toc = spawnSync('pg_restore', ['--list', archivePath], {
        encoding: 'utf8', timeout: 30_000, maxBuffer: 5 * 1024 * 1024, windowsHide: true,
      });
      expect(toc.error).toBeUndefined();
      expect(toc.status, toc.stderr).toBe(0);
      expect(toc.stdout).toContain('TABLE public light_points');
      expect(toc.stdout).toContain('TABLE DATA public integration_logs');
      expect(toc.stdout).toContain('SEQUENCE SET public light_points_id_seq');
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('reapplication removes stale retention DELETE grants and restores only the reviewed table allowlist', async () => {
    await pools!.admin.query('GRANT DELETE ON ALL TABLES IN SCHEMA public TO lighting_retention');

    const before = await pools!.admin.query<{ count: string }>(
      `SELECT count(*)::text AS count
         FROM pg_class AS relation
         JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
        WHERE namespace.nspname = 'public'
          AND relation.relkind IN ('r', 'p', 'v', 'm', 'f')
          AND has_table_privilege('lighting_retention', relation.oid, 'DELETE')`
    );
    expect(Number(before.rows[0]?.count)).toBeGreaterThan(0);

    await pools!.admin.query(maintenanceGrantSql);

    const after = await pools!.admin.query<{ relation: string }>(
      `SELECT format('%I.%I', namespace.nspname, relation.relname) AS relation
         FROM pg_class AS relation
         JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
        WHERE namespace.nspname = 'public'
          AND relation.relkind IN ('r', 'p', 'v', 'm', 'f')
          AND has_table_privilege('lighting_retention', relation.oid, 'DELETE')
        ORDER BY relation.relname`
    );
    expect(after.rows.map((row) => row.relation)).toEqual([
      'public.admin_activity_logs', 'public.admin_refresh_sessions', 'public.inventory_audit_events',
    ]);

    // Reapplying restores the narrow eligibility-read allowlist after stale grants are removed.
    await expect(pools!.retention.query('SELECT id, created_at FROM public.admin_activity_logs LIMIT 0'))
      .resolves.toMatchObject({ rows: [] });
    await expect(pools!.retention.query('SELECT batch_id, outcome FROM public.import_batch_rows LIMIT 0'))
      .resolves.toMatchObject({ rows: [] });
    await expect(pools!.retention.query('DELETE FROM public.import_batches WHERE false'))
      .rejects.toMatchObject({ code: '42501' });
  });

  it('keeps retention scoped to approved columns and denies import-history deletion', async () => {
    expect(firstAdminId).toBeDefined();
    const activity = await pools!.admin.query<{ id: number }>(
      `INSERT INTO public.admin_activity_logs (admin_id, action, entity_type, entity_id, details)
       VALUES ($1, 'synthetic.retention_fresh', 'test', 1, '{"private":"synthetic"}'::jsonb) RETURNING id`,
      [firstAdminId]
    );
    const oldActivity = await pools!.admin.query<{ id: number }>(
      `INSERT INTO public.admin_activity_logs (admin_id, action, entity_type, entity_id, details, created_at)
       VALUES ($1, 'synthetic.retention_old', 'test', 2, '{"private":"synthetic"}'::jsonb, now() - interval '400 days')
       RETURNING id`, [firstAdminId]
    );
    const audit = await pools!.admin.query<{ id: number }>(
      `INSERT INTO public.inventory_audit_events
         (actor_admin_id, actor_username_snapshot, entity_id_snapshot, inventory_number_snapshot, action, changed_fields)
       VALUES ($1, 'synthetic.retention', 1, 'RETENTION-FRESH', 'create', '{"secret":"synthetic"}'::jsonb)
       RETURNING id`, [firstAdminId]
    );
    const oldAudit = await pools!.admin.query<{ id: number }>(
      `INSERT INTO public.inventory_audit_events
         (actor_admin_id, actor_username_snapshot, entity_id_snapshot, inventory_number_snapshot, action, changed_fields, created_at)
       VALUES ($1, 'synthetic.retention', 2, 'RETENTION-OLD', 'create', '{"secret":"synthetic"}'::jsonb, now() - interval '400 days')
       RETURNING id`, [firstAdminId]
    );
    const batch = await pools!.admin.query<{ id: number }>(
      `INSERT INTO public.import_batches (filename, status, created_at, completed_at)
       VALUES ('synthetic-retention.csv', 'completed', now() - interval '400 days', now() - interval '400 days')
       RETURNING id`
    );
    const queuedBatch = await pools!.admin.query<{ id: number }>(
      `INSERT INTO public.import_batches (filename, status, completed_at)
       VALUES ('synthetic-retention-queued.csv', 'queued', NULL) RETURNING id`
    );
    const child = await pools!.admin.query<{ id: number }>(
      `INSERT INTO public.import_batch_rows (batch_id, source_row_number, outcome, inventory_number, reason_code, payload)
       VALUES ($1, 1, 'pending', 'RETENTION-PENDING', 'synthetic', '{"synthetic":true}'::jsonb) RETURNING id`,
      [queuedBatch.rows[0].id]
    );
    const expiredSession = await pools!.admin.query<{ id: string }>(
      `INSERT INTO public.admin_refresh_sessions (admin_id, token_hash, expires_at)
       VALUES ($1, 'synthetic-retention-token-hash', now() - interval '1 day') RETURNING id`, [firstAdminId]
    );
    const activeSession = await pools!.admin.query<{ id: string }>(
      `INSERT INTO public.admin_refresh_sessions (admin_id, token_hash, expires_at)
       VALUES ($1, 'synthetic-retention-active-token-hash', now() + interval '1 day') RETURNING id`, [firstAdminId]
    );

    expect((await pools!.retention.query('SELECT id, created_at FROM public.admin_activity_logs WHERE id = $1', [activity.rows[0].id])).rows)
      .toHaveLength(1);
    expect((await pools!.retention.query('SELECT id, created_at FROM public.admin_activity_logs WHERE id = $1', [oldActivity.rows[0].id])).rows)
      .toHaveLength(1);
    expect((await pools!.retention.query(
      'SELECT id, created_at, import_batch_id FROM public.inventory_audit_events WHERE id = $1', [audit.rows[0].id]
    )).rows).toHaveLength(1);
    expect((await pools!.retention.query(
      'SELECT id, created_at, import_batch_id FROM public.inventory_audit_events WHERE id = $1', [oldAudit.rows[0].id]
    )).rows).toHaveLength(1);
    expect((await pools!.retention.query(
      'SELECT id, status, completed_at FROM public.import_batches WHERE id = $1', [batch.rows[0].id]
    )).rows).toHaveLength(1);
    expect((await pools!.retention.query(
      'SELECT id, status, completed_at FROM public.import_batches WHERE id = $1', [queuedBatch.rows[0].id]
    )).rows).toHaveLength(1);
    expect((await pools!.retention.query(
      'SELECT batch_id, outcome FROM public.import_batch_rows WHERE batch_id = $1', [queuedBatch.rows[0].id]
    )).rows).toHaveLength(1);
    expect((await pools!.retention.query(
      'SELECT id, expires_at FROM public.admin_refresh_sessions WHERE id = $1', [expiredSession.rows[0].id]
    )).rows).toHaveLength(1);
    expect((await pools!.retention.query(
      'SELECT id, expires_at FROM public.admin_refresh_sessions WHERE id = $1', [activeSession.rows[0].id]
    )).rows).toHaveLength(1);

    await expect(pools!.retention.query(
      'SELECT details FROM public.admin_activity_logs WHERE id = $1', [activity.rows[0].id]
    )).rejects.toMatchObject({ code: '42501' });
    await expect(pools!.retention.query(
      'SELECT changed_fields FROM public.inventory_audit_events WHERE id = $1', [audit.rows[0].id]
    )).rejects.toMatchObject({ code: '42501' });
    await expect(pools!.retention.query(
      'SELECT filename FROM public.import_batches WHERE id = $1', [batch.rows[0].id]
    )).rejects.toMatchObject({ code: '42501' });
    await expect(pools!.retention.query(
      'SELECT payload FROM public.import_batch_rows WHERE batch_id = $1', [batch.rows[0].id]
    )).rejects.toMatchObject({ code: '42501' });
    await expect(pools!.retention.query(
      'SELECT token_hash FROM public.admin_refresh_sessions WHERE id = $1', [expiredSession.rows[0].id]
    )).rejects.toMatchObject({ code: '42501' });

    const retentionDeletes = await pools!.admin.query<{ relation: string }>(
      `SELECT format('%I.%I', namespace.nspname, relation.relname) AS relation
         FROM pg_class AS relation JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
        WHERE namespace.nspname = 'public' AND relation.relkind IN ('r', 'p')
          AND has_table_privilege('lighting_retention', relation.oid, 'DELETE') ORDER BY relation.relname`,
    );
    expect(retentionDeletes.rows.map((row) => row.relation)).toEqual([
      'public.admin_activity_logs', 'public.admin_refresh_sessions', 'public.inventory_audit_events',
    ]);
    await expect(pools!.retention.query('DELETE FROM public.import_batches WHERE id = $1', [batch.rows[0].id]))
      .rejects.toMatchObject({ code: '42501' });
    await expect(pools!.retention.query('DELETE FROM public.import_batch_rows WHERE id = $1', [child.rows[0].id]))
      .rejects.toMatchObject({ code: '42501' });

    expect((await pools!.admin.query(
      'SELECT id FROM public.import_batch_rows WHERE id = $1', [child.rows[0].id]
    )).rows).toHaveLength(1);
    expect((await pools!.admin.query(
      'SELECT id FROM public.import_batches WHERE id = $1', [queuedBatch.rows[0].id]
    )).rows).toHaveLength(1);

    await pools!.admin.query('DELETE FROM public.import_batches WHERE id = ANY($1::integer[])', [
      [batch.rows[0].id, queuedBatch.rows[0].id],
    ]);
    await pools!.admin.query('DELETE FROM public.admin_activity_logs WHERE id = ANY($1::integer[])', [
      [activity.rows[0].id, oldActivity.rows[0].id],
    ]);
    await pools!.admin.query('DELETE FROM public.inventory_audit_events WHERE id = ANY($1::bigint[])', [
      [audit.rows[0].id, oldAudit.rows[0].id],
    ]);
    await pools!.admin.query('DELETE FROM public.admin_refresh_sessions WHERE id = ANY($1::uuid[])', [
      [expiredSession.rows[0].id, activeSession.rows[0].id],
    ]);
  });

  it('denies retention mutation outside the exact approved allowlist', async () => {
    const forbidden = [
      'DELETE FROM public.light_points WHERE false',
      "UPDATE public.light_points SET status = 'maintenance' WHERE false",
      'TRUNCATE public.light_points',
      'DELETE FROM public.admins WHERE false',
      "UPDATE public.admins SET username = username WHERE false",
      'TRUNCATE public.admins',
      'DELETE FROM public.schema_migrations WHERE false',
      'UPDATE public.schema_migrations SET name = name WHERE false',
      'TRUNCATE public.schema_migrations',
      'DELETE FROM public.integration_logs WHERE false',
      "INSERT INTO public.admin_activity_logs (action) VALUES ('forbidden.retention')",
      "UPDATE public.admin_activity_logs SET action = action WHERE false",
      'CREATE TABLE public.retention_must_not_ddl (id integer)',
      'ALTER TABLE public.light_points ADD COLUMN retention_must_not_ddl integer',
      'CREATE SCHEMA retention_must_not_ddl',
      'CREATE TEMP TABLE retention_must_not_temp (id integer)',
      `CREATE DATABASE pf_retention_must_not_create_${process.pid}`,
      `CREATE ROLE pf_retention_must_not_create_${process.pid}`,
    ];
    for (const statement of forbidden) {
      await expect(pools!.retention.query(statement), statement).rejects.toMatchObject({ code: '42501' });
    }
    for (const targetRole of protectedRoleNames.filter((roleName) => roleName !== 'lighting_retention')) {
      await expect(pools!.retention.query(`SET ROLE ${targetRole}`)).rejects.toMatchObject({ code: '42501' });
    }
    await expect(pools!.retention.query('SET ROLE pg_read_all_data')).rejects.toMatchObject({ code: '42501' });
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

  describe.skipIf(!phaseCGPostgresEnabled)('Phases C–G offline operations PostgreSQL evidence', () => {
    const previousOperationsMode = process.env.DATABASE_OPERATIONS_MODE;
    beforeAll(() => { process.env.DATABASE_OPERATIONS_MODE = 'offline-test'; });
    afterAll(() => {
      if (previousOperationsMode === undefined) delete process.env.DATABASE_OPERATIONS_MODE;
      else process.env.DATABASE_OPERATIONS_MODE = previousOperationsMode;
    });
    beforeAll(async () => {
      const existingAdmins = await pools!.admin.query<{ id: number }>(
        'SELECT id FROM public.admins ORDER BY id LIMIT 1',
      );
      if (existingAdmins.rows[0]) {
        firstAdminId = existingAdmins.rows[0].id;
        return;
      }
      const created = await createFirstAdmin(pools!.bootstrap, {
        username: `synthetic.cg.${randomUUID()}`,
        password: `synthetic-cg-password-${randomUUID()}`,
      });
      firstAdminId = created.id;
    });

    it('retains only strict-cutoff approved history, preserves bounded import backlog, and retries safely', async () => {
      const runAt = new Date('2026-10-09T12:34:56.789Z');
      const cutoff = utcCalendarYearCutoff(runAt);
      const older = new Date(cutoff.getTime() - 1);
      const marker = `CG_RETENTION_${randomUUID().replaceAll('-', '')}`;
      await pools!.admin.query(
        `INSERT INTO public.light_points (inventory_number, geom, address)
         VALUES ($1, ST_SetSRID(ST_MakePoint(21.25, 48.72), 4326), 'synthetic retention protection')`, [marker],
      );
      const logAtCutoff = await pools!.admin.query<{ id: number }>(
        `INSERT INTO admin_activity_logs (admin_id, action, created_at) VALUES ($1, 'cg.cutoff', $2) RETURNING id`,
        [firstAdminId, cutoff],
      );
      const oldLog = await pools!.admin.query<{ id: number }>(
        `INSERT INTO admin_activity_logs (admin_id, action, created_at) VALUES ($1, 'cg.old', $2) RETURNING id`,
        [firstAdminId, older],
      );
      const auditAtCutoff = await pools!.admin.query<{ id: string }>(
        `INSERT INTO inventory_audit_events (actor_admin_id, entity_id_snapshot, inventory_number_snapshot, action, created_at)
         VALUES ($1, 1, 'CG-CUTOFF', 'create', $2) RETURNING id`, [firstAdminId, cutoff],
      );
      const oldAudit = await pools!.admin.query<{ id: string }>(
        `INSERT INTO inventory_audit_events (actor_admin_id, entity_id_snapshot, inventory_number_snapshot, action, created_at)
         VALUES ($1, 2, 'CG-OLD', 'create', $2) RETURNING id`, [firstAdminId, older],
      );
      const expired = await pools!.admin.query<{ id: string }>(
        `INSERT INTO admin_refresh_sessions (admin_id, token_hash, expires_at) VALUES ($1, $2, $3) RETURNING id`,
        [firstAdminId, 'synthetic-cg-expired-session-hash', new Date(runAt.getTime() - 1)],
      );
      const exactExpiry = await pools!.admin.query<{ id: string }>(
        `INSERT INTO admin_refresh_sessions (admin_id, token_hash, expires_at) VALUES ($1, $2, $3) RETURNING id`,
        [firstAdminId, 'synthetic-cg-boundary-session-hash', runAt],
      );
      const eligibleBatch = await pools!.admin.query<{ id: number }>(
        `INSERT INTO import_batches (filename, status, created_at, completed_at)
         VALUES ('synthetic-cg-terminal.csv', 'completed', $1, $1) RETURNING id`, [older],
      );
      const eligibleRow = await pools!.admin.query<{ id: string }>(
        `INSERT INTO import_batch_rows (batch_id, source_row_number, outcome, inventory_number)
         VALUES ($1, 1, 'created', 'CG-TERMINAL') RETURNING id`, [eligibleBatch.rows[0]!.id],
      );
      const referencedBatch = await pools!.admin.query<{ id: number }>(
        `INSERT INTO import_batches (filename, status, created_at, completed_at)
         VALUES ('synthetic-cg-audit-linked.csv', 'completed', $1, $1) RETURNING id`, [older],
      );
      await pools!.admin.query(
        `INSERT INTO import_batch_rows (batch_id, source_row_number, outcome, inventory_number)
         VALUES ($1, 1, 'created', 'CG-AUDIT-LINKED')`, [referencedBatch.rows[0]!.id],
      );
      const linkedAudit = await pools!.admin.query<{ id: string }>(
        `INSERT INTO inventory_audit_events (actor_admin_id, entity_id_snapshot, inventory_number_snapshot, action, import_batch_id, created_at)
         VALUES ($1, 3, 'CG-AUDIT-LINKED', 'create', $2, $3) RETURNING id`, [firstAdminId, referencedBatch.rows[0]!.id, runAt],
      );
      const pendingBatch = await pools!.admin.query<{ id: number }>(
        `INSERT INTO import_batches (filename, status, created_at, completed_at)
         VALUES ('synthetic-cg-pending.csv', 'failed', $1, $1) RETURNING id`, [older],
      );
      await pools!.admin.query(
        `INSERT INTO import_batch_rows (batch_id, source_row_number, outcome, inventory_number, payload)
         VALUES ($1, 1, 'pending', 'CG-PENDING', '{"synthetic":true}'::jsonb)`, [pendingBatch.rows[0]!.id],
      );
      const incompleteBatch = await pools!.admin.query<{ id: number }>(
        `INSERT INTO import_batches (filename, status, created_at, completed_at)
         VALUES ('synthetic-cg-no-completion.csv', 'system_failed', $1, NULL) RETURNING id`, [older],
      );
      const originalLightPointCount = await pools!.admin.query<{ count: string }>('SELECT count(*)::text AS count FROM light_points');
      const originalAdminCount = await pools!.admin.query<{ count: string }>('SELECT count(*)::text AS count FROM admins');
      const originalIntegrationCount = await pools!.admin.query<{ count: string }>('SELECT count(*)::text AS count FROM integration_logs');

      await expect(pools!.retention.query('UPDATE public.admin_activity_logs SET action = action WHERE false'))
        .rejects.toMatchObject({ code: '42501' });
      const result = await runRetentionOnce(pools!.retention, { appBuildSha: 'abcdef0123456789', nowForTest: () => runAt });
      expect(result).toMatchObject({ state: 'success_with_backlog', exit_code: 0, cutoff_utc: cutoff.toISOString() });
      expect(result.counts).toMatchObject({
        admin_activity_logs: 1, inventory_audit_events: 1, admin_refresh_sessions: 1,
        deferred_import_batches: 1, import_batches_missing_completion: 1,
        import_batches_with_pending_rows: 1, import_batches_referenced_by_retained_audit: 1,
      });
      expect((await pools!.admin.query('SELECT id FROM admin_activity_logs WHERE id = $1', [logAtCutoff.rows[0]!.id])).rows).toHaveLength(1);
      expect((await pools!.admin.query('SELECT id FROM admin_activity_logs WHERE id = $1', [oldLog.rows[0]!.id])).rows).toHaveLength(0);
      expect((await pools!.admin.query('SELECT id FROM inventory_audit_events WHERE id = $1', [auditAtCutoff.rows[0]!.id])).rows).toHaveLength(1);
      expect((await pools!.admin.query('SELECT id FROM inventory_audit_events WHERE id = $1', [oldAudit.rows[0]!.id])).rows).toHaveLength(0);
      expect((await pools!.admin.query('SELECT id FROM admin_refresh_sessions WHERE id = $1', [expired.rows[0]!.id])).rows).toHaveLength(0);
      expect((await pools!.admin.query('SELECT id FROM admin_refresh_sessions WHERE id = $1', [exactExpiry.rows[0]!.id])).rows).toHaveLength(1);
      expect((await pools!.admin.query('SELECT id FROM import_batches WHERE id = ANY($1::integer[])', [[eligibleBatch.rows[0]!.id, referencedBatch.rows[0]!.id, pendingBatch.rows[0]!.id, incompleteBatch.rows[0]!.id]])).rows).toHaveLength(4);
      expect((await pools!.admin.query('SELECT id FROM import_batch_rows WHERE id = $1', [eligibleRow.rows[0]!.id])).rows).toHaveLength(1);
      expect((await pools!.admin.query('SELECT count(*)::text AS count FROM light_points')).rows[0]?.count).toBe(originalLightPointCount.rows[0]?.count);
      expect((await pools!.admin.query('SELECT count(*)::text AS count FROM admins')).rows[0]?.count).toBe(originalAdminCount.rows[0]?.count);
      expect((await pools!.admin.query('SELECT count(*)::text AS count FROM integration_logs')).rows[0]?.count).toBe(originalIntegrationCount.rows[0]?.count);

      const retry = await runRetentionOnce(pools!.retention, { appBuildSha: 'abcdef0123456789', nowForTest: () => runAt });
      expect(retry.counts.admin_activity_logs).toBe(0);
      expect(retry.counts.inventory_audit_events).toBe(0);
      await pools!.admin.query('DELETE FROM import_batches WHERE id = ANY($1::integer[])', [[eligibleBatch.rows[0]!.id, referencedBatch.rows[0]!.id, pendingBatch.rows[0]!.id, incompleteBatch.rows[0]!.id]]);
      await pools!.admin.query('DELETE FROM inventory_audit_events WHERE id = $1', [linkedAudit.rows[0]!.id]);
      await pools!.admin.query('DELETE FROM light_points WHERE inventory_number = $1', [marker]);
    }, 30_000);

    it('returns overlapping without mutating when the independent retention advisory lock is held', async () => {
      const holder = await pools!.retention.connect();
      try {
        await holder.query('SELECT pg_advisory_lock($1, $2)', [RETENTION_ADVISORY_LOCK.namespace, RETENTION_ADVISORY_LOCK.key]);
        const result = await runRetentionOnce(pools!.retention, { appBuildSha: 'abcdef0123456789' });
        expect(result).toMatchObject({ state: 'skipped_overlapping', exit_code: 10, cutoff_utc: null });
      } finally {
        await holder.query('SELECT pg_advisory_unlock($1, $2)', [RETENTION_ADVISORY_LOCK.namespace, RETENTION_ADVISORY_LOCK.key]);
        holder.release();
      }
    });

    it('uses PostgreSQL UTC transaction time for cutoff and deletes only rows older than that DB-clock cutoff', async () => {
      const marker = `CG_DB_CLOCK_${randomUUID().replaceAll('-', '')}`;
      const before = await pools!.admin.query<{ cutoff: Date }>(
        `SELECT ((transaction_timestamp() AT TIME ZONE 'UTC') - INTERVAL '1 year') AT TIME ZONE 'UTC' AS cutoff`,
      );
      await pools!.admin.query(
        `INSERT INTO public.admin_activity_logs (admin_id, action, created_at) VALUES
          ($1, 'cg.db_clock_expired', transaction_timestamp() - INTERVAL '400 days'),
          ($1, 'cg.db_clock_recent', transaction_timestamp() - INTERVAL '300 days')`, [firstAdminId],
      );
      await pools!.admin.query(
        `INSERT INTO public.admin_refresh_sessions (admin_id, token_hash, expires_at) VALUES
          ($1, $2, transaction_timestamp() - INTERVAL '1 day'),
          ($1, $3, transaction_timestamp() + INTERVAL '1 day')`, [firstAdminId, `${marker}_expired`, `${marker}_valid`],
      );
      const result = await runRetentionOnce(pools!.retention, { appBuildSha: 'abcdef0123456789' });
      const after = await pools!.admin.query<{ cutoff: Date }>(
        `SELECT ((transaction_timestamp() AT TIME ZONE 'UTC') - INTERVAL '1 year') AT TIME ZONE 'UTC' AS cutoff`,
      );
      expect(result.cutoff_utc).not.toBeNull();
      expect(new Date(result.cutoff_utc!).getTime()).toBeGreaterThanOrEqual(before.rows[0]!.cutoff.getTime() - 5_000);
      expect(new Date(result.cutoff_utc!).getTime()).toBeLessThanOrEqual(after.rows[0]!.cutoff.getTime() + 5_000);
      expect((await pools!.admin.query(`SELECT id FROM admin_activity_logs WHERE action = 'cg.db_clock_expired'`)).rows).toHaveLength(0);
      expect((await pools!.admin.query(`SELECT id FROM admin_activity_logs WHERE action = 'cg.db_clock_recent'`)).rows).toHaveLength(1);
      expect((await pools!.admin.query('SELECT id FROM admin_refresh_sessions WHERE token_hash = $1', [`${marker}_expired`])).rows).toHaveLength(0);
      expect((await pools!.admin.query('SELECT id FROM admin_refresh_sessions WHERE token_hash = $1', [`${marker}_valid`])).rows).toHaveLength(1);
      await pools!.admin.query(`DELETE FROM public.admin_activity_logs WHERE action IN ('cg.db_clock_expired', 'cg.db_clock_recent')`);
      await pools!.admin.query(`DELETE FROM public.admin_refresh_sessions WHERE token_hash LIKE $1`, [`${marker}%`]);
    }, 30_000);

    it('discards a retention client whose real PostgreSQL backend is terminated during unlock and releases its session lock', async () => {
      const target = pools!.retention;
      let backendPid: number | undefined;
      let unlockQueryErrorCode: string | undefined;
      let terminatedClientEnded = deferred<void>();
      const baselineErrorListenerCount = target.listenerCount('error');
      const poolErrors: Array<{ code: string | undefined; pid: number | undefined }> = [];
      const onPoolError = (error: Error & { code?: string }, client: pg.PoolClient) => {
        poolErrors.push({ code: error.code, pid: Number((client as unknown as pg.Client & { processID?: number }).processID) });
      };
      target.on('error', onPoolError);
      const failingUnlockPool = {
        options: target.options,
        connect: async () => {
          const client = await target.connect();
          backendPid = Number((await client.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0]?.pid);
          client.once('end', () => terminatedClientEnded.resolve());
          return {
            query: async (sql: string, values?: unknown[]) => {
              if (sql.includes('pg_advisory_unlock')) {
                await pools!.admin.query('SELECT pg_terminate_backend($1)', [backendPid]);
              }
              try {
                return await client.query(sql, values as never);
              } catch (error) {
                if (sql.includes('pg_advisory_unlock')) {
                  unlockQueryErrorCode = error instanceof Error && 'code' in error ? String(error.code) : undefined;
                }
                throw error;
              }
            },
            release: (error?: Error) => client.release(error),
          };
        },
      } as unknown as pg.Pool;
      try {
        const failed = await runRetentionOnce(failingUnlockPool, { appBuildSha: 'abcdef0123456789' });
        expect(failed).toMatchObject({ state: 'incomplete', reason_code: 'retention_lock_release_failed' });
        expect(unlockQueryErrorCode).toBe('57P01');
        await within(terminatedClientEnded.promise, 5000, 'retention_terminated_client_close_unconfirmed');
        await new Promise<void>((resolve) => setImmediate(resolve));
        expect(poolErrors.every((event) => event.code === '57P01' && event.pid === backendPid)).toBe(true);
        const backend = await pools!.admin.query<{ present: boolean }>(
          'SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE pid = $1) AS present', [backendPid],
        );
        expect(backend.rows[0]?.present).toBe(false);

        const retry = await runRetentionOnce(target, { appBuildSha: 'abcdef0123456789' });
        expect(retry.state).not.toBe('skipped_overlapping');
        const probe = await target.connect();
        try {
          const probePid = Number((await probe.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0]?.pid);
          expect(probePid).not.toBe(backendPid);
          const lock = await probe.query<{ acquired: boolean }>(
            'SELECT pg_try_advisory_lock($1, $2) AS acquired', [RETENTION_ADVISORY_LOCK.namespace, RETENTION_ADVISORY_LOCK.key],
          );
          expect(lock.rows[0]?.acquired).toBe(true);
          await probe.query('SELECT pg_advisory_unlock($1, $2)', [RETENTION_ADVISORY_LOCK.namespace, RETENTION_ADVISORY_LOCK.key]);
        } finally { probe.release(); }
      } finally {
        target.removeListener('error', onPoolError);
        expect(target.listenerCount('error')).toBe(baselineErrorListenerCount);
      }
    }, 30_000);

    it('caps each committed retention chunk at 500 rows and leaves a deterministic retryable backlog', async () => {
      const cutoff = utcCalendarYearCutoff(new Date('2026-10-09T12:00:00.000Z'));
      const insertedRows = await pools!.admin.query<{ id: number }>(
        `INSERT INTO admin_activity_logs (admin_id, action, created_at)
         SELECT $1, 'cg.bounded_chunk', $2 FROM generate_series(1, 501)
         RETURNING id`, [firstAdminId, new Date(cutoff.getTime() - 1000)],
      );
      const minId = Math.min(...insertedRows.rows.map((row) => row.id));
      const maxId = Math.max(...insertedRows.rows.map((row) => row.id));
      expect(insertedRows.rows).toHaveLength(501);
      const first = await runRetentionOnce(pools!.retention, {
        appBuildSha: 'abcdef0123456789', nowForTest: () => new Date('2026-10-09T12:00:00.000Z'), maxChunksPerTable: 1,
      });
      expect(first).toMatchObject({ state: 'success_with_backlog', reason_code: 'retention_chunk_ceiling_reached' });
      expect(first.counts.admin_activity_logs).toBe(500);
      const remaining = await pools!.admin.query<{ id: number }>(
        `SELECT id FROM admin_activity_logs WHERE action = 'cg.bounded_chunk' ORDER BY id`,
      );
      expect(remaining.rows).toEqual([{ id: maxId }]);
      const second = await runRetentionOnce(pools!.retention, {
        appBuildSha: 'abcdef0123456789', nowForTest: () => new Date('2026-10-09T12:00:00.000Z'), maxChunksPerTable: 1,
      });
      expect(second.counts.admin_activity_logs).toBe(1);
      expect((await pools!.admin.query(`SELECT id FROM admin_activity_logs WHERE action = 'cg.bounded_chunk'`)).rows).toHaveLength(0);
      expect(minId).toBeLessThan(maxId);
    }, 30_000);

    it('rolls back a failing retention chunk and returns only aggregate error evidence', async () => {
      const old = await pools!.admin.query<{ id: number }>(
        `INSERT INTO admin_activity_logs (admin_id, action, created_at) VALUES ($1, 'cg.rollback', now() - interval '400 days') RETURNING id`,
        [firstAdminId],
      );
      const suffix = randomUUID().replaceAll('-', '').slice(0, 10);
      const functionName = `cg_retention_fail_${suffix}`;
      const triggerName = `cg_retention_fail_${suffix}`;
      await pools!.admin.query(`CREATE FUNCTION public.${functionName}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic failure'; END $$`);
      await pools!.admin.query(`CREATE TRIGGER ${triggerName} BEFORE DELETE ON public.admin_activity_logs FOR EACH ROW EXECUTE FUNCTION public.${functionName}()`);
      try {
        const result = await runRetentionOnce(pools!.retention, { appBuildSha: 'abcdef0123456789' });
        expect(result).toMatchObject({ state: 'incomplete', exit_code: 1, reason_code: 'retention_chunk_or_preflight_failed' });
        expect(JSON.stringify(result)).not.toContain('synthetic failure');
        expect((await pools!.admin.query('SELECT id FROM admin_activity_logs WHERE id = $1', [old.rows[0]!.id])).rows).toHaveLength(1);
      } finally {
        await pools!.admin.query(`DROP TRIGGER IF EXISTS ${triggerName} ON public.admin_activity_logs`);
        await pools!.admin.query(`DROP FUNCTION IF EXISTS public.${functionName}()`);
        await pools!.admin.query('DELETE FROM admin_activity_logs WHERE id = $1', [old.rows[0]!.id]);
      }
    }, 30_000);

    it('records a serialized duplicate schedule trigger without running a second producer', async () => {
      const stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-scheduler-state-'));
      const journal = new FileSchedulerJournal(stateRoot);
      const started = deferred<void>();
      const release = deferred();
      let executions = 0;
      const executeBackup = async (runId: string) => {
        executions += 1;
        started.resolve();
        await release.promise;
        return {
          result_version: 1 as const, state: 'complete' as const, exit_code: 0, reason_code: 'producer_pipeline_complete',
          run_id: runId, run_started_at: new Date().toISOString(), duration_ms: 1,
          recipient_key_id: `sha256:${'a'.repeat(64)}`, app_build_sha: 'abcdef0123456789',
        };
      };
      const options = { now: () => new Date('2026-10-09T12:00:00.000Z'), schedulerPool: pools!.backup, journal, executeBackup };
      try {
        const first = runScheduledBackup(options);
        await started.promise;
        expect(await runScheduledBackup(options)).toMatchObject({ action: 'skipped_overlapping', state: 'skipped_overlapping' });
        release.resolve();
        expect((await first).action).toBe('attempted');
        expect(executions).toBe(1);
        expect((await journal.readEvents()).map((event) => event.kind)).toEqual(['attempt_started', 'attempt_finished']);
      } finally { release.resolve(); fs.rmSync(stateRoot, { recursive: true, force: true }); }
    }, 30_000);
  });

  describe.skipIf(!phaseBIntegrationEnabled)('Phase B offline PostgreSQL backup producer', () => {
    let backupRoot: string;
    let identityFile: string;
    let wrongIdentityFile: string;
    let passwordFile: string;
    let recipient: string;
    let config: ReturnType<typeof parseBackupConfig>;
    const dedicatedRestoreAdminPools: pg.Pool[] = [];

    beforeAll(() => {
      backupRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'phase-b-backup-integration-'));
      identityFile = path.join(backupRoot, 'synthetic-identity.txt');
      wrongIdentityFile = path.join(backupRoot, 'wrong-synthetic-identity.txt');
      passwordFile = path.join(backupRoot, 'db-password');
      const identityResult = spawnSync('age-keygen', ['-o', identityFile], { encoding: 'utf8', windowsHide: true });
      if (identityResult.error || identityResult.status !== 0) throw new Error('age_keygen_failed_for_synthetic_test_identity');
      const recipientResult = spawnSync('age-keygen', ['-y', identityFile], { encoding: 'utf8', windowsHide: true });
      if (recipientResult.error || recipientResult.status !== 0) throw new Error('age_public_recipient_derivation_failed');
      recipient = recipientResult.stdout.trim();
      if (!/^age1[0-9a-z]{58}$/.test(recipient)) throw new Error('age_public_recipient_invalid');
      const wrongIdentityResult = spawnSync('age-keygen', ['-o', wrongIdentityFile], { encoding: 'utf8', windowsHide: true });
      if (wrongIdentityResult.error || wrongIdentityResult.status !== 0) throw new Error('age_keygen_failed_for_wrong_test_identity');
      fs.writeFileSync(passwordFile, `${syntheticRolePasswords.backup}\n`, { mode: 0o600, flag: 'wx' });
      config = parseBackupConfig({
        NODE_ENV: 'test',
        BACKUP_TEST_MODE: 'true',
        BACKUP_STORAGE_ADAPTER: 'local-fake',
        BACKUP_DB_HOST: required('DB_HOST'),
        BACKUP_DB_PORT: required('DB_PORT'),
        BACKUP_DB_NAME: pools!.databaseName,
        BACKUP_DB_USER: 'lighting_backup',
        BACKUP_DB_PASSWORD_FILE: passwordFile,
        BACKUP_MAX_SNAPSHOT_LIFETIME: '15000',
        BACKUP_AGE_RECIPIENT: recipient,
        APP_BUILD_SHA: process.env.GITHUB_SHA ?? '0123456789abcdef',
        BACKUP_LOGICAL_DATABASE_ID: 'phase-b-disposable-ci-database',
        BACKUP_STORAGE_NAMESPACE_ID: 'phase-b-local-fake-ci',
        BACKUP_FAKE_STORAGE_ROOT: path.join(backupRoot, 'default-storage'),
      });
    }, 30_000);

    afterAll(() => {
      fs.rmSync(backupRoot, { recursive: true, force: true });
    }, 30_000);
    afterAll(async () => { await Promise.all(dedicatedRestoreAdminPools.map((pool) => pool.end())); });

    function createStorage(hooks?: ConstructorParameters<typeof LocalFakeStorageAdapter>[2]) {
      const root = path.join(backupRoot, `objects-${randomUUID()}`);
      return { root, adapter: new LocalFakeStorageAdapter(root, config.storageNamespaceId, hooks) };
    }

    function run(storage: LocalFakeStorageAdapter, options: {
      runId?: string;
      hooks?: Parameters<typeof runBackupOnce>[0]['hooks'];
      overrides?: Partial<typeof config>;
      signal?: AbortSignal;
      pool?: Pick<pg.Pool, 'connect'>;
    } = {}) {
      return runBackupOnce({
        config: { ...config, ...options.overrides },
        ...(options.runId ? { runId: options.runId } : {}),
        pool: options.pool ?? pools!.backup,
        storage,
        ...(options.hooks ? { hooks: options.hooks } : {}),
        ...(options.signal ? { signal: options.signal } : {}),
      });
    }

    function poolFailingOneUnlock(lockKey: number) {
      let backendPid: number | undefined;
      let releaseError: string | undefined;
      const wrappedPool = {
        connect: async () => {
          const client = await pools!.backup.connect();
          const originalQuery = client.query.bind(client);
          const backend = await originalQuery<{ pid: number }>('SELECT pg_backend_pid() AS pid');
          backendPid = backend.rows[0]?.pid;
          const originalRelease = client.release.bind(client);
          Object.defineProperty(client, 'query', {
            configurable: true,
            value: (...args: unknown[]) => {
              const [statement, values] = args;
              const lockValues = Array.isArray(values) ? values : [];
              if (typeof statement === 'string'
                && statement.includes('pg_advisory_unlock($1, $2)')
                && Number(lockValues[1]) === lockKey) {
                return Promise.reject(new Error('synthetic_unlock_failure'));
              }
              return originalQuery(...(args as Parameters<typeof originalQuery>));
            },
          });
          Object.defineProperty(client, 'release', {
            configurable: true,
            value: (error?: Error | boolean) => {
              if (error) releaseError = error instanceof Error ? error.message : 'discarded';
              originalRelease(error);
            },
          });
          return client;
        },
      };
      return {
        pool: wrappedPool as Pick<pg.Pool, 'connect'>,
        get backendPid() { return backendPid; },
        get releaseError() { return releaseError; },
      };
    }

    async function expectBothBackupLocksAvailable(): Promise<void> {
      const lockCheck = await pools!.migration.connect();
      try {
        const migration = await lockCheck.query<{ locked: boolean }>(
          'SELECT pg_try_advisory_lock($1, $2) AS locked', [MIGRATION_ADVISORY_LOCK.namespace, MIGRATION_ADVISORY_LOCK.key],
        );
        const backup = await lockCheck.query<{ locked: boolean }>(
          'SELECT pg_try_advisory_lock($1, $2) AS locked', [BACKUP_ADVISORY_LOCK.namespace, BACKUP_ADVISORY_LOCK.key],
        );
        expect(migration.rows[0]?.locked).toBe(true);
        expect(backup.rows[0]?.locked).toBe(true);
        await lockCheck.query('SELECT pg_advisory_unlock_all()');
      } finally { lockCheck.release(); }
    }

    async function expectBackupPoolDoesNotReuseDiscardedClient(discardedPid: number | undefined): Promise<void> {
      const borrower = await pools!.backup.connect();
      try {
        const backend = await borrower.query<{ pid: number }>('SELECT pg_backend_pid() AS pid');
        expect(backend.rows[0]?.pid).not.toBe(discardedPid);
        const migration = await borrower.query<{ locked: boolean }>(
          'SELECT pg_try_advisory_lock($1, $2) AS locked', [MIGRATION_ADVISORY_LOCK.namespace, MIGRATION_ADVISORY_LOCK.key],
        );
        const backup = await borrower.query<{ locked: boolean }>(
          'SELECT pg_try_advisory_lock($1, $2) AS locked', [BACKUP_ADVISORY_LOCK.namespace, BACKUP_ADVISORY_LOCK.key],
        );
        expect(migration.rows[0]?.locked).toBe(true);
        expect(backup.rows[0]?.locked).toBe(true);
        await borrower.query('SELECT pg_advisory_unlock_all()');
      } finally { borrower.release(); }
    }

    async function expectBackendClosed(backendPid: number | undefined): Promise<void> {
      expect(backendPid).toBeGreaterThan(0);
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline) {
        const active = await pools!.admin.query<{ present: boolean }>(
          'SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE pid = $1) AS present', [backendPid],
        );
        if (active.rows[0]?.present === false) return;
        await delay(20);
      }
      throw new Error('discarded_backup_connection_did_not_close');
    }

    async function dropDatabaseAfterSessionsClose(databaseName: string): Promise<void> {
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline) {
        const active = await pools!.admin.query<{ count: string }>(
          'SELECT count(*)::text AS count FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()', [databaseName],
        );
        if (Number(active.rows[0]?.count) === 0) {
          await pools!.admin.query(`DROP DATABASE IF EXISTS "${databaseName}"`);
          const state = await pools!.admin.query<{ exists: boolean; sessions: string }>(
            `SELECT EXISTS (SELECT 1 FROM pg_database WHERE datname = $1) AS exists,
                    (SELECT count(*)::text FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()) AS sessions`, [databaseName],
          );
          if (!state.rows[0]?.exists && Number(state.rows[0]?.sessions) === 0) return;
        }
        await delay(20);
      }
      throw new Error('restore_fixture_disposal_unconfirmed');
    }

    async function waitForDatabaseSessionCount(databaseName: string, expectedCount: number, timeoutMs = 5000): Promise<void> {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const active = await pools!.admin.query<{ count: string }>(
          'SELECT count(*)::text AS count FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()', [databaseName],
        );
        if (Number(active.rows[0]?.count) === expectedCount) return;
        await delay(20);
      }
      throw new Error('restore_fixture_session_count_unconfirmed');
    }

    async function restoreToDisposableDatabase(storageRoot: string, manifestKey: string): Promise<{ databaseName: string; database: pg.Pool }> {
      const manifestPath = path.join(storageRoot, ...manifestKey.split('/'));
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as { archive: { object_key: string } };
      const databaseName = `phase_b_restore_${process.pid}_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
      await pools!.admin.query(`CREATE DATABASE ${databaseName} TEMPLATE template0`);
      const archivePath = path.join(storageRoot, ...manifest.archive.object_key.split('/'));
      const database = createAdminPool(databaseName);
      try {
        await restoreEncryptedArchive(archivePath, identityFile, databaseName);
        return { databaseName, database };
      } catch (error) {
        await database.end();
        await dropDatabaseAfterSessionsClose(databaseName);
        throw error;
      }
    }

    it('executes the scheduled encrypted backup, synthetic data-loss recovery, exact restore, and monitoring evidence end to end', async () => {
      const marker = `PHASE_CG_DRILL_${randomUUID().replaceAll('-', '')}`;
      const largeAddress = randomBytes(8 * 1024 * 1024).toString('hex');
      const largeAddressDigest = createHash('md5').update(largeAddress).digest('hex');
      const adminId = firstAdminId ?? Number((await pools!.admin.query<{ id: number }>('SELECT id FROM admins ORDER BY id LIMIT 1')).rows[0]?.id);
      if (!Number.isInteger(adminId)) throw new Error('synthetic_recovery_admin_fixture_missing');
      await pools!.admin.query(
        `INSERT INTO public.light_points (inventory_number, geom, address)
         VALUES ($1, ST_SetSRID(ST_MakePoint(21.25, 48.72), 4326), $2)`, [marker, largeAddress],
      );
      const adminHistory = await pools!.admin.query<{ id: number }>(
        `INSERT INTO public.admin_activity_logs (admin_id, action, entity_type, entity_id, details)
         VALUES ($1, 'synthetic.recovery.drill', 'test', 1, '{"synthetic":true}'::jsonb) RETURNING id`, [adminId],
      );
      const pendingBatch = await pools!.admin.query<{ id: number }>(
        `INSERT INTO public.import_batches (filename, status, total_rows, created_at, queued_at)
         VALUES ('synthetic-recovery.csv', 'queued', 1, now(), now()) RETURNING id`,
      );
      const pendingRow = await pools!.admin.query<{ id: string }>(
        `INSERT INTO public.import_batch_rows (batch_id, source_row_number, outcome, inventory_number, reason_code, payload)
         VALUES ($1, 1, 'pending', $2, 'recovery_pending', '{"synthetic":true}'::jsonb) RETURNING id`,
        [pendingBatch.rows[0]!.id, marker],
      );
      const auditHistory = await pools!.admin.query<{ id: string }>(
        `INSERT INTO public.inventory_audit_events (actor_admin_id, actor_username_snapshot, entity_id_snapshot,
          inventory_number_snapshot, action, import_batch_id, changed_fields)
         VALUES ($1, 'synthetic.recovery', 1, $2, 'create', $3, '{"synthetic":true}'::jsonb) RETURNING id`,
        [adminId, marker, pendingBatch.rows[0]!.id],
      );
      const storage = createStorage();
      const stateDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'phase-cg-scheduler-state-'));
      const journal = new FileSchedulerJournal(stateDirectory);
      const source = {
        verifyExactObject: (identity: Parameters<typeof storage.adapter.verifyExactObject>[0], signal: AbortSignal) =>
          storage.adapter.verifyExactObject(identity, { signal }),
        readExactManifest: (identity: Parameters<typeof storage.adapter.readManifestForRestore>[0], signal: AbortSignal) =>
          storage.adapter.readManifestForRestore(identity, signal),
        openExactArchive: (identity: Parameters<typeof storage.adapter.openArchiveForRestore>[0], signal: AbortSignal) =>
          storage.adapter.openArchiveForRestore(identity, signal),
      };
      let restoreDatabaseName = '';
      let restoreFailureCode: string | undefined;
      let restoreFailureStage = 'restore_callback_start';
      const targetPoolEndRequested = deferred<{ backendPid: number; atUtc: string }>();
      const allowTargetPoolSocketClose = deferred<void>();
      const allowRestoreSessionProbe = deferred<void>();
      const targetSessionCheck = deferred<{ activeSessions: number; atUtc: string }>();
      let restoreSessionCheckObserver: ((activeSessions: number) => void) | undefined;
      const targetPoolErrors: Array<{ code: string | undefined; pid: number | undefined }> = [];
      const restoreLifecycle: {
        backendPid?: number;
        concurrentBackendPid?: number;
        poolEndRequestedAtUtc?: string;
        poolEndResolvedAtUtc?: string;
        sessionDrainObservedAtUtc?: string;
        concurrentSessionClosedAtUtc?: string;
        disposalStartedAtUtc?: string;
        disposalFinishedAtUtc?: string;
        clientSocketClosedAtUtc?: string;
        restoreDrillSettledAtUtc?: string;
      } = {};
      let delayedTargetPool: pg.Pool | undefined;
      let delayedTargetDatabaseName = '';
      let concurrentTargetPool: pg.Pool | undefined;
      let concurrentTargetClient: pg.PoolClient | undefined;
      let targetPoolErrorListener: ((error: Error & { code?: string }, client: pg.PoolClient) => void) | undefined;
      let targetPoolBaselineErrorListenerCount = 0;
      const dropRestoreFixture = async (databaseName: string): Promise<void> => {
        await dropDatabaseAfterSessionsClose(databaseName);
      };
      try {
        let drill: Awaited<ReturnType<typeof runSyntheticRecoveryDrill>>;
        try {
          const drillPromise = runSyntheticRecoveryDrill({
          appBuildSha: config.appBuildSha,
          produceBackup: async () => {
            const scheduled = await runScheduledBackup({
              now: () => new Date(), schedulerPool: pools!.backup, journal,
              executeBackup: (runId) => run(storage.adapter, { runId }),
            });
            expect(scheduled).toMatchObject({ action: 'attempted', state: 'complete', exit_code: 0 });
            if (!('backup_result' in scheduled) || !scheduled.backup_result) throw new Error('scheduled_backup_result_missing');
            const manifestPath = path.join(storage.root, ...scheduled.backup_result.manifest_id!.split('/'));
            const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as { archive: { object_key: string } };
            const archivePath = path.join(storage.root, ...manifest.archive.object_key.split('/'));
            const decryptedBytes = await countDecryptedArchiveBytes(archivePath, identityFile);
            expect(decryptedBytes).toBeGreaterThan(1024 * 1024);
            return scheduled.backup_result;
          },
          injectSyntheticDataLoss: async () => {
            const removed = await pools!.admin.query('DELETE FROM public.light_points WHERE inventory_number = $1 RETURNING id', [marker]);
            await pools!.admin.query('DELETE FROM public.inventory_audit_events WHERE id = $1', [auditHistory.rows[0]!.id]);
            await pools!.admin.query('DELETE FROM public.import_batches WHERE id = $1', [pendingBatch.rows[0]!.id]);
            await pools!.admin.query('DELETE FROM public.admin_activity_logs WHERE id = $1', [adminHistory.rows[0]!.id]);
            if (removed.rowCount !== 1) throw new Error('synthetic_data_loss_not_injected');
            return { occurred_at_utc: new Date().toISOString(), synthetic_record_removed: true };
          },
          restoreExactArtifact: async (manifestId) => {
            try {
            const manifestIdentity = await storage.adapter.getExactIdentityForRestore(manifestId);
            const restoreAdminPool = new Pool({
              host: required('DB_HOST'), port: Number(required('DB_PORT')), database: pools!.databaseName,
              user: required('DB_USER'), password: required('DB_PASSWORD'), max: 1,
              connectionTimeoutMillis: 5000, idleTimeoutMillis: 0,
            });
            dedicatedRestoreAdminPools.push(restoreAdminPool);
            let adminQueryHook: ((
              sql: string,
              values: unknown[] | undefined,
              execute: (sql: string, values?: unknown[]) => Promise<unknown>,
              client: pg.PoolClient,
            ) => Promise<unknown>) | undefined;
            const interceptAdminPool = (
              pool: pg.Pool,
              afterAcquire?: (client: pg.PoolClient, index: number) => Promise<void>,
            ): pg.Pool => {
              const instrumentedClients = new WeakSet<pg.PoolClient>();
              let acquireIndex = 0;
              return {
                options: pool.options,
                connect: async () => {
                  const client = await pool.connect();
                  await afterAcquire?.(client, acquireIndex++);
                  if (!instrumentedClients.has(client)) {
                    instrumentedClients.add(client);
                    const execute = client.query.bind(client) as (...args: unknown[]) => unknown;
                    Object.defineProperty(client, 'query', {
                      configurable: true,
                      value: async (...args: unknown[]) => {
                        const [sqlArgument, valuesArgument, callbackArgument] = args;
                        if (typeof valuesArgument === 'function' || typeof callbackArgument === 'function') {
                          return execute(...args);
                        }
                        const sql = sqlArgument as string;
                        const values = valuesArgument as unknown[] | undefined;
                        const isRestoreSessionCheck = sql.toLowerCase().includes('restore_active_sessions');
                        if (isRestoreSessionCheck && restoreSessionCheckObserver) await allowRestoreSessionProbe.promise;
                        let result: unknown;
                        if (adminQueryHook) {
                          result = await adminQueryHook(sql, values,
                            (query, queryValues) => execute(query, queryValues) as Promise<unknown>, client);
                        } else {
                          result = await execute(sql, values) as Promise<unknown>;
                        }
                        if (isRestoreSessionCheck && restoreSessionCheckObserver) {
                          const rows = (result as { rows?: Array<{ restore_active_sessions?: string | number }> }).rows ?? [];
                          restoreSessionCheckObserver(Number(rows[0]?.restore_active_sessions ?? 0));
                        }
                        return result;
                      },
                    });
                  }
                  return client;
                },
              } as unknown as pg.Pool;
            };
            const interceptedAdminPool = interceptAdminPool(restoreAdminPool);
            const baselineClient = await restoreAdminPool.connect();
            const baselineSession = (await baselineClient.query<{ pid: number; statement_timeout: string; lock_timeout: string }>(
              "SELECT pg_backend_pid() AS pid, current_setting('statement_timeout') AS statement_timeout, current_setting('lock_timeout') AS lock_timeout",
            )).rows[0];
            if (!baselineSession) throw new Error('restore_admin_session_baseline_missing');
            let baselineBackendPid = Number(baselineSession.pid);
            const baselineDefaultTimeouts = {
              statement_timeout: baselineSession.statement_timeout,
              lock_timeout: baselineSession.lock_timeout,
            };
            await baselineClient.query("SELECT set_config('statement_timeout', '5000ms', false), set_config('lock_timeout', '700ms', false)");
            baselineClient.release();
            const expectRestoreAdminSessionBaseline = async (options: { allowDiscardedClient?: boolean } = {}) => {
              const borrowed = await restoreAdminPool.connect();
              try {
                const result = await borrowed.query<{ pid: number; statement_timeout: string; lock_timeout: string }>(
                  "SELECT pg_backend_pid() AS pid, current_setting('statement_timeout') AS statement_timeout, current_setting('lock_timeout') AS lock_timeout",
                );
                const session = result.rows[0];
                if (!session) throw new Error('restore_admin_session_baseline_missing');
                if (options.allowDiscardedClient && session.pid !== baselineBackendPid) {
                  if (session.statement_timeout !== baselineDefaultTimeouts.statement_timeout) {
                    throw new Error('restore_fresh_statement_timeout_not_default');
                  }
                  if (session.lock_timeout !== baselineDefaultTimeouts.lock_timeout) {
                    throw new Error('restore_fresh_lock_timeout_not_default');
                  }
                  await borrowed.query("SELECT set_config('statement_timeout', '5000ms', false), set_config('lock_timeout', '700ms', false)");
                  baselineBackendPid = Number(session.pid);
                  return;
                }
                if (session.pid !== baselineBackendPid) throw new Error('restore_admin_backend_pid_changed');
                if (session.statement_timeout !== '5s') throw new Error('restore_statement_timeout_not_restored');
                if (session.lock_timeout !== '700ms') throw new Error('restore_lock_timeout_not_restored');
              } finally { borrowed.release(); }
            };
            const restorePgpassDirectories = () => new Set(fs.readdirSync(os.tmpdir()).filter((name) => name.startsWith('lighting-restore-')));
            const expectNoNewRestorePgpassDirectories = (before: Set<string>) => {
              expect([...restorePgpassDirectories()].filter((name) => !before.has(name))).toEqual([]);
            };
            const restoreOptions = (
              identity: Parameters<typeof restoreExactBackupToFreshDatabase>[0]['manifestIdentity'],
              overrides: Partial<Parameters<typeof restoreExactBackupToFreshDatabase>[0]> = {},
            ) => ({
              manifestIdentity: identity,
              expectedStorageNamespaceId: config.storageNamespaceId,
              expectedRecipientKeyId: config.recipientKeyId,
              privateIdentityFile: identityFile,
              databaseAdmin: {
                host: required('DB_HOST'), port: Number(required('DB_PORT')),
                user: required('DB_USER'), password: required('DB_PASSWORD'),
              },
              adminPool: interceptedAdminPool,
              openTargetAdminPool: (databaseName: string) => createAdminPool(databaseName),
              openRuntimePool: (databaseName: string) => new Pool({
                host: required('DB_HOST'), port: Number(required('DB_PORT')), database: databaseName,
                user: 'lighting_runtime', password: syntheticRolePasswords.runtime, max: 2, connectionTimeoutMillis: 5000,
              }),
              assertClusterRolesPrepared: async (signal: AbortSignal) => {
                if (signal.aborted) throw new Error('restore_preflight_aborted');
                const roles = await pools!.admin.query<{ count: string }>(
                  `SELECT count(*)::text AS count FROM pg_roles WHERE rolname = ANY($1::text[])`, [protectedRoleNames],
                );
                if (signal.aborted) throw new Error('restore_preflight_aborted');
                if (roles.rows[0]?.count !== String(protectedRoleNames.length)) throw new Error('restore_roles_not_prepared');
              },
              canonicalGrantSql: grantSql,
              source,
              appBuildSha: config.appBuildSha,
              validateAdditionalData: async (runtime: Pick<pg.Pool, 'query' | 'end'>, _manifest: BackupManifestV1, signal: AbortSignal) => {
                if (signal.aborted) throw new Error('restore_validation_aborted');
                const restoredMarker = await runtime.query<{ inventory_number: string; address_digest: string }>(
                  'SELECT inventory_number, md5(address) AS address_digest FROM public.light_points WHERE inventory_number = $1', [marker],
                );
                if (restoredMarker.rows.length !== 1 || restoredMarker.rows[0]?.address_digest !== largeAddressDigest) {
                  throw new Error('synthetic_large_stream_payload_not_restored');
                }
                const restoredAdminHistory = await runtime.query('SELECT action FROM public.admin_activity_logs WHERE id = $1', [adminHistory.rows[0]!.id]);
                const restoredBatch = await runtime.query<{ status: string; completed_at: Date | null }>(
                  'SELECT status, completed_at FROM public.import_batches WHERE id = $1', [pendingBatch.rows[0]!.id],
                );
                const restoredPendingRow = await runtime.query<{ outcome: string; payload: unknown }>(
                  'SELECT outcome, payload FROM public.import_batch_rows WHERE id = $1', [pendingRow.rows[0]!.id],
                );
                const restoredAudit = await runtime.query<{ import_batch_id: number }>(
                  'SELECT import_batch_id FROM public.inventory_audit_events WHERE id = $1', [auditHistory.rows[0]!.id],
                );
                if (restoredAdminHistory.rows.length !== 1 || restoredBatch.rows[0]?.status !== 'queued'
                  || restoredBatch.rows[0]?.completed_at !== null || restoredPendingRow.rows[0]?.outcome !== 'pending'
                  || !restoredPendingRow.rows[0]?.payload || Number(restoredAudit.rows[0]?.import_batch_id) !== pendingBatch.rows[0]!.id) {
                  throw new Error('synthetic_import_history_not_restored');
                }
              },
              ...overrides,
            });
            const openDelayedTargetAdminPool = (databaseName: string): pg.Pool => {
              delayedTargetDatabaseName = databaseName;
              const pool = createAdminPool(databaseName);
              delayedTargetPool = pool;
              targetPoolBaselineErrorListenerCount = pool.listenerCount('error');
              targetPoolErrorListener = (error, client) => {
                targetPoolErrors.push({ code: error.code, pid: Number((client as unknown as pg.Client & { processID?: number }).processID) });
              };
              pool.on('error', targetPoolErrorListener);
              const acquiredClients = new Set<pg.PoolClient>();
              pool.on('acquire', (client: pg.PoolClient) => acquiredClients.add(client));
              pool.on('remove', (client: pg.PoolClient) => acquiredClients.delete(client));
              const originalPoolEnd = pool.end.bind(pool);
              Object.defineProperty(pool, 'end', {
                configurable: true,
                value: async () => {
                  if (acquiredClients.size === 0) throw new Error('restore_fixture_target_pool_had_no_clients');
                  const clients = [...acquiredClients];
                  const firstClient = clients[0] as unknown as pg.Client & { processID?: number };
                  targetPoolEndRequested.resolve({ backendPid: Number(firstClient.processID), atUtc: new Date().toISOString() });
                  let pendingSocketCloses = clients.length;
                  for (const client of clients) {
                    const lifecycleClient = client as unknown as pg.Client & { processID?: number };
                    const originalClientEnd = (client as unknown as {
                      end: (callback: (error?: Error) => void) => void;
                    }).end.bind(client);
                    Object.defineProperty(client, 'end', {
                      configurable: true,
                      value: (callback?: (error?: Error) => void) => {
                        void allowTargetPoolSocketClose.promise.then(() => {
                          try {
                            originalClientEnd((error?: Error) => {
                              pendingSocketCloses -= 1;
                              if (!error && pendingSocketCloses === 0) restoreLifecycle.clientSocketClosedAtUtc = new Date().toISOString();
                              callback?.(error);
                            });
                          } catch (error) {
                            callback?.(error instanceof Error ? error : new Error('restore_fixture_client_end_failed'));
                          }
                        });
                      },
                    });
                    expect(Number(lifecycleClient.processID)).toBeGreaterThan(0);
                  }
                  await originalPoolEnd();
                  restoreLifecycle.poolEndResolvedAtUtc = new Date().toISOString();
                },
              });
              return pool;
            };
            const beforeRestoreDatabases = await pools!.admin.query<{ count: string }>(
              `SELECT count(*)::text AS count FROM pg_database WHERE datname LIKE 'ops_restore_%'`,
            );
            restoreFailureStage = 'source_deadline';
            await expect(restoreExactBackupToFreshDatabase({
              ...restoreOptions(manifestIdentity), maxRestoreDurationMs: 100,
              source: {
                ...source,
                verifyExactObject: async (_identity, signal) => new Promise((_resolve, reject) => {
                  signal.addEventListener('abort', () => reject(new Error('synthetic_source_cancelled')), { once: true });
                  if (signal.aborted) reject(new Error('synthetic_source_cancelled'));
                }),
              },
            })).rejects.toThrow('controlled_restore_deadline_exceeded');
            const afterSourceTimeout = await pools!.admin.query<{ count: string }>(
              `SELECT count(*)::text AS count FROM pg_database WHERE datname LIKE 'ops_restore_%'`,
            );
            expect(afterSourceTimeout.rows[0]?.count).toBe(beforeRestoreDatabases.rows[0]?.count);
            await expectRestoreAdminSessionBaseline();

            let queryFailureSqlState: string | undefined;
            const queryFailurePgpassBefore = restorePgpassDirectories();
            restoreFailureStage = 'query_failure';
            adminQueryHook = async (sql, _values, execute) => {
              if (sql.startsWith('CREATE DATABASE')) {
                try { return await execute('SELECT 1 / 0'); }
                catch (error) {
                  queryFailureSqlState = (error as { code?: string }).code;
                  throw error;
                }
              }
              return execute(sql, _values);
            };
            try {
              await expect(restoreExactBackupToFreshDatabase(restoreOptions(manifestIdentity)))
                .rejects.toThrow('controlled_restore_failed_fresh_target_discarded');
            } finally { adminQueryHook = undefined; }
            expect(queryFailureSqlState).toBe('22012');
            await expectRestoreAdminSessionBaseline();
            expectNoNewRestorePgpassDirectories(queryFailurePgpassBefore);
            const afterQueryFailure = await pools!.admin.query<{ count: string }>(
              `SELECT count(*)::text AS count FROM pg_database WHERE datname LIKE 'ops_restore_%'`,
            );
            expect(afterQueryFailure.rows[0]?.count).toBe(beforeRestoreDatabases.rows[0]?.count);

            for (const timeoutSetting of ['statement_timeout', 'lock_timeout'] as const) {
              let resetFailureInjected = false;
              restoreFailureStage = `restore_${timeoutSetting}_reset_failure`;
              adminQueryHook = async (sql, values, execute) => {
                const normalizedSql = sql.toLowerCase();
                const restoringStatement = normalizedSql.includes("set_config('statement_timeout'") && values?.[0] === '5s';
                const restoringLock = normalizedSql.includes("set_config('lock_timeout'")
                  && (values?.[0] === '700ms' || values?.[1] === '700ms');
                if (!resetFailureInjected && (timeoutSetting === 'statement_timeout' ? restoringStatement : restoringLock)) {
                  resetFailureInjected = true;
                  // Apply one restoration before failing to prove that partial session state is discarded.
                  await execute("SELECT set_config('statement_timeout', $1, false)", ['5s']);
                  throw new Error(`synthetic_${timeoutSetting}_reset_failure`);
                }
                return execute(sql, values);
              };
              try {
                await expect(restoreExactBackupToFreshDatabase(restoreOptions(manifestIdentity)))
                  .rejects.toThrow(/restore_session_timeout_reset_failed|controlled_restore_failed_cleanup_unconfirmed/);
              } finally { adminQueryHook = undefined; }
              expect(resetFailureInjected).toBe(true);
              await expectRestoreAdminSessionBaseline({ allowDiscardedClient: true });
              expect(restoreAdminPool.waitingCount).toBe(0);
              expect(restoreAdminPool.totalCount).toBe(1);
              const poolStillWorks = await restoreAdminPool.query<{ ok: number }>('SELECT 1 AS ok');
              expect(poolStillWorks.rows[0]?.ok).toBe(1);
            }

            const stalledInitialRead = deferred<{ backendPid: number; resume: () => void }>();
            let initialReadStalled = false;
            const stalledReadStartedAt = Date.now();
            restoreFailureStage = 'initial_current_setting_wall_clock_timeout';
            adminQueryHook = async (sql, values, execute, client) => {
              if (!initialReadStalled && sql.toLowerCase().includes("current_setting('statement_timeout'")) {
                initialReadStalled = true;
                const stream = (client as unknown as { connection: { stream: { pause(): void; resume(): void } } }).connection.stream;
                const backendPid = Number((client as unknown as pg.Client & { processID: number }).processID);
                stream.pause();
                const blockedQuery = execute('SELECT pg_sleep(10)');
                stalledInitialRead.resolve({ backendPid, resume: () => stream.resume() });
                return blockedQuery;
              }
              return execute(sql, values);
            };
            let stalledRestore: Promise<unknown> | undefined;
            try {
              stalledRestore = restoreExactBackupToFreshDatabase(restoreOptions(manifestIdentity, { maxRestoreDurationMs: 500 }));
              const stalled = await within(stalledInitialRead.promise, 1500, 'restore_initial_setting_query_not_started');
              let cancellationConfirmed = false;
              for (let attempt = 0; attempt < 50; attempt += 1) {
                const cancellation = await pools!.admin.query<{ cancelled: boolean }>(
                  'SELECT pg_cancel_backend($1) AS cancelled', [stalled.backendPid],
                );
                if (cancellation.rows[0]?.cancelled) { cancellationConfirmed = true; break; }
                await delay(20);
              }
              expect(cancellationConfirmed).toBe(true);
              const wallClockOutcome = await Promise.race([
                stalledRestore.then(() => 'resolved' as const, () => 'rejected' as const),
                delay(1000).then(() => 'still-pending' as const),
              ]);
              if (wallClockOutcome === 'still-pending') stalled.resume();
              expect(wallClockOutcome).toBe('rejected');
              await expect(stalledRestore).rejects.toThrow('controlled_restore_deadline_exceeded');
              expect(Date.now() - stalledReadStartedAt).toBeLessThan(1200);
              stalled.resume();
              const serverQuerySettled = await pools!.admin.query<{ active: boolean }>(
                'SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE pid = $1 AND state = $2) AS active',
                [stalled.backendPid, 'active'],
              );
              expect(serverQuerySettled.rows[0]?.active).toBe(false);
              await expectRestoreAdminSessionBaseline({ allowDiscardedClient: true });
              expect(restoreAdminPool.waitingCount).toBe(0);
            } finally {
              adminQueryHook = undefined;
              if (stalledRestore) await stalledRestore.catch(() => undefined);
            }

            const sharedRestorePool = new Pool({
              host: required('DB_HOST'), port: Number(required('DB_PORT')), database: pools!.databaseName,
              user: required('DB_USER'), password: required('DB_PASSWORD'), max: 2,
              connectionTimeoutMillis: 5000, idleTimeoutMillis: 0,
            });
            const releaseConcurrentConnects = deferred();
            const firstConcurrentConnect = deferred();
            const bothConcurrentConnects = deferred<number>();
            const concurrentConnectTimeouts: Array<number | undefined> = [];
            let concurrentConnectCount = 0;
            const interceptedSharedPool = interceptAdminPool(sharedRestorePool, async () => {
              concurrentConnectTimeouts.push(sharedRestorePool.options.connectionTimeoutMillis);
              concurrentConnectCount += 1;
              if (concurrentConnectCount === 1) firstConcurrentConnect.resolve();
              if (concurrentConnectCount === 2) bothConcurrentConnects.resolve(concurrentConnectCount);
              await releaseConcurrentConnects.promise;
            });
            const originalConnectTimeout = sharedRestorePool.options.connectionTimeoutMillis;
            adminQueryHook = async (sql, values, execute) => {
              if (sql.startsWith('SELECT EXISTS (SELECT 1 FROM pg_database')) return execute('SELECT 1 / 0');
              return execute(sql, values);
            };
            const firstRestore = restoreExactBackupToFreshDatabase(restoreOptions(manifestIdentity, {
              adminPool: interceptedSharedPool, maxRestoreDurationMs: 4000,
            }));
            let secondRestore: Promise<unknown> | undefined;
            try {
              await within(firstConcurrentConnect.promise, 1000, 'first_shared_restore_connect_not_observed');
              secondRestore = restoreExactBackupToFreshDatabase(restoreOptions(manifestIdentity, {
                adminPool: interceptedSharedPool, maxRestoreDurationMs: 8000,
              }));
              await within(bothConcurrentConnects.promise, 1000, 'second_shared_restore_connect_not_observed');
              expect(concurrentConnectTimeouts).toEqual([originalConnectTimeout, originalConnectTimeout]);
              expect(sharedRestorePool.options.connectionTimeoutMillis).toBe(originalConnectTimeout);
              releaseConcurrentConnects.resolve();
              const outcomes = await Promise.allSettled([firstRestore, secondRestore]);
              expect(outcomes).toHaveLength(2);
              expect(outcomes.every((outcome) => outcome.status === 'rejected')).toBe(true);
              expect(sharedRestorePool.options.connectionTimeoutMillis).toBe(originalConnectTimeout);
              expect(sharedRestorePool.waitingCount).toBe(0);
            } finally {
              releaseConcurrentConnects.resolve();
              await Promise.allSettled([firstRestore, ...(secondRestore ? [secondRestore] : [])]);
              adminQueryHook = undefined;
              await sharedRestorePool.end();
            }

            let timeoutSqlState: string | undefined;
            let timeoutVerificationCalls = 0;
            const timeoutPgpassBefore = restorePgpassDirectories();
            restoreFailureStage = 'statement_timeout';
            const delayedSource = {
              ...source,
              verifyExactObject: async (identity: Parameters<typeof source.verifyExactObject>[0], signal: AbortSignal) => {
                if (timeoutVerificationCalls++ === 0) await delay(1200);
                return source.verifyExactObject(identity, signal);
              },
            };
            adminQueryHook = async (sql, _values, execute) => {
              if (sql.startsWith('CREATE DATABASE')) {
                try {
                  await execute("SELECT set_config('statement_timeout', '100ms', false)");
                  return await execute('SELECT pg_sleep(5)');
                }
                catch (error) {
                  timeoutSqlState = (error as { code?: string }).code;
                  throw error;
                }
              }
              return execute(sql, _values);
            };
            try {
              await expect(restoreExactBackupToFreshDatabase(restoreOptions(manifestIdentity, {
                maxRestoreDurationMs: 2500, source: delayedSource,
              }))).rejects.toThrow('controlled_restore_failed_fresh_target_discarded');
            } finally { adminQueryHook = undefined; }
            expect(timeoutSqlState).toBe('57014');
            await expectRestoreAdminSessionBaseline();
            expectNoNewRestorePgpassDirectories(timeoutPgpassBefore);
            const afterStatementTimeout = await pools!.admin.query<{ count: string }>(
              `SELECT count(*)::text AS count FROM pg_database WHERE datname LIKE 'ops_restore_%'`,
            );
            expect(afterStatementTimeout.rows[0]?.count).toBe(beforeRestoreDatabases.rows[0]?.count);

            const abortController = new AbortController();
            const abortPgpassBefore = restorePgpassDirectories();
            restoreFailureStage = 'external_abort';
            adminQueryHook = async (sql, _values, execute) => {
              if (sql.startsWith('CREATE DATABASE')) {
                const abortTimer = setTimeout(() => abortController.abort(new Error('synthetic_external_abort')), 50);
                try { return await execute('SELECT pg_sleep(0.2)'); }
                finally { clearTimeout(abortTimer); }
              }
              return execute(sql, _values);
            };
            try {
              await expect(restoreExactBackupToFreshDatabase(restoreOptions(manifestIdentity, {
                signal: abortController.signal,
              }))).rejects.toThrow('controlled_restore_failed_fresh_target_discarded');
            } finally { adminQueryHook = undefined; }
            expect(abortController.signal.aborted).toBe(true);
            await expectRestoreAdminSessionBaseline({ allowDiscardedClient: true });
            expect(restoreAdminPool.waitingCount).toBe(0);
            const poolAfterAbort = await within(restoreAdminPool.query<{ ok: number }>('SELECT 1 AS ok'), 1500, 'restore_pool_after_abort_stalled');
            expect(poolAfterAbort.rows[0]?.ok).toBe(1);
            expectNoNewRestorePgpassDirectories(abortPgpassBefore);
            const afterAbort = await pools!.admin.query<{ count: string }>(
              `SELECT count(*)::text AS count FROM pg_database WHERE datname LIKE 'ops_restore_%'`,
            );
            expect(afterAbort.rows[0]?.count).toBe(beforeRestoreDatabases.rows[0]?.count);

            if (process.platform !== 'win32') {
              restoreFailureStage = 'age_process_failure';
              const ageFailure = path.join(stateDirectory, 'age-failure');
              const restoreDrain = path.join(stateDirectory, 'pg-restore-drain');
              const restoreEarlyExit = path.join(stateDirectory, 'pg-restore-early-exit');
              fs.writeFileSync(ageFailure, '#!/bin/sh\nif [ "$1" = "--version" ]; then echo "age v1.3.2"; exit 0; fi\nexit 7\n', { mode: 0o700 });
              fs.writeFileSync(restoreDrain, '#!/bin/sh\nif [ "$1" = "--version" ]; then echo "pg_restore (PostgreSQL) 16.0"; exit 0; fi\ncat >/dev/null\n', { mode: 0o700 });
              fs.writeFileSync(restoreEarlyExit, '#!/bin/sh\nif [ "$1" = "--version" ]; then echo "pg_restore (PostgreSQL) 16.0"; exit 0; fi\nexit 9\n', { mode: 0o700 });
              await expect(restoreExactBackupToFreshDatabase({
                ...restoreOptions(manifestIdentity), ageBinary: ageFailure, pgRestoreBinary: restoreDrain,
              })).rejects.toThrow('controlled_restore_failed_fresh_target_discarded');
              const afterAgeFailure = await pools!.admin.query<{ count: string }>(
                `SELECT count(*)::text AS count FROM pg_database WHERE datname LIKE 'ops_restore_%'`,
              );
              expect(afterAgeFailure.rows[0]?.count).toBe(beforeRestoreDatabases.rows[0]?.count);
              restoreFailureStage = 'pg_restore_early_exit';
              await expect(restoreExactBackupToFreshDatabase({
                ...restoreOptions(manifestIdentity), pgRestoreBinary: restoreEarlyExit,
              })).rejects.toThrow('controlled_restore_failed_fresh_target_discarded');
              const afterRestoreEarlyExit = await pools!.admin.query<{ count: string }>(
                `SELECT count(*)::text AS count FROM pg_database WHERE datname LIKE 'ops_restore_%'`,
              );
              expect(afterRestoreEarlyExit.rows[0]?.count).toBe(beforeRestoreDatabases.rows[0]?.count);
              restoreFailureStage = 'archive_read_failure';
              await expect(restoreExactBackupToFreshDatabase({
                ...restoreOptions(manifestIdentity),
                source: { ...source, openExactArchive: async () => new Readable({ read() { this.destroy(new Error('synthetic archive read failure')); } }) },
              })).rejects.toThrow('controlled_restore_failed_fresh_target_discarded');
              const afterArchiveReadFailure = await pools!.admin.query<{ count: string }>(
                `SELECT count(*)::text AS count FROM pg_database WHERE datname LIKE 'ops_restore_%'`,
              );
              expect(afterArchiveReadFailure.rows[0]?.count).toBe(beforeRestoreDatabases.rows[0]?.count);

              const ageBlocker = path.join(stateDirectory, 'age-blocker');
              restoreFailureStage = 'restore_timeout';
              fs.writeFileSync(ageBlocker, '#!/bin/sh\nif [ "$1" = "--version" ]; then echo "age v1.3.2"; exit 0; fi\nexec sleep 30\n', { mode: 0o700 });
              await expect(restoreExactBackupToFreshDatabase({
                ...restoreOptions(manifestIdentity), ageBinary: ageBlocker, pgRestoreBinary: restoreDrain, maxRestoreDurationMs: 1500,
              })).rejects.toThrow('controlled_restore_failed_fresh_target_discarded');
              const afterTimedRestore = await pools!.admin.query<{ count: string }>(
                `SELECT count(*)::text AS count FROM pg_database WHERE datname LIKE 'ops_restore_%'`,
              );
              expect(afterTimedRestore.rows[0]?.count).toBe(beforeRestoreDatabases.rows[0]?.count);

              const ignoreTermPidFile = path.join(stateDirectory, 'restore-child.pid');
              const ignoreTermReceivedFile = path.join(stateDirectory, 'restore-child.term');
              const ageIgnoreTerm = path.join(stateDirectory, 'age-ignore-term.mjs');
              restoreFailureStage = 'term_ignoring_child_cleanup';
              fs.writeFileSync(ageIgnoreTerm, `#!/usr/bin/env node
import { writeFileSync } from 'node:fs';
if (process.argv[2] === '--version') { process.stdout.write('age v1.3.2\\n'); process.exit(0); }
writeFileSync(${JSON.stringify(ignoreTermPidFile)}, String(process.pid));
process.on('SIGTERM', () => writeFileSync(${JSON.stringify(ignoreTermReceivedFile)}, 'SIGTERM received'));
setInterval(() => {}, 1000);
`, { mode: 0o700 });
              const ignoredTermStartedAt = Date.now();
              const ignoredTermPgpassBefore = restorePgpassDirectories();
              await expect(restoreExactBackupToFreshDatabase({
                ...restoreOptions(manifestIdentity), ageBinary: ageIgnoreTerm, pgRestoreBinary: restoreDrain, maxRestoreDurationMs: 1500,
              })).rejects.toThrow('controlled_restore_failed_fresh_target_discarded');
              const ignoredTermElapsedMs = Date.now() - ignoredTermStartedAt;
              const ignoredTermPid = Number(fs.readFileSync(ignoreTermPidFile, 'utf8'));
              expect(fs.readFileSync(ignoreTermReceivedFile, 'utf8')).toBe('SIGTERM received');
              expect(ignoredTermElapsedMs).toBeGreaterThanOrEqual(2500);
              expect(ignoredTermElapsedMs).toBeLessThan(8000);
              let ignoredTermProcessAlive = true;
              try { process.kill(ignoredTermPid, 0); } catch { ignoredTermProcessAlive = false; }
              expect(ignoredTermProcessAlive).toBe(false);
              expectNoNewRestorePgpassDirectories(ignoredTermPgpassBefore);
              const afterIgnoredTermRestore = await pools!.admin.query<{ count: string }>(
                `SELECT count(*)::text AS count FROM pg_database WHERE datname LIKE 'ops_restore_%'`,
              );
              expect(afterIgnoredTermRestore.rows[0]?.count).toBe(beforeRestoreDatabases.rows[0]?.count);

              const pgpassPathFile = path.join(stateDirectory, 'pgpass-path.txt');
              const pgRestoreCleanupFailure = path.join(stateDirectory, 'pg-restore-cleanup-failure');
              restoreFailureStage = 'pgpass_cleanup_failure';
              const shellQuote = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`;
              fs.writeFileSync(pgRestoreCleanupFailure,
                `#!/bin/sh\nif [ "$1" = "--version" ]; then echo "pg_restore (PostgreSQL) 16.0"; exit 0; fi\nprintf '%s\\n' "$PGPASSFILE" > ${shellQuote(pgpassPathFile)}\nchmod 000 "$(dirname "$PGPASSFILE")"\nexit 9\n`,
                { mode: 0o700 },
              );
              const cleanupFailurePgpassBefore = restorePgpassDirectories();
              let cleanupFailureOutcome: { receipt: unknown } | { error: unknown };
              try {
                cleanupFailureOutcome = await restoreExactBackupToFreshDatabase({
                  ...restoreOptions(manifestIdentity), pgRestoreBinary: pgRestoreCleanupFailure,
                }).then((receipt) => ({ receipt }), (error: unknown) => ({ error }));
              } finally {
                const capturedPgpassPath = fs.readFileSync(pgpassPathFile, 'utf8').trim();
                const capturedPgpassDirectory = path.dirname(capturedPgpassPath);
                fs.chmodSync(capturedPgpassDirectory, 0o700);
                fs.rmSync(capturedPgpassDirectory, { recursive: true, force: true });
              }
              if (!('error' in cleanupFailureOutcome)) throw new Error('cleanup_failure_unexpectedly_returned_restore_receipt');
              const cleanupFailureMessage = cleanupFailureOutcome.error instanceof Error
                ? cleanupFailureOutcome.error.message : String(cleanupFailureOutcome.error);
              restoreFailureStage = 'pgpass_cleanup_error_classification';
              expect(cleanupFailureMessage).toBe('controlled_restore_failed_cleanup_unconfirmed');
              restoreFailureStage = 'pgpass_cleanup_credential_redaction';
              expect(cleanupFailureMessage).not.toContain(required('DB_PASSWORD'));
              restoreFailureStage = 'pgpass_cleanup_session_reuse';
              await expectRestoreAdminSessionBaseline({ allowDiscardedClient: true });
              restoreFailureStage = 'pgpass_cleanup_directory_removal';
              expectNoNewRestorePgpassDirectories(cleanupFailurePgpassBefore);
              restoreFailureStage = 'pgpass_cleanup_fresh_database_absence';
              const afterCleanupFailure = await pools!.admin.query<{ count: string }>(
                `SELECT count(*)::text AS count FROM pg_database WHERE datname LIKE 'ops_restore_%'`,
              );
              expect(afterCleanupFailure.rows[0]?.count).toBe(beforeRestoreDatabases.rows[0]?.count);
            }
            restoreFailureStage = 'stale_artifact_identity';
            await expect(restoreExactBackupToFreshDatabase(restoreOptions({ ...manifestIdentity, providerVersionId: 'stale-provider-version' })))
              .rejects.toThrow();
            const manifest = JSON.parse((await storage.adapter.readManifestForRestore(manifestIdentity)).toString('utf8')) as { archive: { object_key: string } };
            const archivePath = path.join(storage.root, ...manifest.archive.object_key.split('/'));
            const originalArchive = fs.readFileSync(archivePath);
            const corruptedArchive = Buffer.from(originalArchive);
            corruptedArchive[0] = (corruptedArchive[0] ?? 0) ^ 0xff;
            fs.writeFileSync(archivePath, corruptedArchive);
            restoreFailureStage = 'archive_checksum_rejection';
            await expect(restoreExactBackupToFreshDatabase(restoreOptions(manifestIdentity)))
              .rejects.toThrow('restore_archive_checksum_mismatch');
            fs.writeFileSync(archivePath, originalArchive);
            const afterRejectedRestoreDatabases = await pools!.admin.query<{ count: string }>(
              `SELECT count(*)::text AS count FROM pg_database WHERE datname LIKE 'ops_restore_%'`,
            );
            expect(afterRejectedRestoreDatabases.rows[0]?.count).toBe(beforeRestoreDatabases.rows[0]?.count);
            const successfulRestorePgpassBefore = restorePgpassDirectories();
            restoreFailureStage = 'successful_restore_receipt';
            restoreSessionCheckObserver = (activeSessions) => targetSessionCheck.resolve({ activeSessions, atUtc: new Date().toISOString() });
            const receipt = await restoreExactBackupToFreshDatabase(restoreOptions(manifestIdentity, {
              openTargetAdminPool: openDelayedTargetAdminPool,
            }));
            restoreFailureStage = 'successful_restore_session_baseline';
            await expectRestoreAdminSessionBaseline();
            restoreFailureStage = 'successful_restore_pgpass_cleanup';
            expectNoNewRestorePgpassDirectories(successfulRestorePgpassBefore);
            restoreFailureStage = 'successful_restore_database_receipt';
            restoreDatabaseName = receipt.target_database;
            return receipt;
            } catch (error) {
              const errorType = error instanceof Error ? error.name.toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 40) : 'non_error_throwable';
              const safeErrorCode = error instanceof Error && /^[a-z0-9_]{1,100}$/.test(error.message)
                ? error.message : errorType;
              const cause = error instanceof Error && error.cause instanceof Error
                && /^[a-z0-9_]{1,80}$/.test(error.cause.message) ? error.cause.message : undefined;
              restoreFailureCode = `${restoreFailureStage}_${safeErrorCode}${cause ? `_${cause}` : ''}`;
              throw error;
            }
          },
              disposeRestoredDatabase: async (receipt) => {
                restoreDatabaseName = receipt.target_database;
                restoreLifecycle.disposalStartedAtUtc = new Date().toISOString();
                const active = await pools!.admin.query<{ pid: number }>(
                  'SELECT pid FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()', [receipt.target_database],
                );
                if (active.rows.length > 0) throw new Error('restore_target_sessions_active_before_disposal');
                await pools!.admin.query(`DROP DATABASE IF EXISTS "${receipt.target_database}"`);
                const remaining = await pools!.admin.query<{ exists: boolean }>(
                  'SELECT EXISTS (SELECT 1 FROM pg_database WHERE datname = $1) AS exists', [receipt.target_database],
                );
                const remainingSessions = await pools!.admin.query<{ pid: number }>(
                  'SELECT pid FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()', [receipt.target_database],
                );
                if (remaining.rows[0]?.exists || remainingSessions.rows.length > 0) {
                  throw new Error('restore_target_disposal_unconfirmed');
                }
                restoreLifecycle.disposalFinishedAtUtc = new Date().toISOString();
                restoreDatabaseName = '';
              },
          });
          const drillSettled = drillPromise.then(
            () => { restoreLifecycle.restoreDrillSettledAtUtc = new Date().toISOString(); return 'settled' as const; },
            () => { restoreLifecycle.restoreDrillSettledAtUtc = new Date().toISOString(); return 'settled' as const; },
          );
          let raceProofError: unknown;
          try {
            const endRequest = await within(Promise.race([
              targetPoolEndRequested.promise.then((requested) => ({ kind: 'pool-end' as const, requested })),
              drillSettled.then(() => ({ kind: 'drill-settled' as const })),
            ]), 30_000, 'restore_target_pool_end_not_observed');
            if (endRequest.kind !== 'pool-end') {
              throw new Error(`restore_drill_settled_before_target_pool_end:${restoreFailureCode ?? 'unexpected_early_completion'}`);
            }
            const requested = endRequest.requested;
            restoreLifecycle.backendPid = requested.backendPid;
            restoreLifecycle.poolEndRequestedAtUtc = requested.atUtc;
            expect(restoreLifecycle.backendPid).toBeGreaterThan(0);
            if (!delayedTargetDatabaseName) throw new Error('restore_target_database_identity_unobserved');
            concurrentTargetPool = createAdminPool(delayedTargetDatabaseName);
            concurrentTargetClient = await concurrentTargetPool.connect();
            restoreLifecycle.concurrentBackendPid = Number((await concurrentTargetClient.query<{ pid: number }>(
              'SELECT pg_backend_pid() AS pid',
            )).rows[0]?.pid);
            expect(restoreLifecycle.concurrentBackendPid).toBeGreaterThan(0);
            expect(restoreLifecycle.concurrentBackendPid).not.toBe(restoreLifecycle.backendPid);
            allowRestoreSessionProbe.resolve();
            const progress = await within(Promise.race([
              targetSessionCheck.promise.then((observation) => ({ kind: 'session-check' as const, observation })),
              drillSettled.then(() => ({ kind: 'settled' as const })),
            ]), 5000, 'restore_target_drain_progress_unobserved');
            if (progress.kind !== 'session-check') throw new Error('restore_returned_before_target_sessions_drained');
            restoreLifecycle.sessionDrainObservedAtUtc = progress.observation.atUtc;
            expect(progress.observation.activeSessions).toBeGreaterThanOrEqual(2);
            expect(restoreLifecycle.restoreDrillSettledAtUtc).toBeUndefined();
            concurrentTargetClient.release();
            concurrentTargetClient = undefined;
            const closedConcurrentPool = concurrentTargetPool;
            concurrentTargetPool = undefined;
            await closedConcurrentPool.end();
            await waitForDatabaseSessionCount(delayedTargetDatabaseName, 1);
            restoreLifecycle.concurrentSessionClosedAtUtc = new Date().toISOString();
          } catch (error) {
            raceProofError = error;
          } finally {
            allowRestoreSessionProbe.resolve();
            concurrentTargetClient?.release();
            concurrentTargetClient = undefined;
            if (concurrentTargetPool) {
              const closedConcurrentPool = concurrentTargetPool;
              concurrentTargetPool = undefined;
              await closedConcurrentPool.end();
              if (delayedTargetDatabaseName) await waitForDatabaseSessionCount(delayedTargetDatabaseName, 1);
              restoreLifecycle.concurrentSessionClosedAtUtc ??= new Date().toISOString();
            }
            allowTargetPoolSocketClose.resolve();
            restoreSessionCheckObserver = undefined;
          }
          try {
            drill = await drillPromise;
          } catch (error) {
            if (raceProofError) throw raceProofError;
            throw error;
          }
          if (raceProofError) throw raceProofError;
        } catch (error) {
          if (restoreFailureCode) throw new Error(`synthetic_recovery_drill_failed:${restoreFailureCode}`);
          throw error;
        }
        expect(restoreLifecycle.poolEndResolvedAtUtc).toBeDefined();
        expect(restoreLifecycle.clientSocketClosedAtUtc).toBeDefined();
        expect(restoreLifecycle.sessionDrainObservedAtUtc).toBeDefined();
        expect(Date.parse(restoreLifecycle.poolEndResolvedAtUtc!)).toBeLessThanOrEqual(Date.parse(restoreLifecycle.sessionDrainObservedAtUtc!));
        expect(Date.parse(restoreLifecycle.sessionDrainObservedAtUtc!)).toBeLessThanOrEqual(Date.parse(restoreLifecycle.concurrentSessionClosedAtUtc!));
        expect(Date.parse(restoreLifecycle.concurrentSessionClosedAtUtc!)).toBeLessThanOrEqual(Date.parse(restoreLifecycle.clientSocketClosedAtUtc!));
        expect(Date.parse(restoreLifecycle.sessionDrainObservedAtUtc!)).toBeLessThanOrEqual(Date.parse(restoreLifecycle.clientSocketClosedAtUtc!));
        expect(restoreLifecycle.disposalStartedAtUtc).toBeDefined();
        expect(restoreLifecycle.disposalFinishedAtUtc).toBeDefined();
        expect(targetPoolErrors).toEqual([]);
        console.info(`RESTORE_TARGET_LIFECYCLE ${JSON.stringify(restoreLifecycle)}`);
        expect(drill).toMatchObject({
          state: 'complete',
          evidence: { evidence_class: 'synthetic_ci', synthetic_snapshot_to_loss_target_met: true },
          restore_receipt: { state: 'complete', checks: { postgres16_restore: true, postgis: true, migrations_current: true, canonical_grants: true, additional_data: true } },
        });
        expect(drill.evidence.synthetic_snapshot_to_loss_elapsed_ms).toBeGreaterThanOrEqual(0);
        expect(drill.evidence.synthetic_loss_to_restore_elapsed_ms).toBeGreaterThanOrEqual(0);
        expect((await journal.readEvents()).map((event) => event.kind)).toEqual(['attempt_started', 'attempt_finished']);
        const serialized = await persistOperationsRecord(stateDirectory, {
          operations_version: 1, phase: 'recovery_drill', operation_id: drill.operation_id,
          state: drill.state, reason_code: drill.reason_code, started_at_utc: drill.started_at_utc,
          finished_at_utc: drill.finished_at_utc, app_build_sha: drill.app_build_sha, evidence: drill.evidence,
        });
        const evidenceBytes = fs.readFileSync(path.join(stateDirectory, serialized), 'utf8');
        expect(evidenceBytes).not.toContain(marker);
        expect(evidenceBytes).not.toContain(syntheticRolePasswords.backup);
        expect(evidenceBytes).not.toContain(identityFile);
        expect((await pools!.admin.query('SELECT id FROM public.light_points WHERE inventory_number = $1', [marker])).rows).toHaveLength(0);

        const monitoring = evaluateMonitoring({
          nowUtc: new Date().toISOString(), appBuildSha: config.appBuildSha,
          latestRecoveryVerifiedSnapshotAtUtc: drill.restore_receipt.snapshot_started_at_utc,
          latestFinalScheduledBackupFailureAtUtc: null, latestIntegrityFailureAtUtc: null,
          latestRetentionSuccessAtUtc: null, retentionFailureAtUtc: null, eligibleRetentionBacklogSinceUtc: null,
          latestRestoreDrillAtUtc: drill.finished_at_utc, latestRestoreDrillEvidenceClass: 'synthetic_ci', databaseAvailable: true, migrationFailed: false,
        });
        expect(monitoring.every((event) => event.delivery_status === 'not_configured')).toBe(true);
        expect(monitoring).toContainEqual(expect.objectContaining({
          component: 'restore_drill_evidence_missing', severity: 'unknown', measured_value: 'synthetic_ci',
        }));
        expect(monitoring.some((event) => event.component === 'restore_drill_age')).toBe(false);
        expect(monitoring.some((event) => event.component === 'recovery_verified_backup_age' && event.severity === 'critical')).toBe(false);
      } finally {
        allowTargetPoolSocketClose.resolve();
        allowRestoreSessionProbe.resolve();
        restoreSessionCheckObserver = undefined;
        try {
          concurrentTargetClient?.release();
          concurrentTargetClient = undefined;
          if (concurrentTargetPool) {
            const closedConcurrentPool = concurrentTargetPool;
            concurrentTargetPool = undefined;
            await closedConcurrentPool.end();
          }
          if (restoreDatabaseName) await dropRestoreFixture(restoreDatabaseName);
          if (delayedTargetPool) {
            await new Promise<void>((resolve) => setImmediate(resolve));
            expect(targetPoolErrors).toEqual([]);
          }
        } finally {
          try {
            if (delayedTargetPool && targetPoolErrorListener) {
              delayedTargetPool.removeListener('error', targetPoolErrorListener);
              expect(delayedTargetPool.listenerCount('error')).toBe(targetPoolBaselineErrorListenerCount);
            }
          } finally {
            fs.rmSync(stateDirectory, { recursive: true, force: true });
          }
        }
      }
    }, 180_000);

    it('exports one real PG16 snapshot, encrypts a custom archive, and binds its exact migration ledger', async () => {
      const marker = `PHASE_B_BASE_${randomUUID().replaceAll('-', '')}`;
      const lateMarker = `PHASE_B_LATE_${randomUUID().replaceAll('-', '')}`;
      await pools!.admin.query(
        `INSERT INTO public.light_points (inventory_number, geom, address)
         VALUES ($1, ST_SetSRID(ST_MakePoint(21.25, 48.72), 4326), 'synthetic pre-snapshot row')`, [marker],
      );
      const snapshotReady = deferred<{ backendPid: number; snapshotId: string }>();
      const releaseSnapshot = deferred();
      const storage = createStorage();
      const runPromise = run(storage.adapter, {
        hooks: { afterSnapshot: async (snapshot) => { snapshotReady.resolve(snapshot); await releaseSnapshot.promise; } },
      });
      const snapshot = await snapshotReady.promise;
      await pools!.admin.query(
        `INSERT INTO public.light_points (inventory_number, geom, address)
         VALUES ($1, ST_SetSRID(ST_MakePoint(21.26, 48.73), 4326), 'synthetic post-snapshot row')`, [lateMarker],
      );
      releaseSnapshot.resolve();
      const result = await runPromise;
      expect(result).toMatchObject({ state: 'complete', exit_code: 0, reason_code: 'producer_pipeline_complete' });
      expect(snapshot.backendPid).toBeGreaterThan(0);
      expect(snapshot.snapshotId).toMatch(/^[0-9A-F]+-[0-9A-F]+-[0-9]+$/i);
      expect(result.snapshot_started_at).toMatch(/Z$/);
      expect(result.migration_ledger).toEqual(await pools!.admin.query(
        'SELECT version, name, checksum FROM public.schema_migrations ORDER BY version',
      ).then(({ rows }) => rows));
      expect(result.manifest_id).toMatch(new RegExp(`^backups/v1/runs/${result.run_id}/manifest\\.json$`));
      expect(result.archive_encrypted_bytes).toBeGreaterThan(0);
      expect(result.archive_encrypted_sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(storage.adapter.events.indexOf(`verified:backups/v1/runs/${result.run_id}/database.pgdump.age`))
        .toBeLessThan(storage.adapter.events.findIndex((event) => event.startsWith('published-manifest:')));

      const restored = await restoreToDisposableDatabase(storage.root, result.manifest_id!);
      try {
        const restoredLedger = await restored.database.query('SELECT version, name, checksum FROM public.schema_migrations ORDER BY version');
        expect(restoredLedger.rows).toEqual(result.migration_ledger);
        const restoredMarkers = await restored.database.query(
          'SELECT inventory_number FROM public.light_points WHERE inventory_number = ANY($1::text[]) ORDER BY inventory_number',
          [[marker, lateMarker]],
        );
        expect(restoredMarkers.rows).toEqual([{ inventory_number: marker }]);

        const manifestPath = path.join(storage.root, ...result.manifest_id!.split('/'));
        const manifestText = fs.readFileSync(manifestPath, 'utf8');
        const manifest = JSON.parse(manifestText) as {
          run_id: string;
          source: { migration_ledger: unknown[]; logical_database_id: string };
          archive: { object_key: string; encrypted_sha256: string; encrypted_bytes: number; provider_checksum: { value: string } };
          encryption: { recipient_key_ids: string[]; private_identity_available_to_writer: boolean };
          completion_state: string;
        };
        expect(manifest).toMatchObject({ run_id: result.run_id, completion_state: 'complete' });
        expect(manifest.source.migration_ledger).toEqual(result.migration_ledger);
        expect(manifest.source.logical_database_id).toBe('phase-b-disposable-ci-database');
        expect(manifest.archive.encrypted_sha256).toBe(result.archive_encrypted_sha256);
        expect(manifest.archive.encrypted_bytes).toBe(result.archive_encrypted_bytes);
        expect(manifest.archive.provider_checksum.value).toBe(result.archive_encrypted_sha256);
        expect(manifest.encryption.recipient_key_ids).toEqual([config.recipientKeyId]);
        expect(manifest.encryption.private_identity_available_to_writer).toBe(false);
        expect(manifestText).not.toContain(syntheticRolePasswords.backup);
        expect(manifestText).not.toContain(marker);
        expect(JSON.stringify(result)).not.toContain(syntheticRolePasswords.backup);

        const archivePath = path.join(storage.root, ...manifest.archive.object_key.split('/'));
        const wrongKey = spawnSync('age', ['--decrypt', '--identity', wrongIdentityFile, archivePath], {
          encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'], maxBuffer: 4096,
        });
        expect(wrongKey.error).toBeUndefined();
        expect(wrongKey.status).not.toBe(0);
        const truncatedPath = path.join(backupRoot, 'truncated.pgdump.age');
        fs.copyFileSync(archivePath, truncatedPath);
        fs.truncateSync(truncatedPath, Math.max(1, fs.statSync(truncatedPath).size - 8));
        const truncated = spawnSync('age', ['--decrypt', '--identity', identityFile, truncatedPath], {
          encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'], maxBuffer: 4096,
        });
        expect(truncated.error).toBeUndefined();
        expect(truncated.status).not.toBe(0);
        expect(fs.readdirSync(path.join(storage.root, '.incoming'))).toHaveLength(0);
        expect(fs.readdirSync(storage.root, { recursive: true }).some((name) => String(name).endsWith('.pgdump'))).toBe(false);
      } finally {
        await restored.database.end();
        await dropDatabaseAfterSessionsClose(restored.databaseName);
      }
    }, 120_000);

    it('fails before creating storage when the snapshot migration ledger is not readable', async () => {
      const storage = createStorage();
      await pools!.admin.query('REVOKE SELECT ON public.schema_migrations FROM lighting_backup');
      try {
        const result = await run(storage.adapter);
        expect(result).toMatchObject({ state: 'incomplete', exit_code: 1, reason_code: 'backup_pipeline_failed' });
        expect(result.migration_ledger).toBeUndefined();
        expect(storage.adapter.events).toEqual([]);
      } finally {
        await pools!.admin.query('GRANT SELECT ON public.schema_migrations TO lighting_backup');
      }
    }, 30_000);

    it('blocks backup before snapshot when the canonical migration session owns the barrier', async () => {
      const owner = await pools!.migration.connect();
      const storage = createStorage();
      let snapshotHookCalled = false;
      try {
        await owner.query('SELECT pg_advisory_lock($1, $2)', [MIGRATION_ADVISORY_LOCK.namespace, MIGRATION_ADVISORY_LOCK.key]);
        const result = await run(storage.adapter, { hooks: { afterSnapshot: () => { snapshotHookCalled = true; } } });
        expect(result).toMatchObject({ state: 'blocked_by_migration', exit_code: 11, reason_code: 'migration_barrier_busy' });
        expect(result.snapshot_started_at).toBeUndefined();
        expect(snapshotHookCalled).toBe(false);
        expect(storage.adapter.events).toEqual([]);
      } finally {
        await owner.query('SELECT pg_advisory_unlock($1, $2)', [MIGRATION_ADVISORY_LOCK.namespace, MIGRATION_ADVISORY_LOCK.key]).catch(() => undefined);
        owner.release();
      }
    }, 30_000);

    it('holds the migration barrier during a backpressured real pg_dump and releases it before remote finalization', async () => {
      const fixtureTable = `phase_b_lock_dump_${process.pid}`;
      await pools!.admin.query(`CREATE TABLE public.${fixtureTable} (id integer PRIMARY KEY, payload text NOT NULL)`);
      await pools!.admin.query(`GRANT SELECT ON public.${fixtureTable} TO lighting_backup`);
      await pools!.admin.query(
        `INSERT INTO public.${fixtureTable} (id, payload)
         SELECT generated.id, string_agg(md5(random()::text || generated.id::text || chunks.part::text), '')
           FROM generate_series(1, 8192) AS generated(id)
           CROSS JOIN generate_series(1, 128) AS chunks(part)
          GROUP BY generated.id`,
      );
      const uploadPaused = deferred();
      const releaseUpload = deferred();
      const barrierReleased = deferred();
      const releaseBarrierHook = deferred();
      const finalizePaused = deferred();
      const releaseFinalize = deferred();
      const storage = createStorage({
        beforeFirstArchiveWrite: async () => { uploadPaused.resolve(); await releaseUpload.promise; },
        beforeArchiveFinalize: async () => { finalizePaused.resolve(); await releaseFinalize.promise; },
      });
      const runPromise = run(storage.adapter, {
        hooks: { afterMigrationBarrierRelease: async () => { barrierReleased.resolve(); await releaseBarrierHook.promise; } },
      });
      let migrationProbe: pg.PoolClient | undefined;
      try {
        await uploadPaused.promise;
        let activeDumpCount = 0;
        const activeDumpDeadline = Date.now() + 5000;
        while (activeDumpCount === 0 && Date.now() < activeDumpDeadline) {
          const activeDump = await pools!.admin.query<{ count: string }>(
            `SELECT count(*)::text AS count FROM pg_stat_activity
              WHERE datname = $1 AND application_name LIKE 'lighting-backup-%' AND state = 'active'`, [pools!.databaseName],
          );
          activeDumpCount = Number(activeDump.rows[0]?.count ?? 0);
          if (activeDumpCount === 0) await delay(25);
        }
        expect(activeDumpCount).toBeGreaterThan(0);
        migrationProbe = await pools!.migration.connect();
        const lockedDuringDump = await migrationProbe.query<{ locked: boolean }>(
          'SELECT pg_try_advisory_lock($1, $2) AS locked', [MIGRATION_ADVISORY_LOCK.namespace, MIGRATION_ADVISORY_LOCK.key],
        );
        expect(lockedDuringDump.rows[0]?.locked).toBe(false);

        releaseUpload.resolve();
        await barrierReleased.promise;
        const lockAfterDump = await migrationProbe.query<{ locked: boolean }>(
          'SELECT pg_try_advisory_lock($1, $2) AS locked', [MIGRATION_ADVISORY_LOCK.namespace, MIGRATION_ADVISORY_LOCK.key],
        );
        expect(lockAfterDump.rows[0]?.locked).toBe(true);
        await migrationProbe.query('SELECT pg_advisory_unlock($1, $2)', [MIGRATION_ADVISORY_LOCK.namespace, MIGRATION_ADVISORY_LOCK.key]);
        releaseBarrierHook.resolve();
        await finalizePaused.promise;
        const secondStorage = createStorage();
        const overlapping = await run(secondStorage.adapter);
        expect(overlapping).toMatchObject({ state: 'skipped_overlapping', exit_code: 10, reason_code: 'backup_already_running' });
        expect(secondStorage.adapter.events).toEqual([]);
        expect(storage.adapter.events.some((event) => event.startsWith('published-manifest:'))).toBe(false);
        releaseFinalize.resolve();
        expect((await runPromise).state).toBe('complete');
      } finally {
        releaseUpload.resolve();
        releaseBarrierHook.resolve();
        releaseFinalize.resolve();
        migrationProbe?.release();
        await runPromise.catch(() => undefined);
        await pools!.admin.query(`DROP TABLE IF EXISTS public.${fixtureTable}`);
      }
    }, 120_000);

    it('enforces backup-backup exclusion and releases both locks after cancellation and timeout', async () => {
      const snapshotReady = deferred();
      const releaseSnapshot = deferred();
      const firstStorage = createStorage();
      const firstRun = run(firstStorage.adapter, {
        hooks: { afterSnapshot: async () => { snapshotReady.resolve(); await releaseSnapshot.promise; } },
      });
      await snapshotReady.promise;
      const secondStorage = createStorage();
      const overlapping = await run(secondStorage.adapter);
      expect(overlapping).toMatchObject({ state: 'skipped_overlapping', exit_code: 10 });
      expect(secondStorage.adapter.events).toEqual([]);
      releaseSnapshot.resolve();
      expect((await firstRun).state).toBe('complete');

      const controller = new AbortController();
      const dumpStarted = deferred();
      const releaseDumpHook = deferred();
      const cancelStorage = createStorage();
      const cancelledRun = run(cancelStorage.adapter, {
        signal: controller.signal,
        hooks: { afterDumpSpawn: () => { dumpStarted.resolve(); return releaseDumpHook.promise; } },
      });
      await dumpStarted.promise;
      controller.abort(new Error('synthetic SIGTERM test'));
      releaseDumpHook.resolve();
      expect(await cancelledRun).toMatchObject({ state: 'incomplete', reason_code: 'termination_requested' });
      expect(cancelStorage.adapter.events.some((event) => event.startsWith('published-manifest:'))).toBe(false);
      expect(fs.readdirSync(path.join(cancelStorage.root, '.incoming'))).toHaveLength(0);
      const childCount = await pools!.admin.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM pg_stat_activity
          WHERE datname = $1 AND application_name LIKE 'lighting-backup-%'`, [pools!.databaseName],
      );
      expect(Number(childCount.rows[0]?.count)).toBe(0);

      const timeoutReady = deferred();
      const timeoutStorage = createStorage();
      const timedOutRun = run(timeoutStorage.adapter, {
        overrides: { maxSnapshotLifetimeMs: 50 },
        hooks: { afterSnapshot: async () => { timeoutReady.resolve(); await new Promise<void>(() => undefined); } },
      });
      await timeoutReady.promise;
      expect(await timedOutRun).toMatchObject({ state: 'incomplete', reason_code: 'snapshot_max_lifetime_exceeded' });

      const lockCheck = await pools!.migration.connect();
      try {
        const barrier = await lockCheck.query<{ locked: boolean }>(
          'SELECT pg_try_advisory_lock($1, $2) AS locked', [MIGRATION_ADVISORY_LOCK.namespace, MIGRATION_ADVISORY_LOCK.key],
        );
        const backup = await lockCheck.query<{ locked: boolean }>(
          'SELECT pg_try_advisory_lock($1, $2) AS locked', [BACKUP_ADVISORY_LOCK.namespace, BACKUP_ADVISORY_LOCK.key],
        );
        expect(barrier.rows[0]?.locked).toBe(true);
        expect(backup.rows[0]?.locked).toBe(true);
        await lockCheck.query('SELECT pg_advisory_unlock_all()');
      } finally { lockCheck.release(); }
    }, 120_000);

    it.skipIf(process.platform === 'win32')('bounds a stalled storage create by the snapshot deadline and releases the PG transaction and locks', async () => {
      const createStarted = deferred();
      const lateCreate = deferred();
      let exporterPid: number | undefined;
      const storage = createStorage({ beforeArchiveCreate: () => { createStarted.resolve(); return lateCreate.promise; } });
      const unspawnedDumpMarker = path.join(backupRoot, 'pg-dump-must-not-start-on-create-timeout');
      const fakeDump = path.join(backupRoot, 'pg-dump-timeout-probe');
      fs.writeFileSync(fakeDump, [
        '#!/usr/bin/env node',
        "if (process.argv.includes('--version')) { process.stdout.write('pg_dump (PostgreSQL) 16.8\\n'); process.exit(0); }",
        `require('node:fs').writeFileSync(${JSON.stringify(unspawnedDumpMarker)}, 'started');`,
        "process.stdin.resume();",
        '',
      ].join('\n'), { mode: 0o700, flag: 'wx' });
      fs.chmodSync(fakeDump, 0o700);
      const startedAt = Date.now();
      const runPromise = run(storage.adapter, {
        overrides: { maxSnapshotLifetimeMs: 1500, pgDumpBinary: fakeDump },
        hooks: { afterSnapshot: ({ backendPid }) => { exporterPid = backendPid; } },
      });
      await Promise.race([createStarted.promise, delay(5000).then(() => { throw new Error('storage_create_did_not_start'); })]);
      const result = await runPromise;
      const elapsedMs = Date.now() - startedAt;
      expect(result).toMatchObject({ state: 'incomplete', exit_code: 1, reason_code: 'snapshot_max_lifetime_exceeded' });
      expect(elapsedMs).toBeLessThan(5000);
      expect(result.manifest_id).toBeUndefined();
      expect(storage.adapter.events).toEqual([]);
      expect(fs.existsSync(unspawnedDumpMarker)).toBe(false);
      expect(fs.readdirSync(path.join(storage.root, '.incoming'))).toHaveLength(0);
      const transaction = await pools!.admin.query<{ xact_start: Date | null }>(
        'SELECT xact_start FROM pg_stat_activity WHERE pid = $1', [exporterPid],
      );
      expect(transaction.rows).toEqual([{ xact_start: null }]);
      const child = await pools!.admin.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM pg_stat_activity
          WHERE datname = $1 AND application_name LIKE 'lighting-backup-%'`, [pools!.databaseName],
      );
      expect(Number(child.rows[0]?.count)).toBe(0);
      await expectBothBackupLocksAvailable();

      // Resolving the abandoned test hook after timeout must not create or trust an artifact.
      lateCreate.resolve();
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(result.state).toBe('incomplete');
      expect(storage.adapter.events).toEqual([]);
      expect(fs.readdirSync(path.join(storage.root, '.incoming'))).toHaveLength(0);
      expect(fs.existsSync(path.join(storage.root, 'backups', 'v1', 'runs', result.run_id, 'database.pgdump.age'))).toBe(false);
      expect(fs.existsSync(path.join(storage.root, 'backups', 'v1', 'runs', result.run_id, 'manifest.json'))).toBe(false);
    }, 30_000);

    it('cancels a stalled storage create promptly and releases the exporter session and both advisory locks', async () => {
      const createStarted = deferred();
      const lateCreate = deferred();
      let exporterPid: number | undefined;
      const controller = new AbortController();
      const storage = createStorage({ beforeArchiveCreate: () => { createStarted.resolve(); return lateCreate.promise; } });
      const unspawnedDumpMarker = path.join(backupRoot, 'pg-dump-must-not-start-on-create-cancellation');
      const fakeDump = path.join(backupRoot, 'pg-dump-cancel-probe');
      fs.writeFileSync(fakeDump, [
        '#!/usr/bin/env node',
        "if (process.argv.includes('--version')) { process.stdout.write('pg_dump (PostgreSQL) 16.8\\n'); process.exit(0); }",
        `require('node:fs').writeFileSync(${JSON.stringify(unspawnedDumpMarker)}, 'started');`,
        "process.stdin.resume();",
        '',
      ].join('\n'), { mode: 0o700, flag: 'wx' });
      fs.chmodSync(fakeDump, 0o700);
      const startedAt = Date.now();
      const runPromise = run(storage.adapter, {
        signal: controller.signal,
        overrides: { pgDumpBinary: fakeDump },
        hooks: { afterSnapshot: ({ backendPid }) => { exporterPid = backendPid; } },
      });
      await Promise.race([createStarted.promise, delay(5000).then(() => { throw new Error('storage_create_did_not_start'); })]);
      controller.abort(new Error('synthetic storage-create cancellation'));
      const result = await runPromise;
      expect(result).toMatchObject({ state: 'incomplete', exit_code: 1, reason_code: 'termination_requested' });
      expect(Date.now() - startedAt).toBeLessThan(3000);
      expect(result.manifest_id).toBeUndefined();
      expect(storage.adapter.events).toEqual([]);
      expect(fs.existsSync(unspawnedDumpMarker)).toBe(false);
      expect(fs.readdirSync(path.join(storage.root, '.incoming'))).toHaveLength(0);
      const transaction = await pools!.admin.query<{ xact_start: Date | null }>(
        'SELECT xact_start FROM pg_stat_activity WHERE pid = $1', [exporterPid],
      );
      expect(transaction.rows).toEqual([{ xact_start: null }]);
      const child = await pools!.admin.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM pg_stat_activity
          WHERE datname = $1 AND application_name LIKE 'lighting-backup-%'`, [pools!.databaseName],
      );
      expect(Number(child.rows[0]?.count)).toBe(0);
      await expectBothBackupLocksAvailable();
      lateCreate.resolve();
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(storage.adapter.events).toEqual([]);
      expect(fs.existsSync(path.join(storage.root, 'backups', 'v1', 'runs', result.run_id, 'manifest.json'))).toBe(false);
    }, 30_000);

    it('rejects a successful age preflight that consumes the dump but emits zero ciphertext', async () => {
      const emptyAge = path.join(backupRoot, 'age-empty-ciphertext');
      fs.writeFileSync(emptyAge, [
        '#!/usr/bin/env node',
        "if (process.argv.includes('--version')) { process.stdout.write('v1.3.2\\n'); process.exit(0); }",
        "process.stdin.on('data', () => {});",
        "process.stdin.on('end', () => process.exit(0));",
        'process.stdin.resume();',
        '',
      ].join('\n'), { mode: 0o700, flag: 'wx' });
      fs.chmodSync(emptyAge, 0o700);
      const storage = createStorage();
      const result = await run(storage.adapter, { overrides: { ageBinary: emptyAge } });
      expect(result).toMatchObject({ state: 'incomplete', exit_code: 1, reason_code: 'encrypted_archive_empty' });
      expect(result.archive_encrypted_bytes).toBeUndefined();
      expect(result.manifest_id).toBeUndefined();
      expect(storage.adapter.events.some((event) => event.startsWith('finalized:'))).toBe(false);
      expect(storage.adapter.events.some((event) => event.startsWith('published-manifest:'))).toBe(false);
      expect(fs.readdirSync(path.join(storage.root, '.incoming'))).toHaveLength(0);
      await expectBothBackupLocksAvailable();
    }, 120_000);

    it('discards a pool client after migration-lock unlock failure and the server releases both session locks', async () => {
      const failedPool = poolFailingOneUnlock(MIGRATION_ADVISORY_LOCK.key);
      const storage = createStorage();
      const result = await run(storage.adapter, { pool: failedPool.pool });
      expect(result).toMatchObject({
        state: 'incomplete', exit_code: 1, reason_code: 'migration_lock_release_failed',
        cleanup_error_code: 'migration_lock_release_failed',
      });
      expect(result.manifest_id).toBeUndefined();
      expect(failedPool.releaseError).toBe('backup_database_lock_cleanup_failed');
      await expectBackendClosed(failedPool.backendPid);
      expect(storage.adapter.events.some((event) => event.startsWith('published-manifest:'))).toBe(false);
      await expectBothBackupLocksAvailable();
      await expectBackupPoolDoesNotReuseDiscardedClient(failedPool.backendPid);
    }, 120_000);

    it('discards a pool client after backup-lock unlock failure and never returns a false complete result', async () => {
      const failedPool = poolFailingOneUnlock(BACKUP_ADVISORY_LOCK.key);
      const storage = createStorage();
      const result = await run(storage.adapter, { pool: failedPool.pool });
      expect(result).toMatchObject({
        state: 'incomplete', exit_code: 1, reason_code: 'database_lock_cleanup_failed',
        cleanup_error_code: 'backup_lock_release_failed',
      });
      expect(result.manifest_id).toBeUndefined();
      // The immutable manifest was already published before the final unlock was attempted.
      // Its backup bytes are valid, but the run result does not claim clean lock finalization.
      expect(storage.adapter.events.some((event) => event.startsWith('published-manifest:'))).toBe(true);
      expect(failedPool.releaseError).toBe('backup_database_lock_cleanup_failed');
      await expectBackendClosed(failedPool.backendPid);
      await expectBothBackupLocksAvailable();
      await expectBackupPoolDoesNotReuseDiscardedClient(failedPool.backendPid);
    }, 120_000);

    it('preserves a producer failure when backup-lock cleanup also fails', async () => {
      const failedPool = poolFailingOneUnlock(BACKUP_ADVISORY_LOCK.key);
      const storage = createStorage({ failArchiveFinalize: true });
      const result = await run(storage.adapter, { pool: failedPool.pool });
      expect(result).toMatchObject({
        state: 'incomplete', reason_code: 'backup_pipeline_failed',
        cleanup_error_code: 'backup_lock_release_failed',
      });
      expect(result.manifest_id).toBeUndefined();
      expect(failedPool.releaseError).toBe('backup_database_lock_cleanup_failed');
      await expectBackendClosed(failedPool.backendPid);
      await expectBothBackupLocksAvailable();
      await expectBackupPoolDoesNotReuseDiscardedClient(failedPool.backendPid);
    }, 120_000);

    it('fails visibly for future ungranted tables and never publishes a manifest on pipeline failures', async () => {
      const futureTable = `phase_b_future_ungranted_${process.pid}`;
      await pools!.admin.query(`CREATE TABLE public.${futureTable} (id integer PRIMARY KEY)`);
      try {
        const storage = createStorage();
        const result = await run(storage.adapter);
        expect(result).toMatchObject({ state: 'incomplete', reason_code: 'pg_dump_failed' });
        expect(storage.adapter.events.some((event) => event.startsWith('published-manifest:'))).toBe(false);
      } finally {
        await pools!.admin.query(`DROP TABLE IF EXISTS public.${futureTable}`);
      }

      const failures = [
        { reason: 'upload write', hooks: { failArchiveAfterBytes: 32 }, expected: 'backup_pipeline_failed' },
        { reason: 'archive finalize', hooks: { failArchiveFinalize: true }, expected: 'backup_pipeline_failed' },
        { reason: 'ambiguous archive finalize', hooks: { failAfterArchiveFinalize: true }, expected: 'backup_pipeline_failed' },
        { reason: 'remote object mismatch', hooks: { corruptBeforeArchiveVerify: true }, expected: 'remote_archive_integrity_mismatch' },
        { reason: 'manifest publish', hooks: { failManifestPublish: true }, expected: 'backup_pipeline_failed' },
      ] as const;
      for (const failure of failures) {
        const storage = createStorage(failure.hooks);
        const result = await run(storage.adapter);
        expect(result.state, failure.reason).toBe('incomplete');
        expect(result.reason_code, failure.reason).toBe(failure.expected);
        expect(result.manifest_id, failure.reason).toBeUndefined();
        expect(storage.adapter.events.some((event) => event.startsWith('published-manifest:')), failure.reason).toBe(false);
        expect(fs.readdirSync(path.join(storage.root, '.incoming')), failure.reason).toHaveLength(0);
      }
    }, 120_000);

    it('propagates nonzero pg_dump and age child exits without leaking child stderr or publishing a manifest', async () => {
      function failingTestExecutable(name: string, versionOutput: string): string {
        const executable = path.join(backupRoot, name);
        fs.writeFileSync(executable, [
          '#!/usr/bin/env node',
          `if (process.argv.includes('--version')) { process.stdout.write(${JSON.stringify(versionOutput)} + '\\n'); process.exit(0); }`,
          "process.stderr.write('synthetic-secret-child-diagnostic'); process.exit(17);",
          '',
        ].join('\n'), { mode: 0o700, flag: 'wx' });
        fs.chmodSync(executable, 0o700);
        return executable;
      }

      const fakeDumpBinary = failingTestExecutable('failing-pg-dump', 'pg_dump (PostgreSQL) 16.8');
      const dumpStorage = createStorage();
      const dumpFailure = await run(dumpStorage.adapter, { overrides: { pgDumpBinary: fakeDumpBinary } });
      expect(dumpFailure).toMatchObject({ state: 'incomplete', reason_code: 'pg_dump_failed' });
      expect(JSON.stringify(dumpFailure)).not.toContain('synthetic-secret-child-diagnostic');
      expect(dumpStorage.adapter.events.some((event) => event.startsWith('published-manifest:'))).toBe(false);

      const fakeAgeBinary = failingTestExecutable('failing-age', 'v1.3.2');
      const ageStorage = createStorage();
      const ageFailure = await run(ageStorage.adapter, { overrides: { ageBinary: fakeAgeBinary } });
      expect(ageFailure).toMatchObject({ state: 'incomplete', reason_code: 'age_encrypt_failed' });
      expect(JSON.stringify(ageFailure)).not.toContain('synthetic-secret-child-diagnostic');
      expect(ageStorage.adapter.events.some((event) => event.startsWith('published-manifest:'))).toBe(false);
    }, 120_000);

    it('reports a fresh attempt ID after a failed run and aborts on exporter connection loss', async () => {
      const failedStorage = createStorage({ failArchiveFinalize: true });
      const failed = await run(failedStorage.adapter);
      const retryStorage = createStorage();
      const retry = await run(retryStorage.adapter);
      expect(failed.run_id).not.toBe(retry.run_id);
      expect(retry.state).toBe('complete');

      const disconnected = deferred<number>();
      const releaseHook = deferred();
      const disconnectStorage = createStorage();
      const disconnectRun = run(disconnectStorage.adapter, {
        hooks: { afterSnapshot: async ({ backendPid }) => { disconnected.resolve(backendPid); await releaseHook.promise; } },
      });
      const backendPid = await disconnected.promise;
      await pools!.admin.query('SELECT pg_terminate_backend($1)', [backendPid]);
      releaseHook.resolve();
      const disconnectedResult = await disconnectRun;
      expect(disconnectedResult.state).toBe('incomplete');
      expect(disconnectStorage.adapter.events.some((event) => event.startsWith('published-manifest:'))).toBe(false);
      const lockCheck = await pools!.migration.connect();
      try {
        const barrier = await lockCheck.query<{ locked: boolean }>(
          'SELECT pg_try_advisory_lock($1, $2) AS locked', [MIGRATION_ADVISORY_LOCK.namespace, MIGRATION_ADVISORY_LOCK.key],
        );
        expect(barrier.rows[0]?.locked).toBe(true);
        await lockCheck.query('SELECT pg_advisory_unlock_all()');
      } finally { lockCheck.release(); }
    }, 120_000);
  }, 120_000);
});
