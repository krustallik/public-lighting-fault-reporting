import { describe, expect, it } from 'vitest';
import {
  digestMatches,
  EmailVerificationCrypto,
  EMAIL_OTP_TTL_SECONDS,
  isValidVerificationEmail,
  normalizeVerificationEmail,
} from '../../src/services/emailVerificationCrypto.js';

const crypto = new EmailVerificationCrypto(Buffer.from(Array.from({ length: 32 }, (_, index) => index + 1)).toString('base64url'));
const email = 'resident@example.test';
const intentId = '55c9af58-a37b-4f89-9039-bcc3737cd302';

describe('email verification cryptographic primitives', () => {
  it('normalizes email addresses and enforces the service input shape and length bound', () => {
    const atMaximumLength = `${'l'.repeat(64)}@${'a'.repeat(63)}.${'b'.repeat(63)}.${'c'.repeat(61)}`;
    expect(normalizeVerificationEmail('  Resident@Example.Test  ')).toBe(email);
    expect(isValidVerificationEmail(' Resident@Example.Test ')).toBe(true);
    expect(isValidVerificationEmail('resident@example.test')).toBe(true);
    expect(atMaximumLength).toHaveLength(254);
    expect(isValidVerificationEmail(atMaximumLength)).toBe(true);
    expect(isValidVerificationEmail(`${atMaximumLength}x`)).toBe(false);
    expect(isValidVerificationEmail('resident@example')).toBe(false);
    expect(isValidVerificationEmail('resident @example.test')).toBe(false);
    expect(isValidVerificationEmail('@example.test')).toBe(false);
    expect(isValidVerificationEmail('resident@.test')).toBe(false);
    expect(isValidVerificationEmail('resident@example.')).toBe(false);
    expect(isValidVerificationEmail('resident@example.test@other.test')).toBe(false);
    expect(isValidVerificationEmail(`${'a'.repeat(248)}@x.test`)).toBe(false);
  });

  it('rejects missing HMAC configuration and preserves the ten-minute expiry constant', () => {
    expect(() => new EmailVerificationCrypto('')).toThrow('Email verification key is required.');
    expect(EMAIL_OTP_TTL_SECONDS).toBe(600);
  });

  it('generates six decimal digits, a version-4 UUID intent, and a 32-byte URL-safe capability', () => {
    for (let index = 0; index < 20; index += 1) {
      expect(crypto.createCode()).toMatch(/^\d{6}$/);
    }
    expect(crypto.createIntentId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    const token = crypto.createVerificationToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(token, 'base64url')).toHaveLength(32);
  });

  it('binds keyed digests to purpose, normalized email, intent, code, and token', () => {
    const emailDigest = crypto.emailDigest(email);
    expect(crypto.emailDigest(' RESIDENT@EXAMPLE.TEST ')).toEqual(emailDigest);
    expect(emailDigest.toString('hex')).toBe('76b1a33c994f63f61f970f0c8158604ed7a6df8d5b12b3fdeddb590e62df1424');
    expect(crypto.ipDigest('192.0.2.1')).not.toEqual(emailDigest);
    expect(crypto.ipDigest('192.0.2.1').toString('hex')).toBe('2eead9d59630358e4ed2710a51c0fc19d20517af779cacf832eefbc9e4dca79d');

    const otpDigest = crypto.otpDigest(intentId, emailDigest, '123456');
    expect(otpDigest.toString('hex')).toBe('b4ed519676b3143264fc34d4bed763a0fac992b248995fd82c90feb8c9b39eee');
    expect(crypto.otpDigest(intentId, emailDigest, '123456')).toEqual(otpDigest);
    expect(crypto.otpDigest('changed-intent', emailDigest, '123456')).not.toEqual(otpDigest);
    expect(crypto.otpDigest(intentId, crypto.emailDigest('changed@example.test'), '123456')).not.toEqual(otpDigest);
    expect(crypto.otpDigest(intentId, emailDigest, '123457')).not.toEqual(otpDigest);

    const tokenDigest = crypto.verificationTokenDigest(intentId, emailDigest, 'A'.repeat(43));
    expect(tokenDigest.toString('hex')).toBe('728a99df1bbc79aa602075090fe4bc90fb2616d2afc1a00456eb15a9bb616974');
    expect(crypto.verificationTokenDigest(intentId, emailDigest, 'A'.repeat(43))).toEqual(tokenDigest);
    expect(crypto.verificationTokenDigest(intentId, emailDigest, 'B'.repeat(43))).not.toEqual(tokenDigest);
    expect(tokenDigest).not.toEqual(otpDigest);
  });

  it('compares equal-length digests safely and rejects different values or lengths', () => {
    const expected = Buffer.from('same digest bytes');
    expect(digestMatches(expected, Buffer.from('same digest bytes'))).toBe(true);
    expect(digestMatches(expected, Buffer.from('other digest bytes'))).toBe(false);
    expect(digestMatches(expected, Buffer.from('short'))).toBe(false);
  });
});
