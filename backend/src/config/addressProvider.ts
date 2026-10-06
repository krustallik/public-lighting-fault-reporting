import dotenv from 'dotenv';

dotenv.config();

export interface AddressProviderConfig {
  enabled: boolean;
  baseUrl: string;
  apiKey: string;
  timeoutMs: number;
  maxActive: number;
  maxPending: number;
  startIntervalMs: number;
  queueExpiryMs: number;
  dailyBudget: number;
}

export const ADDRESS_PROVIDER_DEFAULTS = {
  enabled: false,
  baseUrl: 'https://api-eu.geoapify.com',
  apiKey: '',
  timeoutMs: 3000,
  maxActive: 1,
  maxPending: 1,
  startIntervalMs: 250,
  queueExpiryMs: 4000,
  dailyBudget: 2700,
} as const;

function integerSetting(env: Record<string, string | undefined>, key: string, fallback: number, minimum: number): number {
  const raw = env[key];
  if (raw === undefined) return fallback;
  if (!/^\d+$/.test(raw)) throw new Error(`${key} must be an integer.`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum) throw new Error(`${key} is outside its allowed range.`);
  return value;
}

export function createAddressProviderConfig(env: Record<string, string | undefined>): AddressProviderConfig {
  const enabledRaw = env.GEOAPIFY_ENABLED;
  if (enabledRaw !== undefined && enabledRaw !== 'true' && enabledRaw !== 'false') {
    throw new Error('GEOAPIFY_ENABLED must be true or false.');
  }
  const enabled = enabledRaw === 'true';
  const baseUrl = env.GEOAPIFY_BASE_URL || ADDRESS_PROVIDER_DEFAULTS.baseUrl;
  let parsed: URL;
  try { parsed = new URL(baseUrl); } catch { throw new Error('GEOAPIFY_BASE_URL is invalid.'); }
  if (
    parsed.protocol !== 'https:' || parsed.username || parsed.password ||
    parsed.hostname.toLowerCase() !== 'api-eu.geoapify.com' || parsed.port ||
    !['', '/'].includes(parsed.pathname) || parsed.search || parsed.hash
  ) throw new Error('GEOAPIFY_BASE_URL must be the allowlisted HTTPS Geoapify origin.');
  const apiKey = env.GEOAPIFY_API_KEY || '';
  if (enabled && !apiKey.trim()) throw new Error('GEOAPIFY_API_KEY is required when Geoapify is enabled.');
  return {
    enabled,
    baseUrl: parsed.origin,
    apiKey,
    timeoutMs: integerSetting(env, 'GEOAPIFY_TIMEOUT_MS', 3000, 1),
    maxActive: integerSetting(env, 'GEOAPIFY_MAX_ACTIVE', 1, 1),
    maxPending: integerSetting(env, 'GEOAPIFY_MAX_PENDING', 1, 0),
    startIntervalMs: integerSetting(env, 'GEOAPIFY_START_INTERVAL_MS', 250, 0),
    queueExpiryMs: integerSetting(env, 'GEOAPIFY_QUEUE_EXPIRY_MS', 4000, 1),
    dailyBudget: integerSetting(env, 'GEOAPIFY_DAILY_BUDGET', 2700, 1),
  };
}

export const addressProviderConfig = createAddressProviderConfig(process.env);

export interface AddressIpLimiterConfig {
  burst: number;
  refillPerMinute: number;
  maxKeys: number;
  idleTtlMs: number;
}

export function createAddressIpLimiterConfig(env: Record<string, string | undefined>): AddressIpLimiterConfig {
  return {
    burst: integerSetting(env, 'ADDRESS_IP_BUCKET_BURST', 10, 1),
    refillPerMinute: integerSetting(env, 'ADDRESS_IP_REFILL_PER_MINUTE', 30, 1),
    maxKeys: integerSetting(env, 'ADDRESS_IP_MAX_KEYS', 8192, 1),
    idleTtlMs: integerSetting(env, 'ADDRESS_IP_IDLE_TTL_MS', 120000, 1),
  };
}

export const addressIpLimiterConfig = createAddressIpLimiterConfig(process.env);
