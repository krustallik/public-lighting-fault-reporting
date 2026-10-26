import { afterEach, describe, expect, it } from 'vitest';
import {
  loadLiveDockerDatabaseSecrets,
  loadLiveDockerServerSecrets,
  parseLiveDockerSecret,
} from '../local-uat/liveDockerSecrets.js';

const environmentNames = [
  'DB_PASSWORD', 'JWT_SECRET', 'ADMIN_INITIAL_PASSWORD', 'GEOAPIFY_API_KEY',
  'RESEND_API_KEY', 'RESEND_FROM_EMAIL', 'LOCAL_UAT_APPROVED_EMAIL_RECIPIENT',
  'LOCAL_UAT_RESEND_BLOCKED',
] as const;
const originalEnvironment = new Map(environmentNames.map((name) => [name, process.env[name]]));

afterEach(() => {
  for (const name of environmentNames) {
    const original = originalEnvironment.get(name);
    if (original === undefined) delete process.env[name];
    else process.env[name] = original;
  }
});

describe('live Docker UAT mounted-secret parsing', () => {
  it('trims a single value and permits only an explicitly empty recipient file', () => {
    expect(parseLiveDockerSecret('geoapify_api_key', '  provider-key  \n')).toBe('provider-key');
    expect(parseLiveDockerSecret('approved_email_recipient', '', true)).toBe('');
    expect(() => parseLiveDockerSecret('resend_api_key', '')).toThrow();
  });

  it('rejects unknown mounts, oversized values, null bytes, and embedded lines', () => {
    expect(() => parseLiveDockerSecret('database_url', 'secret')).toThrow();
    expect(() => parseLiveDockerSecret('jwt_secret', 'x'.repeat(4097))).toThrow();
    expect(() => parseLiveDockerSecret('resend_api_key', 'first\nsecond')).toThrow();
    expect(() => parseLiveDockerSecret('db_password', 'bad\0value')).toThrow();
  });

  it('loads only the database and admin bootstrap secrets for disposable database initialization', () => {
    const readSecret = (name: string) => `synthetic-${name}`;
    loadLiveDockerDatabaseSecrets(readSecret);
    expect(process.env.DB_PASSWORD).toBe('synthetic-db_password');
    expect(process.env.JWT_SECRET).toBe('synthetic-jwt_secret');
    expect(process.env.ADMIN_INITIAL_PASSWORD).toBe('synthetic-admin_initial_password');
    expect(process.env.RESEND_API_KEY).toBe(originalEnvironment.get('RESEND_API_KEY'));
  });

  it('loads real-provider secrets for the allowlisted OTP mode', () => {
    const values: Record<string, string> = {
      db_password: 'synthetic-db', jwt_secret: 'synthetic-jwt', geoapify_api_key: 'synthetic-geo',
      approved_email_recipient: 'owner@example.test', resend_api_key: 'synthetic-resend',
      resend_from_email: 'otp@otp.mapa-svietidiel.sk',
    };
    loadLiveDockerServerSecrets(true, (name) => values[name] ?? '');
    expect(process.env.GEOAPIFY_API_KEY).toBe('synthetic-geo');
    expect(process.env.RESEND_API_KEY).toBe('synthetic-resend');
    expect(process.env.RESEND_FROM_EMAIL).toBe('otp@otp.mapa-svietidiel.sk');
    expect(process.env.LOCAL_UAT_APPROVED_EMAIL_RECIPIENT).toBe('owner@example.test');
    expect(process.env.LOCAL_UAT_RESEND_BLOCKED).toBeUndefined();
  });

  it('keeps Resend unconfigured when the recipient file is empty and rejects an unallowlisted bypass', () => {
    const values: Record<string, string> = {
      db_password: 'synthetic-db', jwt_secret: 'synthetic-jwt', geoapify_api_key: 'synthetic-geo',
      approved_email_recipient: '',
    };
    loadLiveDockerServerSecrets(false, (name) => values[name] ?? '');
    expect(process.env.RESEND_API_KEY).toBeUndefined();
    expect(process.env.RESEND_FROM_EMAIL).toBeUndefined();
    expect(process.env.LOCAL_UAT_APPROVED_EMAIL_RECIPIENT).toBeUndefined();
    expect(process.env.LOCAL_UAT_RESEND_BLOCKED).toBe('owner_recipient_missing');

    values.approved_email_recipient = 'owner@example.test';
    expect(() => loadLiveDockerServerSecrets(false, (name) => values[name] ?? '')).toThrow();
  });
});
