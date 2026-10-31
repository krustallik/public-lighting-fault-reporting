import path from 'node:path';

const ALLOWED_DATABASE = 'p5_e2e_admin';
const ALLOWED_USER = 'p5_e2e_user';
const ALLOWED_SOCKET_RELATIVE_PATH = '.p5-e2e-postgres-socket';

/**
 * Guards destructive E2E setup/reset operations. CI connects either to the
 * run-scoped host socket or to that same socket mounted in the contained
 * workload workspace. It never accepts arbitrary p5_e2e_* databases/sockets.
 */
export function assertDisposableE2EDatabaseConfig(env: NodeJS.ProcessEnv): void {
  const runId = env.GITHUB_RUN_ID ?? '';
  const sourceSocket = `/tmp/p5-e2e-postgres-socket-${runId}`;
  const workspace = env.GITHUB_WORKSPACE ?? '';
  const mountedSocket = path.posix.join(workspace, ALLOWED_SOCKET_RELATIVE_PATH);
  const databaseHost = env.DB_HOST ?? '';

  if (
    env.NODE_ENV !== 'test' ||
    env.P5_E2E_ALLOW_DB_RESET !== 'true' ||
    !/^\d+$/.test(runId) ||
    env.DB_NAME !== ALLOWED_DATABASE ||
    env.DB_PORT !== '5432' ||
    env.DB_USER !== ALLOWED_USER ||
    !env.DB_PASSWORD ||
    !path.posix.isAbsolute(workspace) ||
    env.P5_E2E_SOCKET_HOST !== sourceSocket ||
    env.P5_E2E_SOCKET_REL !== ALLOWED_SOCKET_RELATIVE_PATH ||
    (databaseHost !== sourceSocket && databaseHost !== mountedSocket)
  ) {
    throw new Error('Refusing P5 E2E database operation outside the run-scoped disposable PostGIS database.');
  }
}
