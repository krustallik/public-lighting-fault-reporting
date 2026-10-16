import {
  EMAIL_OTP_RESEND_COOLDOWN_SECONDS,
  EMAIL_OTP_TTL_SECONDS,
  EmailVerificationCrypto,
  isValidVerificationEmail,
  normalizeVerificationEmail,
} from './emailVerificationCrypto.js';
import type { EmailVerificationProvider } from './emailVerificationProvider.js';
import type { EmailVerificationStore } from './emailVerificationStore.js';

export class EmailVerificationService {
  constructor(
    private readonly store: EmailVerificationStore,
    private readonly provider: EmailVerificationProvider,
    private readonly crypto: EmailVerificationCrypto
  ) {}

  async requestCode(input: {
    email: string;
    intentId?: string;
    ipAddress: string;
    locale: 'sk' | 'en';
  }): Promise<
    | { status: 'sent'; intentId: string; expiresInSeconds: number; retryAfterSeconds: number }
    | { status: 'rate_limited' | 'cooldown'; retryAfterSeconds: number }
    | { status: 'send_limit' | 'expired' | 'not_found' }
    | { status: 'delivery_failed' }
    | { status: 'invalid_email' }
  > {
    if (!isValidVerificationEmail(input.email)) return { status: 'invalid_email' };
    const email = normalizeVerificationEmail(input.email);
    const intentId = input.intentId ?? this.crypto.createIntentId();
    const emailDigest = this.crypto.emailDigest(email);
    const otp = this.crypto.createCode();
    const otpDigest = this.crypto.otpDigest(intentId, emailDigest, otp);
    const challenge = {
      intentId,
      emailDigest,
      otpDigest,
      ipDigest: this.crypto.ipDigest(input.ipAddress),
    };

    if (input.intentId) {
      const resend = await this.store.resendChallenge(challenge);
      if (resend.status !== 'sent') return { ...resend };
    } else {
      const created = await this.store.createChallenge(challenge);
      if (created !== 'created') return created;
    }

    try {
      await this.provider.sendVerificationCode({ email, code: otp, locale: input.locale });
    } catch {
      await this.store.deleteUndeliveredChallenge(intentId, otpDigest).catch(() => undefined);
      return { status: 'delivery_failed' };
    }

    return {
      status: 'sent',
      intentId,
      expiresInSeconds: EMAIL_OTP_TTL_SECONDS,
      retryAfterSeconds: EMAIL_OTP_RESEND_COOLDOWN_SECONDS,
    };
  }

  async verifyCode(input: {
    intentId: string;
    email: string;
    code: string;
    ipAddress: string;
  }): Promise<
    | { status: 'verified'; verificationToken: string; expiresInSeconds: number }
    | { status: 'rate_limited'; retryAfterSeconds: number }
    | { status: 'invalid' | 'attempts_exhausted' | 'expired' | 'already_verified' | 'not_found'; attemptsRemaining?: number }
    | { status: 'invalid_email' }
  > {
    if (!isValidVerificationEmail(input.email)) return { status: 'invalid_email' };
    if (!/^\d{6}$/.test(input.code)) return { status: 'invalid', attemptsRemaining: undefined };
    const emailDigest = this.crypto.emailDigest(input.email);
    const verificationToken = this.crypto.createVerificationToken();
    const result = await this.store.verifyChallenge({
      intentId: input.intentId,
      emailDigest,
      ipDigest: this.crypto.ipDigest(input.ipAddress),
      otpDigest: this.crypto.otpDigest(input.intentId, emailDigest, input.code),
      verificationTokenDigest: this.crypto.verificationTokenDigest(input.intentId, emailDigest, verificationToken),
    });
    return result.status === 'verified'
      ? { status: 'verified', verificationToken, expiresInSeconds: result.expiresInSeconds }
      : result;
  }

  async consumeSubmissionVerification(input: {
    email: string;
    intentId: string;
    verificationToken: string;
  }): Promise<boolean> {
    if (!isValidVerificationEmail(input.email) ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.intentId) ||
      !/^[A-Za-z0-9_-]{43}$/.test(input.verificationToken)) return false;
    const emailDigest = this.crypto.emailDigest(input.email);
    return this.store.consumeVerification(
      input.intentId,
      emailDigest,
      this.crypto.verificationTokenDigest(input.intentId, emailDigest, input.verificationToken)
    );
  }
}
