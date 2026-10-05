import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createReportAddressSuggestionService,
  ReportAddressSuggestionError,
  type AddressSuggestionProvider,
  type ReportAddressSuggestionRequest,
} from '../../src/services/reportAddressSuggestion.service.js';

const baseRequest: ReportAddressSuggestionRequest = {
  latitude: 48.7,
  longitude: 21.25,
  targetKind: 'custom',
  language: 'sk',
};

function provider(
  reverse: AddressSuggestionProvider['reverse'] = vi.fn(async () => ({
    address: 'Jarná 12, Košice',
    locality: 'Jarná',
  }))
): AddressSuggestionProvider {
  return { id: 'fake-provider', reverse };
}

function serviceOptions(overrides: Record<string, unknown> = {}) {
  return {
    enabled: true,
    provider: provider(),
    admission: {
      maxPending: 2,
      maxActive: 1,
      queueExpiryMs: 100,
      timeoutMs: 100,
      minStartIntervalMs: 0,
    },
    cache: { maxEntries: 0, ttlMs: 0 },
    ...overrides,
  } as Parameters<typeof createReportAddressSuggestionService>[0];
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('report address suggestion provider boundary', () => {
  it('keeps the production default disabled and performs no provider call', async () => {
    const fake = provider();
    const service = createReportAddressSuggestionService({ provider: fake });

    await expect(service.suggest(baseRequest)).rejects.toMatchObject({ code: 'disabled' });
    expect(fake.reverse).not.toHaveBeenCalled();
  });

  it.each([
    ['NaN latitude', { ...baseRequest, latitude: Number.NaN }],
    ['out-of-range longitude', { ...baseRequest, longitude: 181 }],
    ['unsupported target', { ...baseRequest, targetKind: 'light-point' as 'custom' }],
  ])('rejects %s before provider start', async (_label, request) => {
    const fake = provider();
    const service = createReportAddressSuggestionService(serviceOptions({ provider: fake }));

    await expect(service.suggest(request)).rejects.toBeInstanceOf(ReportAddressSuggestionError);
    expect(fake.reverse).not.toHaveBeenCalled();
  });

  it('normalizes a fake provider success into address/locality without persistence', async () => {
    const fake = provider();
    const service = createReportAddressSuggestionService(serviceOptions({ provider: fake }));

    await expect(service.suggest(baseRequest)).resolves.toEqual({
      address: 'Jarná 12, Košice',
      locality: 'Jarná',
    });
    expect(fake.reverse).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['missing address', { locality: 'Jarná' }],
    ['blank address', { address: '   ' }],
    ['non-string locality', { address: 'Jarná 12', locality: 3 }],
  ])('rejects malformed provider response: %s', async (_label, result) => {
    const fake = provider(vi.fn(async () => result));
    const service = createReportAddressSuggestionService(serviceOptions({ provider: fake }));

    await expect(service.suggest(baseRequest)).rejects.toMatchObject({ code: 'provider_error' });
    expect(fake.reverse).toHaveBeenCalledTimes(1);
  });

  it('normalizes provider errors without leaking provider details or retrying', async () => {
    const fake = provider(vi.fn(async () => { throw new Error('private upstream URL and key'); }));
    const service = createReportAddressSuggestionService(serviceOptions({ provider: fake }));

    await expect(service.suggest(baseRequest)).rejects.toMatchObject({
      code: 'provider_error',
      message: 'Address suggestion is unavailable',
    });
    expect(fake.reverse).toHaveBeenCalledTimes(1);
  });

  it('does not cache failures and requires a fresh user request instead of retrying', async () => {
    const fake = provider(vi.fn()
      .mockRejectedValueOnce(new Error('synthetic outage'))
      .mockResolvedValue({ address: 'Recovered address' }));
    const service = createReportAddressSuggestionService(serviceOptions({
      provider: fake,
      cache: { maxEntries: 2, ttlMs: 100 },
    }));

    await expect(service.suggest(baseRequest)).rejects.toMatchObject({ code: 'provider_error' });
    await expect(service.suggest(baseRequest)).resolves.toEqual({ address: 'Recovered address' });
    expect(fake.reverse).toHaveBeenCalledTimes(2);
  });

  it.each([429, 503])('normalizes provider HTTP-style %s failures without retry or fallback', async (status) => {
    const upstreamError = Object.assign(new Error(`HTTP ${status} at private-url`), { status });
    const fake = provider(vi.fn(async () => { throw upstreamError; }));
    const service = createReportAddressSuggestionService(serviceOptions({ provider: fake }));

    await expect(service.suggest(baseRequest)).rejects.toMatchObject({
      code: 'provider_error',
      status: 502,
      message: 'Address suggestion is unavailable',
    });
    expect(fake.reverse).toHaveBeenCalledTimes(1);
  });

  it('aborts a timed-out provider request and does not retry it', async () => {
    let signal: AbortSignal | undefined;
    const fake = provider(vi.fn((_request, requestSignal) => {
      signal = requestSignal;
      return new Promise((_resolve, reject) => {
        requestSignal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      });
    }));
    const service = createReportAddressSuggestionService(serviceOptions({
      provider: fake,
      admission: {
        maxPending: 1,
        maxActive: 1,
        queueExpiryMs: 100,
        timeoutMs: 10,
        minStartIntervalMs: 0,
      },
    }));

    await expect(service.suggest(baseRequest)).rejects.toMatchObject({ code: 'timeout' });
    expect(signal?.aborted).toBe(true);
    expect(fake.reverse).toHaveBeenCalledTimes(1);
  });
});

describe('bounded report address admission', () => {
  it('rejects invalid admission settings instead of accepting unsafe bounds', () => {
    expect(() => createReportAddressSuggestionService(serviceOptions({
      admission: {
        maxPending: Number.MAX_SAFE_INTEGER + 1,
        maxActive: 1,
        queueExpiryMs: 100,
        timeoutMs: 100,
        minStartIntervalMs: 0,
      },
    }))).toThrow(/admission/i);
  });

  it('coalesces identical in-flight requests', async () => {
    const response = deferred<{ address: string; locality: string }>();
    const fake = provider(vi.fn(() => response.promise));
    const service = createReportAddressSuggestionService(serviceOptions({ provider: fake }));

    const first = service.suggest(baseRequest);
    const second = service.suggest(baseRequest);
    expect(fake.reverse).toHaveBeenCalledTimes(1);
    response.resolve({ address: 'Jarná 12', locality: 'Jarná' });
    await expect(Promise.all([first, second])).resolves.toEqual([
      { address: 'Jarná 12', locality: 'Jarná' },
      { address: 'Jarná 12', locality: 'Jarná' },
    ]);
    expect(service.counters().coalesced).toBe(1);
  });

  it('rejects admission-policy and application-cap checks before upstream work', async () => {
    const fake = provider();
    const service = createReportAddressSuggestionService(serviceOptions({
      provider: fake,
      policy: {
        admit: () => false,
        tryConsumeBudget: () => false,
      },
    }));

    await expect(service.suggest(baseRequest)).rejects.toMatchObject({ code: 'admission_rejected' });
    expect(fake.reverse).not.toHaveBeenCalled();

    const budgetService = createReportAddressSuggestionService(serviceOptions({
      provider: fake,
      policy: { tryConsumeBudget: () => false },
    }));
    await expect(budgetService.suggest(baseRequest)).rejects.toMatchObject({ code: 'application_cap' });
    expect(fake.reverse).not.toHaveBeenCalled();
  });

  it('rejects queue overflow without adding another provider call', async () => {
    const active = deferred<{ address: string }>();
    const fake = provider(vi.fn()
      .mockImplementationOnce(() => active.promise)
      .mockResolvedValue({ address: 'Queued address' }));
    const service = createReportAddressSuggestionService(serviceOptions({
      provider: fake,
      admission: {
        maxPending: 1,
        maxActive: 1,
        queueExpiryMs: 100,
        timeoutMs: 100,
        minStartIntervalMs: 0,
      },
    }));

    const first = service.suggest(baseRequest);
    const second = service.suggest({ ...baseRequest, latitude: 48.71 });
    await expect(service.suggest({ ...baseRequest, latitude: 48.72 })).rejects.toMatchObject({ code: 'queue_full' });
    expect(fake.reverse).toHaveBeenCalledTimes(1);
    active.resolve({ address: 'Active address' });
    await first;
    await second;
    expect(fake.reverse).toHaveBeenCalledTimes(2);
  });

  it('starts queued work in FIFO order while enforcing the active-work bound', async () => {
    const first = deferred<{ address: string }>();
    const started: number[] = [];
    const fake = provider(vi.fn(({ latitude }) => {
      started.push(latitude);
      if (latitude === baseRequest.latitude) return first.promise;
      return Promise.resolve({ address: `Address ${latitude}` });
    }));
    const service = createReportAddressSuggestionService(serviceOptions({
      provider: fake,
      admission: {
        maxPending: 2,
        maxActive: 1,
        queueExpiryMs: 100,
        timeoutMs: 100,
        minStartIntervalMs: 0,
      },
    }));

    const active = service.suggest(baseRequest);
    const queuedFirst = service.suggest({ ...baseRequest, latitude: 48.71 });
    const queuedSecond = service.suggest({ ...baseRequest, latitude: 48.72 });
    expect(started).toEqual([48.7]);
    first.resolve({ address: 'Active address' });
    await Promise.all([active, queuedFirst, queuedSecond]);
    expect(started).toEqual([48.7, 48.71, 48.72]);
  });

  it('expires queued work before provider start and makes zero upstream calls for that request', async () => {
    const active = deferred<{ address: string }>();
    const fake = provider(vi.fn()
      .mockImplementationOnce(() => active.promise)
      .mockResolvedValue({ address: 'Should not be called for expired item' }));
    const service = createReportAddressSuggestionService(serviceOptions({
      provider: fake,
      admission: {
        maxPending: 1,
        maxActive: 1,
        queueExpiryMs: 10,
        timeoutMs: 200,
        minStartIntervalMs: 0,
      },
    }));

    const first = service.suggest(baseRequest);
    const expired = service.suggest({ ...baseRequest, latitude: 48.71 });
    await expect(expired).rejects.toMatchObject({ code: 'queue_expired' });
    expect(fake.reverse).toHaveBeenCalledTimes(1);
    active.resolve({ address: 'Active address' });
    await first;
    expect(fake.reverse).toHaveBeenCalledTimes(1);
    await service.suggest({ ...baseRequest, latitude: 48.71 });
    expect(fake.reverse).toHaveBeenCalledTimes(2);
  });

  it('applies bounded TTL/size caching keyed by provider, language, and exact coordinates', async () => {
    let now = 1_000;
    const fake = provider(vi.fn(async ({ latitude }) => ({ address: `Address ${latitude}` })));
    const service = createReportAddressSuggestionService(serviceOptions({
      provider: fake,
      cache: { maxEntries: 1, ttlMs: 20 },
      now: () => now,
    }));

    await service.suggest(baseRequest);
    await service.suggest(baseRequest);
    expect(fake.reverse).toHaveBeenCalledTimes(1);
    expect(service.counters().cacheHit).toBe(1);
    await service.suggest({ ...baseRequest, latitude: 48.71 });
    await service.suggest(baseRequest);
    expect(fake.reverse).toHaveBeenCalledTimes(3);
    now += 21;
    await service.suggest({ ...baseRequest, latitude: 48.71 });
    expect(fake.reverse).toHaveBeenCalledTimes(4);
    expect(service.counters().cacheHit).toBe(1);
  });

  it('does not reuse a successful address across language variants', async () => {
    const fake = provider();
    const service = createReportAddressSuggestionService(serviceOptions({
      provider: fake,
      cache: { maxEntries: 2, ttlMs: 100 },
    }));

    await service.suggest(baseRequest);
    await service.suggest({ ...baseRequest, language: 'en' });
    await service.suggest(baseRequest);
    expect(fake.reverse).toHaveBeenCalledTimes(2);
    expect(service.counters().cacheHit).toBe(1);
  });

  it('spaces provider starts and uses the budget seam immediately before each start', async () => {
    const startTimes: number[] = [];
    const fake = provider(vi.fn(async () => {
      startTimes.push(Date.now());
      return { address: 'Synthetic' };
    }));
    const service = createReportAddressSuggestionService(serviceOptions({
      provider: fake,
      admission: {
        maxPending: 2,
        maxActive: 2,
        queueExpiryMs: 100,
        timeoutMs: 100,
        minStartIntervalMs: 15,
      },
    }));

    await Promise.all([
      service.suggest(baseRequest),
      service.suggest({ ...baseRequest, latitude: 48.71 }),
    ]);
    expect(startTimes).toHaveLength(2);
    expect(startTimes[1] - startTimes[0]).toBeGreaterThanOrEqual(10);
    expect(fake.reverse).toHaveBeenCalledTimes(2);
  });

  it('exposes only aggregate counters and never logs coordinate keys or addresses', async () => {
    const log = vi.spyOn(console, 'log');
    const info = vi.spyOn(console, 'info');
    const warn = vi.spyOn(console, 'warn');
    const error = vi.spyOn(console, 'error');
    const fake = provider();
    const service = createReportAddressSuggestionService(serviceOptions({
      provider: fake,
      cache: { maxEntries: 2, ttlMs: 100 },
    }));
    await service.suggest(baseRequest);
    await service.suggest(baseRequest);

    expect(service.counters()).toEqual(expect.objectContaining({
      accepted: 1,
      cacheHit: 1,
    }));
    expect(JSON.stringify(service.counters())).not.toContain('48.7');
    expect([log, info, warn, error].flatMap((spy) => spy.mock.calls)).toEqual([]);
  });
});
