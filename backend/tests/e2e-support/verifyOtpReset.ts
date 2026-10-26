import { pool } from '../../src/db/pool.js';
import { EmailVerificationCrypto } from '../../src/services/emailVerificationCrypto.js';
import { EmailVerificationService } from '../../src/services/emailVerification.service.js';
import type { EmailVerificationProvider } from '../../src/services/emailVerificationProvider.js';
import { PostgresEmailVerificationStore } from '../../src/services/emailVerificationStore.js';
import { resetE2EDatabase } from './resetDatabase.js';

const databaseName = process.env.DB_NAME ?? '';
const socketHost = process.env.DB_HOST ?? '';

function assertDisposableConfiguration(): void {
  if (
    process.env.NODE_ENV !== 'test' ||
    process.env.P5_E2E_ALLOW_DB_RESET !== 'true' ||
    databaseName !== 'p5_e2e_admin' ||
    !/^\/tmp\/p5-e2e-postgres-socket-\d+$/.test(socketHost) ||
    process.env.P5_E2E_SOCKET_HOST !== socketHost ||
    !process.env.DB_USER ||
    !process.env.DB_PASSWORD
  ) {
    throw new Error('Refusing OTP reset verification outside the dedicated disposable browser database.');
  }
}

async function countRows(table: 'email_verification_challenges' | 'email_verification_rate_limits'): Promise<number> {
  const result = await pool.query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM ${table}`);
  return Number(result.rows[0]?.count ?? '0');
}

async function verifyResetRecovery(): Promise<void> {
  assertDisposableConfiguration();
  const current = await pool.query<{ database_name: string; migrations: string[] }>(
    `SELECT current_database() AS database_name,
            ARRAY(SELECT version FROM schema_migrations ORDER BY version) AS migrations`
  );
  if (
    current.rows[0]?.database_name !== databaseName ||
    current.rows[0]?.migrations.join(',') !== '0001,0002,0003,0004'
  ) {
    throw new Error('OTP reset verification requires the canonical disposable E2E database.');
  }

  let deliveries = 0;
  const provider: EmailVerificationProvider = {
    async sendVerificationCode() { deliveries += 1; },
  };
  const service = new EmailVerificationService(
    new PostgresEmailVerificationStore(pool),
    provider,
    new EmailVerificationCrypto('p5-e2e-reset-recovery-only-secret')
  );
  const request = {
    email: 'otp-e2e@example.test',
    ipAddress: '127.0.0.1',
    locale: 'en' as const,
  };

  for (let index = 0; index < 3; index += 1) {
    const result = await service.requestCode(request);
    if (result.status !== 'sent') throw new Error('Could not seed OTP rate counters before reset.');
  }
  const blockedBeforeReset = await service.requestCode(request);
  if (blockedBeforeReset.status !== 'rate_limited' || deliveries !== 3) {
    throw new Error('OTP test setup did not reach the expected per-email send limit.');
  }

  const challengeRowsBeforeReset = await countRows('email_verification_challenges');
  const rateLimitRowsBeforeReset = await countRows('email_verification_rate_limits');
  if (challengeRowsBeforeReset === 0 || rateLimitRowsBeforeReset === 0) {
    throw new Error('OTP challenge and rate-limit rows were not persisted before reset.');
  }

  await resetE2EDatabase(pool);
  const challengeRowsAfterReset = await countRows('email_verification_challenges');
  const rateLimitRowsAfterReset = await countRows('email_verification_rate_limits');
  if (challengeRowsAfterReset !== 0 || rateLimitRowsAfterReset !== 0) {
    throw new Error('Disposable E2E reset left OTP verification state behind.');
  }

  const requestAfterReset = await service.requestCode(request);
  if (requestAfterReset.status !== 'sent') {
    throw new Error('A fresh OTP request remained blocked after the disposable reset.');
  }

  console.log('P5_E2E_OTP_RESET_RECOVERY_VERIFIED challenges_cleared=true rate_limits_cleared=true fresh_request=sent fake_provider=true');
}

try {
  await verifyResetRecovery();
} finally {
  await pool.end();
}
