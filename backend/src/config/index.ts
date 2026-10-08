import dotenv from 'dotenv';
import { readFileSync } from 'node:fs';
import { createAddressIpLimiterConfig, createAddressProviderConfig } from './addressProvider.js';
import { parseTrustedProxyCidrs } from '../security/clientAddress.js';

dotenv.config();

export const PRODUCTION_PUBLIC_ORIGIN =
  'https://mapa.vra-ubuntu-server-0579.virtual.cloud.tuke.sk';
export const PRODUCTION_ADMIN_ORIGIN =
  'https://admin.mapa.vra-ubuntu-server-0579.virtual.cloud.tuke.sk';

const DEFAULT_JWT_SECRET = 'dev-only-change-in-production';

export interface RuntimeConfig {
  port: number;
  nodeEnv: string;
  corsOrigin: string;
  publicOrigin?: string;
  adminOrigin?: string;
  trustProxyCidrs: string[];
  jwtSecret: string;
  db: { host: string; port: number; database: string; user: string; password: string };
  aussemio: { baseUrl: string; apiKey: string; testMode: boolean; locale: string };
  geocoding: {
    autoGeocode: boolean;
    nominatimBaseUrl: string;
    userAgent: string;
    acceptLanguage: string;
    minIntervalMs: number;
  };
  addressProvider: ReturnType<typeof createAddressProviderConfig>;
  addressIpLimiter: ReturnType<typeof createAddressIpLimiterConfig>;
}

function integer(env: Record<string, string | undefined>, name: string, fallback: number): number {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  if (!/^\d+$/.test(raw)) throw new Error(`${name} must be an integer.`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1 || value > 65535) {
    throw new Error(`${name} is outside its allowed range.`);
  }
  return value;
}

function secret(env: Record<string, string | undefined>, name: string): string | undefined {
  const direct = env[name];
  const file = env[`${name}_FILE`];
  if (direct !== undefined && file !== undefined) {
    throw new Error(`Set either ${name} or ${name}_FILE, not both.`);
  }
  if (file !== undefined) {
    try {
      return readFileSync(file, 'utf8').replace(/[\r\n]+$/, '');
    } catch {
      throw new Error(`${name}_FILE could not be read.`);
    }
  }
  return direct;
}

function required(env: Record<string, string | undefined>, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function assertExactHttpsOrigin(value: string, expected: string, name: string): void {
  let parsed: URL;
  try { parsed = new URL(value); } catch { throw new Error(`${name} is invalid.`); }
  if (parsed.origin !== expected || parsed.href !== `${expected}/`) {
    throw new Error(`${name} must be exactly ${expected}.`);
  }
}

function assertJwtSecret(value: string): void {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error('JWT_SECRET must be unpadded base64url.');
  }
  const decoded = Buffer.from(value, 'base64url');
  if (decoded.length < 32 || decoded.toString('base64url') !== value) {
    throw new Error('JWT_SECRET must encode at least 32 bytes as canonical base64url.');
  }
  if (decoded.every((byte) => byte === decoded[0])) {
    throw new Error('JWT_SECRET is an obviously weak repeated-byte value.');
  }
  if (
    value === DEFAULT_JWT_SECRET ||
    /^(.)\1{42,}$/.test(value) ||
    ['AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB']
      .includes(value)
  ) {
    throw new Error('JWT_SECRET is a known or obviously weak value.');
  }
}

function assertProductionEnvironment(
  env: Record<string, string | undefined>,
  values: { jwtSecret: string; dbPassword: string; providerKey: string; trustProxyCidrs: string }
): void {
  if (env.NODE_ENV !== 'production') throw new Error('NODE_ENV must be exactly production.');
  assertExactHttpsOrigin(required(env, 'PUBLIC_ORIGIN'), PRODUCTION_PUBLIC_ORIGIN, 'PUBLIC_ORIGIN');
  assertExactHttpsOrigin(required(env, 'ADMIN_ORIGIN'), PRODUCTION_ADMIN_ORIGIN, 'ADMIN_ORIGIN');
  if (env.CORS_ORIGIN !== undefined) throw new Error('CORS_ORIGIN must be absent for same-origin production APIs.');

  const proxyCidrs = parseTrustedProxyCidrs(values.trustProxyCidrs);
  if (proxyCidrs.length !== 1 || proxyCidrs[0].family !== 4 || proxyCidrs[0].prefix !== 32) {
    throw new Error('TRUST_PROXY_CIDRS must contain exactly one IPv4 /32 proxy address.');
  }
  if (proxyCidrs[0].normalized !== '172.30.0.2') {
    throw new Error('TRUST_PROXY_CIDRS must identify the exact private Nginx proxy at 172.30.0.2.');
  }

  const dbHost = required(env, 'DB_HOST').toLowerCase();
  if (dbHost !== 'db') {
    throw new Error('DB_HOST must identify the private PostgreSQL Compose service "db".');
  }
  if (required(env, 'DB_PORT') !== '5432') {
    throw new Error('DB_PORT must be the private PostgreSQL service port 5432.');
  }
  required(env, 'DB_NAME');
  if (required(env, 'DB_USER') !== 'lighting_runtime') {
    throw new Error('DB_USER must be the lighting_runtime role.');
  }
  if (!values.dbPassword.trim() || ['postgres', 'password', 'dev-only-change-in-production'].includes(values.dbPassword)) {
    throw new Error('DB_PASSWORD must be a non-default runtime credential.');
  }
  assertJwtSecret(values.jwtSecret);

  if (env.GEOAPIFY_ENABLED !== 'true') {
    throw new Error('GEOAPIFY_ENABLED must be true for public report-address suggestions.');
  }
  if (!values.providerKey.trim()) throw new Error('GEOAPIFY_API_KEY is required in production.');
  if (env.NOMINATIM_AUTO_GEOCODE !== 'false') {
    throw new Error('NOMINATIM_AUTO_GEOCODE must remain false in production.');
  }
  if (env.LOCAL_TEST_SUBMIT_ENABLED !== 'false') {
    throw new Error('LOCAL_TEST_SUBMIT_ENABLED must remain false in production.');
  }
  if (env.GEOAPIFY_BASE_URL !== 'https://api-eu.geoapify.com') {
    throw new Error('GEOAPIFY_BASE_URL must be explicitly set to the approved EU origin.');
  }
  if (env.AUSEMIO_API_KEY?.trim()) {
    throw new Error('AUSEMIO_API_KEY must be absent while AUSEMIO is on hold.');
  }
  if (env.ADMIN_INITIAL_PASSWORD !== undefined) {
    throw new Error('ADMIN_INITIAL_PASSWORD must be absent from production runtime.');
  }
  const forbiddenPrefixes = ['MIGRATION_DB_', 'BOOTSTRAP_DB_'];
  if (Object.entries(env).some(([key, value]) =>
    value !== undefined && forbiddenPrefixes.some((prefix) => key.startsWith(prefix))
  )) {
    throw new Error('Migration/bootstrap credentials must not be present in the HTTP runtime.');
  }
}

export function createRuntimeConfig(env: Record<string, string | undefined>): RuntimeConfig {
  const nodeEnv = env.NODE_ENV || 'development';
  const production = nodeEnv === 'production';
  const jwtSecret = secret(env, 'JWT_SECRET') || DEFAULT_JWT_SECRET;
  const dbPassword = secret(env, 'DB_PASSWORD') || 'postgres';
  const providerKey = secret(env, 'GEOAPIFY_API_KEY') || '';
  const normalizedEnv = { ...env, GEOAPIFY_API_KEY: providerKey };
  const trustProxyCidrs = env.TRUST_PROXY_CIDRS || '';

  if (production) {
    assertProductionEnvironment(env, { jwtSecret, dbPassword, providerKey, trustProxyCidrs });
  }

  const addressProvider = createAddressProviderConfig(normalizedEnv, { production });
  const addressIpLimiter = createAddressIpLimiterConfig(env, { production });
  const config: RuntimeConfig = {
    port: integer(env, 'PORT', 5000),
    nodeEnv,
    corsOrigin: production ? '' : env.CORS_ORIGIN || 'http://localhost:5173',
    publicOrigin: production ? PRODUCTION_PUBLIC_ORIGIN : env.PUBLIC_ORIGIN,
    adminOrigin: production ? PRODUCTION_ADMIN_ORIGIN : env.ADMIN_ORIGIN,
    trustProxyCidrs: trustProxyCidrs.split(',').map((value) => value.trim()).filter(Boolean),
    jwtSecret,
    db: {
      host: production ? required(env, 'DB_HOST') : env.DB_HOST || 'localhost',
      port: integer(env, 'DB_PORT', 5432),
      database: production ? required(env, 'DB_NAME') : env.DB_NAME || 'lighting_faults',
      user: production ? required(env, 'DB_USER') : env.DB_USER || 'postgres',
      password: dbPassword,
    },
    aussemio: {
      baseUrl: env.AUSEMIO_BASE_URL || 'https://kosice.ausemio.io/public_issues',
      apiKey: production ? '' : env.AUSEMIO_API_KEY || '',
      testMode: env.AUSEMIO_TEST_MODE !== 'false',
      locale: env.AUSEMIO_LOCALE || 'sk',
    },
    geocoding: {
      autoGeocode: !production && env.NOMINATIM_AUTO_GEOCODE === 'true',
      nominatimBaseUrl: env.NOMINATIM_BASE_URL || 'https://nominatim.openstreetmap.org',
      userAgent: env.NOMINATIM_USER_AGENT || 'PublicLightingFaultReporting/1.0',
      acceptLanguage: env.NOMINATIM_ACCEPT_LANGUAGE || 'sk',
      minIntervalMs: integer(env, 'NOMINATIM_MIN_INTERVAL_MS', 1100),
    },
    addressProvider,
    addressIpLimiter,
  };
  return config;
}

export const config = createRuntimeConfig(process.env);
