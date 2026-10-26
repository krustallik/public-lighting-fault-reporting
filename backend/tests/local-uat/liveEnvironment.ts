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
  const dockerUat = env.LOCAL_UAT_CONTAINER_MODE === 'true' && env.LIVE_PROVIDER_LOCAL_UAT_DOCKER === 'true';
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
  const emailEnabled = env.EMAIL_VERIFICATION_ENABLED === 'true';
  const emailDisabledByOwnerGate = dockerUat && env.EMAIL_VERIFICATION_ENABLED === 'false' &&
    env.LOCAL_UAT_RESEND_BLOCKED === 'owner_recipient_missing' &&
    !resendKey?.trim() && !sender?.trim() && !recipient?.trim();
  const emailConfigurationValid = emailEnabled
    ? Boolean(resendKey?.trim()) && Boolean(sender && EMAIL_PATTERN.test(sender) && sender.length <= 254) &&
      Boolean(recipient && EMAIL_PATTERN.test(recipient) && recipient.length <= 254) &&
      env.LOCAL_UAT_RESEND_BLOCKED === undefined
    : emailDisabledByOwnerGate;
  const hostDatabaseMatches = env.DB_HOST === '127.0.0.1' && env.DB_PORT === '5433';
  const dockerDatabaseMatches = dockerUat && env.DB_HOST === 'db' && env.DB_PORT === '5432' &&
    env.DB_NAME === 'lighting_faults_local_uat_dev' && env.DB_USER === 'plfr_uat' &&
    env.LOCAL_UAT_EDGE_ADDRESS === '172.36.0.2' && env.TRUST_PROXY_CIDRS === '172.36.0.2/32' &&
    env.LOCAL_UAT_SECURE_COOKIES === 'true';
  const expectedCorsOrigin = dockerUat ? 'https://localhost:8443' : 'http://127.0.0.1:5173';
  const hostOnlySettingsValid = dockerUat || (
    env.LOCAL_UAT_CONTAINER_MODE === undefined && env.LOCAL_UAT_EDGE_ADDRESS === undefined &&
    env.TRUST_PROXY_CIDRS === undefined && env.LOCAL_UAT_SECURE_COOKIES === undefined &&
    env.LIVE_PROVIDER_LOCAL_UAT_DOCKER === undefined
  );
  const validProviderValues = [geoapifyKey, ...(emailEnabled ? [resendKey, sender, recipient] : [])]
    .every(hasNoLineBreak);

  if (
    env.NODE_ENV !== 'development' || env.LOCAL_UAT_MODE !== 'true' || env.LIVE_PROVIDER_LOCAL_UAT !== 'true' ||
    (dockerUat ? !dockerDatabaseMatches : !hostDatabaseMatches || !loopbackDbMatches) || !hostOnlySettingsValid ||
    !env.DB_PASSWORD?.trim() || !isStrongLocalJwtSecret(env.JWT_SECRET) ||
    env.PORT !== '5000' || corsOrigin !== expectedCorsOrigin || !emailConfigurationValid ||
    env.GEOAPIFY_ENABLED !== 'true' || !geoapifyKey?.trim() ||
    env.GEOAPIFY_BASE_URL !== 'https://api-eu.geoapify.com' ||
    env.NOMINATIM_AUTO_GEOCODE !== 'false' || env.LOCAL_TEST_SUBMIT_ENABLED !== 'true' ||
    env.EMAIL_E2E_PORT !== undefined || env.AUSEMIO_API_KEY?.trim() || forbiddenCredential || !validProviderValues
  ) {
    throw new Error('Live provider local UAT requires explicit provider configuration and its dedicated local database.');
  }
}

export function assertLiveProviderLocalUatWorkingDirectory(cwd: string, expectedDirectory: string): void {
  if (path.resolve(cwd) !== path.resolve(expectedDirectory)) {
    throw new Error('Live provider local UAT must run from its private state directory.');
  }
}
