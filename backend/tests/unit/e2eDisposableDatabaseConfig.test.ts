import { describe, expect, it } from 'vitest';
import { assertDisposableE2EDatabaseConfig } from '../e2e-support/disposableDatabaseConfig.js';

const sourceSocket = '/tmp/p5-e2e-postgres-socket-41130286118';
const workspace = '/home/runner/work/public-lighting-fault-reporting/public-lighting-fault-reporting';
const base = {
  NODE_ENV: 'test',
  P5_E2E_ALLOW_DB_RESET: 'true',
  GITHUB_RUN_ID: '41130286118',
  GITHUB_WORKSPACE: workspace,
  DB_HOST: sourceSocket,
  DB_PORT: '5432',
  DB_NAME: 'p5_e2e_admin',
  DB_USER: 'p5_e2e_user',
  DB_PASSWORD: 'synthetic-only',
  P5_E2E_SOCKET_HOST: sourceSocket,
  P5_E2E_SOCKET_REL: '.p5-e2e-postgres-socket',
} satisfies NodeJS.ProcessEnv;

describe('disposable E2E database operation guard', () => {
  it('accepts the run-scoped host socket used for database prepare and cleanup', () => {
    expect(() => assertDisposableE2EDatabaseConfig(base)).not.toThrow();
  });

  it('accepts only the workspace mount of that same run-scoped socket in the contained browser server', () => {
    expect(() => assertDisposableE2EDatabaseConfig({
      ...base,
      DB_HOST: `${workspace}/.p5-e2e-postgres-socket`,
    })).not.toThrow();
  });

  it.each([
    ['arbitrary database suffix', { DB_NAME: 'p5_e2e_production' }],
    ['unrelated user', { DB_USER: 'postgres' }],
    ['nonstandard port', { DB_PORT: '5433' }],
    ['system PostgreSQL socket', { DB_HOST: '/var/run/postgresql' }],
    ['unscoped temporary socket', { DB_HOST: '/tmp/p5-e2e-postgres-socket-999' }],
    ['unrelated mounted socket', { DB_HOST: `${workspace}/other-socket` }],
    ['mismatched socket source', { P5_E2E_SOCKET_HOST: '/tmp/p5-e2e-postgres-socket-999' }],
    ['non-numeric run identity', { GITHUB_RUN_ID: 'local-run' }],
    ['missing explicit reset flag', { P5_E2E_ALLOW_DB_RESET: 'false' }],
  ] as const)('rejects %s before any reset code can run', (_label, override) => {
    expect(() => assertDisposableE2EDatabaseConfig({ ...base, ...override })).toThrow(
      'run-scoped disposable PostGIS database'
    );
  });
});
