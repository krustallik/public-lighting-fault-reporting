import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { PassThrough } from 'node:stream';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
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
    const databaseName = `lighting_pf_${process.pid}_${Math.random().toString(36).slice(2, 8)}`;
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
      await maintenance.query(`ALTER ROLE lighting_backup PASSWORD '${syntheticRolePasswords.backup}'`);
      await maintenance.query(`ALTER ROLE lighting_retention PASSWORD '${syntheticRolePasswords.retention}'`);
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
      await pools.admin.query(maintenanceGrantSql);
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

  it('reapplication removes stale retention DELETE grants from every current public table', async () => {
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
    expect(after.rows).toEqual([]);

    // Reapplying restores the narrow eligibility-read allowlist after stale grants are removed.
    await expect(pools!.retention.query('SELECT id, created_at FROM public.admin_activity_logs LIMIT 0'))
      .resolves.toMatchObject({ rows: [] });
    await expect(pools!.retention.query('SELECT batch_id, outcome FROM public.import_batch_rows LIMIT 0'))
      .resolves.toMatchObject({ rows: [] });
    await expect(pools!.retention.query('DELETE FROM public.import_batches WHERE false'))
      .rejects.toMatchObject({ code: '42501' });
  });

  it('keeps retention read-only with narrowly scoped eligibility columns', async () => {
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

    const deniedDeletes = [
      ['fresh admin activity', 'DELETE FROM public.admin_activity_logs WHERE id = $1', activity.rows[0].id],
      ['old admin activity', 'DELETE FROM public.admin_activity_logs WHERE id = $1', oldActivity.rows[0].id],
      ['fresh inventory audit event', 'DELETE FROM public.inventory_audit_events WHERE id = $1', audit.rows[0].id],
      ['old inventory audit event', 'DELETE FROM public.inventory_audit_events WHERE id = $1', oldAudit.rows[0].id],
      ['old completed import batch', 'DELETE FROM public.import_batches WHERE id = $1', batch.rows[0].id],
      ['young nonterminal import batch', 'DELETE FROM public.import_batches WHERE id = $1', queuedBatch.rows[0].id],
      ['expired refresh session', 'DELETE FROM public.admin_refresh_sessions WHERE id = $1', expiredSession.rows[0].id],
      ['unexpired refresh session', 'DELETE FROM public.admin_refresh_sessions WHERE id = $1', activeSession.rows[0].id],
      ['pending import child row', 'DELETE FROM public.import_batch_rows WHERE id = $1', child.rows[0].id],
    ] as const;
    for (const [description, statement, id] of deniedDeletes) {
      await expect(pools!.retention.query(statement, [id]), description)
        .rejects.toMatchObject({ code: '42501' });
    }

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

  it('denies retention mutation of inventory, admins, migration metadata, and integration_logs', async () => {
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
});
