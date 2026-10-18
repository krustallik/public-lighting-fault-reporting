import { createServer, request as httpRequest, type Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { createEmailInboxServer, createLocalUatTools } from '../local-uat/http.js';
import { assertLocalUatEnvironment, assertLocalUatWorkingDirectory } from '../local-uat/environment.js';
import { LocalUatAddressProvider, LocalUatEmailProvider } from '../local-uat/fakes.js';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const openServers: Server[] = [];

async function reservePort(): Promise<number> {
  const server = createServer();
  const port = await listen(server);
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  openServers.splice(openServers.indexOf(server), 1);
  return port;
}

async function listen(server: Server, requestedPort = 0): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(requestedPort, '127.0.0.1', resolve);
  });
  openServers.push(server);
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected a TCP test listener.');
  return address.port;
}

async function requestStatusWithHost(url: string, host: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const request = httpRequest(url, { headers: { host } }, (response) => {
      response.resume();
      response.once('end', () => resolve(response.statusCode ?? 0));
    });
    request.once('error', reject);
    request.end();
  });
}

afterEach(async () => {
  await Promise.all(openServers.splice(0).map((server) => new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  })));
});

const validEnvironment: Record<string, string | undefined> = {
  NODE_ENV: 'development',
  LOCAL_UAT_MODE: 'true',
  EMAIL_VERIFICATION_ENABLED: 'true',
  LOCAL_TEST_SUBMIT_ENABLED: 'true',
  DB_HOST: '127.0.0.1',
  DB_PORT: '5433',
  DB_NAME: 'lighting_faults_local_uat_dev',
  DB_USER: 'plfr_uat',
  DB_PASSWORD: 'synthetic-local-value',
  PORT: '5000',
  EMAIL_E2E_PORT: '5001',
  GEOAPIFY_ENABLED: 'false',
  NOMINATIM_AUTO_GEOCODE: 'false',
  AUSEMIO_API_KEY: '',
  RESEND_API_KEY: '',
};

describe('local UAT admission and HTTP controls', () => {
  it('admits only the disposable loopback configuration and rejects provider secret files', () => {
    expect(() => assertLocalUatEnvironment(validEnvironment)).not.toThrow();
    expect(() => assertLocalUatEnvironment({ ...validEnvironment, DB_HOST: 'database.internal' }))
      .toThrow('dedicated loopback-only');
    expect(() => assertLocalUatEnvironment({ ...validEnvironment, RESEND_API_KEY_FILE: 'secret.path' }))
      .toThrow('dedicated loopback-only');
    expect(() => assertLocalUatEnvironment({ ...validEnvironment, DOTENV_KEY: 'dotenv://example.test/vault/development?key=synthetic' }))
      .toThrow('dedicated loopback-only');
    expect(() => assertLocalUatEnvironment({ ...validEnvironment, AGE_IDENTITY_FILE: 'secret.path' }))
      .toThrow('dedicated loopback-only');
    expect(() => assertLocalUatEnvironment({ ...validEnvironment, BACKUP_DB_PASSWORD: 'synthetic-secret' }))
      .toThrow('dedicated loopback-only');
    expect(() => assertLocalUatEnvironment({ ...validEnvironment, MIGRATION_DB_USER: 'lighting_migrator' }))
      .toThrow('dedicated loopback-only');
    expect(() => assertLocalUatEnvironment({ ...validEnvironment, ADMIN_INITIAL_PASSWORD: 'synthetic-secret' }))
      .toThrow('dedicated loopback-only');
    expect(() => assertLocalUatEnvironment({ ...validEnvironment, admin_initial_password: 'synthetic-secret' }))
      .toThrow('dedicated loopback-only');
    expect(() => assertLocalUatEnvironment({ ...validEnvironment, backup_db_password: 'synthetic-secret' }))
      .toThrow('dedicated loopback-only');
    expect(() => assertLocalUatEnvironment({ ...validEnvironment, migration_db_user: 'lighting_migrator' }))
      .toThrow('dedicated loopback-only');
  });

  it('requires the private state working directory and rejects dotenv files before app imports', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'plfr-uat-'));
    try {
      expect(() => assertLocalUatWorkingDirectory(root, root)).not.toThrow();
      expect(() => assertLocalUatWorkingDirectory(path.dirname(root), root))
        .toThrow('private state directory');
      writeFileSync(path.join(root, '.env.local'), 'RESEND_API_KEY=must-not-load\n');
      expect(() => assertLocalUatWorkingDirectory(root, root)).toThrow('dotenv files');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('rejects unapproved Host values and validates scenario updates', async () => {
    const address = new LocalUatAddressProvider();
    const email = new LocalUatEmailProvider();
    const backendPort = await reservePort();
    const port = await listen(createServer(createLocalUatTools(address, email, { port: backendPort })), backendPort);
    const base = `http://127.0.0.1:${port}`;

    expect(await requestStatusWithHost(`${base}/api/dev/local-uat/status`, 'untrusted.example')).toBe(403);

    const invalid = await fetch(`${base}/api/dev/local-uat/address-scenario`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ scenario: 'unknown', extra: true }),
    });
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toMatchObject({ code: 'LOCAL_UAT_INVALID_SCENARIO' });
    expect(address.scenario()).toBe('success');

    const accepted = await fetch(`${base}/api/dev/local-uat/address-scenario`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ scenario: 'no-result' }),
    });
    expect(accepted.status).toBe(200);
    expect(await accepted.json()).toEqual({ success: true, scenario: 'no-result' });
    expect(address.scenario()).toBe('no-result');
  });

  it('serves the fake inbox only over the fixed loopback Host and supports GET and HEAD', async () => {
    const email = new LocalUatEmailProvider();
    await email.sendVerificationCode({ email: 'citizen@example.test', code: '123456', locale: 'en' });
    const inboxPort = await reservePort();
    const port = await listen(createEmailInboxServer(email, inboxPort), inboxPort);
    const base = `http://127.0.0.1:${port}`;
    const headers = {};

    const latest = await fetch(`${base}/api/latest`, { headers });
    expect(latest.status).toBe(200);
    expect(latest.headers.get('cache-control')).toBe('no-store');
    expect(await latest.json()).toMatchObject({ message: { email: 'citizen@example.test', code: '123456' } });

    const head = await fetch(`${base}/api/latest`, { method: 'HEAD', headers });
    expect(head.status).toBe(200);
    expect(await head.text()).toBe('');

    expect(await requestStatusWithHost(`${base}/api/latest`, 'untrusted.example')).toBe(403);
    const rejectedMethod = await fetch(`${base}/api/latest`, { method: 'POST', headers });
    expect(rejectedMethod.status).toBe(404);
  });
});
