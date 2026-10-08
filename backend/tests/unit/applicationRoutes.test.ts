import { createServer, request as nodeHttpRequest, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';

let server: Server | undefined;
let baseUrl: string;

const productionTestEnv: Record<string, string> = {
  NODE_ENV: 'production',
  PUBLIC_ORIGIN: 'https://mapa.vra-ubuntu-server-0579.virtual.cloud.tuke.sk',
  ADMIN_ORIGIN: 'https://admin.mapa.vra-ubuntu-server-0579.virtual.cloud.tuke.sk',
  TRUST_PROXY_CIDRS: '172.30.0.2/32',
  JWT_SECRET: Buffer.from(Array.from({ length: 32 }, (_, index) => index + 1)).toString('base64url'),
  DB_HOST: 'db',
  DB_PORT: '5432',
  DB_NAME: 'lighting_production_test',
  DB_USER: 'lighting_runtime',
  DB_PASSWORD: 'synthetic-runtime-password',
  GEOAPIFY_ENABLED: 'true',
  GEOAPIFY_BASE_URL: 'https://api-eu.geoapify.com',
  GEOAPIFY_API_KEY: 'synthetic-provider-key',
  GEOAPIFY_TIMEOUT_MS: '3000',
  GEOAPIFY_MAX_ACTIVE: '1',
  GEOAPIFY_MAX_PENDING: '1',
  GEOAPIFY_START_INTERVAL_MS: '250',
  GEOAPIFY_QUEUE_EXPIRY_MS: '4000',
  GEOAPIFY_DAILY_BUDGET: '2700',
  ADDRESS_IP_BUCKET_BURST: '10',
  ADDRESS_IP_REFILL_PER_MINUTE: '30',
  ADDRESS_IP_MAX_KEYS: '8192',
  ADDRESS_IP_IDLE_TTL_MS: '120000',
  NOMINATIM_AUTO_GEOCODE: 'false',
  LOCAL_TEST_SUBMIT_ENABLED: 'false',
};

async function startServer(env: Record<string, string | undefined> = {
  NODE_ENV: 'test',
  LOCAL_TEST_SUBMIT_ENABLED: 'true',
}): Promise<void> {
  server = createServer(createApp(env, { serviceAreaClassifier: () => 'inside' }));
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

function postWithHost(path: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const address = server?.address() as AddressInfo;
    const request = nodeHttpRequest({
      hostname: '127.0.0.1',
      port: address.port,
      path,
      method: 'POST',
      headers: { host: 'mapa.vra-ubuntu-server-0579.virtual.cloud.tuke.sk' },
    }, (response: IncomingMessage) => {
      response.resume();
      response.once('end', () => resolve(response.statusCode ?? 0));
    });
    request.once('error', reject);
    request.end();
  });
}

afterEach(stopServer);

describe('current API report transport boundary', () => {
  it('does not expose the legacy public report submit route', async () => {
    await startServer();
    const response = await fetch(`${baseUrl}/api/reports/send`, { method: 'POST' });
    expect(response.status).toBe(404);
  });

  it('keeps the explicitly enabled local test route available', async () => {
    await startServer();
    const response = await fetch(`${baseUrl}/api/dev/ausemio-test-submit`, { method: 'POST' });
    expect(response.status).toBe(400);
    const body = await response.json() as { error?: { code?: string } };
    expect(body.error?.code).toBe('LOCAL_TEST_INVALID_PAYLOAD');
  });

  it.each([
    ['production with the local sink disabled', productionTestEnv],
    ['test without explicit opt-in', { NODE_ENV: 'test' }],
  ])('does not expose either report POST route in the full app when %s', async (reason, env) => {
    await startServer(env);

    const active = reason.startsWith('production')
      ? { status: await postWithHost('/api/dev/ausemio-test-submit') }
      : await fetch(`${baseUrl}/api/dev/ausemio-test-submit`, { method: 'POST' });
    const legacy = reason.startsWith('production')
      ? { status: await postWithHost('/api/reports/send') }
      : await fetch(`${baseUrl}/api/reports/send`, { method: 'POST' });

    expect(active.status).toBe(404);
    expect(legacy.status).toBe(404);
  });

  it('fails closed when production attempts to enable the local test sink', () => {
    expect(() => createApp({ ...productionTestEnv, LOCAL_TEST_SUBMIT_ENABLED: 'true' }))
      .toThrow(/LOCAL_TEST_SUBMIT_ENABLED/);
  });
});
