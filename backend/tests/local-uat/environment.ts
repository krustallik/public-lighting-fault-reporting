import { readdirSync } from 'node:fs';
import path from 'node:path';

const LOOPBACK = '127.0.0.1';

export function assertLocalUatWorkingDirectory(cwd: string, expectedDirectory: string): void {
  if (path.resolve(cwd) !== path.resolve(expectedDirectory)) {
    throw new Error('Local UAT must run from its private state directory.');
  }
  const dotenvFile = readdirSync(cwd).find((name) => /^\.env(?:\.|$)/i.test(name));
  if (dotenvFile) throw new Error('Local UAT state must not contain dotenv files.');
}

export function assertLocalUatEnvironment(env: Record<string, string | undefined>): void {
  const forbiddenPrefixes = [
    'MIGRATION_DB_', 'BOOTSTRAP_DB_', 'BACKUP_DB_', 'RETENTION_DB_',
    'LIGHTING_BACKUP_', 'LIGHTING_RETENTION_', 'DB_BACKUP_', 'DB_RETENTION_',
    'DB_LIGHTING_BACKUP_', 'DB_LIGHTING_RETENTION_', 'DB_ADMIN_', 'DBA_',
  ];
  const unexpectedSecretVariable = Object.keys(env).find((name) => {
    const normalizedName = name.toUpperCase();
    return /_FILE$/.test(normalizedName) || normalizedName === 'ADMIN_INITIAL_PASSWORD' ||
    forbiddenPrefixes.some((prefix) => normalizedName.startsWith(prefix)) || [
      'DATABASE_URL', 'PGPASSWORD', 'PGPASSFILE', 'DOTENV_KEY', 'AGE_IDENTITY', 'BACKUP_AGE_IDENTITY',
      'BACKUP_DB_PASSWORD', 'DB_BACKUP_PASSWORD', 'DB_RETENTION_PASSWORD', 'RETENTION_DB_PASSWORD',
      'LIGHTING_BACKUP_PASSWORD', 'LIGHTING_RETENTION_PASSWORD', 'DB_ADMIN_PASSWORD',
      'DB_RUNTIME_PASSWORD', 'MIGRATION_DB_PASSWORD', 'DB_BOOTSTRAP_PASSWORD',
      'BOOTSTRAP_DB_PASSWORD', 'DB_MIGRATION_PASSWORD',
    ].includes(normalizedName) && Boolean(env[name]?.trim());
  });
  if (
    env.NODE_ENV !== 'development' || env.LOCAL_UAT_MODE !== 'true' ||
    env.EMAIL_VERIFICATION_ENABLED !== 'true' || env.LOCAL_TEST_SUBMIT_ENABLED !== 'true' ||
    env.DB_HOST !== LOOPBACK || env.DB_PORT !== '5433' ||
    env.DB_NAME !== 'lighting_faults_local_uat_dev' || env.DB_USER !== 'plfr_uat' ||
    !env.DB_PASSWORD?.trim() || env.PORT !== '5000' ||
    env.EMAIL_E2E_PORT !== '5001' || env.GEOAPIFY_ENABLED !== 'false' ||
    env.NOMINATIM_AUTO_GEOCODE !== 'false' || env.AUSEMIO_API_KEY?.trim() ||
    env.RESEND_API_KEY?.trim() || env.GEOAPIFY_API_KEY?.trim() || unexpectedSecretVariable
  ) {
    throw new Error('Local UAT requires the dedicated loopback-only development configuration.');
  }
}
