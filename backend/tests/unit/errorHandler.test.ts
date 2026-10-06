import express from 'express';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { errorHandler } from '../../src/middleware/errorHandler.js';
import { AppError } from '../../src/utils/AppError.js';

const sensitiveConnectionString = 'postgresql://secret-user:secret-password@db.internal/internal';

let server: Server | undefined;
let baseUrl: string;

async function startErrorServer(): Promise<void> {
  const app = express();
  app.use(express.json());
  app.get('/generic-error', (_req, _res, next) => next(new Error(sensitiveConnectionString)));
  app.get('/app-error-500', (_req, _res, next) => next(new AppError(500, sensitiveConnectionString)));
  app.get('/app-error-400', (_req, _res, next) => next(new AppError(400, 'Invalid coordinates')));
  app.post('/invalid-json', (_req, res) => res.status(204).end());
  app.use(errorHandler);

  server = createServer(app);
  await new Promise<void>((resolve, reject) => {
    server?.once('error', reject);
    server?.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
}

async function stopErrorServer(): Promise<void> {
  if (!server?.listening) return;
  await new Promise<void>((resolve, reject) => {
    server?.close((error) => error ? reject(error) : resolve());
  });
  server = undefined;
}

beforeEach(() => {
  vi.stubEnv('NODE_ENV', 'production');
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(async () => {
  await stopErrorServer();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('Express error middleware response privacy', () => {
  it('returns a stable generic production 500 for an unhandled internal error and keeps server logging', async () => {
    await startErrorServer();

    const response = await fetch(`${baseUrl}/generic-error`);
    const body = await response.json() as { success: boolean; message: string; stack?: string };
    const serializedBody = JSON.stringify(body);

    expect(response.status).toBe(500);
    expect(body.success).toBe(false);
    expect(body.message).toBe('Internal server error');
    expect(serializedBody).not.toContain(sensitiveConnectionString);
    expect(serializedBody).not.toContain('secret-password');
    expect(serializedBody).not.toContain('db.internal');
    expect(serializedBody).not.toContain('at Error');
    expect(body.stack).toBeUndefined();
    expect(console.error).toHaveBeenCalledTimes(1);
    expect(console.error).toHaveBeenCalledWith(expect.objectContaining({ message: sensitiveConnectionString }));
  });

  it('hides the message of a production AppError with a 5xx status', async () => {
    await startErrorServer();

    const response = await fetch(`${baseUrl}/app-error-500`);
    const body = await response.json() as { success: boolean; message: string; stack?: string };

    expect(response.status).toBe(500);
    expect(body.success).toBe(false);
    expect(body.message).toBe('Internal server error');
    expect(JSON.stringify(body)).not.toContain(sensitiveConnectionString);
    expect(JSON.stringify(body)).not.toContain('secret-password');
    expect(body.stack).toBeUndefined();
  });

  it('preserves an intentionally client-visible production 4xx AppError message', async () => {
    await startErrorServer();

    const response = await fetch(`${baseUrl}/app-error-400`);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({ success: false, message: 'Invalid coordinates' });
  });

  it('keeps malformed JSON as a generic production 400 response', async () => {
    await startErrorServer();

    const response = await fetch(`${baseUrl}/invalid-json`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"latitude":',
    });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({ success: false, message: 'Invalid request body' });
  });

  it('retains the existing detailed development error response', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    await startErrorServer();

    const response = await fetch(`${baseUrl}/generic-error`);
    const body = await response.json() as { success: boolean; message: string; stack?: string };

    expect(response.status).toBe(500);
    expect(body.success).toBe(false);
    expect(body.message).toBe(sensitiveConnectionString);
    expect(body.stack).toContain(sensitiveConnectionString);
  });
});
