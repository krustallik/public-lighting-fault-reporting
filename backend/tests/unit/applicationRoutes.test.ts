import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';

let server: Server | undefined;
let baseUrl: string;

async function startServer(): Promise<void> {
  server = createServer(createApp({ NODE_ENV: 'test', LOCAL_TEST_SUBMIT_ENABLED: 'true' }));
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
});
