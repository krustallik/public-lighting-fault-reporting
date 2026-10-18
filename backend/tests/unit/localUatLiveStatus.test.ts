import { createServer } from 'node:http';
import { request as httpRequest } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { createLiveUatStatusHandler } from '../local-uat/liveStatus.js';
import { LiveProviderEvidence } from '../local-uat/liveProviders.js';

const servers: ReturnType<typeof createServer>[] = [];

function startStatusServer() {
  const evidence = new LiveProviderEvidence();
  const server = createServer((request, response) => {
    const handler = createLiveUatStatusHandler(() => ({
      database: { postgisVerified: true, migrationsCurrent: true, inventoryRows: 255 },
      providers: {
        resend: {
          configured: true, ownerAccountConfirmation: 'required', fromConfigured: true,
          approvedRecipientAllowlist: true, maxSendsPerProcess: 3,
        },
        geoapify: { configured: true, maxRequestsPerProcess: 10 },
        carto: {
          configured: true, tileEvidence: 'reported_in_public_browser',
          attribution: 'owner_browser_confirmation_required',
        },
        observations: evidence.snapshot(),
      },
      submission: { status: 'ON_HOLD', result: 'local simulated sink only', externalRequests: 0 },
    }));
    if (!handler(request, response)) response.writeHead(404).end();
  });
  servers.push(server);
  return new Promise<{ server: ReturnType<typeof createServer>; origin: string }>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Expected an ephemeral local port.');
      resolve({ server, origin: `http://127.0.0.1:${address.port}` });
    });
  });
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

describe('LIVE_PROVIDER_UAT status surface', () => {
  it('reports live provider outcome classes and local DB evidence without secrets or OTPs', async () => {
    const { origin } = await startStatusServer();
    const response = await fetch(`${origin}/api/dev/local-uat/status`);
    const body = await response.json() as Record<string, any>;

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      mode: 'LIVE_PROVIDER_UAT',
      database: { postgisVerified: true, migrationsCurrent: true, inventoryRows: 255 },
      providers: {
        resend: { ownerAccountConfirmation: 'required', maxSendsPerProcess: 3 },
        geoapify: { maxRequestsPerProcess: 10 },
        carto: { tileEvidence: 'reported_in_public_browser', attribution: 'owner_browser_confirmation_required' },
        observations: {
          email: { attempts: 0, lastOutcome: 'not_requested', inboxReceipt: 'owner_confirmation_required' },
          address: { requests: 0, lastOutcome: 'not_requested' },
        },
      },
      submission: { status: 'ON_HOLD', result: 'local simulated sink only', externalRequests: 0 },
    });
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain('test-resend-key');
    expect(serialized).not.toContain('test-geo-key');
    expect(serialized).not.toContain('owner@example.test');
    expect(serialized).not.toContain('482913');
  });

  it('allows HEAD, rejects mutation methods, and rejects a mismatched host', async () => {
    const { origin } = await startStatusServer();
    const head = await fetch(`${origin}/api/dev/local-uat/status`, { method: 'HEAD' });
    expect(head.status).toBe(200);
    expect(await head.text()).toBe('');

    const mutation = await fetch(`${origin}/api/dev/local-uat/status`, { method: 'POST' });
    expect(mutation.status).toBe(405);
    expect(mutation.headers.get('allow')).toBe('GET, HEAD');

    const wrongHostStatus = await new Promise<number>((resolve, reject) => {
      const request = httpRequest(`${origin}/api/dev/local-uat/status`, {
        headers: { Host: 'external.example.test' },
      }, (response) => {
        response.resume();
        response.once('end', () => resolve(response.statusCode ?? 0));
      });
      request.once('error', reject);
      request.end();
    });
    expect(wrongHostStatus).toBe(403);
  });

  it('leaves unrelated application paths to the regular app router', async () => {
    const { origin } = await startStatusServer();
    const response = await fetch(`${origin}/api/dev/another-route`);
    expect(response.status).toBe(404);
  });
});
