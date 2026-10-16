import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createBootstrapPool } from '../../src/db/bootstrapPool.js';
import { createMigrationPool } from '../../src/db/migrationPool.js';

const roots: string[] = [];

async function tempSecret(value: string): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'pool-config-test-'));
  roots.push(root);
  const filename = path.join(root, 'password');
  await writeFile(filename, value, { flag: 'wx' });
  return filename;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('dedicated bootstrap and migration pool configuration', () => {
  it('accepts only the development DB contract and handles its exclusive secret sources', async () => {
    const base = { NODE_ENV: 'test', DB_HOST: '127.0.0.1', DB_PORT: '5432', DB_NAME: 'lighting_test', DB_USER: 'ci_test' };
    const direct = createMigrationPool({ ...base, DB_PASSWORD: 'synthetic-direct' });
    expect(direct.options.application_name).toBe('lighting-migration-dev');
    await direct.end();

    const passwordFile = await tempSecret('synthetic-file\n');
    const file = createMigrationPool({ ...base, DB_PASSWORD_FILE: passwordFile });
    expect(file.options.password).toBe('synthetic-file');
    await file.end();

    expect(() => createMigrationPool({ ...base, DB_PASSWORD: 'direct', DB_PASSWORD_FILE: passwordFile }))
      .toThrow('Set either DB_PASSWORD or DB_PASSWORD_FILE.');
    expect(() => createMigrationPool({ ...base, DB_PASSWORD_FILE: path.join(os.tmpdir(), 'missing-pool-secret') }))
      .toThrow('DB_PASSWORD_FILE could not be read.');
    expect(() => createMigrationPool({ ...base, DB_PASSWORD: '' })).toThrow('DB_PASSWORD is required.');
  });

  it('requires the restricted production migration identity and validates port boundaries', async () => {
    const production = {
      NODE_ENV: 'production', MIGRATION_DB_HOST: '127.0.0.1', MIGRATION_DB_PORT: '5432',
      MIGRATION_DB_NAME: 'lighting_test', MIGRATION_DB_USER: 'lighting_migrator', MIGRATION_DB_PASSWORD: 'synthetic-migration',
    };
    const pool = createMigrationPool(production);
    expect(pool.options.application_name).toBe('lighting-migrator');
    await pool.end();

    expect(() => createMigrationPool({ ...production, MIGRATION_DB_USER: 'postgres' }))
      .toThrow('MIGRATION_DB_USER must be the lighting_migrator role.');
    expect(() => createMigrationPool({ ...production, MIGRATION_DB_PORT: '65536' }))
      .toThrow('MIGRATION_DB_PORT is invalid.');
    expect(() => createMigrationPool({ ...production, MIGRATION_DB_PORT: 'invalid' }))
      .toThrow('MIGRATION_DB_PORT is invalid.');
    expect(() => createMigrationPool({ ...production, MIGRATION_DB_NAME: '' }))
      .toThrow('MIGRATION_DB_NAME is required for the controlled migration process.');
  });

  it('restricts bootstrap pool creation to its dedicated role and validates the secret file', async () => {
    const base = {
      BOOTSTRAP_DB_HOST: '127.0.0.1', BOOTSTRAP_DB_PORT: '5432',
      BOOTSTRAP_DB_NAME: 'lighting_test', BOOTSTRAP_DB_USER: 'lighting_bootstrap',
    };
    const direct = createBootstrapPool({ ...base, BOOTSTRAP_DB_PASSWORD: 'synthetic-bootstrap' });
    expect(direct.options.application_name).toBe('lighting-bootstrap-admin');
    await direct.end();

    const passwordFile = await tempSecret('synthetic-bootstrap-file\n');
    const file = createBootstrapPool({ ...base, BOOTSTRAP_DB_PASSWORD_FILE: passwordFile });
    expect(file.options.password).toBe('synthetic-bootstrap-file');
    await file.end();
    expect(() => createBootstrapPool({ ...base, BOOTSTRAP_DB_USER: 'lighting_runtime', BOOTSTRAP_DB_PASSWORD: 'synthetic' }))
      .toThrow('BOOTSTRAP_DB_USER must be the lighting_bootstrap role.');
    expect(() => createBootstrapPool({ ...base, BOOTSTRAP_DB_PORT: '0', BOOTSTRAP_DB_PASSWORD: 'synthetic' }))
      .toThrow('BOOTSTRAP_DB_PORT is invalid.');
    expect(() => createBootstrapPool({ ...base, BOOTSTRAP_DB_PASSWORD_FILE: path.join(os.tmpdir(), 'missing-bootstrap-secret') }))
      .toThrow('BOOTSTRAP_DB_PASSWORD_FILE could not be read.');
    const emptyPasswordFile = await tempSecret('');
    expect(() => createBootstrapPool({ ...base, BOOTSTRAP_DB_PASSWORD_FILE: emptyPasswordFile }))
      .toThrow('BOOTSTRAP_DB_PASSWORD_FILE could not be read.');
  });
});
