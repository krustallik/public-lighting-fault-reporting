import { createServer, request as httpRequest, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp, type AppOptions } from '../../src/app.js';
import {
  createReportAddressSuggestionService,
  type AddressSuggestionProvider,
} from '../../src/services/reportAddressSuggestion.service.js';
import type {
  LightPointAddressRepository,
  PersistLightPointAddressResult,
} from '../../src/services/lightPointAddressRepository.js';
import { normalizeLimiterAddress } from '../../src/security/clientAddress.js';
import { verifyReportAddressProof } from '../../src/services/reportAddressProof.js';

let server: Server | undefined;
let baseUrl = '';

function createTestApp(env: Record<string, string | undefined> = { NODE_ENV: 'test' }, options: AppOptions = {}) {
  return createApp(env, { serviceAreaClassifier: () => 'inside', ...options });
}

async function startServer(app = createTestApp()): Promise<void> {
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

function memoryLightPointAddressRepository(initialAddress: string | null = null) {
  let address = initialAddress;
  const repository: LightPointAddressRepository = {
    findById: vi.fn(async () => ({ latitude: 48.7164, longitude: 21.2611, address })),
    persistIfMissing: vi.fn(async ({ latitude, longitude, address: nextAddress }): Promise<PersistLightPointAddressResult> => {
      if (latitude !== 48.7164 || longitude !== 21.2611) {
        return { status: 'coordinates_changed', address };
      }
      if (address) return { status: 'existing', address };
      address = nextAddress;
      return { status: 'stored', address: nextAddress };
    }),
  };
  return { repository, read: () => address };
}

afterEach(stopServer);

describe('report-scoped address suggestion API', () => {
  it('validates selected targets without invoking the geocoder or consuming address-provider limits', async () => {
    const reverse = vi.fn(async () => ({ address: 'Must not be requested for selection validation' }));
    const limiter = { consume: vi.fn(() => ({ allowed: true as const })) };
    const coordinates = { findCoordinates: vi.fn(async () => ({ latitude: 48.7164, longitude: 21.2611 })) };
    await startServer(createTestApp({ NODE_ENV: 'test' }, {
      reportAddressSuggestionService: enabledFakeService({ id: 'fake', reverse }),
      addressIpLimiter: limiter,
      reportTargetCoordinateRepository: coordinates,
      serviceAreaClassifier: () => 'outside',
    }));

    const response = await fetch(`${baseUrl}/api/reports/target-validation`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetKind: 'light-point', lightPointId: 42 }),
    });

    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ success: false, code: 'outside_service_area' });
    expect(coordinates.findCoordinates).toHaveBeenCalledWith(42);
    expect(limiter.consume).not.toHaveBeenCalled();
    expect(reverse).not.toHaveBeenCalled();
  });

  it('rate-limits anonymous target validation before database or area-classifier work', async () => {
    const targetLimiter = { consume: vi.fn(() => ({ allowed: false as const, code: 'rate_limited' as const, retryAfterSeconds: 23 })) };
    const providerLimiter = { consume: vi.fn(() => ({ allowed: true as const })) };
    const coordinates = { findCoordinates: vi.fn(async () => ({ latitude: 48.7164, longitude: 21.2611 })) };
    const classifyArea = vi.fn(() => 'inside' as const);
    await startServer(createTestApp({ NODE_ENV: 'test' }, {
      addressIpLimiter: providerLimiter,
      reportTargetValidationIpLimiter: targetLimiter,
      reportTargetCoordinateRepository: coordinates,
      serviceAreaClassifier: classifyArea,
    }));

    const response = await fetch(`${baseUrl}/api/reports/target-validation`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetKind: 'light-point', lightPointId: 42 }),
    });

    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('23');
    expect(await response.json()).toMatchObject({ code: 'rate_limited', targetValidated: false });
    expect(coordinates.findCoordinates).not.toHaveBeenCalled();
    expect(classifyArea).not.toHaveBeenCalled();
    expect(providerLimiter.consume).not.toHaveBeenCalled();
  });

  it('accepts a point inside the service area and rejects malformed target-validation requests', async () => {
    await startServer(createTestApp({ NODE_ENV: 'test' }, {
      serviceAreaClassifier: (point) => {
        expect(point).toEqual({ latitude: 48.7, longitude: 21.25 });
        return 'inside';
      },
    }));

    const response = await fetch(`${baseUrl}/api/reports/target-validation`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetKind: 'custom', latitude: 48.7, longitude: 21.25 }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, data: { valid: true } });

    const malformed = await fetch(`${baseUrl}/api/reports/target-validation`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetKind: 'custom', latitude: 48.7, longitude: 21.25, language: 'sk' }),
    });
    expect(malformed.status).toBe(400);
    expect(await malformed.json()).toMatchObject({ code: 'invalid_request' });
  });

  it('maps inventory, invalid-coordinate, and unavailable-area outcomes without provider or limiter work', async () => {
    const reverse = vi.fn(async () => ({ address: 'Must not be requested for target validation' }));
    const limiter = { consume: vi.fn(() => ({ allowed: true as const })) };
    const coordinates = {
      findCoordinates: vi.fn(async (id: number) => id === 17 ? { latitude: 48.7164, longitude: 21.2611 } : null),
    };
    const classifyArea = vi.fn()
      .mockReturnValueOnce('inside' as const)
      .mockReturnValueOnce('unavailable' as const);
    await startServer(createTestApp({ NODE_ENV: 'test' }, {
      reportAddressSuggestionService: enabledFakeService({ id: 'fake', reverse }),
      addressIpLimiter: limiter,
      reportTargetCoordinateRepository: coordinates,
      serviceAreaClassifier: classifyArea,
    }));

    const postTarget = (body: unknown) => fetch(`${baseUrl}/api/reports/target-validation`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const validInventory = await postTarget({ targetKind: 'light-point', lightPointId: 17 });
    expect(validInventory.status).toBe(200);
    expect(await validInventory.json()).toEqual({ success: true, data: { valid: true } });

    const missingInventory = await postTarget({ targetKind: 'light-point', lightPointId: 18 });
    expect(missingInventory.status).toBe(404);
    expect(await missingInventory.json()).toMatchObject({ success: false, code: 'light_point_not_found' });

    const invalidCoordinates = await postTarget({ targetKind: 'device', latitude: 91, longitude: 21.2611 });
    expect(invalidCoordinates.status).toBe(400);
    expect(await invalidCoordinates.json()).toMatchObject({ success: false, code: 'invalid_coordinates' });

    const unavailableArea = await postTarget({ targetKind: 'custom', latitude: 48.7164, longitude: 21.2611 });
    expect(unavailableArea.status).toBe(503);
    expect(await unavailableArea.json()).toEqual({
      success: false,
      code: 'service_area_unavailable',
      message: 'Address assistance is unavailable.',
    });

    expect(coordinates.findCoordinates).toHaveBeenNthCalledWith(1, 17);
    expect(coordinates.findCoordinates).toHaveBeenNthCalledWith(2, 18);
    expect(classifyArea).toHaveBeenCalledTimes(2);
    expect(classifyArea).toHaveBeenNthCalledWith(1, { latitude: 48.7164, longitude: 21.2611 });
    expect(limiter.consume).not.toHaveBeenCalled();
    expect(reverse).not.toHaveBeenCalled();
  });

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
    await startServer(createTestApp({ NODE_ENV: 'test' }, {
      reportAddressSuggestionService: enabledFakeService({ id: 'fake', reverse: async () => null }),
    }));
    const response = await fetch(`${baseUrl}/api/reports/address-assistance-capability`);
    expect(response.status).toBe(404);
  });

  it('rejects an outside reverse target before the fake provider can be dispatched', async () => {
    const reverse = vi.fn(async () => ({ address: 'Must remain private' }));
    const limiter = { consume: vi.fn(() => ({ allowed: true as const })) };
    const app = createTestApp({ NODE_ENV: 'test' }, {
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
    const proofSecret = 'report address route test secret';
    const provider: AddressSuggestionProvider = {
      id: 'fake',
      reverse: vi.fn(async () => ({ address: 'Synthetic address' })),
    };
    const limiter = { consume: vi.fn((address: string) => { observedAddresses.push(address); return { allowed: true as const }; }) };
    const app = createTestApp({ NODE_ENV: 'test', TRUST_PROXY_CIDRS: '', JWT_SECRET: proofSecret }, {
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
    const body = await response.json() as { data: { address: string; proof: string } };
    expect(body.data.address).toBe('Synthetic address');
    expect(verifyReportAddressProof(body.data.address, 'custom', 48.7, 21.25, body.data.proof, proofSecret)).toBe(true);
    expect(normalizeLimiterAddress(observedAddresses[0])).toBe('v4:127.0.0.1');
    expect(observedAddresses[0]).not.toBe('203.0.113.91');
  });

  it('uses a trusted proxy chain only when every hop is explicitly in the CIDR allowlist', async () => {
    const observedAddresses: string[] = [];
    const limiter = { consume: vi.fn((address: string) => { observedAddresses.push(address); return { allowed: true as const }; }) };
    const app = createTestApp({ NODE_ENV: 'test', TRUST_PROXY_CIDRS: '127.0.0.1/32,10.0.0.0/8' }, {
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
    const app = createTestApp({ NODE_ENV: 'test' }, {
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

  it('supports an injected fake provider in a production-configured app without live transport', async () => {
    const reverse = vi.fn(async () => ({ address: 'Synthetic isolated address' }));
    const app = createTestApp({
      NODE_ENV: 'production',
      PUBLIC_ORIGIN: 'https://mapa-svietidiel.sk',
      ADMIN_ORIGIN: 'https://panel.mapa-svietidiel.sk',
      TRUST_PROXY_CIDRS: '172.30.0.2/32',
      JWT_SECRET: Buffer.from(Array.from({ length: 32 }, (_, index) => index + 1)).toString('base64url'),
      DB_HOST: 'db', DB_PORT: '5432', DB_NAME: 'lighting_test', DB_USER: 'lighting_runtime', DB_PASSWORD: 'synthetic-runtime-password',
      GEOAPIFY_ENABLED: 'true', GEOAPIFY_BASE_URL: 'https://api-eu.geoapify.com', GEOAPIFY_API_KEY: 'synthetic-provider-key',
      GEOAPIFY_TIMEOUT_MS: '3000', GEOAPIFY_MAX_ACTIVE: '1', GEOAPIFY_MAX_PENDING: '1',
      GEOAPIFY_START_INTERVAL_MS: '250', GEOAPIFY_QUEUE_EXPIRY_MS: '4000', GEOAPIFY_DAILY_BUDGET: '2700',
      ADDRESS_IP_BUCKET_BURST: '10', ADDRESS_IP_REFILL_PER_MINUTE: '30', ADDRESS_IP_MAX_KEYS: '8192', ADDRESS_IP_IDLE_TTL_MS: '120000',
      NOMINATIM_AUTO_GEOCODE: 'false', LOCAL_TEST_SUBMIT_ENABLED: 'false', REPORT_SUBMISSION_MODE: 'disabled',
    }, {
      reportAddressSuggestionService: enabledFakeService({ id: 'fake', reverse }),
    });
    await startServer(app);
    const body = JSON.stringify({
        latitude: 48.7,
        longitude: 21.25,
        targetKind: 'custom',
        language: 'sk',
      });
    const responseStatus = await new Promise<number>((resolve, reject) => {
      const request = httpRequest(new URL(`${baseUrl}/api/reports/address-suggestion`), {
        method: 'POST',
        headers: {
          host: 'mapa-svietidiel.sk',
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
      }, (incoming) => {
        incoming.resume();
        incoming.once('end', () => resolve(incoming.statusCode ?? 0));
      });
      request.once('error', reject);
      request.end(body);
    });

    expect(responseStatus).toBe(200);
    expect(reverse).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['empty-string coordinates', { latitude: '', longitude: 21.25, targetKind: 'custom', language: 'sk' }, 'invalid_coordinates'],
    ['out-of-range coordinates', { latitude: 48.7, longitude: 181, targetKind: 'custom', language: 'sk' }, 'invalid_coordinates'],
    ['light-point target', { latitude: 48.7, longitude: 21.25, targetKind: 'light-point', language: 'sk' }, 'invalid_request'],
    ['unexpected field', { latitude: 48.7, longitude: 21.25, targetKind: 'custom', language: 'sk', address: 'PII' }, 'invalid_request'],
  ])('rejects %s before calling the injected provider', async (_label, payload, code) => {
    const reverse = vi.fn(async () => ({ address: 'Never requested' }));
    const app = createTestApp({ NODE_ENV: 'test' }, {
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
    const app = createTestApp({ NODE_ENV: 'test' }, {
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
      data: {
        address: 'Jarná 12, Košice', locality: 'Jarná',
        proof: expect.stringMatching(/^v1\.[A-Za-z0-9_-]{43}$/),
      },
    });
    expect(reverse).toHaveBeenCalledTimes(1);
  });

  it('geocodes only the server-resolved coordinates of an explicitly selected inventory point', async () => {
    const reverse = vi.fn(async () => ({ address: 'Jarná 12, Košice', locality: 'Košice' }));
    const addressStore = memoryLightPointAddressRepository();
    const findCoordinates = vi.fn(async (id: number) =>
      id === 81 ? { latitude: 48.7164, longitude: 21.2611 } : null
    );
    const app = createTestApp({ NODE_ENV: 'test' }, {
      reportAddressSuggestionService: enabledFakeService({ id: 'fake', reverse }),
      reportTargetCoordinateRepository: { findCoordinates },
      reportTargetAddressRepository: addressStore.repository,
    });
    await startServer(app);

    const response = await fetch(`${baseUrl}/api/reports/address-suggestion`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetKind: 'light-point', lightPointId: 81, language: 'sk' }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: true,
      data: { address: 'Jarná 12, Košice', locality: 'Košice' },
    });
    expect(findCoordinates).toHaveBeenCalledWith(81);
    expect(reverse).toHaveBeenCalledWith({ latitude: 48.7164, longitude: 21.2611, language: 'sk' }, expect.any(AbortSignal));
    expect(addressStore.repository.persistIfMissing).toHaveBeenCalledWith({
      id: 81, latitude: 48.7164, longitude: 21.2611, address: 'Jarná 12, Košice',
    });
    expect(addressStore.read()).toBe('Jarná 12, Košice');
  });

  it('reuses a persisted inventory address without consuming provider capacity', async () => {
    const reverse = vi.fn(async () => ({ address: 'Must not be requested' }));
    const addressStore = memoryLightPointAddressRepository('Jarná 12, Košice');
    const limiter = { consume: vi.fn(() => ({ allowed: true as const })) };
    const app = createTestApp({ NODE_ENV: 'test' }, {
      reportAddressSuggestionService: enabledFakeService({ id: 'fake', reverse }),
      addressIpLimiter: limiter,
      reportTargetCoordinateRepository: {
        findCoordinates: vi.fn(async () => ({ latitude: 48.7164, longitude: 21.2611 })),
      },
      reportTargetAddressRepository: addressStore.repository,
    });
    await startServer(app);

    const response = await fetch(`${baseUrl}/api/reports/address-suggestion`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetKind: 'light-point', lightPointId: 81, language: 'sk' }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, data: { address: 'Jarná 12, Košice' } });
    expect(reverse).not.toHaveBeenCalled();
    expect(limiter.consume).not.toHaveBeenCalled();
    expect(addressStore.repository.persistIfMissing).not.toHaveBeenCalled();
  });

  it.each(['no-result', 'provider-failure'] as const)(
    'does not persist a selected-point geocode result after %s',
    async (scenario) => {
      const reverse = vi.fn(async () => {
        if (scenario === 'no-result') return null;
        throw new Error('synthetic provider failure');
      });
      const addressStore = memoryLightPointAddressRepository();
      const app = createTestApp({ NODE_ENV: 'test' }, {
        reportAddressSuggestionService: enabledFakeService({ id: `fake-${scenario}`, reverse }),
        addressIpLimiter: { consume: vi.fn(() => ({ allowed: true as const })) },
        reportTargetCoordinateRepository: {
          findCoordinates: vi.fn(async () => ({ latitude: 48.7164, longitude: 21.2611 })),
        },
        reportTargetAddressRepository: addressStore.repository,
      });
      await startServer(app);

      const response = await fetch(`${baseUrl}/api/reports/address-suggestion`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetKind: 'light-point', lightPointId: 81, language: 'sk' }),
      });

      expect(addressStore.repository.persistIfMissing).not.toHaveBeenCalled();
      expect(addressStore.read()).toBeNull();
      expect(response.status).toBe(scenario === 'no-result' ? 200 : 503);
    }
  );

  it('discards a provider result when the selected inventory coordinates changed in flight', async () => {
    const reverse = vi.fn(async () => ({ address: 'Stale synthetic address' }));
    const repository: LightPointAddressRepository = {
      findById: vi.fn(async () => ({ latitude: 48.7164, longitude: 21.2611, address: null })),
      persistIfMissing: vi.fn(async (): Promise<PersistLightPointAddressResult> => ({
        status: 'coordinates_changed', address: null,
      })),
    };
    await startServer(createTestApp({ NODE_ENV: 'test' }, {
      reportAddressSuggestionService: enabledFakeService({ id: 'fake-stale', reverse }),
      addressIpLimiter: { consume: vi.fn(() => ({ allowed: true as const })) },
      reportTargetCoordinateRepository: {
        findCoordinates: vi.fn(async () => ({ latitude: 48.7164, longitude: 21.2611 })),
      },
      reportTargetAddressRepository: repository,
    }));

    const response = await fetch(`${baseUrl}/api/reports/address-suggestion`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetKind: 'light-point', lightPointId: 81, language: 'sk' }),
    });

    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body).toMatchObject({ code: 'light_point_changed' });
    expect(JSON.stringify(body)).not.toContain('Stale synthetic address');
    expect(repository.persistIfMissing).toHaveBeenCalledTimes(1);
  });

  it('coalesces concurrent selected-light requests and stores the provider result once', async () => {
    let releaseProvider!: (value: { address: string }) => void;
    const providerResponse = new Promise<{ address: string }>((resolve) => { releaseProvider = resolve; });
    const reverse = vi.fn(() => providerResponse);
    const addressStore = memoryLightPointAddressRepository();
    const limiter = { consume: vi.fn(() => ({ allowed: true as const })) };
    const reportAddressSuggestionService = createReportAddressSuggestionService({
      enabled: true,
      provider: { id: 'fake', reverse },
      admission: {
        maxPending: 2,
        maxActive: 1,
        queueExpiryMs: 2_000,
        timeoutMs: 2_000,
        minStartIntervalMs: 0,
      },
      cache: { maxEntries: 0, ttlMs: 0 },
    });
    const app = createTestApp({ NODE_ENV: 'test' }, {
      reportAddressSuggestionService,
      addressIpLimiter: limiter,
      reportTargetCoordinateRepository: {
        findCoordinates: vi.fn(async () => ({ latitude: 48.7164, longitude: 21.2611 })),
      },
      reportTargetAddressRepository: addressStore.repository,
    });
    await startServer(app);

    const request = () => fetch(`${baseUrl}/api/reports/address-suggestion`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetKind: 'light-point', lightPointId: 81, language: 'sk' }),
    });
    const first = request();
    const second = request();
    for (let attempt = 0; attempt < 200 &&
      (reverse.mock.calls.length === 0 || limiter.consume.mock.calls.length < 2); attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    expect(reverse).toHaveBeenCalledTimes(1);
    expect(limiter.consume).toHaveBeenCalledTimes(2);
    releaseProvider({ address: 'Jarná 12, Košice' });

    const responses = await Promise.all([first, second]);
    expect(responses.map((response) => response.status)).toEqual([200, 200]);
    expect(await Promise.all(responses.map((response) => response.json()))).toEqual([
      { success: true, data: { address: 'Jarná 12, Košice' } },
      { success: true, data: { address: 'Jarná 12, Košice' } },
    ]);
    expect(addressStore.repository.persistIfMissing).toHaveBeenCalledTimes(2);
    expect(addressStore.read()).toBe('Jarná 12, Košice');
  });

  it('rejects an unknown inventory point before the fake geocoder can be called', async () => {
    const reverse = vi.fn(async () => ({ address: 'Should not be requested' }));
    const app = createTestApp({ NODE_ENV: 'test' }, {
      reportAddressSuggestionService: enabledFakeService({ id: 'fake', reverse }),
      reportTargetCoordinateRepository: { findCoordinates: vi.fn(async () => null) },
    });
    await startServer(app);

    const response = await fetch(`${baseUrl}/api/reports/address-suggestion`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetKind: 'light-point', lightPointId: 404, language: 'sk' }),
    });

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ code: 'light_point_not_found' });
    expect(reverse).not.toHaveBeenCalled();
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
    await startServer(createTestApp({ NODE_ENV: 'test' }, { reportAddressSuggestionService: service }));
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
