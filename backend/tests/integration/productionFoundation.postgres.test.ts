import fs from 'node:fs';
import path from 'node:path';
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
};
const reservedRoleNames = ['lighting_migrator', 'lighting_runtime', 'lighting_bootstrap'];

type TestPools = {
  admin: pg.Pool;
  migration: pg.Pool;
  runtime: pg.Pool;
  bootstrap: pg.Pool;
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

describe.skipIf(!enabled)('production database-role and first-admin foundation', () => {
  beforeAll(async () => {
    const configuredDatabase = required('DB_NAME');
    if (!configuredDatabase.endsWith('_test')) {
      throw new Error('Production-foundation integration may run only when DB_NAME ends with _test.');
    }
    const databaseName = `lighting_pf_${process.pid}_${Math.random().toString(36).slice(2, 8)}`;
    const maintenance = createAdminPool('postgres');
    const roles = reservedRoleNames;
    let applicationRolesProvisioned = false;
    try {
      const existingRoles = await maintenance.query<{ rolname: string }>(
        'SELECT rolname FROM pg_roles WHERE rolname = ANY($1::text[])', [roles]
      );
      if (existingRoles.rows.length > 0) {
        throw new Error('Refusing to modify pre-existing production role names in the test cluster.');
      }
      await maintenance.query(initialProvisioningSql);
      applicationRolesProvisioned = true;
      await maintenance.query(`ALTER ROLE lighting_migrator PASSWORD '${syntheticRolePasswords.migrator}'`);
      await maintenance.query(`ALTER ROLE lighting_runtime PASSWORD '${syntheticRolePasswords.runtime}'`);
      await maintenance.query(`ALTER ROLE lighting_bootstrap PASSWORD '${syntheticRolePasswords.bootstrap}'`);
      await maintenance.query(`CREATE DATABASE ${databaseName}`);
    } catch (error) {
      try {
        if (applicationRolesProvisioned) {
          await maintenance.query(`DROP DATABASE IF EXISTS ${databaseName} WITH (FORCE)`);
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
