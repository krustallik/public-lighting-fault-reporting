import type { Pool, PoolClient } from 'pg';
import {
  EMAIL_OTP_MAX_ATTEMPTS,
  EMAIL_OTP_MAX_SENDS,
  EMAIL_OTP_RESEND_COOLDOWN_SECONDS,
  EMAIL_OTP_TTL_SECONDS,
  digestMatches,
} from './emailVerificationCrypto.js';

export interface VerificationRateKeys {
  emailDigest: Buffer;
  ipDigest: Buffer;
}

export interface NewEmailChallenge extends VerificationRateKeys {
  intentId: string;
  otpDigest: Buffer;
}

export type CreateChallengeResult = 'created' | { status: 'rate_limited'; retryAfterSeconds: number };
export type ResendChallengeResult =
  | { status: 'sent' }
  | { status: 'rate_limited'; retryAfterSeconds: number }
  | { status: 'cooldown'; retryAfterSeconds: number }
  | { status: 'send_limit' }
  | { status: 'expired' }
  | { status: 'not_found' };

export type VerifyChallengeResult =
  | { status: 'verified'; expiresInSeconds: number }
  | { status: 'rate_limited'; retryAfterSeconds: number }
  | { status: 'invalid'; attemptsRemaining: number }
  | { status: 'attempts_exhausted' }
  | { status: 'expired' }
  | { status: 'already_verified' }
  | { status: 'not_found' };

export interface VerifyChallengeInput extends VerificationRateKeys {
  intentId: string;
  otpDigest: Buffer;
  verificationTokenDigest: Buffer;
}

export interface EmailVerificationStore {
  createChallenge(challenge: NewEmailChallenge): Promise<CreateChallengeResult>;
  resendChallenge(challenge: NewEmailChallenge): Promise<ResendChallengeResult>;
  verifyChallenge(input: VerifyChallengeInput): Promise<VerifyChallengeResult>;
  deleteUndeliveredChallenge(intentId: string, otpDigest: Buffer): Promise<void>;
  consumeVerification(intentId: string, emailDigest: Buffer, tokenDigest: Buffer): Promise<boolean>;
  cleanupExpired(): Promise<void>;
}

type RateLimit = { scope: 'send_email' | 'send_ip' | 'verify_email' | 'verify_ip'; keyDigest: Buffer; maxAttempts: number };

const CLEANUP_BATCH_SIZE = 100;
const CLEANUP_MAX_BATCHES_PER_TABLE = 10;
const CLEANUP_TIME_BUDGET_MS = 1000;

async function applyRateLimits(
  client: PoolClient,
  limits: RateLimit[]
): Promise<{ allowed: true } | { allowed: false; retryAfterSeconds: number }> {
  let retryAfterSeconds = 0;
  for (const limit of limits) {
    const result = await client.query<{ attempt_count: number; retry_after_seconds: number }>(
      `INSERT INTO email_verification_rate_limits
         (scope, key_digest, window_started_at, attempt_count, updated_at)
       VALUES ($1, $2, statement_timestamp(), 1, statement_timestamp())
       ON CONFLICT (scope, key_digest) DO UPDATE SET
         attempt_count = CASE
           WHEN email_verification_rate_limits.window_started_at <= statement_timestamp() - interval '1 hour'
             THEN 1
           ELSE LEAST(email_verification_rate_limits.attempt_count + 1, 2147483647)
         END,
         window_started_at = CASE
           WHEN email_verification_rate_limits.window_started_at <= statement_timestamp() - interval '1 hour'
             THEN statement_timestamp()
           ELSE email_verification_rate_limits.window_started_at
         END,
         updated_at = statement_timestamp()
       RETURNING attempt_count,
         GREATEST(1, CEIL(EXTRACT(EPOCH FROM (
           window_started_at + interval '1 hour' - statement_timestamp()
         )))::integer) AS retry_after_seconds`,
      [limit.scope, limit.keyDigest]
    );
    const row = result.rows[0];
    if (!row || row.attempt_count > limit.maxAttempts) {
      retryAfterSeconds = Math.max(retryAfterSeconds, row?.retry_after_seconds ?? 3600);
    }
  }
  return retryAfterSeconds > 0
    ? { allowed: false, retryAfterSeconds }
    : { allowed: true };
}

async function cleanupTemporaryState(client: PoolClient): Promise<void> {
  const cleanupTableInBatches = async (statement: string) => {
    const deadline = Date.now() + CLEANUP_TIME_BUDGET_MS;
    for (let batch = 0; batch < CLEANUP_MAX_BATCHES_PER_TABLE && Date.now() < deadline; batch += 1) {
      const result = await client.query(statement, [CLEANUP_BATCH_SIZE]);
      if ((result.rowCount ?? 0) < CLEANUP_BATCH_SIZE) break;
      // Keep the bounded cleanup loop responsive even if a database driver returns at the deadline.
      if (Date.now() >= deadline) break;
    }
  };

  await cleanupTableInBatches(
    `WITH stale AS (
       SELECT ctid FROM email_verification_challenges
       WHERE expires_at < clock_timestamp() - interval '1 hour'
          OR consumed_at < clock_timestamp() - interval '1 hour'
       ORDER BY expires_at
       LIMIT $1
       FOR UPDATE SKIP LOCKED
     )
     DELETE FROM email_verification_challenges AS challenge
     USING stale WHERE challenge.ctid = stale.ctid`
  );
  await cleanupTableInBatches(
    `WITH stale AS (
       SELECT ctid FROM email_verification_rate_limits
       WHERE updated_at < clock_timestamp() - interval '48 hours'
       ORDER BY updated_at
       LIMIT $1
       FOR UPDATE SKIP LOCKED
     )
     DELETE FROM email_verification_rate_limits AS rate_limit
     USING stale WHERE rate_limit.ctid = stale.ctid`
  );
}

export class PostgresEmailVerificationStore implements EmailVerificationStore {
  constructor(private readonly pool: Pool) {}

  private async transaction<T>(operation: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await operation(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async createChallenge(challenge: NewEmailChallenge): Promise<CreateChallengeResult> {
    return this.transaction(async (client) => {
      const rateLimit = await applyRateLimits(client, [
        { scope: 'send_email', keyDigest: challenge.emailDigest, maxAttempts: 3 },
        { scope: 'send_ip', keyDigest: challenge.ipDigest, maxAttempts: 15 },
      ]);
      if (!rateLimit.allowed) {
        await cleanupTemporaryState(client);
        return { status: 'rate_limited', retryAfterSeconds: rateLimit.retryAfterSeconds };
      }
      await client.query(
        `INSERT INTO email_verification_challenges
           (intent_id, email_digest, otp_digest, expires_at, send_count)
         VALUES ($1, $2, $3, clock_timestamp() + ($4 * interval '1 second'), 1)`,
        [challenge.intentId, challenge.emailDigest, challenge.otpDigest, EMAIL_OTP_TTL_SECONDS]
      );
      await cleanupTemporaryState(client);
      return 'created';
    });
  }

  async resendChallenge(challenge: NewEmailChallenge): Promise<ResendChallengeResult> {
    return this.transaction(async (client) => {
      const current = await client.query<{
        expires_at: Date;
        is_expired: boolean;
        verified_at: Date | null;
        consumed_at: Date | null;
        send_count: number;
        retry_after_seconds: number;
      }>(
        `SELECT expires_at, expires_at <= clock_timestamp() AS is_expired,
                verified_at, consumed_at, send_count,
                GREATEST(0, CEIL(EXTRACT(EPOCH FROM (
                  last_sent_at + ($3 * interval '1 second') - clock_timestamp()
                )))::integer) AS retry_after_seconds
         FROM email_verification_challenges
         WHERE intent_id = $1 AND email_digest = $2
         FOR UPDATE`,
        [challenge.intentId, challenge.emailDigest, EMAIL_OTP_RESEND_COOLDOWN_SECONDS]
      );
      const existing = current.rows[0];
      if (!existing) return { status: 'not_found' };
      if (existing.is_expired) return { status: 'expired' };
      if (existing.verified_at || existing.consumed_at) return { status: 'not_found' };
      if (existing.send_count >= EMAIL_OTP_MAX_SENDS) return { status: 'send_limit' };
      if (existing.retry_after_seconds > 0) {
        return { status: 'cooldown', retryAfterSeconds: existing.retry_after_seconds };
      }

      const rateLimit = await applyRateLimits(client, [
        { scope: 'send_email', keyDigest: challenge.emailDigest, maxAttempts: 3 },
        { scope: 'send_ip', keyDigest: challenge.ipDigest, maxAttempts: 15 },
      ]);
      if (!rateLimit.allowed) {
        await cleanupTemporaryState(client);
        return { status: 'rate_limited', retryAfterSeconds: rateLimit.retryAfterSeconds };
      }

      const update = await client.query(
        `UPDATE email_verification_challenges SET
           otp_digest = $3,
           attempt_count = 0,
           send_count = send_count + 1,
           last_sent_at = clock_timestamp(),
           expires_at = clock_timestamp() + ($4 * interval '1 second')
         WHERE intent_id = $1 AND email_digest = $2
           AND verified_at IS NULL AND consumed_at IS NULL
           AND expires_at > clock_timestamp()
           AND send_count < $5
           AND last_sent_at <= clock_timestamp() - ($6 * interval '1 second')`,
        [
          challenge.intentId,
          challenge.emailDigest,
          challenge.otpDigest,
          EMAIL_OTP_TTL_SECONDS,
          EMAIL_OTP_MAX_SENDS,
          EMAIL_OTP_RESEND_COOLDOWN_SECONDS,
        ]
      );
      if (update.rowCount === 1) {
        await cleanupTemporaryState(client);
        return { status: 'sent' };
      }

      await cleanupTemporaryState(client);
      const expiry = await client.query<{ is_expired: boolean }>(
        `SELECT expires_at <= clock_timestamp() AS is_expired
         FROM email_verification_challenges WHERE intent_id = $1 AND email_digest = $2`,
        [challenge.intentId, challenge.emailDigest]
      );
      if (expiry.rows[0]?.is_expired) return { status: 'expired' };
      return { status: 'not_found' };
    });
  }

  async verifyChallenge(input: VerifyChallengeInput): Promise<VerifyChallengeResult> {
    return this.transaction(async (client) => {
      const rateLimit = await applyRateLimits(client, [
        { scope: 'verify_email', keyDigest: input.emailDigest, maxAttempts: 15 },
        { scope: 'verify_ip', keyDigest: input.ipDigest, maxAttempts: 30 },
      ]);
      if (!rateLimit.allowed) {
        await cleanupTemporaryState(client);
        return { status: 'rate_limited', retryAfterSeconds: rateLimit.retryAfterSeconds };
      }

      const candidate = await client.query<{ otp_digest: Buffer; attempt_count: number }>(
        `UPDATE email_verification_challenges SET attempt_count = attempt_count + 1
         WHERE intent_id = $1 AND email_digest = $2
           AND verified_at IS NULL AND consumed_at IS NULL
           AND expires_at > clock_timestamp() AND attempt_count < $3
         RETURNING otp_digest, attempt_count`,
        [input.intentId, input.emailDigest, EMAIL_OTP_MAX_ATTEMPTS]
      );
      const row = candidate.rows[0];
      if (!row) {
        const current = await client.query<{
          expires_at: Date;
          is_expired: boolean;
          verified_at: Date | null;
          consumed_at: Date | null;
          attempt_count: number;
        }>(
          `SELECT expires_at, expires_at <= clock_timestamp() AS is_expired,
                  verified_at, consumed_at, attempt_count
           FROM email_verification_challenges WHERE intent_id = $1 AND email_digest = $2`,
          [input.intentId, input.emailDigest]
        );
        await cleanupTemporaryState(client);
        const state = current.rows[0];
        if (!state) return { status: 'not_found' };
        if (state.is_expired) return { status: 'expired' };
        if (state.consumed_at || state.verified_at) return { status: 'already_verified' };
        if (state.attempt_count >= EMAIL_OTP_MAX_ATTEMPTS) return { status: 'attempts_exhausted' };
        return { status: 'not_found' };
      }

      if (!digestMatches(row.otp_digest, input.otpDigest)) {
        await cleanupTemporaryState(client);
        return row.attempt_count >= EMAIL_OTP_MAX_ATTEMPTS
          ? { status: 'attempts_exhausted' }
          : { status: 'invalid', attemptsRemaining: EMAIL_OTP_MAX_ATTEMPTS - row.attempt_count };
      }

      const verified = await client.query<{ expires_in_seconds: number }>(
        `UPDATE email_verification_challenges SET
           verified_at = clock_timestamp(), verification_token_digest = $3
         WHERE intent_id = $1 AND email_digest = $2
           AND verified_at IS NULL AND consumed_at IS NULL
           AND expires_at > clock_timestamp()
         RETURNING GREATEST(1, CEIL(EXTRACT(EPOCH FROM (expires_at - clock_timestamp())))::integer) AS expires_in_seconds`,
        [input.intentId, input.emailDigest, input.verificationTokenDigest]
      );
      await cleanupTemporaryState(client);
      if (verified.rowCount === 1) {
        return { status: 'verified', expiresInSeconds: verified.rows[0].expires_in_seconds };
      }
      const expiry = await client.query<{ is_expired: boolean }>(
        `SELECT expires_at <= clock_timestamp() AS is_expired
         FROM email_verification_challenges WHERE intent_id = $1 AND email_digest = $2`,
        [input.intentId, input.emailDigest]
      );
      return expiry.rows[0]?.is_expired ? { status: 'expired' } : { status: 'already_verified' };
    });
  }

  async deleteUndeliveredChallenge(intentId: string, otpDigest: Buffer): Promise<void> {
    await this.pool.query(
      `DELETE FROM email_verification_challenges
       WHERE intent_id = $1 AND otp_digest = $2 AND verified_at IS NULL AND consumed_at IS NULL`,
      [intentId, otpDigest]
    );
  }

  async consumeVerification(intentId: string, emailDigest: Buffer, tokenDigest: Buffer): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE email_verification_challenges SET consumed_at = clock_timestamp()
       WHERE intent_id = $1 AND email_digest = $2 AND verification_token_digest = $3
         AND verified_at IS NOT NULL AND consumed_at IS NULL
         AND expires_at > clock_timestamp()
       RETURNING intent_id`,
      [intentId, emailDigest, tokenDigest]
    );
    return result.rowCount === 1;
  }

  async cleanupExpired(): Promise<void> {
    await this.transaction(cleanupTemporaryState);
  }
}
