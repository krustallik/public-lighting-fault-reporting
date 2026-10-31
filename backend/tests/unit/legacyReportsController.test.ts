import express from 'express';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { sendFaultReport } = vi.hoisted(() => ({ sendFaultReport: vi.fn() }));
vi.mock('../../src/services/reports.service.js', () => ({ sendFaultReport }));

import { handleReportUploadError, sendReport } from '../../src/controllers/reports.controller.js';
import reportRoutes from '../../src/routes/reports.routes.js';

let server: Server | undefined;
let baseUrl = '';

async function startRouter(): Promise<void> {
  const app = express();
  app.use(express.json());
  app.use('/reports', reportRoutes);
  app.use((error: { status?: number; message?: string }, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
    response.status(error.status ?? 500).json({ message: error.message ?? 'Unexpected failure' });
  });
  server = createServer(app);
  await new Promise<void>((resolve, reject) => {
    server?.once('error', reject);
    server?.listen(0, '127.0.0.1', resolve);
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

async function stopRouter(): Promise<void> {
  if (server?.listening) await new Promise<void>((resolve, reject) => server?.close((error) => error ? reject(error) : resolve()));
  server = undefined;
}

afterEach(stopRouter);
beforeEach(() => sendFaultReport.mockReset());

describe('disabled legacy report route adapters', () => {
  it('dispatches a parsed multipart request through the controller and returns the simulated result', async () => {
    await startRouter();
    sendFaultReport.mockResolvedValue({ referenceCode: 'RPT-test', status: 'simulated' });
    const body = new FormData();
    body.append('properties[vyber_sluzby]', '2');
    body.append('email', 'resident@example.test');
    body.append('files[]', new Blob(['fake image bytes'], { type: 'image/png' }), 'lamp.png');

    const response = await fetch(`${baseUrl}/reports/send?lightPointId=17`, { method: 'POST', body });

    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ success: true, data: { referenceCode: 'RPT-test' } });
    expect(sendFaultReport.mock.calls[0]).toMatchObject([
      { properties: { vyber_sluzby: '2' }, email: 'resident@example.test' },
      [expect.objectContaining({ originalname: 'lamp.png', mimetype: 'image/png' })],
      17,
    ]);
  });

  it('maps upload limits and controller failures to their documented error path', async () => {
    await startRouter();
    const tooMany = new FormData();
    for (let index = 0; index < 6; index += 1) {
      tooMany.append('files[]', new Blob([`fake-${index}`]), `lamp-${index}.txt`);
    }
    const countResponse = await fetch(`${baseUrl}/reports/send`, { method: 'POST', body: tooMany });
    expect(countResponse.status).toBe(400);
    expect(await countResponse.json()).toMatchObject({ message: 'Maximum 5 files allowed' });

    const next = vi.fn();
    handleReportUploadError({ code: 'LIMIT_FILE_SIZE' }, {} as never, {} as never, next);
    expect(next.mock.calls[0]?.[0]).toMatchObject({ status: 400, message: 'File too large (max 10 MB)' });
    const unsupportedUploadError = { code: 'LIMIT_UNEXPECTED_FILE', field: 'files[]' };
    handleReportUploadError(unsupportedUploadError, {} as never, {} as never, next);
    expect(next.mock.calls[1]?.[0]).toBe(unsupportedUploadError);
    const genericError = new Error('synthetic parser failure');
    handleReportUploadError(genericError, {} as never, {} as never, next);
    expect(next.mock.calls[2]?.[0]).toBe(genericError);

    sendFaultReport.mockRejectedValueOnce(new Error('synthetic service failure'));
    const json = await fetch(`${baseUrl}/reports/send`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'resident@example.test' }),
    });
    expect(json.status).toBe(500);
    expect(await json.json()).toMatchObject({ message: 'synthetic service failure' });
  });

  it('rejects malformed optional light point ids before calling the reporting service', async () => {
    const response = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };
    const next = vi.fn();
    await sendReport({ files: undefined, query: { lightPointId: 'Infinity' }, body: {} } as never, response as never, next);
    expect(next.mock.calls[0]?.[0]).toMatchObject({ status: 400, message: 'Invalid light point id' });
    expect(sendFaultReport).not.toHaveBeenCalled();
  });
});
