import { describe, expect, it } from 'vitest';
import { PRODUCTION_ADMIN_ORIGIN, PRODUCTION_PUBLIC_ORIGIN, createRuntimeConfig } from '../../src/config/index.js';

const strongJwt = Buffer.from([
  19, 203, 44, 91, 7, 166, 230, 51, 116, 9, 189, 64, 233, 18, 143, 78,
  91, 4, 172, 225, 36, 105, 252, 11, 147, 55, 204, 63, 18, 171, 99, 240,
]).toString('base64url');

function productionEnv(overrides: Record<string, string | undefined> = {}): Record<string, string | undefined> {
  return {
    NODE_ENV: 'production',
    PUBLIC_ORIGIN: PRODUCTION_PUBLIC_ORIGIN,
    ADMIN_ORIGIN: PRODUCTION_ADMIN_ORIGIN,
    TRUST_PROXY_CIDRS: '172.30.0.2/32',
    DB_HOST: 'db',
    DB_PORT: '5432',
    DB_NAME: 'lighting_faults',
    DB_USER: 'lighting_runtime',
    DB_PASSWORD: 'synthetic-runtime-password-for-tests',
    JWT_SECRET: strongJwt,
    GEOAPIFY_ENABLED: 'true',
    GEOAPIFY_BASE_URL: 'https://api-eu.geoapify.com',
    GEOAPIFY_API_KEY: 'synthetic-provider-key',
    GEOAPIFY_TIMEOUT_MS: '3000',
    GEOAPIFY_MAX_ACTIVE: '1',
    GEOAPIFY_MAX_PENDING: '1',
    GEOAPIFY_START_INTERVAL_MS: '250',
    GEOAPIFY_QUEUE_EXPIRY_MS: '4000',
    GEOAPIFY_DAILY_BUDGET: '2700',
    ADDRESS_IP_BUCKET_BURST: '10',
    ADDRESS_IP_REFILL_PER_MINUTE: '30',
    ADDRESS_IP_MAX_KEYS: '8192',
    ADDRESS_IP_IDLE_TTL_MS: '120000',
    NOMINATIM_AUTO_GEOCODE: 'false',
    LOCAL_TEST_SUBMIT_ENABLED: 'false',
    ...overrides,
  };
}

describe('production runtime configuration boundary', () => {
  it('accepts exact approved origins and least-privilege runtime settings', () => {
    const config = createRuntimeConfig(productionEnv());
    expect(config.nodeEnv).toBe('production');
    expect(config.db.user).toBe('lighting_runtime');
    expect(config.addressProvider.enabled).toBe(true);
    expect(config.geocoding.autoGeocode).toBe(false);
  });

  it.each([
    ['unapproved public origin', { PUBLIC_ORIGIN: 'https://example.com' }],
    ['CORS configured for production', { CORS_ORIGIN: 'https://example.com' }],
    ['broad proxy trust', { TRUST_PROXY_CIDRS: '172.30.0.0/24' }],
    ['unexpected proxy address', { TRUST_PROXY_CIDRS: '172.30.0.3/32' }],
    ['external database host', { DB_HOST: 'db.example.com' }],
    ['unexpected database port', { DB_PORT: '15432' }],
    ['default database user', { DB_USER: 'postgres' }],
    ['default database password', { DB_PASSWORD: 'postgres' }],
    ['missing provider key', { GEOAPIFY_API_KEY: '' }],
    ['implicit provider origin', { GEOAPIFY_BASE_URL: undefined }],
    ['provider disabled', { GEOAPIFY_ENABLED: 'false' }],
    ['legacy inventory geocoding', { NOMINATIM_AUTO_GEOCODE: 'true' }],
    ['implicit inventory geocoding setting', { NOMINATIM_AUTO_GEOCODE: undefined }],
    ['local test sink', { LOCAL_TEST_SUBMIT_ENABLED: 'true' }],
    ['implicit local sink setting', { LOCAL_TEST_SUBMIT_ENABLED: undefined }],
    ['AUSEMIO credential', { AUSEMIO_API_KEY: 'synthetic-forbidden' }],
    ['bootstrap credential in HTTP runtime', { BOOTSTRAP_DB_PASSWORD: 'synthetic-forbidden' }],
    ['migration credential in HTTP runtime', { MIGRATION_DB_USER: 'lighting_migrator' }],
    ['default JWT secret', { JWT_SECRET: 'dev-only-change-in-production' }],
  ])('rejects %s', (_case, overrides) => {
    expect(() => createRuntimeConfig(productionEnv(overrides))).toThrow();
  });

  it('allows development configuration without applying production-only gates', () => {
    expect(createRuntimeConfig({ NODE_ENV: 'development' }).nodeEnv).toBe('development');
  });

  it('requires every provider admission and IP limiter bound to be explicit and within limits', () => {
    expect(() => createRuntimeConfig(productionEnv({ GEOAPIFY_QUEUE_EXPIRY_MS: undefined })))
      .toThrow(/GEOAPIFY_QUEUE_EXPIRY_MS/);
    expect(() => createRuntimeConfig(productionEnv({ GEOAPIFY_MAX_PENDING: '1000000' })))
      .toThrow(/GEOAPIFY_MAX_PENDING/);
    expect(() => createRuntimeConfig(productionEnv({ ADDRESS_IP_MAX_KEYS: undefined })))
      .toThrow(/ADDRESS_IP_MAX_KEYS/);
  });
});
