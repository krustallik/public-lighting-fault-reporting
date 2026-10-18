import path from 'node:path';

const LOOPBACK_DB = {
  DB_HOST: '127.0.0.1',
  DB_PORT: '5433',
  DB_NAME: 'lighting_faults_local_uat_dev',
  DB_USER: 'plfr_uat',
} as const;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function hasNoLineBreak(value: string | undefined): boolean {
  return value !== undefined && !/[\r\n\0]/.test(value);
}

function isStrongLocalJwtSecret(value: string | undefined): boolean {
  if (!value || !/^[A-Za-z0-9_-]+$/.test(value)) return false;
  const bytes = Buffer.from(value, 'base64url');
  return bytes.length >= 32 && bytes.toString('base64url') === value && !bytes.every((byte) => byte === bytes[0]);
}

export function assertLiveProviderLocalUatEnvironment(env: Record<string, string | undefined>): void {
  const forbiddenCredential = Object.keys(env).some((name) => {
    const normalized = name.toUpperCase();
    return normalized.endsWith('_FILE') || [
      'AUSEMIO_API_KEY', 'DATABASE_URL', 'PGPASSWORD', 'PGPASSFILE',
      'NODE_TLS_REJECT_UNAUTHORIZED', 'DOTENV_KEY',
      'ADMIN_INITIAL_PASSWORD', 'BACKUP_AGE_IDENTITY', 'AGE_IDENTITY',
      'DB_ADMIN_PASSWORD', 'DB_BOOTSTRAP_PASSWORD', 'DB_BACKUP_PASSWORD',
      'DB_MIGRATION_PASSWORD', 'DB_RETENTION_PASSWORD', 'DB_RUNTIME_PASSWORD',
      'LIGHTING_BACKUP_PASSWORD', 'LIGHTING_RETENTION_PASSWORD',
    ].includes(normalized) && Boolean(env[name]?.trim());
  });
  const loopbackDbMatches = Object.entries(LOOPBACK_DB).every(([name, value]) => env[name] === value);
  const resendKey = env.RESEND_API_KEY;
  const geoapifyKey = env.GEOAPIFY_API_KEY;
  const sender = env.RESEND_FROM_EMAIL;
  const recipient = env.LOCAL_UAT_APPROVED_EMAIL_RECIPIENT;
  const corsOrigin = env.CORS_ORIGIN;
  const validProviderValues = [resendKey, geoapifyKey, sender, recipient].every(hasNoLineBreak);

  if (
    env.NODE_ENV !== 'development' || env.LOCAL_UAT_MODE !== 'true' || env.LIVE_PROVIDER_LOCAL_UAT !== 'true' ||
    !loopbackDbMatches || !env.DB_PASSWORD?.trim() || !isStrongLocalJwtSecret(env.JWT_SECRET) ||
    env.PORT !== '5000' || corsOrigin !== 'http://127.0.0.1:5173' ||
    env.EMAIL_VERIFICATION_ENABLED !== 'true' || !resendKey?.trim() ||
    !sender?.trim() || sender.length > 254 || !EMAIL_PATTERN.test(sender) ||
    !recipient?.trim() || recipient.length > 254 || !EMAIL_PATTERN.test(recipient) ||
    env.GEOAPIFY_ENABLED !== 'true' || !geoapifyKey?.trim() ||
    env.GEOAPIFY_BASE_URL !== 'https://api-eu.geoapify.com' ||
    env.NOMINATIM_AUTO_GEOCODE !== 'false' || env.LOCAL_TEST_SUBMIT_ENABLED !== 'true' ||
    env.EMAIL_E2E_PORT !== undefined || env.AUSEMIO_API_KEY?.trim() || forbiddenCredential || !validProviderValues
  ) {
    throw new Error('Live provider local UAT requires explicit provider configuration and the dedicated loopback database.');
  }
}

export function assertLiveProviderLocalUatWorkingDirectory(cwd: string, expectedDirectory: string): void {
  if (path.resolve(cwd) !== path.resolve(expectedDirectory)) {
    throw new Error('Live provider local UAT must run from its private state directory.');
  }
}
