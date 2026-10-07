import { createServer, request as httpRequest, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../src/app.js';
import {
  createReportAddressSuggestionService,
  type AddressSuggestionProvider,
} from '../../src/services/reportAddressSuggestion.service.js';
import { normalizeLimiterAddress } from '../../src/security/clientAddress.js';

let server: Server | undefined;
let baseUrl = '';

async function startServer(app = createApp({ NODE_ENV: 'test' })): Promise<void> {
  server = createServer(app);
  await new Promise<void>((resolve, reject) => {
    server?.once('error', reject);
    server?.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
}

async function stopServer(): Promise<void> {
  if (!server?.listening) return;
  await new Promise<void>((resolve, reject) => {
    server?.close((error) => error ? reject(error) : resolve());
  });
}

function enabledFakeService(provider: AddressSuggestionProvider) {
  return createReportAddressSuggestionService({
    enabled: true,
    provider,
    admission: {
      maxPending: 2,
      maxActive: 1,
      queueExpiryMs: 100,
      timeoutMs: 100,
      minStartIntervalMs: 0,
    },
    cache: { maxEntries: 0, ttlMs: 0 },
  });
}

afterEach(stopServer);

describe('report-scoped address suggestion API', () => {
  it('has a deterministic disabled response and does not proxy the legacy generic route', async () => {
    await startServer();
    const response = await fetch(`${baseUrl}/api/reports/address-suggestion`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        latitude: 48.7164,
        longitude: 21.2611,
        targetKind: 'custom',
        language: 'sk',
      }),
    });
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      success: false,
      code: 'disabled',
      targetValidated: true,
    });

    const legacy = await fetch(`${baseUrl}/api/geocode/reverse?lat=48.7&lng=21.25`);
    expect(legacy.status).toBe(404);
    expect(JSON.stringify(await legacy.json())).not.toContain('48.7');

    const autocomplete = await fetch(`${baseUrl}/api/reports/address-autocomplete`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'Jarná', language: 'sk' }),
    });
    expect(autocomplete.status).toBe(404);
  });

  it('removes the unused capability endpoint from the submit-only enrichment flow', async () => {
    await startServer(createApp({ NODE_ENV: 'test' }, {
      reportAddressSuggestionService: enabledFakeService({ id: 'fake', reverse: async () => null }),
    }));
    const response = await fetch(`${baseUrl}/api/reports/address-assistance-capability`);
    expect(response.status).toBe(404);
  });

  it('rejects an outside reverse target before the fake provider can be dispatched', async () => {
    const reverse = vi.fn(async () => ({ address: 'Must remain private' }));
    const limiter = { consume: vi.fn(() => ({ allowed: true as const })) };
    const app = createApp({ NODE_ENV: 'test' }, {
      reportAddressSuggestionService: enabledFakeService({ id: 'fake', reverse }),
      addressIpLimiter: limiter,
      serviceAreaClassifier: () => 'outside',
    });
    await startServer(app);
    const response = await fetch(`${baseUrl}/api/reports/address-suggestion`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ latitude: 48.7, longitude: 21.25, targetKind: 'custom', language: 'sk' }),
    });
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ code: 'outside_service_area' });
    expect(limiter.consume).not.toHaveBeenCalled();
    expect(reverse).not.toHaveBeenCalled();
  });

  it('ignores spoofed X-Forwarded-For unless the direct proxy is explicitly trusted', async () => {
    const observedAddresses: string[] = [];
    const provider: AddressSuggestionProvider = {
      id: 'fake',
      reverse: vi.fn(async () => ({ address: 'Synthetic address' })),
    };
    const limiter = { consume: vi.fn((address: string) => { observedAddresses.push(address); return { allowed: true as const }; }) };
    const app = createApp({ NODE_ENV: 'test', TRUST_PROXY_CIDRS: '' }, {
      reportAddressSuggestionService: enabledFakeService(provider),
      addressIpLimiter: limiter,
      serviceAreaClassifier: () => 'inside',
    });
    await startServer(app);
    const response = await fetch(`${baseUrl}/api/reports/address-suggestion`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '203.0.113.91' },
      body: JSON.stringify({ latitude: 48.7, longitude: 21.25, targetKind: 'custom', language: 'sk' }),
    });
    expect(response.status).toBe(200);
    expect(normalizeLimiterAddress(observedAddresses[0])).toBe('v4:127.0.0.1');
    expect(observedAddresses[0]).not.toBe('203.0.113.91');
  });

  it('uses a trusted proxy chain only when every hop is explicitly in the CIDR allowlist', async () => {
    const observedAddresses: string[] = [];
    const limiter = { consume: vi.fn((address: string) => { observedAddresses.push(address); return { allowed: true as const }; }) };
    const app = createApp({ NODE_ENV: 'test', TRUST_PROXY_CIDRS: '127.0.0.1/32,10.0.0.0/8' }, {
      reportAddressSuggestionService: enabledFakeService({ id: 'fake', reverse: async () => null }),
      addressIpLimiter: limiter,
      serviceAreaClassifier: () => 'inside',
    });
    await startServer(app);
    const response = await fetch(`${baseUrl}/api/reports/address-suggestion`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '203.0.113.91, 10.2.3.4' },
      body: JSON.stringify({ latitude: 48.7, longitude: 21.25, targetKind: 'custom', language: 'sk' }),
    });
    expect(response.status).toBe(200);
    expect(observedAddresses[0]).toBe('203.0.113.91');
  });

  it('rejects malformed trusted-proxy CIDRs during app startup', () => {
    expect(() => createApp({ NODE_ENV: 'test', TRUST_PROXY_CIDRS: '127.0.0.1/99' })).toThrow();
  });

  it.each([
    ['/address-suggestion', { latitude: 48.7, longitude: 21.25, targetKind: 'custom', language: 'sk' }],
  ])('does not dispatch %s when caller admission rejects the request', async (path, payload) => {
    const reverse = vi.fn(async () => ({ address: 'Must not dispatch' }));
    const consumeBudget = vi.fn(() => true);
    const service = createReportAddressSuggestionService({
      enabled: true,
      provider: { id: 'fake', reverse },
      admission: { maxActive: 1, maxPending: 1, queueExpiryMs: 4000, timeoutMs: 100, minStartIntervalMs: 0 },
      cache: { maxEntries: 0, ttlMs: 0 },
      policy: { tryConsumeBudget: consumeBudget },
    });
    const app = createApp({ NODE_ENV: 'test' }, {
      reportAddressSuggestionService: service,
      addressIpLimiter: { consume: vi.fn(() => ({ allowed: false as const, code: 'rate_limited' as const, retryAfterSeconds: 17 })) },
      serviceAreaClassifier: () => 'inside',
    });
    await startServer(app);
    const response = await fetch(`${baseUrl}/api/reports${path}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    });
    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('17');
    expect(await response.json()).toMatchObject({ code: 'rate_limited', targetValidated: true });
    expect(reverse).not.toHaveBeenCalled();
    expect(consumeBudget).not.toHaveBeenCalled();
    expect(service.counters()).toMatchObject({ accepted: 0 });
  });

  it('ignores injected provider transports in production and keeps external transfer disabled', async () => {
    const reverse = vi.fn(async () => ({ address: 'Must not reach production transport' }));
    const app = createApp({ NODE_ENV: 'production' }, {
      reportAddressSuggestionService: enabledFakeService({ id: 'fake', reverse }),
    });
    await startServer(app);
    const response = await fetch(`${baseUrl}/api/reports/address-suggestion`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        latitude: 48.7,
        longitude: 21.25,
        targetKind: 'custom',
        language: 'sk',
      }),
    });

    expect(response.status).toBe(503);
    expect(reverse).not.toHaveBeenCalled();
  });

  it.each([
    ['empty-string coordinates', { latitude: '', longitude: 21.25, targetKind: 'custom', language: 'sk' }, 'invalid_coordinates'],
    ['out-of-range coordinates', { latitude: 48.7, longitude: 181, targetKind: 'custom', language: 'sk' }, 'invalid_coordinates'],
    ['light-point target', { latitude: 48.7, longitude: 21.25, targetKind: 'light-point', language: 'sk' }, 'invalid_request'],
    ['unexpected field', { latitude: 48.7, longitude: 21.25, targetKind: 'custom', language: 'sk', address: 'PII' }, 'invalid_request'],
  ])('rejects %s before calling the injected provider', async (_label, payload, code) => {
    const reverse = vi.fn(async () => ({ address: 'Never requested' }));
    const app = createApp({ NODE_ENV: 'test' }, {
      reportAddressSuggestionService: enabledFakeService({ id: 'fake', reverse }),
    });
    await startServer(app);
    const response = await fetch(`${baseUrl}/api/reports/address-suggestion`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code });
    expect(reverse).not.toHaveBeenCalled();
  });

  it('accepts only synthetic request fields and returns normalized fake-provider data', async () => {
    const reverse = vi.fn(async () => ({ address: 'Jarná 12, Košice', locality: 'Jarná' }));
    const app = createApp({ NODE_ENV: 'test' }, {
      reportAddressSuggestionService: enabledFakeService({ id: 'fake', reverse }),
    });
    await startServer(app);
    const response = await fetch(`${baseUrl}/api/reports/address-suggestion`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        latitude: 48.7,
        longitude: 21.25,
        targetKind: 'device',
        language: 'sk',
      }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: true,
      data: { address: 'Jarná 12, Košice', locality: 'Jarná' },
    });
    expect(reverse).toHaveBeenCalledTimes(1);
  });

  it('cancels queued provider work when the requesting client disconnects', async () => {
    let releaseFirst!: (value: { address: string }) => void;
    const firstWork = new Promise<{ address: string }>((resolve) => { releaseFirst = resolve; });
    const reverse = vi.fn(() => firstWork);
    const service = createReportAddressSuggestionService({
      enabled: true,
      provider: { id: 'fake', reverse },
      admission: {
        maxPending: 1,
        maxActive: 1,
        queueExpiryMs: 5_000,
        timeoutMs: 5_000,
        minStartIntervalMs: 0,
      },
      cache: { maxEntries: 0, ttlMs: 0 },
    });
    await startServer(createApp({ NODE_ENV: 'test' }, { reportAddressSuggestionService: service }));
    const url = `${baseUrl}/api/reports/address-suggestion`;
    const payload = JSON.stringify({
      latitude: 48.7,
      longitude: 21.25,
      targetKind: 'device',
      language: 'sk',
    });

    const firstHttpRequest = httpRequest(new URL(url), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    const firstRequest = new Promise<number>((resolve, reject) => {
      firstHttpRequest.once('error', reject);
      firstHttpRequest.once('response', (response) => {
        response.resume();
        response.once('end', () => resolve(response.statusCode ?? 0));
      });
    });
    firstHttpRequest.end(payload);
    for (let attempt = 0; attempt < 100 && reverse.mock.calls.length === 0; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    expect(reverse).toHaveBeenCalledTimes(1);

    const queuedHttpRequest = httpRequest(new URL(url), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    queuedHttpRequest.on('error', () => undefined);
    const queuedClosed = new Promise<void>((resolve) => queuedHttpRequest.once('close', resolve));
    queuedHttpRequest.end(payload.replace('48.7', '48.71'));
    for (let attempt = 0; attempt < 100 && service.counters().accepted < 2; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    expect(service.counters().accepted).toBe(2);
    queuedHttpRequest.destroy();
    await queuedClosed;

    releaseFirst({ address: 'Synthetic address' });
    expect(await firstRequest).toBe(200);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(reverse).toHaveBeenCalledTimes(1);
  });

  it('does not log malformed JSON request bodies that may contain coordinates', async () => {
    const errorLog = vi.spyOn(console, 'error');
    await startServer();
    const response = await fetch(`${baseUrl}/api/reports/address-suggestion`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"latitude":48.7,"longitude":21.25',
    });

    expect(response.status).toBe(400);
    expect(errorLog).not.toHaveBeenCalled();
  });
});
