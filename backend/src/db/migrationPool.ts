import { readFileSync } from 'node:fs';
import pg from 'pg';

const { Pool } = pg;

function getSecret(env: Record<string, string | undefined>, name: string): string {
  const direct = env[name];
  const file = env[`${name}_FILE`];
  if (direct !== undefined && file !== undefined) throw new Error(`Set either ${name} or ${name}_FILE.`);
  if (file !== undefined) {
    try { return readFileSync(file, 'utf8').replace(/[\r\n]+$/, ''); }
    catch { throw new Error(`${name}_FILE could not be read.`); }
  }
  if (direct === undefined || direct === '') throw new Error(`${name} is required.`);
  return direct;
}

function required(env: Record<string, string | undefined>, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is required for the controlled migration process.`);
  return value;
}

/** Creates a pool for the controlled migration command; never used by the HTTP process. */
export function createMigrationPool(env: Record<string, string | undefined> = process.env): pg.Pool {
  const production = env.NODE_ENV === 'production';
  const prefix = production ? 'MIGRATION_DB_' : 'DB_';
  const user = required(env, `${prefix}USER`);
  if (production && user !== 'lighting_migrator') {
    throw new Error('MIGRATION_DB_USER must be the lighting_migrator role.');
  }
  const portValue = required(env, `${prefix}PORT`);
  if (!/^\d+$/.test(portValue) || Number(portValue) < 1 || Number(portValue) > 65535) {
    throw new Error(`${prefix}PORT is invalid.`);
  }
  return new Pool({
    host: required(env, `${prefix}HOST`),
    port: Number(portValue),
    database: required(env, `${prefix}NAME`),
    user,
    password: getSecret(env, `${prefix}PASSWORD`),
    max: 1,
    connectionTimeoutMillis: 10000,
    idleTimeoutMillis: 5000,
    allowExitOnIdle: false,
    application_name: production ? 'lighting-migrator' : 'lighting-migration-dev',
  });
}
