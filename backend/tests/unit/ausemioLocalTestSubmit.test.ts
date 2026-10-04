import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { pool } from '../../src/db/pool.js';
import {
  DEFAULT_LOCAL_TEST_UPLOAD_LIMITS,
  isLocalTestSubmitEnabled,
  mountLocalTestSubmitRoutes,
  type LocalTestUploadStorage,
} from '../../src/routes/ausemioTest.routes.js';

vi.mock('../../src/db/pool.js', () => ({
  pool: { query: vi.fn() },
}));

const BASE_FIELDS = {
  'properties[vyber_sluzby]': '2',
  'properties[ulica_miesto_poruchy_lokalita]': 'Spam',
  'properties[tel_cislo]': '+421951449039',
  email: 'resident@example.test',
  locale: 'sk',
};

interface LocalTestEchoBody {
  status?: string;
  fields?: Record<string, string>;
  files?: Array<{ filename: string; mimeType: string; size: number }>;
  error?: { code?: string };
}

let server: Server;
let baseUrl: string;
let storage: LocalTestUploadStorage | undefined;

async function startServer(env: Record<string, string | undefined> = {
  NODE_ENV: 'test',
  LOCAL_TEST_SUBMIT_ENABLED: 'true',
}): Promise<void> {
  const app = express();
  storage = mountLocalTestSubmitRoutes(app, env);
  server = createServer(app);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
}

async function stopServer(): Promise<void> {
  if (!server?.listening) return;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

function createForm(
  fields: Record<string, string> = {},
  files: Array<{ name: string; bytes: number }> = []
): FormData {
  const form = new FormData();
  for (const [key, value] of Object.entries({ ...BASE_FIELDS, ...fields })) {
    form.append(key, value);
  }
  for (const file of files) {
    form.append(
      'files[]',
      new Blob([new Uint8Array(file.bytes)], { type: 'application/octet-stream' }),
      file.name
    );
  }
  return form;
}

async function postForm(form: FormData): Promise<Response> {
  return fetch(`${baseUrl}/api/dev/ausemio-test-submit`, { method: 'POST', body: form });
}

async function errorCode(response: Response): Promise<string | undefined> {
  const body = (await response.json()) as LocalTestEchoBody;
  return body.error?.code;
}

beforeEach(async () => {
  vi.mocked(pool.query).mockClear();
  await startServer();
});

afterEach(async () => {
  await stopServer();
  vi.restoreAllMocks();
});

describe('local test endpoint gate', () => {
  it('requires development/test NODE_ENV and an explicit true flag', () => {
    expect(isLocalTestSubmitEnabled({ NODE_ENV: 'development' })).toBe(false);
    expect(isLocalTestSubmitEnabled({ NODE_ENV: 'production', LOCAL_TEST_SUBMIT_ENABLED: 'true' }))
      .toBe(false);
    expect(isLocalTestSubmitEnabled({ NODE_ENV: 'test', LOCAL_TEST_SUBMIT_ENABLED: 'false' }))
      .toBe(false);
    expect(isLocalTestSubmitEnabled({ NODE_ENV: 'development', LOCAL_TEST_SUBMIT_ENABLED: 'true' }))
      .toBe(true);
    expect(isLocalTestSubmitEnabled({ NODE_ENV: 'test', LOCAL_TEST_SUBMIT_ENABLED: 'true' }))
      .toBe(true);
  });

  it('does not mount in production even when the flag is true', async () => {
    await stopServer();
    await startServer({ NODE_ENV: 'production', LOCAL_TEST_SUBMIT_ENABLED: 'true' });
    const response = await postForm(createForm());
    expect(response.status).toBe(404);
    expect(storage).toBeUndefined();
  });

  it('does not mount when the opt-in flag is unset', async () => {
    await stopServer();
    await startServer({ NODE_ENV: 'development' });
    const response = await postForm(createForm());
    expect(response.status).toBe(404);
    expect(storage).toBeUndefined();
  });
});

describe('local test multipart echo', () => {
  it('returns a transient metadata-only echo, no-store, and makes no DB or outbound HTTP calls', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const response = await postForm(createForm({}, [{ name: 'synthetic.txt', bytes: 12 }]));
    const raw = await response.text();
    const body = JSON.parse(raw) as LocalTestEchoBody;

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(body.status).toBe('local_test_received');
    expect(body.fields?.['properties[vyber_sluzby]']).toBe('2');
    expect(body.files).toEqual([
      {
        filename: 'synthetic.txt',
        mimeType: 'application/octet-stream',
        size: 12,
      },
    ]);
    expect(raw).not.toContain('SYNTHETIC_FILE_CONTENT');
    expect(pool.query).not.toHaveBeenCalled();
    expect(fetchSpy).toHaveBeenCalledTimes(1); // The single loopback client request.
    expect(storage?.activeRequests).toBe(0);
  });

  it('preserves omitted optional values without manufacturing defaults', async () => {
    const response = await postForm(createForm());
    const body = (await response.json()) as LocalTestEchoBody;

    expect(response.status).toBe(200);
    expect(body.fields).not.toHaveProperty('properties[lokalizacia_blok]');
    expect(body.fields).not.toHaveProperty('properties[typ_poruchy]');
    expect(body.fields).not.toHaveProperty('properties[iny_druh_poruchy]');
  });

  it('rejects service values other than exactly 2', async () => {
    const response = await postForm(createForm({ 'properties[vyber_sluzby]': '16' }));
    expect(response.status).toBe(400);
    expect(await errorCode(response)).toBe('LOCAL_TEST_INVALID_PAYLOAD');
    expect(storage?.activeRequests).toBe(0);
  });

  it('rejects CSS keys/codes and unknown localities', async () => {
    const cssKeyResponse = await postForm(
      createForm({ 'properties[typ_poruchy_css]': 'Q10' })
    );
    expect(cssKeyResponse.status).toBe(400);
    expect(await errorCode(cssKeyResponse)).toBe('LOCAL_TEST_INVALID_PAYLOAD');

    const cssCodeResponse = await postForm(createForm({ 'properties[typ_poruchy]': 'Q20' }));
    expect(cssCodeResponse.status).toBe(400);
    expect(await errorCode(cssCodeResponse)).toBe('LOCAL_TEST_INVALID_PAYLOAD');

    const localityResponse = await postForm(
      createForm({ 'properties[ulica_miesto_poruchy_lokalita]': 'not a catalog locality' })
    );
    expect(localityResponse.status).toBe(400);
    expect(await errorCode(localityResponse)).toBe('LOCAL_TEST_INVALID_PAYLOAD');
    expect(storage?.activeRequests).toBe(0);
  });

  it('returns a deterministic client error for malformed multipart input', async () => {
    const response = await fetch(`${baseUrl}/api/dev/ausemio-test-submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'multipart/form-data' },
      body: 'malformed',
    });
    expect(response.status).toBe(400);
    expect(await errorCode(response)).toBe('LOCAL_TEST_INVALID_MULTIPART');
    expect(storage?.activeRequests).toBe(0);
  });
});

describe('local upload resource caps and cleanup', () => {
  it('uses bounded local-only defaults', () => {
    expect(DEFAULT_LOCAL_TEST_UPLOAD_LIMITS).toEqual({
      maxFileBytes: 10485760,
      maxFiles: 3,
      maxTotalUploadBytes: 20971520,
    });
  });

  it('accepts exactly the per-file byte limit and rejects limit plus one', async () => {
    const exact = await postForm(
      createForm({}, [{ name: 'exact.bin', bytes: DEFAULT_LOCAL_TEST_UPLOAD_LIMITS.maxFileBytes }])
    );
    expect(exact.status).toBe(200);
    expect(((await exact.json()) as LocalTestEchoBody).files?.[0].size)
      .toBe(DEFAULT_LOCAL_TEST_UPLOAD_LIMITS.maxFileBytes);
    expect(storage?.activeRequests).toBe(0);

    const over = await postForm(
      createForm({}, [{ name: 'over.bin', bytes: DEFAULT_LOCAL_TEST_UPLOAD_LIMITS.maxFileBytes + 1 }])
    );
    expect(over.status).toBe(413);
    expect(await errorCode(over)).toBe('LOCAL_TEST_RESOURCE_LIMIT');
    expect(storage?.activeRequests).toBe(0);
  });

  it('accepts exactly the file-count limit and rejects count plus one', async () => {
    const filesAtLimit = Array.from({ length: 3 }, (_, index) => ({
      name: `file-${index}.bin`,
      bytes: 1,
    }));
    const exact = await postForm(createForm({}, filesAtLimit));
    expect(exact.status).toBe(200);
    expect(((await exact.json()) as LocalTestEchoBody).files).toHaveLength(3);
    expect(storage?.activeRequests).toBe(0);

    const over = await postForm(
      createForm({}, [...filesAtLimit, { name: 'extra.bin', bytes: 1 }])
    );
    expect(over.status).toBe(413);
    expect(await errorCode(over)).toBe('LOCAL_TEST_RESOURCE_LIMIT');
    expect(storage?.activeRequests).toBe(0);
  });

  it('accepts exactly the aggregate byte limit and rejects aggregate limit plus one while streaming', async () => {
    const exactFiles = [
      { name: 'first.bin', bytes: 10485760 },
      { name: 'second.bin', bytes: 10485760 },
    ];
    const exact = await postForm(createForm({}, exactFiles));
    expect(exact.status).toBe(200);
    expect(((await exact.json()) as LocalTestEchoBody).files?.map((file) => file.size)).toEqual([
      10485760,
      10485760,
    ]);
    expect(storage?.activeRequests).toBe(0);

    const over = await postForm(
      createForm({}, [
        { name: 'first.bin', bytes: 10485760 },
        { name: 'second.bin', bytes: 10485760 },
        { name: 'one-byte-over.bin', bytes: 1 },
      ])
    );
    expect(over.status).toBe(413);
    expect(await errorCode(over)).toBe('LOCAL_TEST_RESOURCE_LIMIT');
    expect(storage?.activeRequests).toBe(0);
  });
});
