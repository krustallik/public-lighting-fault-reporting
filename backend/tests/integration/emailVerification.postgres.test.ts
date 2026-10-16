import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Pool } from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { EmailVerificationCrypto, EMAIL_OTP_MAX_ATTEMPTS, EMAIL_OTP_MAX_SENDS, EMAIL_OTP_RESEND_COOLDOWN_SECONDS, EMAIL_OTP_TTL_SECONDS } from '../../src/services/emailVerificationCrypto.js';
import { PostgresEmailVerificationStore, type NewEmailChallenge, type VerifyChallengeInput } from '../../src/services/emailVerificationStore.js';

const connectionString = process.env.EMAIL_VERIFICATION_TEST_DATABASE_URL;
const explicitlyDisposable = process.env.P5_E2E_ALLOW_DB_RESET === 'true';

function assertSafeDisposableTarget(value: string | undefined): asserts value is string {
  if (!value || !explicitlyDisposable) {
    throw new Error('PostgreSQL OTP integration tests require the explicit disposable E2E database opt-in.');
  }
  const parsed = new URL(value);
  const database = decodeURIComponent(parsed.pathname.slice(1));
  const configuredHosts = parsed.searchParams.getAll('host');
  const host = configuredHosts[0] ?? parsed.hostname;
  const isLocalHost = (candidate: string) =>
    candidate === 'localhost' || candidate === '127.0.0.1' || candidate === '::1' || candidate.startsWith('/tmp/');
  if (!database.startsWith('p5_e2e_') || configuredHosts.length > 1 ||
    !isLocalHost(parsed.hostname) || !isLocalHost(host)) {
    throw new Error('PostgreSQL OTP integration tests only accept a local p5_e2e_* disposable database.');
  }
}

const runPostgresTests = Boolean(connectionString && explicitlyDisposable);
const suite = runPostgresTests ? describe : describe.skip;
const crypto = new EmailVerificationCrypto(
  Buffer.from(Array.from({ length: 32 }, (_, index) => ((index * 23 + 29) % 255) + 1)).toString('base64url')
);
let adminPool: Pool | undefined;
let testPool: Pool | undefined;
let store: PostgresEmailVerificationStore;
let schemaName = '';

suite('email verification PostgreSQL persistence and concurrency', () => {
  beforeAll(async () => {
    assertSafeDisposableTarget(connectionString);
    adminPool = new Pool({ connectionString, max: 2 });
    schemaName = `email_otp_test_${process.pid}_${randomBytes(4).toString('hex')}`;
    await adminPool.query(`CREATE SCHEMA "${schemaName}"`);
    testPool = new Pool({ connectionString, max: 10, options: `-c search_path=${schemaName},pg_catalog` });
    const migration = readFileSync(new URL('../../src/db/migrations/0003_email_verification.sql', import.meta.url), 'utf8');
    await testPool.query(migration);
    store = new PostgresEmailVerificationStore(testPool);
  });

  beforeEach(async () => {
    await testPool?.query('TRUNCATE email_verification_challenges, email_verification_rate_limits');
  });

  afterEach(() => vi.restoreAllMocks());

  afterAll(async () => {
    await testPool?.end();
    if (adminPool && schemaName) await adminPool.query(`DROP SCHEMA "${schemaName}" CASCADE`);
    await adminPool?.end();
  });

  function newChallenge(email = 'resident@example.test', ip = '127.0.0.1') {
    const intentId = crypto.createIntentId();
    const code = crypto.createCode();
    const emailDigest = crypto.emailDigest(email);
    const challenge: NewEmailChallenge = {
      intentId,
      emailDigest,
      otpDigest: crypto.otpDigest(intentId, emailDigest, code),
      ipDigest: crypto.ipDigest(ip),
    };
    return { challenge, code, email };
  }

  function verifyInput(
    challenge: NewEmailChallenge,
    email: string,
    code: string,
    token = crypto.createVerificationToken()
  ): VerifyChallengeInput {
    return {
      intentId: challenge.intentId,
      emailDigest: crypto.emailDigest(email),
      ipDigest: challenge.ipDigest,
      otpDigest: crypto.otpDigest(challenge.intentId, crypto.emailDigest(email), code),
      verificationTokenDigest: crypto.verificationTokenDigest(
        challenge.intentId,
        crypto.emailDigest(email),
        token
      ),
    };
  }

  it('serializes concurrent OTP verification and consumes the verification capability once', async () => {
    const { challenge, code, email } = newChallenge();
    expect(await store.createChallenge(challenge)).toBe('created');
    const tokenA = crypto.createVerificationToken();
    const tokenB = crypto.createVerificationToken();
    const inputs = [verifyInput(challenge, email, code, tokenA), verifyInput(challenge, email, code, tokenB)];
    const results = await Promise.all(inputs.map((input) => store.verifyChallenge(input)));
    expect(results.filter((result) => result.status === 'verified')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'already_verified')).toHaveLength(1);
    const winnerIndex = results.findIndex((result) => result.status === 'verified');
    const winner = inputs[winnerIndex];
    const consumed = await Promise.all([
      store.consumeVerification(winner.intentId, winner.emailDigest, winner.verificationTokenDigest),
      store.consumeVerification(winner.intentId, winner.emailDigest, winner.verificationTokenDigest),
    ]);
    expect(consumed.sort()).toEqual([false, true]);
  });

  it('binds attempts to the original email and locks the challenge after five wrong codes', async () => {
    const { challenge, code, email } = newChallenge();
    await store.createChallenge(challenge);
    const wrongCode = code === '000000' ? '000001' : '000000';
    const wrong = verifyInput(challenge, email, wrongCode);
    const results = [];
    for (let attempt = 0; attempt < EMAIL_OTP_MAX_ATTEMPTS; attempt += 1) {
      results.push(await store.verifyChallenge(wrong));
    }
    expect(results.map((result) => result.status)).toEqual([
      'invalid', 'invalid', 'invalid', 'invalid', 'attempts_exhausted',
    ]);
    expect((await store.verifyChallenge(wrong)).status).toBe('attempts_exhausted');
    expect((await store.verifyChallenge(verifyInput(challenge, 'changed@example.test', code))).status).toBe('not_found');
  });

  it('rejects expired codes and allows only a bounded resend count after the cooldown', async () => {
    const expired = newChallenge('expired@example.test');
    await store.createChallenge(expired.challenge);
    await testPool?.query(
      `UPDATE email_verification_challenges SET expires_at = clock_timestamp() - interval '1 second'
       WHERE intent_id = $1`,
      [expired.challenge.intentId]
    );
    expect((await store.verifyChallenge(verifyInput(expired.challenge, expired.email, expired.code))).status).toBe('expired');

    const resend = newChallenge('resend@example.test');
    await store.createChallenge(resend.challenge);
    const next = { ...resend.challenge, otpDigest: crypto.otpDigest(resend.challenge.intentId, resend.challenge.emailDigest, '123456') };
    expect((await store.resendChallenge(next)).status).toBe('cooldown');
    await testPool?.query(
      `UPDATE email_verification_challenges SET last_sent_at = clock_timestamp() - (($2 + 1) * interval '1 second')
       WHERE intent_id = $1`,
      [resend.challenge.intentId, EMAIL_OTP_RESEND_COOLDOWN_SECONDS]
    );
    expect((await store.resendChallenge(next)).status).toBe('sent');
    await testPool?.query(
      `UPDATE email_verification_challenges SET last_sent_at = clock_timestamp() - (($2 + 1) * interval '1 second')
       WHERE intent_id = $1`,
      [resend.challenge.intentId, EMAIL_OTP_RESEND_COOLDOWN_SECONDS]
    );
    expect((await store.resendChallenge(next)).status).toBe('sent');
    await testPool?.query(
      `UPDATE email_verification_challenges SET last_sent_at = clock_timestamp() - (($2 + 1) * interval '1 second')
       WHERE intent_id = $1`,
      [resend.challenge.intentId, EMAIL_OTP_RESEND_COOLDOWN_SECONDS]
    );
    expect((await store.resendChallenge(next)).status).toBe('send_limit');
    expect(EMAIL_OTP_MAX_SENDS).toBe(3);
    expect(EMAIL_OTP_TTL_SECONDS).toBe(600);
  });

  it('rejects resend for a changed email, expired intent, or already verified intent', async () => {
    const changedAddress = newChallenge('original@example.test');
    await store.createChallenge(changedAddress.challenge);
    expect((await store.resendChallenge({
      ...changedAddress.challenge,
      emailDigest: crypto.emailDigest('changed@example.test'),
    })).status).toBe('not_found');

    const expired = newChallenge('expired-resend@example.test');
    await store.createChallenge(expired.challenge);
    await testPool?.query(
      `UPDATE email_verification_challenges SET expires_at = clock_timestamp() - interval '1 second'
       WHERE intent_id = $1`, [expired.challenge.intentId],
    );
    expect((await store.resendChallenge(expired.challenge)).status).toBe('expired');

    const verified = newChallenge('verified-resend@example.test');
    await store.createChallenge(verified.challenge);
    const token = crypto.createVerificationToken();
    const input = verifyInput(verified.challenge, verified.email, verified.code, token);
    expect((await store.verifyChallenge(input)).status).toBe('verified');
    expect((await store.resendChallenge(verified.challenge)).status).toBe('not_found');
  });

  it('classifies database expiry with the PostgreSQL clock despite application clock skew', async () => {
    const verifyExpired = newChallenge('verify-clock-skew@example.test');
    await store.createChallenge(verifyExpired.challenge);
    await testPool?.query(
      `UPDATE email_verification_challenges SET expires_at = clock_timestamp() - interval '1 second'
       WHERE intent_id = $1`, [verifyExpired.challenge.intentId],
    );

    const resendExpired = newChallenge('resend-clock-skew@example.test');
    await store.createChallenge(resendExpired.challenge);
    await testPool?.query(
      `UPDATE email_verification_challenges SET expires_at = clock_timestamp() - interval '1 second'
       WHERE intent_id = $1`, [resendExpired.challenge.intentId],
    );

    vi.spyOn(Date, 'now').mockReturnValue(0);
    expect((await store.verifyChallenge(
      verifyInput(verifyExpired.challenge, verifyExpired.email, verifyExpired.code),
    )).status).toBe('expired');
    expect((await store.resendChallenge(resendExpired.challenge)).status).toBe('expired');
  });

  it('deletes only the matching undelivered code and removes expired temporary state', async () => {
    const pending = newChallenge('pending-delete@example.test');
    await store.createChallenge(pending.challenge);
    const wrongDigest = crypto.otpDigest(pending.challenge.intentId, pending.challenge.emailDigest, '999999');
    await store.deleteUndeliveredChallenge(pending.challenge.intentId, wrongDigest);
    expect((await testPool?.query('SELECT 1 FROM email_verification_challenges WHERE intent_id = $1', [pending.challenge.intentId]))?.rowCount).toBe(1);
    await store.deleteUndeliveredChallenge(pending.challenge.intentId, pending.challenge.otpDigest);
    expect((await testPool?.query('SELECT 1 FROM email_verification_challenges WHERE intent_id = $1', [pending.challenge.intentId]))?.rowCount).toBe(0);

    const verified = newChallenge('verified-delete@example.test');
    await store.createChallenge(verified.challenge);
    const verifiedInput = verifyInput(verified.challenge, verified.email, verified.code);
    await store.verifyChallenge(verifiedInput);
    await store.deleteUndeliveredChallenge(verified.challenge.intentId, verified.challenge.otpDigest);
    expect((await testPool?.query('SELECT 1 FROM email_verification_challenges WHERE intent_id = $1', [verified.challenge.intentId]))?.rowCount).toBe(1);

    await testPool?.query(
      `UPDATE email_verification_challenges SET expires_at = clock_timestamp() - interval '2 hours'
       WHERE intent_id = $1`, [verified.challenge.intentId],
    );
    await testPool?.query(
      `UPDATE email_verification_rate_limits SET updated_at = clock_timestamp() - interval '49 hours'`,
    );
    await store.cleanupExpired();
    expect((await testPool?.query('SELECT 1 FROM email_verification_challenges WHERE intent_id = $1', [verified.challenge.intentId]))?.rowCount).toBe(0);
    expect((await testPool?.query('SELECT 1 FROM email_verification_rate_limits'))?.rowCount).toBe(0);
  });

  it('drains stale challenge and rate rows across bounded cleanup batches', async () => {
    await testPool?.query(
      `INSERT INTO email_verification_challenges (intent_id, email_digest, otp_digest, expires_at)
       SELECT md5(value::text)::uuid,
              decode(lpad(to_hex(value), 64, '0'), 'hex'),
              decode(lpad(to_hex(value + 1000), 64, '0'), 'hex'),
              clock_timestamp() - interval '2 hours'
       FROM generate_series(1, 250) AS value`,
    );
    await testPool?.query(
      `INSERT INTO email_verification_rate_limits (scope, key_digest, attempt_count, updated_at)
       SELECT 'send_ip', decode(lpad(to_hex(value), 64, '0'), 'hex'), 1,
              clock_timestamp() - interval '49 hours'
       FROM generate_series(1, 250) AS value`,
    );

    await store.cleanupExpired();

    expect((await testPool?.query('SELECT count(*) FROM email_verification_challenges'))?.rows[0]?.count).toBe('0');
    expect((await testPool?.query('SELECT count(*) FROM email_verification_rate_limits'))?.rows[0]?.count).toBe('0');
  });

  it('enforces persistent verification rate limits independently of attempt exhaustion', async () => {
    const { challenge, email, code } = newChallenge('verify-rate@example.test', '198.51.100.19');
    await store.createChallenge(challenge);
    const wrongCode = code === '000000' ? '000001' : '000000';
    const outcomes = [];
    for (let attempt = 0; attempt < 16; attempt += 1) {
      outcomes.push((await store.verifyChallenge(verifyInput(challenge, email, wrongCode))).status);
    }
    expect(outcomes.slice(0, 5)).toEqual(['invalid', 'invalid', 'invalid', 'invalid', 'attempts_exhausted']);
    expect(outcomes.slice(5, 15).every((status) => status === 'attempts_exhausted')).toBe(true);
    expect(outcomes[15]).toBe('rate_limited');
  });

  it('uses database rate counters to limit duplicate recipient requests across transactions', async () => {
    const requests = Array.from({ length: 4 }, () => newChallenge('same-recipient@example.test'));
    const results = await Promise.all(requests.map(({ challenge }) => store.createChallenge(challenge)));
    expect(results.filter((result) => result === 'created')).toHaveLength(3);
    const limited = results.find((result) => typeof result !== 'string');
    expect(limited).toMatchObject({ status: 'rate_limited' });
    expect(limited && typeof limited !== 'string' ? limited.retryAfterSeconds : 0).toBeGreaterThan(0);
    expect(limited && typeof limited !== 'string' ? limited.retryAfterSeconds : 3601).toBeLessThanOrEqual(3600);
  });

  it('reports only the remaining database rate-window duration', async () => {
    const { challenge } = newChallenge('late-window@example.test');
    await testPool?.query(
      `INSERT INTO email_verification_rate_limits (scope, key_digest, attempt_count, window_started_at)
       VALUES ('send_email', $1, 3, clock_timestamp() - interval '59 minutes')`,
      [challenge.emailDigest],
    );

    const result = await store.createChallenge(challenge);

    expect(result).toMatchObject({ status: 'rate_limited' });
    expect(result && typeof result !== 'string' ? result.retryAfterSeconds : 0).toBeGreaterThan(0);
    expect(result && typeof result !== 'string' ? result.retryAfterSeconds : 3601).toBeLessThanOrEqual(60);
  });

  it('keeps rate-window predicates stable across a volatile clock rollover', async () => {
    await testPool?.query(`CREATE SEQUENCE "${schemaName}".email_otp_clock_ticks`);
    await testPool?.query(`CREATE TABLE "${schemaName}".email_otp_clock_state (base_at timestamptz NOT NULL)`);
    await testPool?.query(
      `CREATE FUNCTION "${schemaName}".clock_timestamp() RETURNS timestamptz
       LANGUAGE sql VOLATILE AS $function$
         SELECT base_at + ((nextval('"${schemaName}".email_otp_clock_ticks') - 1) * interval '100 milliseconds')
         FROM "${schemaName}".email_otp_clock_state
       $function$`,
    );
    const { rows } = await testPool!.query<{ base_at: Date }>(
      "SELECT pg_catalog.clock_timestamp() + interval '1 hour' AS base_at",
    );
    const baseAt = rows[0].base_at;
    const windowStartedAt = new Date(baseAt.getTime() - 60 * 60 * 1000 + 250);
    await testPool?.query('INSERT INTO email_otp_clock_state (base_at) VALUES ($1)', [baseAt]);
    const clockTicks = await testPool!.query<{ tick: Date }>(
      'SELECT clock_timestamp() AS tick FROM generate_series(1, 4)',
    );
    const tickValues = clockTicks.rows.map(({ tick }) => tick.getTime());
    const windowExpiresAt = windowStartedAt.getTime() + 60 * 60 * 1000;
    expect(Math.min(...tickValues)).toBe(baseAt.getTime());
    expect(Math.max(...tickValues)).toBe(baseAt.getTime() + 300);
    expect(baseAt.getTime() + 200).toBeLessThan(windowExpiresAt);
    expect(baseAt.getTime() + 300).toBeGreaterThan(windowExpiresAt);
    await testPool!.query(`ALTER SEQUENCE "${schemaName}".email_otp_clock_ticks RESTART WITH 1`);

    const { challenge } = newChallenge('rollover-window@example.test');
    await testPool?.query(
      `INSERT INTO email_verification_rate_limits
         (scope, key_digest, attempt_count, window_started_at)
       VALUES ('send_email', $1, 3, $2)`,
      [challenge.emailDigest, windowStartedAt],
    );

    const result = await store.createChallenge(challenge);
    const counter = await testPool?.query<{ attempt_count: number; window_started_at: Date }>(
      `SELECT attempt_count, window_started_at FROM email_verification_rate_limits
       WHERE scope = 'send_email' AND key_digest = $1`,
      [challenge.emailDigest],
    );

    expect(result).toMatchObject({ status: 'rate_limited' });
    expect(counter?.rows[0]?.attempt_count).toBe(4);
    expect(counter?.rows[0]?.window_started_at.getTime()).toBe(windowStartedAt.getTime());
  });
});
