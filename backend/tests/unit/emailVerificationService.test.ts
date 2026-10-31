import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EmailVerificationCrypto } from '../../src/services/emailVerificationCrypto.js';
import { EmailVerificationService } from '../../src/services/emailVerification.service.js';
import type { EmailVerificationProvider } from '../../src/services/emailVerificationProvider.js';
import type { EmailVerificationStore } from '../../src/services/emailVerificationStore.js';

const intentId = '55c9af58-a37b-4f89-9039-bcc3737cd302';
const verificationToken = 'A'.repeat(43);

describe('email verification service input and delivery boundaries', () => {
  const store: EmailVerificationStore = {
    createChallenge: vi.fn(),
    resendChallenge: vi.fn(),
    verifyChallenge: vi.fn(),
    deleteUndeliveredChallenge: vi.fn(),
    consumeVerification: vi.fn(),
    cleanupExpired: vi.fn(),
  };
  const provider: EmailVerificationProvider = { sendVerificationCode: vi.fn() };
  const crypto = new EmailVerificationCrypto(
    Buffer.from(Array.from({ length: 32 }, (_, index) => index + 1)).toString('base64url')
  );
  const service = new EmailVerificationService(store, provider, crypto);

  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('rejects invalid addresses and malformed codes before persistence or delivery', async () => {
    await expect(service.requestCode({
      email: 'not-an-address', ipAddress: '127.0.0.1', locale: 'en',
    })).resolves.toEqual({ status: 'invalid_email' });
    await expect(service.verifyCode({
      intentId, email: 'not-an-address', code: '123456', ipAddress: '127.0.0.1',
    })).resolves.toEqual({ status: 'invalid_email' });
    await expect(service.verifyCode({
      intentId, email: 'resident@example.test', code: '12345', ipAddress: '127.0.0.1',
    })).resolves.toEqual({ status: 'invalid', attemptsRemaining: undefined });

    expect(store.createChallenge).not.toHaveBeenCalled();
    expect(store.verifyChallenge).not.toHaveBeenCalled();
    expect(provider.sendVerificationCode).not.toHaveBeenCalled();
  });

  it('fails delivery when cleanup after provider failure also fails', async () => {
    vi.mocked(store.createChallenge).mockResolvedValue('created');
    vi.mocked(provider.sendVerificationCode).mockRejectedValue(new Error('synthetic transport failure'));
    vi.mocked(store.deleteUndeliveredChallenge).mockRejectedValue(new Error('synthetic database failure'));

    await expect(service.requestCode({
      email: 'resident@example.test', ipAddress: '127.0.0.1', locale: 'sk',
    })).resolves.toEqual({ status: 'delivery_failed' });

    expect(store.deleteUndeliveredChallenge).toHaveBeenCalledTimes(1);
  });

  it('preserves resend cooldown and rate-limit outcomes without attempting delivery', async () => {
    vi.mocked(store.resendChallenge).mockResolvedValue({ status: 'cooldown', retryAfterSeconds: 37 });

    await expect(service.requestCode({
      email: 'resident@example.test', intentId, ipAddress: '127.0.0.1', locale: 'sk',
    })).resolves.toEqual({ status: 'cooldown', retryAfterSeconds: 37 });

    expect(store.resendChallenge).toHaveBeenCalledTimes(1);
    expect(provider.sendVerificationCode).not.toHaveBeenCalled();
    expect(store.createChallenge).not.toHaveBeenCalled();
  });

  it('rejects malformed submission capabilities before consulting the store', async () => {
    const invalidInputs = [
      { email: 'bad', intentId, verificationToken },
      { email: 'resident@example.test', intentId: 'not-a-uuid', verificationToken },
      { email: 'resident@example.test', intentId, verificationToken: 'short' },
    ];
    for (const input of invalidInputs) {
      await expect(service.consumeSubmissionVerification(input)).resolves.toBe(false);
    }

    expect(store.consumeVerification).not.toHaveBeenCalled();
  });

  it('passes a well-shaped capability to one store check and preserves a rejected result', async () => {
    vi.mocked(store.consumeVerification).mockResolvedValue(false);

    await expect(service.consumeSubmissionVerification({
      email: 'resident@example.test', intentId, verificationToken,
    })).resolves.toBe(false);

    expect(store.consumeVerification).toHaveBeenCalledTimes(1);
  });
});
