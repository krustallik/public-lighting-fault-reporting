import { describe, expect, it } from 'vitest';
import { createAddressIpLimiterConfig, createAddressProviderConfig } from '../../src/config/addressProvider.js';

describe('address provider server configuration', () => {
  it('is disabled by default with the approved bounded settings', () => {
    expect(createAddressProviderConfig({})).toEqual({
      enabled: false,
      baseUrl: 'https://api-eu.geoapify.com',
      apiKey: '',
      timeoutMs: 3000,
      maxActive: 1,
      maxPending: 1,
      startIntervalMs: 250,
      queueExpiryMs: 4000,
      dailyBudget: 2700,
    });
    expect(createAddressIpLimiterConfig({})).toEqual({ burst: 10, refillPerMinute: 30, maxKeys: 8192, idleTtlMs: 120000 });
  });

  it('requires a server key and rejects non-allowlisted or credential-bearing origins', () => {
    expect(() => createAddressProviderConfig({ GEOAPIFY_ENABLED: 'true' })).toThrow('GEOAPIFY_API_KEY');
    expect(() => createAddressProviderConfig({ GEOAPIFY_BASE_URL: 'http://api-eu.geoapify.com' })).toThrow();
    expect(() => createAddressProviderConfig({ GEOAPIFY_BASE_URL: 'https://user:pass@api-eu.geoapify.com' })).toThrow();
    expect(() => createAddressProviderConfig({ GEOAPIFY_BASE_URL: 'https://example.com' })).toThrow();
    expect(() => createAddressProviderConfig({ GEOAPIFY_BASE_URL: 'https://api-eu.geoapify.com/proxy' })).toThrow();
    expect(createAddressProviderConfig({ GEOAPIFY_ENABLED: 'true', GEOAPIFY_API_KEY: 'server-only' }).enabled).toBe(true);
  });

  it('rejects malformed numeric values', () => {
    for (const value of ['-1', '1.2', 'not-a-number', '']) {
      expect(() => createAddressProviderConfig({ GEOAPIFY_TIMEOUT_MS: value })).toThrow();
    }
    expect(() => createAddressProviderConfig({ GEOAPIFY_MAX_ACTIVE: '0' })).toThrow();
    expect(() => createAddressIpLimiterConfig({ ADDRESS_IP_MAX_KEYS: '0' })).toThrow();
  });
});
