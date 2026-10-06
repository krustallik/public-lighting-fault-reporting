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
  vi.useRealTimers();
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

  it('filters autocomplete candidates through the local boundary and returns text-only DTOs', async () => {
    const autocomplete = vi.fn(async () => [
      { address: 'Inside, Košice', locality: 'Košice', latitude: 48.7, longitude: 21.25 },
      { address: 'Outside Slovakia', latitude: 49, longitude: 22 },
      { address: 'Outside longitude', latitude: 48.7, longitude: 22 },
    ]);
    const fake = { ...provider(), autocomplete };
    const service = createReportAddressSuggestionService(serviceOptions({
      provider: fake,
      classifyServiceArea: ({ latitude, longitude }: { latitude: number; longitude: number }) =>
        (latitude === 48.7 && longitude === 21.25) || (latitude === 48.6972647672 && longitude === 21.2644255873)
          ? 'inside' : 'outside',
    }));
    const result = await service.autocomplete({ text: 'Jarná', language: 'sk' });
    expect(result).toEqual([{ label: 'Inside, Košice', locality: 'Košice' }]);
    expect(JSON.stringify(result)).not.toMatch(/latitude|longitude|geometry|providerId/i);
    expect(autocomplete).toHaveBeenCalledTimes(1);
  });

  it('normalizes autocomplete text and rejects fewer than three Unicode code points before upstream work', async () => {
    const autocomplete = vi.fn(async () => []);
    const fake = { ...provider(), autocomplete };
    const service = createReportAddressSuggestionService(serviceOptions({
      provider: fake,
      classifyServiceArea: () => 'inside',
    }));
    await expect(service.autocomplete({ text: 'é', language: 'sk' })).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(service.autocomplete({ text: '  e\u0301xy  ', language: 'sk' })).resolves.toEqual([]);
    expect(autocomplete).toHaveBeenCalledWith(expect.objectContaining({ text: 'éxy' }), expect.any(AbortSignal));
  });

  it.each([
    ['missing address', { locality: 'Jarná' }],
    ['blank address', { address: '   ' }],
    ['non-string locality', { address: 'Jarná 12', locality: 3 }],
  ])('rejects malformed provider response: %s', async (_label, result) => {
    const fake = provider(vi.fn(async () => result));
    const service = createReportAddressSuggestionService(serviceOptions({ provider: fake }));

    await expect(service.suggest(baseRequest)).rejects.toMatchObject({ code: 'provider_invalid_response', status: 502 });
    expect(fake.reverse).toHaveBeenCalledTimes(1);
  });

  it('normalizes provider errors without leaking provider details or retrying', async () => {
    const fake = provider(vi.fn(async () => { throw new Error('private upstream URL and key'); }));
    const service = createReportAddressSuggestionService(serviceOptions({ provider: fake }));

    await expect(service.suggest(baseRequest)).rejects.toMatchObject({
      code: 'provider_unavailable',
      status: 503,
      message: 'Address assistance is temporarily unavailable',
    });
    expect(fake.reverse).toHaveBeenCalledTimes(1);
  });

  it('does not cache completed provider results and requires a fresh user request', async () => {
    const fake = provider(vi.fn()
      .mockRejectedValueOnce(new Error('synthetic outage'))
      .mockResolvedValue({ address: 'Recovered address' }));
    const service = createReportAddressSuggestionService(serviceOptions({
      provider: fake,
    }));

    await expect(service.suggest(baseRequest)).rejects.toMatchObject({ code: 'provider_unavailable', status: 503 });
    await expect(service.suggest(baseRequest)).resolves.toEqual({ address: 'Recovered address' });
    expect(fake.reverse).toHaveBeenCalledTimes(2);
  });

  it.each([429, 503])('does not trust untyped provider HTTP-style %s errors', async (status) => {
    const upstreamError = Object.assign(new Error(`HTTP ${status} at private-url`), { status });
    const fake = provider(vi.fn(async () => { throw upstreamError; }));
    const service = createReportAddressSuggestionService(serviceOptions({ provider: fake }));

    await expect(service.suggest(baseRequest)).rejects.toMatchObject({
      code: 'provider_unavailable',
      status: 503,
      message: 'Address assistance is temporarily unavailable',
    });
    expect(fake.reverse).toHaveBeenCalledTimes(1);
  });

  it('aborts a timed-out provider request and does not retry it', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
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

    const outcome = service.suggest(baseRequest).then(
      () => 'resolved',
      (error: { code?: string }) => error.code
    );
    await vi.advanceTimersByTimeAsync(9);
    expect(signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await expect(outcome).resolves.toBe('address_provider_timeout');
    expect(signal?.aborted).toBe(true);
    expect(fake.reverse).toHaveBeenCalledTimes(1);
    expect(service.counters().timeout).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('lets provider completion immediately before the timeout win exactly once', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(2_000);
    const response = deferred<{ address: string }>();
    const fake = provider(vi.fn(() => response.promise));
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
    const settlement = vi.fn();
    const outcome = service.suggest(baseRequest).then(
      (value) => { settlement(value); return value; },
      (error: { code?: string }) => { settlement(error); throw error; }
    );

    await vi.advanceTimersByTimeAsync(9);
    response.resolve({ address: 'Finished before timeout' });
    await expect(outcome).resolves.toEqual({ address: 'Finished before timeout' });
    await vi.advanceTimersByTimeAsync(1);

    expect(settlement).toHaveBeenCalledTimes(1);
    expect(settlement).toHaveBeenCalledWith({ address: 'Finished before timeout' });
    expect(fake.reverse).toHaveBeenCalledTimes(1);
    expect(service.counters().timeout).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
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

  it('rejects admission-policy and daily-budget checks before upstream work', async () => {
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
    await expect(budgetService.suggest(baseRequest)).rejects.toMatchObject({ code: 'daily_budget_exceeded' });
    expect(fake.reverse).not.toHaveBeenCalled();
  });

  it('fails closed and releases the active slot when the application budget hook throws', async () => {
    const budget = vi.fn().mockImplementationOnce(() => { throw new Error('synthetic budget store failure'); })
      .mockReturnValue(true);
    const fake = provider();
    const service = createReportAddressSuggestionService(serviceOptions({
      provider: fake,
      policy: { tryConsumeBudget: budget },
    }));

    await expect(service.suggest(baseRequest)).rejects.toMatchObject({ code: 'daily_budget_exceeded' });
    expect(fake.reverse).not.toHaveBeenCalled();
    await expect(service.suggest({ ...baseRequest, latitude: 48.71 })).resolves.toEqual({
      address: 'Jarná 12, Košice',
      locality: 'Jarná',
    });
    expect(budget).toHaveBeenCalledTimes(2);
    expect(fake.reverse).toHaveBeenCalledTimes(1);
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

  it('bounds pending work while start spacing delays a free active slot', async () => {
    const active = deferred<{ address: string }>();
    const fake = provider(vi.fn()
      .mockImplementationOnce(() => active.promise)
      .mockResolvedValue({ address: 'Queued address' }));
    const service = createReportAddressSuggestionService(serviceOptions({
      provider: fake,
      admission: {
        maxPending: 1,
        maxActive: 2,
        queueExpiryMs: 5_000,
        timeoutMs: 5_000,
        minStartIntervalMs: 10_000,
      },
    }));

    const first = service.suggest(baseRequest);
    const secondController = new AbortController();
    const second = service.suggest({ ...baseRequest, latitude: 48.71 }, secondController.signal);
    await expect(service.suggest({ ...baseRequest, latitude: 48.72 }))
      .rejects.toMatchObject({ code: 'queue_full' });
    expect(fake.reverse).toHaveBeenCalledTimes(1);

    secondController.abort();
    await expect(second).rejects.toMatchObject({ code: 'cancelled' });
    active.resolve({ address: 'Active address' });
    await expect(first).resolves.toEqual({ address: 'Active address' });
    expect(fake.reverse).toHaveBeenCalledTimes(1);
  });

  it('removes a cancelled queued lookup before provider start', async () => {
    const active = deferred<{ address: string }>();
    const fake = provider(vi.fn()
      .mockImplementationOnce(() => active.promise)
      .mockResolvedValue({ address: 'Replacement address' }));
    const service = createReportAddressSuggestionService(serviceOptions({
      provider: fake,
      admission: {
        maxPending: 1,
        maxActive: 1,
        queueExpiryMs: 5_000,
        timeoutMs: 5_000,
        minStartIntervalMs: 0,
      },
    }));

    const first = service.suggest(baseRequest);
    const controller = new AbortController();
    const cancelled = service.suggest({ ...baseRequest, latitude: 48.71 }, controller.signal);
    controller.abort();
    await expect(cancelled).rejects.toMatchObject({ code: 'cancelled' });
    expect(fake.reverse).toHaveBeenCalledTimes(1);

    active.resolve({ address: 'Active address' });
    await first;
    await expect(service.suggest({ ...baseRequest, latitude: 48.71 }))
      .resolves.toEqual({ address: 'Replacement address' });
    expect(fake.reverse).toHaveBeenCalledTimes(2);
  });

  it('keeps shared provider work alive when one coalesced caller disconnects', async () => {
    const response = deferred<{ address: string }>();
    let providerSignal: AbortSignal | undefined;
    const fake = provider(vi.fn((_request, signal) => {
      providerSignal = signal;
      return response.promise;
    }));
    const service = createReportAddressSuggestionService(serviceOptions({ provider: fake }));
    const controller = new AbortController();
    const cancelledCaller = service.suggest(baseRequest, controller.signal);
    const remainingCaller = service.suggest(baseRequest);

    controller.abort();
    await expect(cancelledCaller).rejects.toMatchObject({ code: 'cancelled' });
    expect(providerSignal?.aborted).toBe(false);
    expect(fake.reverse).toHaveBeenCalledTimes(1);

    response.resolve({ address: 'Shared synthetic result' });
    await expect(remainingCaller).resolves.toEqual({ address: 'Shared synthetic result' });
    expect(providerSignal?.aborted).toBe(false);
  });

  it('aborts active provider work after every coalesced caller disconnects', async () => {
    let providerSignal: AbortSignal | undefined;
    const reverse = vi.fn()
      .mockImplementationOnce((_request: unknown, signal: AbortSignal) => {
        providerSignal = signal;
        return new Promise<{ address: string }>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new Error('synthetic abort')), { once: true });
        });
      })
      .mockResolvedValueOnce({ address: 'Replacement address' });
    const fake = provider(reverse);
    const service = createReportAddressSuggestionService(serviceOptions({ provider: fake }));
    const firstController = new AbortController();
    const secondController = new AbortController();
    const first = service.suggest(baseRequest, firstController.signal);
    const second = service.suggest(baseRequest, secondController.signal);

    firstController.abort();
    await expect(first).rejects.toMatchObject({ code: 'cancelled' });
    expect(providerSignal?.aborted).toBe(false);
    secondController.abort();
    await expect(second).rejects.toMatchObject({ code: 'cancelled' });

    expect(providerSignal?.aborted).toBe(true);
    await expect(service.suggest({ ...baseRequest, latitude: 48.71 }))
      .resolves.toEqual({ address: 'Replacement address' });
    expect(fake.reverse).toHaveBeenCalledTimes(2);
  });

  it('holds the active slot until a non-cooperative provider settles after timeout', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(3_000);
    const blockedProvider = deferred<{ address: string }>();
    const fake = provider(vi.fn()
      .mockImplementationOnce(() => blockedProvider.promise)
      .mockResolvedValue({ address: 'Queued synthetic result' }));
    const service = createReportAddressSuggestionService(serviceOptions({
      provider: fake,
      admission: {
        maxPending: 1,
        maxActive: 1,
        queueExpiryMs: 1_000,
        timeoutMs: 10,
        minStartIntervalMs: 0,
      },
    }));

    const settled = vi.fn();
    const timedOut = service.suggest(baseRequest).then(
      () => { settled('resolved'); return 'resolved'; },
      (error: { code?: string }) => { settled(error.code); return error.code; }
    );
    await vi.advanceTimersByTimeAsync(10);
    await expect(timedOut).resolves.toBe('address_provider_timeout');
    expect(settled).toHaveBeenCalledTimes(1);
    const queued = service.suggest({ ...baseRequest, latitude: 48.71 });
    expect(fake.reverse).toHaveBeenCalledTimes(1);

    blockedProvider.resolve({ address: 'Late synthetic result' });
    await expect(queued).resolves.toEqual({ address: 'Queued synthetic result' });
    expect(settled).toHaveBeenCalledTimes(1);
    expect(fake.reverse).toHaveBeenCalledTimes(2);
    expect(service.counters().timeout).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
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
    vi.useFakeTimers();
    vi.setSystemTime(4_000);
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
    const expiredOutcome = expect(expired).rejects.toMatchObject({ code: 'queue_expired' });
    await vi.advanceTimersByTimeAsync(10);
    await expiredOutcome;
    expect(fake.reverse).toHaveBeenCalledTimes(1);
    active.resolve({ address: 'Active address' });
    await first;
    expect(fake.reverse).toHaveBeenCalledTimes(1);
    await service.suggest({ ...baseRequest, latitude: 48.71 });
    expect(fake.reverse).toHaveBeenCalledTimes(2);
    expect(service.counters().rejected).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('starts a dequeued request just before expiry instead of expiring it with zero provider calls', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(5_000);
    const active = deferred<{ address: string }>();
    const fake = provider(vi.fn()
      .mockImplementationOnce(() => active.promise)
      .mockResolvedValue({ address: 'Started before expiry' }));
    const service = createReportAddressSuggestionService(serviceOptions({
      provider: fake,
      admission: {
        maxPending: 1,
        maxActive: 1,
        queueExpiryMs: 10,
        timeoutMs: 100,
        minStartIntervalMs: 0,
      },
    }));

    const first = service.suggest(baseRequest);
    const queued = service.suggest({ ...baseRequest, latitude: 48.71 });
    await vi.advanceTimersByTimeAsync(9);
    active.resolve({ address: 'Released active slot' });
    await expect(first).resolves.toEqual({ address: 'Released active slot' });
    await expect(queued).resolves.toEqual({ address: 'Started before expiry' });
    await vi.advanceTimersByTimeAsync(1);

    expect(fake.reverse).toHaveBeenCalledTimes(2);
    expect(service.counters().rejected).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('never reuses completed reverse results', async () => {
    let now = 1_000;
    const fake = provider(vi.fn(async ({ latitude }) => ({ address: `Address ${latitude}` })));
    const service = createReportAddressSuggestionService(serviceOptions({
      provider: fake,
      cache: { maxEntries: 0, ttlMs: 0 },
      now: () => now,
    }));

    await service.suggest(baseRequest);
    await service.suggest(baseRequest);
    expect(fake.reverse).toHaveBeenCalledTimes(2);
    expect(service.counters()).not.toHaveProperty('cacheHit');
    now += 21;
    expect(now).toBe(1_021);
  });

  it('rejects any configuration that enables completed-result caching', async () => {
    const fake = provider();
    expect(() => createReportAddressSuggestionService(serviceOptions({
      provider: fake,
      cache: { maxEntries: 2, ttlMs: 100 },
    }))).toThrow('Completed address-result caching must remain disabled');
  });

  it('spaces provider starts and uses the budget seam immediately before each start', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
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

    const first = service.suggest(baseRequest);
    const second = service.suggest({ ...baseRequest, latitude: 48.71 });
    expect(startTimes).toEqual([10_000]);
    await vi.advanceTimersByTimeAsync(14);
    expect(startTimes).toEqual([10_000]);
    await vi.advanceTimersByTimeAsync(1);
    await Promise.all([first, second]);
    expect(startTimes).toHaveLength(2);
    expect(startTimes).toEqual([10_000, 10_015]);
    expect(startTimes[1] - startTimes[0]).toBe(15);
    expect(fake.reverse).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('exposes only aggregate counters and never logs coordinate keys or addresses', async () => {
    const log = vi.spyOn(console, 'log');
    const info = vi.spyOn(console, 'info');
    const warn = vi.spyOn(console, 'warn');
    const error = vi.spyOn(console, 'error');
    const fake = provider();
    const service = createReportAddressSuggestionService(serviceOptions({
      provider: fake,
      cache: { maxEntries: 0, ttlMs: 0 },
    }));
    await service.suggest(baseRequest);
    await service.suggest(baseRequest);

    expect(service.counters()).toEqual(expect.objectContaining({
      accepted: 2,
    }));
    expect(JSON.stringify(service.counters())).not.toContain('48.7');
    expect([log, info, warn, error].flatMap((spy) => spy.mock.calls)).toEqual([]);
  });
});
