import { describe, expect, it } from 'vitest';
import { LocalUatAddressProvider, LocalUatEmailProvider } from '../local-uat/fakes.js';

const request = {
  latitude: 48.7164,
  longitude: 21.2611,
  targetKind: 'custom' as const,
  language: 'sk' as const,
};

describe('local UAT provider fakes', () => {
  it('uses the Geoapify response adapter with deterministic success and no-result bodies', async () => {
    const provider = new LocalUatAddressProvider();
    await expect(provider.suggest(request)).resolves.toEqual({
      address: '12 Jarná Street, Košice, Slovakia', locality: 'Košice',
    });
    provider.setScenario('no-result');
    await expect(provider.suggest({ ...request, longitude: 21.2612 })).resolves.toBeNull();
    expect(provider.requestCount()).toBe(2);
  });

  it.each([
    ['unavailable', 'provider_unavailable'],
    ['rate-limited', 'provider_throttled'],
  ] as const)('maps fake %s to the existing safe provider failure', async (scenario, errorCode) => {
    const provider = new LocalUatAddressProvider();
    provider.setScenario(scenario);
    await expect(provider.suggest(request)).rejects.toMatchObject({ code: errorCode });
    expect(provider.requestCount()).toBe(1);
  });

  it('times out through the normal adapter abort path', async () => {
    const provider = new LocalUatAddressProvider({ timeoutMs: 35 });
    provider.setScenario('timeout');
    await expect(provider.suggest(request)).rejects.toMatchObject({
      code: 'address_provider_timeout', status: 504,
    });
  });

  it('blocks fake budget before transport and can force only the local outside-area UX case', async () => {
    const provider = new LocalUatAddressProvider();
    provider.setScenario('budget-exhausted');
    await expect(provider.suggest(request)).rejects.toMatchObject({ code: 'daily_budget_exceeded' });
    expect(provider.requestCount()).toBe(0);
    provider.setScenario('outside-area');
    expect(provider.classifyPoint(request, () => 'inside')).toBe('outside');
    provider.setScenario('success');
    expect(provider.classifyPoint(request, () => 'inside')).toBe('inside');
  });

  it('keeps only the latest fake email in memory and supports delivery failure', async () => {
    const provider = new LocalUatEmailProvider();
    await provider.sendVerificationCode({ email: 'uat@example.test', code: '123456', locale: 'en' });
    expect(provider.latest()).toMatchObject({ code: '123456', locale: 'en' });
    expect(provider.latest()).not.toHaveProperty('email');
    provider.failNextDelivery();
    await expect(provider.sendVerificationCode({ email: 'uat@example.test', code: '654321', locale: 'en' }))
      .rejects.toThrow('Local UAT fake email delivery failure.');
    expect(provider.latest()?.code).toBe('123456');
  });
});
