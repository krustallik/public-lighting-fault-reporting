import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, EmailVerificationApiError } from '@/services/api';

function jsonResponse(body: unknown, status = 200, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
}

afterEach(() => vi.unstubAllGlobals());

describe('public API client contracts', () => {
  it('returns health and disabled OTP status from their read-only endpoints', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ status: 'ok' }))
      .mockResolvedValueOnce(jsonResponse({ enabled: false }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(api.getHealth()).resolves.toEqual({ status: 'ok' });
    await expect(api.getEmailVerificationStatus()).resolves.toEqual({ enabled: false });
    expect(fetchMock.mock.calls[0][0]).toBe('http://localhost:5000/api/health');
    expect(fetchMock.mock.calls[1]).toEqual(['http://localhost:5000/api/reports/email-verification/status', {
      credentials: 'same-origin', cache: 'no-store',
    }]);
  });

  it('sends OTP request and verify payloads as same-origin JSON with optional intent reuse', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ success: true, intentId: '12345678-1234-4234-8234-123456789abc', expiresInSeconds: 600, retryAfterSeconds: 60 }))
      .mockResolvedValueOnce(jsonResponse({ success: true, verificationToken: 'synthetic-token', expiresInSeconds: 590 }))
      .mockResolvedValueOnce(jsonResponse({ success: true, intentId: 'new-intent', expiresInSeconds: 600, retryAfterSeconds: 60 }));
    vi.stubGlobal('fetch', fetchMock);

    await api.requestEmailVerificationCode('citizen@example.test', 'sk');
    await api.verifyEmailCode('12345678-1234-4234-8234-123456789abc', 'citizen@example.test', '135790');
    await api.requestEmailVerificationCode('citizen@example.test', 'en', '12345678-1234-4234-8234-123456789abc');

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      'http://localhost:5000/api/reports/email-verification/request',
      'http://localhost:5000/api/reports/email-verification/verify',
      'http://localhost:5000/api/reports/email-verification/request',
    ]);
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' } });
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({ email: 'citizen@example.test', locale: 'sk' });
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body))).toEqual({ intentId: '12345678-1234-4234-8234-123456789abc', email: 'citizen@example.test', code: '135790' });
    expect(JSON.parse(String(fetchMock.mock.calls[2][1]?.body))).toEqual({ email: 'citizen@example.test', locale: 'en', intentId: '12345678-1234-4234-8234-123456789abc' });
  });

  it('maps status, rate-limit, malformed JSON, and unreadable payload failures to closed API errors', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ enabled: 'yes' }))
      .mockResolvedValueOnce(jsonResponse({ success: false, error: { code: 'EMAIL_VERIFICATION_RESEND_COOLDOWN' } }, 429, { 'Retry-After': '45' }))
      .mockResolvedValueOnce(new Response('{bad-json', { status: 503 }))
      .mockResolvedValueOnce(jsonResponse(['unexpected'], 200));
    vi.stubGlobal('fetch', fetchMock);

    await expect(api.getEmailVerificationStatus()).rejects.toMatchObject({ name: 'EmailVerificationApiError', status: 200, code: 'EMAIL_VERIFICATION_STATUS_UNAVAILABLE' });
    await expect(api.requestEmailVerificationCode('citizen@example.test', 'en')).rejects.toMatchObject({ status: 429, code: 'EMAIL_VERIFICATION_RESEND_COOLDOWN', retryAfterSeconds: 45 });
    await expect(api.verifyEmailCode('intent', 'citizen@example.test', 'wrong')).rejects.toMatchObject({ status: 503, code: 'EMAIL_VERIFICATION_UNAVAILABLE' });
    await expect(api.getEmailVerificationStatus()).rejects.toBeInstanceOf(EmailVerificationApiError);
  });

  it('fails a non-OK health response with its status and rejects malformed local success bodies', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('down', { status: 503 }))
      .mockResolvedValueOnce(jsonResponse({ success: true, status: 'local_test_received', filesReceived: Number.POSITIVE_INFINITY }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(api.getHealth()).rejects.toThrow('Health check failed (503)');
    await expect(api.sendLocalTestSubmission(new FormData())).rejects.toMatchObject({ code: 'LOCAL_TEST_ENDPOINT_RESPONSE_ERROR' });
  });
});
