import express from 'express';
import { createServer, type Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EmailVerificationService } from '../../src/services/emailVerification.service.js';
import { createEmailVerificationRouter } from '../../src/routes/emailVerification.routes.js';

let server: Server | undefined;
let baseUrl = '';

async function startRouter(service?: EmailVerificationService, enabled = true): Promise<void> {
  const app = express();
  app.use(express.json());
  app.use('/reports', createEmailVerificationRouter(enabled, service));
  server = createServer(app);
  await new Promise<void>((resolve, reject) => {
    server?.once('error', reject);
    server?.listen(0, '127.0.0.1', resolve);
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

async function stopRouter(): Promise<void> {
  if (server?.listening) await new Promise<void>((resolve, reject) => server?.close((error) => error ? reject(error) : resolve()));
  server = undefined;
}

afterEach(stopRouter);

function fakeService() {
  return {
    requestCode: vi.fn(async () => ({
      status: 'sent' as const,
      intentId: randomUUID(),
      expiresInSeconds: 600,
      retryAfterSeconds: 60,
    })),
    verifyCode: vi.fn(async () => ({ status: 'verified' as const, verificationToken: 'v'.repeat(43), expiresInSeconds: 600 })),
  };
}

async function request(payload: unknown): Promise<Response> {
  return fetch(`${baseUrl}/reports/email-verification/request`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
  });
}

async function verify(payload: unknown): Promise<Response> {
  return fetch(`${baseUrl}/reports/email-verification/verify`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
  });
}

describe('email verification HTTP request contract', () => {
  it('reports disabled state and rejects provider operations while the feature is off', async () => {
    await startRouter(undefined, false);
    expect(await (await fetch(`${baseUrl}/reports/email-verification/status`)).json()).toEqual({ enabled: false });
    expect(await request({ email: 'resident@example.test', locale: 'en' })).toMatchObject({ status: 404 });
    expect(await verify({ intentId: randomUUID(), email: 'resident@example.test', code: '123456' })).toMatchObject({ status: 404 });
  });

  it('validates request shapes before service calls and returns the successful no-store contract', async () => {
    const service = fakeService();
    await startRouter(service as unknown as EmailVerificationService);
    const invalid = [
      null,
      [],
      { email: 'resident@example.test', locale: 'en', extra: true },
      { email: 'resident@example.test', locale: 'de' },
      { email: 'x'.repeat(321), locale: 'en' },
      { email: 'resident@example.test', locale: 'en', intentId: 'not-a-v4-uuid' },
    ];
    for (const body of invalid) expect((await request(body)).status).toBe(400);
    expect(service.requestCode).not.toHaveBeenCalled();

    const success = await request({ email: 'resident@example.test', locale: 'sk' });
    const payload = await success.json();
    expect(success.status).toBe(200);
    expect(success.headers.get('cache-control')).toBe('no-store');
    expect(payload).toMatchObject({ success: true, expiresInSeconds: 600, retryAfterSeconds: 60 });
    expect(service.requestCode).toHaveBeenCalledWith({
      email: 'resident@example.test', locale: 'sk', ipAddress: '127.0.0.1',
    });
  });

  it.each([
    [{ status: 'invalid_email' }, 400, 'EMAIL_VERIFICATION_INVALID_EMAIL', undefined],
    [{ status: 'rate_limited', retryAfterSeconds: 73 }, 429, 'EMAIL_VERIFICATION_RATE_LIMITED', '73'],
    [{ status: 'cooldown', retryAfterSeconds: 17 }, 429, 'EMAIL_VERIFICATION_RESEND_COOLDOWN', '17'],
    [{ status: 'send_limit' }, 429, 'EMAIL_VERIFICATION_SEND_LIMIT', undefined],
    [{ status: 'expired' }, 410, 'EMAIL_VERIFICATION_EXPIRED', undefined],
    [{ status: 'not_found' }, 404, 'EMAIL_VERIFICATION_NOT_FOUND', undefined],
    [{ status: 'delivery_failed' }, 503, 'EMAIL_VERIFICATION_DELIVERY_UNAVAILABLE', undefined],
  ])('maps resend/service outcome %s to a stable public error', async (result, status, code, retryAfter) => {
    const service = fakeService();
    service.requestCode.mockResolvedValueOnce(result as never);
    await startRouter(service as unknown as EmailVerificationService);
    const response = await request({ email: 'resident@example.test', locale: 'en', intentId: randomUUID() });
    expect(response.status).toBe(status);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('retry-after')).toBe(retryAfter ?? null);
    expect(await response.json()).toEqual({ success: false, error: { code } });
  });

  it('fails closed when the verification service rejects unexpectedly', async () => {
    const service = fakeService();
    service.requestCode.mockRejectedValueOnce(new Error('synthetic provider/database failure'));
    await startRouter(service as unknown as EmailVerificationService);
    expect(await (await request({ email: 'resident@example.test', locale: 'en' })).json())
      .toEqual({ success: false, error: { code: 'EMAIL_VERIFICATION_UNAVAILABLE' } });
  });

  it('validates verify payloads, returns a capability, and maps every store outcome', async () => {
    const service = fakeService();
    await startRouter(service as unknown as EmailVerificationService);
    const intentId = randomUUID();
    const invalid = [
      null,
      { intentId, email: 'resident@example.test', code: '123456', extra: true },
      { intentId: 'invalid', email: 'resident@example.test', code: '123456' },
      { intentId, email: 'x'.repeat(321), code: '123456' },
      { intentId, email: 'resident@example.test', code: '1'.repeat(33) },
    ];
    for (const body of invalid) expect((await verify(body)).status).toBe(400);
    expect(service.verifyCode).not.toHaveBeenCalled();

    const success = await verify({ intentId, email: 'resident@example.test', code: '012345' });
    expect(success.status).toBe(200);
    expect(success.headers.get('cache-control')).toBe('no-store');
    expect(await success.json()).toMatchObject({ success: true, verificationToken: 'v'.repeat(43), expiresInSeconds: 600 });
  });

  it.each([
    [{ status: 'invalid_email' }, 400, 'EMAIL_VERIFICATION_INVALID_EMAIL', undefined],
    [{ status: 'rate_limited', retryAfterSeconds: 41 }, 429, 'EMAIL_VERIFICATION_RATE_LIMITED', '41'],
    [{ status: 'invalid' }, 400, 'EMAIL_VERIFICATION_INVALID_CODE', undefined],
    [{ status: 'attempts_exhausted' }, 429, 'EMAIL_VERIFICATION_ATTEMPTS_EXHAUSTED', undefined],
    [{ status: 'expired' }, 410, 'EMAIL_VERIFICATION_EXPIRED', undefined],
    [{ status: 'already_verified' }, 409, 'EMAIL_VERIFICATION_ALREADY_USED', undefined],
    [{ status: 'not_found' }, 404, 'EMAIL_VERIFICATION_NOT_FOUND', undefined],
  ])('maps verification outcome %s to a stable public error', async (result, status, code, retryAfter) => {
    const service = fakeService();
    service.verifyCode.mockResolvedValueOnce(result as never);
    await startRouter(service as unknown as EmailVerificationService);
    const response = await verify({ intentId: randomUUID(), email: 'resident@example.test', code: '123456' });
    expect(response.status).toBe(status);
    expect(response.headers.get('retry-after')).toBe(retryAfter ?? null);
    expect(await response.json()).toEqual({ success: false, error: { code } });
  });

  it('fails closed on unexpected verification persistence errors', async () => {
    const service = fakeService();
    service.verifyCode.mockRejectedValueOnce(new Error('synthetic database failure'));
    await startRouter(service as unknown as EmailVerificationService);
    expect(await (await verify({ intentId: randomUUID(), email: 'resident@example.test', code: '123456' })).json())
      .toEqual({ success: false, error: { code: 'EMAIL_VERIFICATION_UNAVAILABLE' } });
  });
});
