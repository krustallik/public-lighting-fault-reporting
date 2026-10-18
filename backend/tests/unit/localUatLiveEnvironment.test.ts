import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  assertLiveProviderLocalUatEnvironment,
  assertLiveProviderLocalUatWorkingDirectory,
} from '../local-uat/liveEnvironment.js';
import { loadRuntimeDotenv } from '../../src/config/dotenvPolicy.js';

function validEnvironment(): Record<string, string | undefined> {
  return {
    NODE_ENV: 'development',
    LOCAL_UAT_MODE: 'true',
    LIVE_PROVIDER_LOCAL_UAT: 'true',
    DB_HOST: '127.0.0.1',
    DB_PORT: '5433',
    DB_NAME: 'lighting_faults_local_uat_dev',
    DB_USER: 'plfr_uat',
    DB_PASSWORD: 'a'.repeat(64),
    JWT_SECRET: Buffer.from(Array.from({ length: 32 }, (_value, index) => index + 1)).toString('base64url'),
    PORT: '5000',
    CORS_ORIGIN: 'http://127.0.0.1:5173',
    EMAIL_VERIFICATION_ENABLED: 'true',
    RESEND_API_KEY: 'test-resend-key',
    RESEND_FROM_EMAIL: 'reports@example.test',
    LOCAL_UAT_APPROVED_EMAIL_RECIPIENT: 'owner@example.test',
    GEOAPIFY_ENABLED: 'true',
    GEOAPIFY_BASE_URL: 'https://api-eu.geoapify.com',
    GEOAPIFY_API_KEY: 'test-geo-key',
    NOMINATIM_AUTO_GEOCODE: 'false',
    LOCAL_TEST_SUBMIT_ENABLED: 'true',
  };
}

describe('live provider local UAT entrypoint guard', () => {
  it('accepts only the explicit local loopback provider configuration', () => {
    expect(() => assertLiveProviderLocalUatEnvironment(validEnvironment())).not.toThrow();
  });

  it('does not invoke dotenv in live provider UAT while preserving normal mode', () => {
    const load = vi.fn();
    loadRuntimeDotenv({ LIVE_PROVIDER_LOCAL_UAT: 'true' }, load);
    expect(load).not.toHaveBeenCalled();

    load.mockClear();
    loadRuntimeDotenv({ LIVE_PROVIDER_LOCAL_UAT: 'false' }, load);
    expect(load).toHaveBeenCalledOnce();
    expect(load).toHaveBeenCalledWith();
  });

  it.each([
    ['missing explicit mode', 'LIVE_PROVIDER_LOCAL_UAT', undefined],
    ['production mode', 'NODE_ENV', 'production'],
    ['remote database', 'DB_HOST', 'database.example.test'],
    ['wrong disposable database', 'DB_NAME', 'production'],
    ['disabled Resend verification', 'EMAIL_VERIFICATION_ENABLED', 'false'],
    ['missing Resend key', 'RESEND_API_KEY', ''],
    ['invalid Resend sender', 'RESEND_FROM_EMAIL', 'not-an-address'],
    ['missing recipient allowlist', 'LOCAL_UAT_APPROVED_EMAIL_RECIPIENT', ''],
    ['disabled Geoapify', 'GEOAPIFY_ENABLED', 'false'],
    ['non-EU provider origin', 'GEOAPIFY_BASE_URL', 'https://api.geoapify.com'],
    ['enabled Nominatim', 'NOMINATIM_AUTO_GEOCODE', 'true'],
    ['missing local sink flag', 'LOCAL_TEST_SUBMIT_ENABLED', 'false'],
    ['disabled TLS certificate validation', 'NODE_TLS_REJECT_UNAUTHORIZED', '0'],
    ['dotenv vault key present', 'DOTENV_KEY', 'dotenv://example.test/vault/development?key=synthetic'],
    ['AUSEMIO credential present', 'AUSEMIO_API_KEY', 'must-not-be-present'],
    ['provider file indirection present', 'RESEND_API_KEY_FILE', ''],
  ])('rejects %s before provider composition', (_label, key, value) => {
    const env = validEnvironment();
    if (value === undefined) delete env[key!];
    else env[key!] = value;
    expect(() => assertLiveProviderLocalUatEnvironment(env)).toThrow(
      'Live provider local UAT requires explicit provider configuration and the dedicated loopback database.'
    );
  });

  it('rejects malformed local JWT secrets, multiline values and a different working directory', () => {
    const env = validEnvironment();
    env.JWT_SECRET = Buffer.alloc(8, 21).toString('base64url');
    expect(() => assertLiveProviderLocalUatEnvironment(env)).toThrow();

    const withNewline = validEnvironment();
    withNewline.GEOAPIFY_API_KEY = 'fake\nkey';
    expect(() => assertLiveProviderLocalUatEnvironment(withNewline)).toThrow();

    const expected = path.join('private', '.local-uat');
    expect(() => assertLiveProviderLocalUatWorkingDirectory(expected, expected)).not.toThrow();
    expect(() => assertLiveProviderLocalUatWorkingDirectory('repository', expected)).toThrow(
      'Live provider local UAT must run from its private state directory.'
    );
  });
});
