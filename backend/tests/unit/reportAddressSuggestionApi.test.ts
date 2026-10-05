import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../src/app.js';
import {
  createReportAddressSuggestionService,
  type AddressSuggestionProvider,
} from '../../src/services/reportAddressSuggestion.service.js';

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
        latitude: 48.7,
        longitude: 21.25,
        targetKind: 'custom',
        language: 'sk',
      }),
    });
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ success: false, code: 'disabled' });

    const legacy = await fetch(`${baseUrl}/api/geocode/reverse?lat=48.7&lng=21.25`);
    expect(legacy.status).toBe(404);
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
    ['empty-string coordinates', { latitude: '', longitude: 21.25, targetKind: 'custom', language: 'sk' }],
    ['out-of-range coordinates', { latitude: 48.7, longitude: 181, targetKind: 'custom', language: 'sk' }],
    ['light-point target', { latitude: 48.7, longitude: 21.25, targetKind: 'light-point', language: 'sk' }],
    ['unexpected field', { latitude: 48.7, longitude: 21.25, targetKind: 'custom', language: 'sk', address: 'PII' }],
  ])('rejects %s before calling the injected provider', async (_label, payload) => {
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
