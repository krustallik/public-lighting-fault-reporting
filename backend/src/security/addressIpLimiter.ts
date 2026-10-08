import { createHmac, randomBytes } from 'node:crypto';
import type { AddressIpLimiterConfig } from '../config/addressProvider.js';
import { config } from '../config/index.js';
import { normalizeLimiterAddress } from './clientAddress.js';

interface Bucket { tokens: number; updatedAt: number; lastSeenAt: number }
export type AddressLimitResult = { allowed: true } | { allowed: false; code: 'rate_limited' | 'limiter_capacity'; retryAfterSeconds: number };

export function createAddressIpLimiter(
  settings: AddressIpLimiterConfig,
  now: () => number = Date.now,
  secret: Buffer = randomBytes(32)
) {
  if (!Number.isSafeInteger(settings.burst) || settings.burst < 1 ||
    !Number.isSafeInteger(settings.refillPerMinute) || settings.refillPerMinute < 1 ||
    !Number.isSafeInteger(settings.maxKeys) || settings.maxKeys < 1 ||
    !Number.isSafeInteger(settings.idleTtlMs) || settings.idleTtlMs < 1 || secret.length !== 32) {
    throw new Error('Invalid address limiter settings.');
  }
  const buckets = new Map<string, Bucket>();
  const refillPerMs = settings.refillPerMinute / 60_000;

  return {
    consume(address: string): AddressLimitResult {
      const normalized = normalizeLimiterAddress(address);
      if (!normalized) return { allowed: false, code: 'limiter_capacity', retryAfterSeconds: 60 };
      const key = createHmac('sha256', secret).update(normalized).digest('hex');
      const currentTime = now();
      let bucket = buckets.get(key);
      if (!bucket) {
        for (const [candidateKey, candidate] of buckets) {
          if (currentTime - candidate.lastSeenAt >= settings.idleTtlMs) buckets.delete(candidateKey);
        }
        if (buckets.size >= settings.maxKeys) {
          return { allowed: false, code: 'limiter_capacity', retryAfterSeconds: Math.max(1, Math.ceil(settings.idleTtlMs / 1000)) };
        }
        bucket = { tokens: settings.burst, updatedAt: currentTime, lastSeenAt: currentTime };
        buckets.set(key, bucket);
      }
      const elapsed = Math.max(0, currentTime - bucket.updatedAt);
      bucket.tokens = Math.min(settings.burst, bucket.tokens + elapsed * refillPerMs);
      bucket.updatedAt = currentTime;
      bucket.lastSeenAt = currentTime;
      if (bucket.tokens < 1) {
        const retryAfterSeconds = Math.max(1, Math.ceil((1 - bucket.tokens) / refillPerMs / 1000));
        return { allowed: false, code: 'rate_limited', retryAfterSeconds };
      }
      bucket.tokens -= 1;
      return { allowed: true };
    },
    size(): number { return buckets.size; },
  };
}

export const addressIpLimiter = createAddressIpLimiter(config.addressIpLimiter);
