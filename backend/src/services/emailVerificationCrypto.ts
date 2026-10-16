import { createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

export const EMAIL_OTP_TTL_SECONDS = 10 * 60;
export const EMAIL_OTP_RESEND_COOLDOWN_SECONDS = 60;
export const EMAIL_OTP_MAX_SENDS = 3;
export const EMAIL_OTP_MAX_ATTEMPTS = 5;

export function normalizeVerificationEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isValidVerificationEmail(email: string): boolean {
  const normalized = normalizeVerificationEmail(email);
  return normalized.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized);
}

export class EmailVerificationCrypto {
  constructor(private readonly key: string) {
    if (!key) throw new Error('Email verification key is required.');
  }

  private digest(purpose: string, value: string): Buffer {
    return createHmac('sha256', this.key)
      .update(`public-lighting-email-verification:v1:${purpose}\0${value}`)
      .digest();
  }

  emailDigest(email: string): Buffer {
    return this.digest('email', normalizeVerificationEmail(email));
  }

  ipDigest(ip: string): Buffer {
    return this.digest('ip', ip);
  }

  otpDigest(intentId: string, emailDigest: Buffer, code: string): Buffer {
    return this.digest('otp', `${intentId}\0${emailDigest.toString('base64url')}\0${code}`);
  }

  verificationTokenDigest(intentId: string, emailDigest: Buffer, token: string): Buffer {
    return this.digest('submission-token', `${intentId}\0${emailDigest.toString('base64url')}\0${token}`);
  }

  createCode(): string {
    return randomInt(0, 1_000_000).toString().padStart(6, '0');
  }

  createIntentId(): string {
    return cryptoRandomUuid();
  }

  createVerificationToken(): string {
    return randomBytes(32).toString('base64url');
  }
}

function cryptoRandomUuid(): string {
  // randomBytes keeps this module's secure random dependency explicit.
  const bytes = randomBytes(16);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function digestMatches(actual: Buffer, expected: Buffer): boolean {
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
