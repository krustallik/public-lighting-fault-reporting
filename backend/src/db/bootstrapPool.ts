import { readFileSync } from 'node:fs';
import pg from 'pg';

const { Pool } = pg;

function required(env: Record<string, string | undefined>, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is required for the one-shot bootstrap process.`);
  return value;
}

function secret(env: Record<string, string | undefined>, name: string): string {
  const direct = env[name];
  const file = env[`${name}_FILE`];
  if (direct !== undefined && file !== undefined) throw new Error(`Set either ${name} or ${name}_FILE.`);
  if (file !== undefined) {
    try {
      const value = readFileSync(file, 'utf8').replace(/[\r\n]+$/, '');
      if (!value) throw new Error('empty');
      return value;
    } catch {
      throw new Error(`${name}_FILE could not be read.`);
    }
  }
  if (!direct) throw new Error(`${name} is required for the one-shot bootstrap process.`);
  return direct;
}

/** Bootstrap-only database pool; never imported by the HTTP runtime. */
export function createBootstrapPool(env: Record<string, string | undefined> = process.env): pg.Pool {
  if (env.BOOTSTRAP_DB_USER !== 'lighting_bootstrap') {
    throw new Error('BOOTSTRAP_DB_USER must be the lighting_bootstrap role.');
  }
  const portValue = required(env, 'BOOTSTRAP_DB_PORT');
  if (!/^\d+$/.test(portValue) || Number(portValue) < 1 || Number(portValue) > 65535) {
    throw new Error('BOOTSTRAP_DB_PORT is invalid.');
  }
  return new Pool({
    host: required(env, 'BOOTSTRAP_DB_HOST'),
    port: Number(portValue),
    database: required(env, 'BOOTSTRAP_DB_NAME'),
    user: required(env, 'BOOTSTRAP_DB_USER'),
    password: secret(env, 'BOOTSTRAP_DB_PASSWORD'),
    max: 1,
    connectionTimeoutMillis: 10000,
    idleTimeoutMillis: 5000,
    allowExitOnIdle: false,
    application_name: 'lighting-bootstrap-admin',
  });
}
