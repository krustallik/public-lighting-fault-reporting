import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { AUSEMIO_VO_LOCALITIES } from '../../src/config/data/ausemioVoLocalities.generated.js';
import { EMAIL_OTP_MAX_ATTEMPTS, EMAIL_OTP_MAX_SENDS, EMAIL_OTP_RESEND_COOLDOWN_SECONDS, EMAIL_OTP_TTL_SECONDS, digestMatches } from '../../src/services/emailVerificationCrypto.js';
import type { EmailVerificationProvider, VerificationEmail } from '../../src/services/emailVerificationProvider.js';
import type {
  CreateChallengeResult,
  EmailVerificationStore,
  NewEmailChallenge,
  ResendChallengeResult,
  VerifyChallengeInput,
  VerifyChallengeResult,
} from '../../src/services/emailVerificationStore.js';
import type { FaultHistoryStore } from '../../src/services/faultReportHistory.service.js';
import type { PoolClient } from 'pg';

const testKey = Buffer.from(Array.from({ length: 32 }, (_, index) => ((index * 37 + 19) % 255) + 1)).toString('base64url');
const env: Record<string, string> = {
  NODE_ENV: 'test',
  LOCAL_TEST_SUBMIT_ENABLED: 'true',
  EMAIL_VERIFICATION_ENABLED: 'true',
  RESEND_API_KEY: 'synthetic-resend-key',
  RESEND_FROM_EMAIL: 'lighting@example.test',
  JWT_SECRET: testKey,
};

interface ChallengeState {
  intentId: string;
  emailDigest: Buffer;
  otpDigest: Buffer;
  attempts: number;
  sends: number;
  expiresAt: number;
  lastSentAt: number;
  verificationTokenDigest?: Buffer;
  consumed: boolean;
}

class MemoryEmailVerificationStore implements EmailVerificationStore {
  readonly challenges = new Map<string, ChallengeState>();
  readonly rateCounters = new Map<string, { startedAt: number; attempts: number }>();

  private consumeRate(scope: string, digest: Buffer, max: number): number {
    const key = `${scope}:${digest.toString('base64url')}`;
    const now = Date.now();
    const existing = this.rateCounters.get(key);
    if (!existing || now - existing.startedAt >= 60 * 60 * 1000) {
      this.rateCounters.set(key, { startedAt: now, attempts: 1 });
      return 0;
    }
    existing.attempts += 1;
    return existing.attempts <= max
      ? 0
      : Math.max(1, Math.ceil((existing.startedAt + 60 * 60 * 1000 - now) / 1000));
  }

  private consumeSendRate(challenge: NewEmailChallenge): number {
    const emailRetryAfter = this.consumeRate('send_email', challenge.emailDigest, 3);
    const ipRetryAfter = this.consumeRate('send_ip', challenge.ipDigest, 15);
    return Math.max(emailRetryAfter, ipRetryAfter);
  }

  async createChallenge(challenge: NewEmailChallenge): Promise<CreateChallengeResult> {
    const rateLimitRetryAfterSeconds = this.consumeSendRate(challenge);
    if (rateLimitRetryAfterSeconds > 0) {
      return { status: 'rate_limited', retryAfterSeconds: rateLimitRetryAfterSeconds };
    }
    this.challenges.set(challenge.intentId, {
      intentId: challenge.intentId,
      emailDigest: challenge.emailDigest,
      otpDigest: challenge.otpDigest,
      attempts: 0,
      sends: 1,
      expiresAt: Date.now() + EMAIL_OTP_TTL_SECONDS * 1000,
      lastSentAt: Date.now(),
      consumed: false,
    });
    return 'created';
  }

  async resendChallenge(challenge: NewEmailChallenge): Promise<ResendChallengeResult> {
    const current = this.challenges.get(challenge.intentId);
    if (!current || !digestMatches(current.emailDigest, challenge.emailDigest)) return { status: 'not_found' };
    if (current.expiresAt <= Date.now()) return { status: 'expired' };
    if (current.verificationTokenDigest || current.consumed) return { status: 'not_found' };
    if (current.sends >= EMAIL_OTP_MAX_SENDS) return { status: 'send_limit' };
    const retryAfterSeconds = Math.ceil(EMAIL_OTP_RESEND_COOLDOWN_SECONDS - (Date.now() - current.lastSentAt) / 1000);
    if (retryAfterSeconds > 0) return { status: 'cooldown', retryAfterSeconds };
    const rateLimitRetryAfterSeconds = this.consumeSendRate(challenge);
    if (rateLimitRetryAfterSeconds > 0) {
      return { status: 'rate_limited', retryAfterSeconds: rateLimitRetryAfterSeconds };
    }
    current.otpDigest = challenge.otpDigest;
    current.attempts = 0;
    current.sends += 1;
    current.lastSentAt = Date.now();
    current.expiresAt = Date.now() + EMAIL_OTP_TTL_SECONDS * 1000;
    return { status: 'sent' };
  }

  async verifyChallenge(input: VerifyChallengeInput): Promise<VerifyChallengeResult> {
    const emailRetryAfter = this.consumeRate('verify_email', input.emailDigest, 15);
    const ipRetryAfter = this.consumeRate('verify_ip', input.ipDigest, 30);
    const retryAfterSeconds = Math.max(emailRetryAfter, ipRetryAfter);
    if (retryAfterSeconds > 0) return { status: 'rate_limited', retryAfterSeconds };
    const current = this.challenges.get(input.intentId);
    if (!current || !digestMatches(current.emailDigest, input.emailDigest)) return { status: 'not_found' };
    if (current.expiresAt <= Date.now()) return { status: 'expired' };
    if (current.verificationTokenDigest || current.consumed) return { status: 'already_verified' };
    if (current.attempts >= EMAIL_OTP_MAX_ATTEMPTS) return { status: 'attempts_exhausted' };
    current.attempts += 1;
    if (!digestMatches(current.otpDigest, input.otpDigest)) {
      return current.attempts >= EMAIL_OTP_MAX_ATTEMPTS
        ? { status: 'attempts_exhausted' }
        : { status: 'invalid', attemptsRemaining: EMAIL_OTP_MAX_ATTEMPTS - current.attempts };
    }
    current.verificationTokenDigest = input.verificationTokenDigest;
    return { status: 'verified', expiresInSeconds: Math.max(1, Math.ceil((current.expiresAt - Date.now()) / 1000)) };
  }

  async deleteUndeliveredChallenge(intentId: string, otpDigest: Buffer): Promise<void> {
    const current = this.challenges.get(intentId);
    if (current && digestMatches(current.otpDigest, otpDigest) && !current.verificationTokenDigest) {
      this.challenges.delete(intentId);
    }
  }

  async consumeVerification(intentId: string, emailDigest: Buffer, tokenDigest: Buffer): Promise<boolean> {
    const current = this.challenges.get(intentId);
    if (!current || current.expiresAt <= Date.now() || current.consumed ||
      !current.verificationTokenDigest || !digestMatches(current.emailDigest, emailDigest) ||
      !digestMatches(current.verificationTokenDigest, tokenDigest)) return false;
    current.consumed = true;
    return true;
  }

  async cleanupExpired(): Promise<void> {
    const retention = 60 * 60 * 1000;
    for (const [intentId, challenge] of this.challenges) {
      if (challenge.expiresAt < Date.now() - retention ||
        (challenge.consumed && challenge.expiresAt < Date.now())) this.challenges.delete(intentId);
    }
  }
}

class FakeEmailProvider implements EmailVerificationProvider {
  readonly deliveries: VerificationEmail[] = [];
  fail = false;

  async sendVerificationCode(message: VerificationEmail): Promise<void> {
    if (this.fail) throw new Error('Synthetic provider failure');
    this.deliveries.push(message);
  }
}

const fakeFaultHistory: FaultHistoryStore = {
  async recordSubmission(_input, authorize) {
    if (authorize && !await authorize({ query: async () => ({ rows: [], rowCount: 1 }) } as unknown as PoolClient)) {
      return { authorized: false };
    }
    return { authorized: true, automaticNotes: [] };
  },
  async listHistory() { return { items: [], total: 0 }; },
};

let server: Server | undefined;
let baseUrl: string;
let store: MemoryEmailVerificationStore;
let provider: FakeEmailProvider;

async function startServer(): Promise<void> {
  store = new MemoryEmailVerificationStore();
  provider = new FakeEmailProvider();
  server = createServer(createApp(env, {
    emailVerificationStore: store,
    emailVerificationProvider: provider,
    faultHistoryStore: fakeFaultHistory,
  }));
  await new Promise<void>((resolve, reject) => {
    server?.once('error', reject);
    server?.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
}

async function stopServer(): Promise<void> {
  if (!server?.listening) return;
  await new Promise<void>((resolve, reject) => server?.close((error) => error ? reject(error) : resolve()));
}

async function requestCode(email = 'resident@example.test', intentId?: string): Promise<{ intentId: string; code: string }> {
  const response = await fetch(`${baseUrl}/api/reports/email-verification/request`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, locale: 'en', ...(intentId ? { intentId } : {}) }),
  });
  const body = await response.json() as { intentId?: string; error?: { code?: string } };
  if (!response.ok || !body.intentId) throw new Error(`OTP request failed: ${response.status} ${body.error?.code}`);
  return { intentId: body.intentId, code: provider.deliveries.at(-1)?.code ?? '' };
}

async function verify(intentId: string, email: string, code: string): Promise<Response> {
  return fetch(`${baseUrl}/api/reports/email-verification/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ intentId, email, code }),
  });
}

function submission(email: string, intentId?: string, verificationToken?: string): FormData {
  const form = new FormData();
  form.append('properties[vyber_sluzby]', '2');
  form.append('properties[ulica_miesto_poruchy_lokalita]', AUSEMIO_VO_LOCALITIES[0].value);
  form.append('properties[tel_cislo]', '+421901234567');
  form.append('email', email);
  form.append('locale', 'en');
  form.append('reportTarget', JSON.stringify({ kind: 'manual' }));
  form.append('submissionAttemptId', '4ddc41c3-ce9f-4dd4-9ec0-6c7f7b7f43cf');
  if (intentId) form.append('emailVerificationIntentId', intentId);
  if (verificationToken) form.append('emailVerificationToken', verificationToken);
  return form;
}

async function submit(email: string, intentId?: string, token?: string): Promise<Response> {
  return fetch(`${baseUrl}/api/dev/ausemio-test-submit`, {
    method: 'POST',
    body: submission(email, intentId, token),
  });
}

beforeEach(startServer);
afterEach(stopServer);

describe('email verification API and local submission boundary', () => {
  it('keeps the flag disabled without credentials and does not instantiate or call Resend', async () => {
    const disabled = createServer(createApp({ NODE_ENV: 'test' }));
    await new Promise<void>((resolve, reject) => {
      disabled.once('error', reject);
      disabled.listen(0, '127.0.0.1', resolve);
    });
    const address = disabled.address() as AddressInfo;
    try {
      const status = await fetch(`http://127.0.0.1:${address.port}/api/reports/email-verification/status`);
      expect(status.status).toBe(200);
      expect(await status.json()).toEqual({ enabled: false });
      const request = await fetch(`http://127.0.0.1:${address.port}/api/reports/email-verification/request`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
      });
      expect(request.status).toBe(404);
    } finally {
      await new Promise<void>((resolve, reject) => disabled.close((error) => error ? reject(error) : resolve()));
    }
  });

  it('sends a fake code, binds it to email and intent, requires it at submit, and consumes its capability once', async () => {
    const requested = await requestCode(' Resident@Example.test ');
    expect(requested.code).toMatch(/^\d{6}$/);
    const startBody = await fetch(`${baseUrl}/api/reports/email-verification/request`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'resident@example.test', locale: 'en' }),
    }).then((response) => response.json()) as Record<string, unknown>;
    expect(startBody).not.toHaveProperty('code');
    expect(startBody).not.toHaveProperty('otp');

    expect((await submit('resident@example.test')).status).toBe(403);
    expect((await verify(requested.intentId, 'other@example.test', requested.code)).status).toBe(404);
    const wrongCode = requested.code === '000000' ? '000001' : '000000';
    expect((await verify(requested.intentId, 'resident@example.test', wrongCode)).status).toBe(400);

    const verifiedResponse = await verify(requested.intentId, 'RESIDENT@example.test', requested.code);
    expect(verifiedResponse.status).toBe(200);
    const verified = await verifiedResponse.json() as { verificationToken: string };
    expect(verified.verificationToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const challenge = store.challenges.get(requested.intentId);
    expect(challenge).toBeDefined();
    expect(challenge).not.toHaveProperty('code');
    expect(challenge?.otpDigest.toString('utf8')).not.toContain(requested.code);

    expect((await submit('different@example.test', requested.intentId, verified.verificationToken)).status).toBe(403);
    expect((await submit('resident@example.test', requested.intentId, verified.verificationToken)).status).toBe(200);
    expect((await submit('resident@example.test', requested.intentId, verified.verificationToken)).status).toBe(403);
    expect(provider.deliveries).toHaveLength(2);
  });

  it('deletes an undelivered challenge and fails closed when the fake provider errors', async () => {
    provider.fail = true;
    const response = await fetch(`${baseUrl}/api/reports/email-verification/request`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'delivery-failure@example.test', locale: 'sk' }),
    });
    expect(response.status).toBe(503);
    expect(store.challenges.size).toBe(0);
    expect(await response.json()).toEqual({ success: false, error: { code: 'EMAIL_VERIFICATION_DELIVERY_UNAVAILABLE' } });
  });

  it('enforces resend cooldown, a bounded number of OTP attempts, and per-recipient rate limits', async () => {
    const requested = await requestCode('limits@example.test');
    const resend = await fetch(`${baseUrl}/api/reports/email-verification/request`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'limits@example.test', locale: 'en', intentId: requested.intentId }),
    });
    expect(resend.status).toBe(429);
    expect(resend.headers.get('Retry-After')).toBe(String(EMAIL_OTP_RESEND_COOLDOWN_SECONDS));
    const wrongCode = requested.code === '000000' ? '000001' : '000000';
    const statuses: number[] = [];
    for (let attempt = 0; attempt < EMAIL_OTP_MAX_ATTEMPTS; attempt += 1) {
      statuses.push((await verify(requested.intentId, 'limits@example.test', wrongCode)).status);
    }
    expect(statuses).toEqual([400, 400, 400, 400, 429]);
    expect((await verify(requested.intentId, 'limits@example.test', requested.code)).status).toBe(429);

    for (let requestIndex = 0; requestIndex < 3; requestIndex += 1) {
      const response = await fetch(`${baseUrl}/api/reports/email-verification/request`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'recipient-limit@example.test', locale: 'en' }),
      });
      expect(response.status).toBe(200);
    }
    const limited = await fetch(`${baseUrl}/api/reports/email-verification/request`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'recipient-limit@example.test', locale: 'en' }),
    });
    expect(limited.status).toBe(429);
  });

  it('permits only one concurrent verification and one concurrent final submission', async () => {
    const requested = await requestCode('race@example.test');
    const responses = await Promise.all([
      verify(requested.intentId, 'race@example.test', requested.code),
      verify(requested.intentId, 'race@example.test', requested.code),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    const verified = await responses.find((response) => response.status === 200)?.json() as { verificationToken: string };
    const submissions = await Promise.all([
      submit('race@example.test', requested.intentId, verified.verificationToken),
      submit('race@example.test', requested.intentId, verified.verificationToken),
    ]);
    expect(submissions.map((response) => response.status).sort()).toEqual([200, 403]);
  });
});
