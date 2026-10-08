import express from 'express';
import { createServer, request as nodeHttpRequest, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import { createRuntimeConfig, PRODUCTION_ADMIN_ORIGIN, PRODUCTION_PUBLIC_ORIGIN } from '../../src/config/index.js';
import {
  createAdminCsrfGuard,
  createHostBoundary,
  hasValidAdminRequestProvenance,
} from '../../src/middleware/productionRequestBoundary.js';

const ADMIN_ORIGIN = 'https://admin.mapa.vra-ubuntu-server-0579.virtual.cloud.tuke.sk';
const PUBLIC_ORIGIN = 'https://mapa.vra-ubuntu-server-0579.virtual.cloud.tuke.sk';

describe('production admin request provenance', () => {
  it('accepts exact admin Origin and an exact-origin Referer fallback', () => {
    expect(hasValidAdminRequestProvenance({ origin: ADMIN_ORIGIN, fetchSite: 'same-origin' }, ADMIN_ORIGIN)).toBe(true);
    expect(hasValidAdminRequestProvenance({
      referer: `${ADMIN_ORIGIN}/panel-svietidla/login`, fetchSite: 'same-origin',
    }, ADMIN_ORIGIN)).toBe(true);
  });

  it.each([
    ['public sibling origin', { origin: PUBLIC_ORIGIN, fetchSite: 'same-site' }],
    ['cross-site request', { origin: ADMIN_ORIGIN, fetchSite: 'cross-site' }],
    ['same-site without exact origin', { origin: PUBLIC_ORIGIN, fetchSite: 'same-origin' }],
    ['spoofed subdomain', { origin: 'https://admin.mapa.vra-ubuntu-server-0579.virtual.cloud.tuke.sk.attacker.example' }],
    ['protocol-relative origin', { origin: '//admin.mapa.vra-ubuntu-server-0579.virtual.cloud.tuke.sk' }],
    ['missing provenance', {}],
  ])('rejects %s', (_case, provenance) => {
    expect(hasValidAdminRequestProvenance(provenance, ADMIN_ORIGIN)).toBe(false);
  });

  it('rejects invalid Origin even if a valid Referer is also supplied', () => {
    expect(hasValidAdminRequestProvenance({
      origin: 'null', referer: `${ADMIN_ORIGIN}/login`,
    }, ADMIN_ORIGIN)).toBe(false);
  });
});

const productionEnv: Record<string, string> = {
  NODE_ENV: 'production',
  PUBLIC_ORIGIN: PRODUCTION_PUBLIC_ORIGIN,
  ADMIN_ORIGIN: PRODUCTION_ADMIN_ORIGIN,
  TRUST_PROXY_CIDRS: '172.30.0.2/32',
  DB_HOST: 'db', DB_PORT: '5432', DB_NAME: 'synthetic_test',
  DB_USER: 'lighting_runtime', DB_PASSWORD: 'synthetic-runtime-password',
  JWT_SECRET: Buffer.from(Array.from({ length: 32 }, (_, index) => index + 1)).toString('base64url'),
  GEOAPIFY_ENABLED: 'true', GEOAPIFY_BASE_URL: 'https://api-eu.geoapify.com', GEOAPIFY_API_KEY: 'synthetic-key',
  GEOAPIFY_TIMEOUT_MS: '3000', GEOAPIFY_MAX_ACTIVE: '1', GEOAPIFY_MAX_PENDING: '1',
  GEOAPIFY_START_INTERVAL_MS: '250', GEOAPIFY_QUEUE_EXPIRY_MS: '4000', GEOAPIFY_DAILY_BUDGET: '2700',
  ADDRESS_IP_BUCKET_BURST: '10', ADDRESS_IP_REFILL_PER_MINUTE: '30', ADDRESS_IP_MAX_KEYS: '8192', ADDRESS_IP_IDLE_TTL_MS: '120000',
  NOMINATIM_AUTO_GEOCODE: 'false', LOCAL_TEST_SUBMIT_ENABLED: 'false',
};

describe('production admin host and CSRF middleware boundary', () => {
  let server: Server | undefined;
  let port = 0;

  async function start(): Promise<void> {
    const runtime = createRuntimeConfig(productionEnv);
    const app = express();
    app.use('/api/admin', createHostBoundary(runtime, 'admin'), createAdminCsrfGuard(runtime));
    app.post('/api/admin/action', (_request, response) => response.sendStatus(204));
    server = createServer(app);
    await new Promise<void>((resolve, reject) => {
      server?.once('error', reject);
      server?.listen(0, '127.0.0.1', resolve);
    });
    port = (server.address() as AddressInfo).port;
  }

  async function stop(): Promise<void> {
    if (!server?.listening) return;
    await new Promise<void>((resolve, reject) => server?.close((error) => error ? reject(error) : resolve()));
    server = undefined;
  }

  function post(headers: Record<string, string>): Promise<number> {
    return new Promise((resolve, reject) => {
      const request = nodeHttpRequest({
        hostname: '127.0.0.1', port, path: '/api/admin/action', method: 'POST', headers,
      }, (response) => {
        response.resume();
        response.once('end', () => resolve(response.statusCode ?? 0));
      });
      request.once('error', reject);
      request.end();
    });
  }

  it('allows exact admin origin or exact admin referer fallback, including forged forwarded-host input', async () => {
    await start();
    try {
      expect(await post({
        host: 'admin.mapa.vra-ubuntu-server-0579.virtual.cloud.tuke.sk',
        origin: PRODUCTION_ADMIN_ORIGIN,
        'sec-fetch-site': 'same-origin',
        'x-forwarded-host': 'attacker.example',
      })).toBe(204);
      expect(await post({
        host: 'admin.mapa.vra-ubuntu-server-0579.virtual.cloud.tuke.sk',
        referer: `${PRODUCTION_ADMIN_ORIGIN}/login`,
        'sec-fetch-site': 'same-origin',
      })).toBe(204);
    } finally { await stop(); }
  });

  it('rejects sibling public origin, missing provenance, and a public-host request', async () => {
    await start();
    try {
      expect(await post({
        host: 'admin.mapa.vra-ubuntu-server-0579.virtual.cloud.tuke.sk',
        origin: PRODUCTION_PUBLIC_ORIGIN,
        'sec-fetch-site': 'same-site',
      })).toBe(403);
      expect(await post({ host: 'admin.mapa.vra-ubuntu-server-0579.virtual.cloud.tuke.sk' })).toBe(403);
      expect(await post({
        host: 'mapa.vra-ubuntu-server-0579.virtual.cloud.tuke.sk',
        origin: PRODUCTION_ADMIN_ORIGIN,
        'sec-fetch-site': 'same-origin',
      })).toBe(403);
    } finally { await stop(); }
  });
});
