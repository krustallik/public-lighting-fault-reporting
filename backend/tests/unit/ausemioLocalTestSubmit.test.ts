import { createServer, request as httpRequest, type Server } from 'node:http';
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
  'properties[tel_cislo]': 'synthetic-phone-001',
  email: 'resident@example.test',
  locale: 'sk',
};

interface LocalTestEchoBody {
  status?: string;
  filesReceived?: number;
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

function startHeldFileUpload(fileName: string, initialBytes: number) {
  const boundary = `local-test-concurrency-${fileName}`;
  const request = httpRequest(new URL(`${baseUrl}/api/dev/ausemio-test-submit`), {
    method: 'POST',
    headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
  });
  const response = new Promise<{ status: number; body: LocalTestEchoBody }>((resolve, reject) => {
    request.once('error', reject);
    request.once('response', (incoming) => {
      const chunks: Buffer[] = [];
      incoming.on('data', (chunk: Buffer) => chunks.push(chunk));
      incoming.once('error', reject);
      incoming.once('end', () => {
        try {
          resolve({
            status: incoming.statusCode ?? 0,
            body: JSON.parse(Buffer.concat(chunks).toString('utf8')) as LocalTestEchoBody,
          });
        } catch (error) {
          reject(error);
        }
      });
    });
  });

  for (const [key, value] of Object.entries(BASE_FIELDS)) {
    request.write(`--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${value}\r\n`);
  }
  request.write(
    `--${boundary}\r\nContent-Disposition: form-data; name="files[]"; filename="${fileName}"\r\nContent-Type: application/x-synthetic\r\n\r\n`
  );
  request.write(Buffer.alloc(initialBytes, 1));

  return {
    response,
    finish: () => request.end(Buffer.from(`\r\n--${boundary}--\r\n`)),
  };
}

async function waitForActiveRequests(expected: number): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (storage?.activeRequests === expected) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`Timed out waiting for ${expected} active local-test requests.`);
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
    expect(body).toEqual({ success: true, status: 'local_test_received', filesReceived: 1 });
    expect(raw).not.toContain('SYNTHETIC_FILE_CONTENT');
    expect(raw).not.toContain('synthetic-phone-001');
    expect(raw).not.toContain('resident@example.test');
    expect(pool.query).not.toHaveBeenCalled();
    expect(fetchSpy).toHaveBeenCalledTimes(1); // The single loopback client request.
    expect(storage?.activeRequests).toBe(0);
  });

  it('preserves omitted optional values without manufacturing defaults', async () => {
    const response = await postForm(createForm());
    const body = (await response.json()) as LocalTestEchoBody;

    expect(response.status).toBe(200);
    expect(body).not.toHaveProperty('fields');
  });

  it('rejects service values other than exactly 2', async () => {
    const response = await postForm(
      createForm({ 'properties[vyber_sluzby]': '16' }, [{ name: 'synthetic.txt', bytes: 12 }])
    );
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

  it.each([
    ['unsupported locale', { locale: 'fr' }],
    ['malformed email', { email: 'resident-at-example.test' }],
    ['unknown block code', { 'properties[lokalizacia_blok]': 'Q8' }],
    ['unknown fault code', { 'properties[typ_poruchy]': 'Q5' }],
    ['Q99 detail with a different fault code', {
      'properties[typ_poruchy]': 'Q',
      'properties[iny_druh_poruchy]': 'synthetic stale text',
    }],
  ])('rejects %s as a local VO payload', async (_case, fields) => {
    const response = await postForm(createForm(fields));

    expect(response.status).toBe(400);
    expect(await errorCode(response)).toBe('LOCAL_TEST_INVALID_PAYLOAD');
    expect(storage?.activeRequests).toBe(0);
  });

  it('accepts long synthetic text and any non-empty synthetic phone string', async () => {
    const longDescription = 'd'.repeat(2501);
    const longOtherFault = 'o'.repeat(2501);
    const accepted = await postForm(createForm({
      'properties[detail_decription]': longDescription,
      'properties[typ_poruchy]': 'Q99',
      'properties[iny_druh_poruchy]': longOtherFault,
      'properties[tel_cislo]': 'synthetic phone without Slovak formatting',
    }));

    expect(accepted.status).toBe(200);
    const body = await accepted.json() as LocalTestEchoBody;
    expect(body.status).toBe('local_test_received');
    expect(JSON.stringify(body)).not.toContain(longDescription);
    expect(JSON.stringify(body)).not.toContain(longOtherFault);
    expect(JSON.stringify(body)).not.toContain('synthetic phone without Slovak formatting');

    const blankPhone = await postForm(createForm({ 'properties[tel_cislo]': '   ' }));
    expect(blankPhone.status).toBe(400);
    expect(await errorCode(blankPhone)).toBe('LOCAL_TEST_INVALID_PAYLOAD');
    expect(storage?.activeRequests).toBe(0);
  });

  it('reports the local multipart field-byte ceiling as a transport resource limit', async () => {
    const response = await postForm(
      createForm({ 'properties[detail_decription]': 'x'.repeat(65537) })
    );

    expect(response.status).toBe(413);
    expect(await errorCode(response)).toBe('LOCAL_TEST_RESOURCE_LIMIT');
    expect(storage?.activeRequests).toBe(0);
  });

  it('accepts a field exactly at the local byte ceiling', async () => {
    const exactText = 'x'.repeat(65536);
    const response = await postForm(createForm({ 'properties[detail_decription]': exactText }));
    const body = (await response.json()) as LocalTestEchoBody;

    expect(response.status).toBe(200);
    expect(body).not.toHaveProperty('fields');
    expect(storage?.activeRequests).toBe(0);
  });

  it('rejects duplicate scalar and unknown multipart fields instead of selecting one silently', async () => {
    const duplicate = createForm();
    duplicate.append('properties[vyber_sluzby]', '2');
    const duplicateResponse = await postForm(duplicate);
    expect(duplicateResponse.status).toBe(400);
    expect(await errorCode(duplicateResponse)).toBe('LOCAL_TEST_INVALID_PAYLOAD');

    const unknownResponse = await postForm(createForm({ 'properties[unknown_synthetic]': 'value' }));
    expect(unknownResponse.status).toBe(400);
    expect(await errorCode(unknownResponse)).toBe('LOCAL_TEST_INVALID_PAYLOAD');
    expect(storage?.activeRequests).toBe(0);
  });

  it('rejects file parts under a different field name as malformed local multipart input', async () => {
    const form = createForm();
    form.append('unexpected[]', new Blob(['synthetic'], { type: 'application/x-synthetic' }), 'synthetic.bin');
    const response = await postForm(form);

    expect(response.status).toBe(400);
    expect(await errorCode(response)).toBe('LOCAL_TEST_INVALID_MULTIPART');
    expect(storage?.activeRequests).toBe(0);
  });

  it('accepts an empty file with an arbitrary MIME type and returns only an aggregate receipt', async () => {
    const form = createForm();
    form.append('files[]', new Blob([], { type: 'application/x-synthetic' }), 'empty.bin');
    const response = await postForm(form);
    const body = (await response.json()) as LocalTestEchoBody;

    expect(response.status).toBe(200);
    expect(body.filesReceived).toBe(1);
    expect(storage?.activeRequests).toBe(0);
  });

  it('rejects a multipart part with no filename as a non-file field', async () => {
    const form = createForm();
    form.append('files[]', new Blob(['synthetic'], { type: 'application/x-synthetic' }), '');
    const response = await postForm(form);
    const body = (await response.json()) as LocalTestEchoBody;

    expect(response.status).toBe(400);
    expect(body.error?.code).toBe('LOCAL_TEST_INVALID_PAYLOAD');
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
    expect(((await exact.json()) as LocalTestEchoBody).filesReceived).toBe(1);
    expect(storage?.activeRequests).toBe(0);

    const over = await postForm(
      createForm({}, [{ name: 'over.bin', bytes: DEFAULT_LOCAL_TEST_UPLOAD_LIMITS.maxFileBytes + 1 }])
    );
    expect(over.status).toBe(413);
    expect(await errorCode(over)).toBe('LOCAL_TEST_RESOURCE_LIMIT');
    expect(storage?.activeRequests).toBe(0);
  });

  it.each([0, 1, 2, 3])('accepts %s files at or below the local file-count cap', async (count) => {
    const files = Array.from({ length: count }, (_, index) => ({
      name: `file-${index}.bin`,
      bytes: 1,
    }));
    const response = await postForm(createForm({}, files));

    expect(response.status).toBe(200);
    expect(((await response.json()) as LocalTestEchoBody).filesReceived).toBe(count);
    expect(storage?.activeRequests).toBe(0);
  });

  it('rejects four files above the local file-count cap', async () => {
    const files = Array.from({ length: 4 }, (_, index) => ({
      name: `file-${index}.bin`,
      bytes: 1,
    }));
    const over = await postForm(createForm({}, files));
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
    expect(((await exact.json()) as LocalTestEchoBody).filesReceived).toBe(2);
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

  it.each([
    ['LOCAL_TEST_MAX_FILE_BYTES', '0'],
    ['LOCAL_TEST_MAX_FILE_BYTES', '1.5'],
    ['LOCAL_TEST_MAX_FILES', '-1'],
    ['LOCAL_TEST_MAX_FILES', '9007199254740992'],
    ['LOCAL_TEST_MAX_TOTAL_UPLOAD_BYTES', 'Infinity'],
    ['LOCAL_TEST_MAX_TOTAL_UPLOAD_BYTES', 'not-a-number'],
  ])('rejects invalid local upload limit %s=%s during route setup', (key, value) => {
    const app = express();
    expect(() => mountLocalTestSubmitRoutes(app, {
      NODE_ENV: 'test',
      LOCAL_TEST_SUBMIT_ENABLED: 'true',
      [key]: value,
    })).toThrow(`${key} must be a positive safe integer.`);
  });

  it('isolates concurrently streamed request byte counters and releases both request states', async () => {
    await stopServer();
    await startServer({
      NODE_ENV: 'test',
      LOCAL_TEST_SUBMIT_ENABLED: 'true',
      LOCAL_TEST_MAX_FILE_BYTES: '8',
      LOCAL_TEST_MAX_FILES: '2',
      LOCAL_TEST_MAX_TOTAL_UPLOAD_BYTES: '10',
    });

    const first = startHeldFileUpload('first.bin', 6);
    await waitForActiveRequests(1);
    const second = startHeldFileUpload('second.bin', 6);
    await waitForActiveRequests(2);

    const overLimit = startHeldFileUpload('over-limit.bin', 9);
    overLimit.finish();
    const rejected = await overLimit.response;
    expect(rejected.status).toBe(413);
    expect(storage?.activeRequests).toBe(2);

    first.finish();
    second.finish();
    const results = await Promise.all([first.response, second.response]);

    expect(results.map(({ status }) => status)).toEqual([200, 200]);
    expect(results.map(({ body }) => body.filesReceived)).toEqual([1, 1]);
    expect(storage?.activeRequests).toBe(0);
  });

  it('cleans the active request after a client aborts during a streamed file', async () => {
    const boundary = 'p4a-abort-boundary';
    const request = httpRequest(new URL(`${baseUrl}/api/dev/ausemio-test-submit`), {
      method: 'POST',
      headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
    });
    request.on('error', () => undefined);
    const closed = new Promise<void>((resolve) => request.once('close', resolve));
    request.write(
      `--${boundary}\r\nContent-Disposition: form-data; name="files[]"; filename="partial.bin"\r\nContent-Type: application/octet-stream\r\n\r\n`
    );
    request.write(Buffer.alloc(1024, 1));

    for (let attempt = 0; attempt < 100 && storage?.activeRequests === 0; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(storage?.activeRequests).toBe(1);
    request.destroy();
    await closed;

    for (let attempt = 0; attempt < 100 && storage?.activeRequests !== 0; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(storage?.activeRequests).toBe(0);
  });
});
