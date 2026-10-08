import express from 'express';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { errorHandler } from '../../src/middleware/errorHandler.js';
import { importUpload, IMPORT_UPLOAD_LIMITS } from '../../src/middleware/upload.js';

let server: Server | undefined;
let baseUrl = '';

async function startUploadServer(): Promise<void> {
  const app = express();
  app.post('/import', importUpload.single('file'), (request, response) => {
    response.json({ size: request.file?.size ?? 0, field: request.file?.fieldname ?? null });
  });
  app.use(errorHandler);
  server = createServer(app);
  await new Promise<void>((resolve, reject) => {
    server?.once('error', reject);
    server?.listen(0, '127.0.0.1', resolve);
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

async function stopUploadServer(): Promise<void> {
  if (!server?.listening) return;
  await new Promise<void>((resolve, reject) => server?.close((error) => error ? reject(error) : resolve()));
  server = undefined;
}

function fileForm(size: number, extra?: { name: string; value: string }): FormData {
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(size)]), 'synthetic.csv');
  if (extra) form.append(extra.name, extra.value);
  return form;
}

afterEach(async () => {
  await stopUploadServer();
  vi.restoreAllMocks();
});

describe('bounded admin import upload contract', () => {
  it('keeps the single file, 5 MiB, one part and no field contract explicit', async () => {
    expect(IMPORT_UPLOAD_LIMITS).toEqual({
      fileSize: 5 * 1024 * 1024, files: 1, fields: 0, parts: 1, fieldNameSize: 100, headerPairs: 100,
    });
    await startUploadServer();
    const exact = await fetch(`${baseUrl}/import`, { method: 'POST', body: fileForm(5 * 1024 * 1024) });
    expect(exact.status).toBe(200);
    expect(await exact.json()).toEqual({ size: 5 * 1024 * 1024, field: 'file' });
  });

  it('rejects one byte over the file limit with deterministic 413 and no request-detail logging', async () => {
    const errorLog = vi.spyOn(console, 'error');
    await startUploadServer();
    const response = await fetch(`${baseUrl}/import`, { method: 'POST', body: fileForm(5 * 1024 * 1024 + 1) });
    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ success: false, message: 'Uploaded file exceeds the 5 MiB limit' });
    expect(errorLog).not.toHaveBeenCalled();
  });

  it('rejects additional multipart fields under the zero-field contract', async () => {
    await startUploadServer();
    const response = await fetch(`${baseUrl}/import`, {
      method: 'POST', body: fileForm(1, { name: 'unexpected', value: 'synthetic' }),
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ success: false, message: 'Invalid import upload' });
  });

  it('rejects a second file under the one-file contract', async () => {
    await startUploadServer();
    const form = fileForm(1);
    form.append('file', new Blob([new Uint8Array(1)]), 'second.csv');
    const response = await fetch(`${baseUrl}/import`, { method: 'POST', body: form });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ success: false, message: 'Invalid import upload' });
  });
});
