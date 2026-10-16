import { describe, expect, it, vi } from 'vitest';
import { EmailVerificationCrypto, EMAIL_OTP_TTL_SECONDS } from '../../src/services/emailVerificationCrypto.js';
import { EmailDeliveryError, ResendEmailVerificationProvider } from '../../src/services/emailVerificationProvider.js';

const strongKey = Buffer.from(Array.from({ length: 32 }, (_, index) => ((index * 17 + 11) % 255) + 1)).toString('base64url');

describe('email verification cryptography and Resend adapter', () => {
  it('generates six digit codes and keyed digests bound to address and intent', () => {
    const crypto = new EmailVerificationCrypto(strongKey);
    const code = crypto.createCode();
    expect(code).toMatch(/^\d{6}$/);
    expect(EMAIL_OTP_TTL_SECONDS).toBe(600);
    const emailDigest = crypto.emailDigest('Resident@example.test');
    expect(emailDigest).toEqual(crypto.emailDigest(' resident@EXAMPLE.test '));
    expect(crypto.otpDigest('intent-one', emailDigest, code)).not.toEqual(
      crypto.otpDigest('intent-two', emailDigest, code)
    );
    expect(crypto.otpDigest('intent-one', emailDigest, code)).not.toEqual(
      crypto.otpDigest('intent-one', crypto.emailDigest('other@example.test'), code)
    );
    expect(crypto.verificationTokenDigest('intent-one', emailDigest, code)).not.toEqual(
      crypto.otpDigest('intent-one', emailDigest, code)
    );
  });

  it('uses only the fake fetch seam to construct a Resend message', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 200 }));
    const provider = new ResendEmailVerificationProvider('synthetic-key-never-sent', 'lighting@example.test', fetcher);
    await provider.sendVerificationCode({ email: 'resident@example.test', code: '123456', locale: 'en' });
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe('https://api.resend.com/emails');
    expect(init?.method).toBe('POST');
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer synthetic-key-never-sent');
    expect(JSON.parse(String(init?.body))).toEqual({
      from: 'lighting@example.test',
      to: ['resident@example.test'],
      subject: 'Email verification code',
      text: expect.stringContaining('123456'),
    });
  });

  it('returns a generic delivery error for provider rejection or transport failure', async () => {
    const rejected = new ResendEmailVerificationProvider(
      'synthetic-key', 'lighting@example.test',
      vi.fn<typeof fetch>().mockResolvedValue(new Response('private provider response', { status: 503 }))
    );
    await expect(rejected.sendVerificationCode({ email: 'r@example.test', code: '654321', locale: 'sk' }))
      .rejects.toBeInstanceOf(EmailDeliveryError);

    const offline = new ResendEmailVerificationProvider(
      'synthetic-key', 'lighting@example.test',
      vi.fn<typeof fetch>().mockRejectedValue(new Error('synthetic network failure'))
    );
    await expect(offline.sendVerificationCode({ email: 'r@example.test', code: '654321', locale: 'sk' }))
      .rejects.toThrow('Email verification delivery failed.');
  });
});
