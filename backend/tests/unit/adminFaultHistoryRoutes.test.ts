import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  listHistory: vi.fn(),
  getOverview: vi.fn(),
  getSummary: vi.fn(),
  listAnalytics: vi.fn(),
}));

vi.mock('../../src/db/pool.js', () => ({ pool: {} }));
vi.mock('../../src/services/faultReportHistory.service.js', () => ({
  PostgresFaultHistoryStore: class {
    listHistory = mocks.listHistory;
  },
}));
vi.mock('../../src/services/adminDashboard.service.js', () => ({
  getAdminDashboardOverview: mocks.getOverview,
}));
vi.mock('../../src/services/adminReportAnalytics.service.js', () => ({
  getReportAnalyticsSummary: mocks.getSummary,
  listReportAnalytics: mocks.listAnalytics,
}));

import router from '../../src/routes/adminFaultHistory.routes.js';
import { errorHandler } from '../../src/middleware/errorHandler.js';

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use(router);
  app.use(errorHandler);
  server = createServer(app);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  if (server?.listening) await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getOverview.mockResolvedValue({ reports: 4 });
  mocks.getSummary.mockResolvedValue({ total: 4 });
  mocks.listAnalytics.mockResolvedValue({ items: [], total: 0 });
  mocks.listHistory.mockResolvedValue({ items: [], total: 0 });
});

async function get(path: string) {
  return fetch(`${baseUrl}${path}`);
}

describe('admin report history and analytics routes', () => {
  it('uses default history pagination and keeps empty results on a valid first page', async () => {
    const response = await get('/history');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: true,
      data: { items: [], total: 0, pagination: { page: 1, limit: 25, total: 0, totalPages: 1 } },
    });
    expect(mocks.listHistory).toHaveBeenCalledWith({ limit: 25, offset: 0 });
  });

  it('uses explicit pages or a page-aligned legacy offset and computes total pages', async () => {
    mocks.listHistory.mockResolvedValue({ items: [{ id: 'row' }], total: 26 });

    const pageResponse = await get('/history?page=3&limit=10');
    expect(pageResponse.status).toBe(200);
    expect(mocks.listHistory).toHaveBeenNthCalledWith(1, { limit: 10, offset: 20 });
    expect((await pageResponse.json() as { data: { pagination: unknown } }).data.pagination)
      .toEqual({ page: 3, limit: 10, total: 26, totalPages: 3 });

    const offsetResponse = await get('/history?offset=20&limit=10');
    expect(offsetResponse.status).toBe(200);
    expect(mocks.listHistory).toHaveBeenNthCalledWith(2, { limit: 10, offset: 20 });
  });

  it.each([
    ['limit below range', '?limit=0'],
    ['limit above range', '?limit=101'],
    ['fractional page', '?page=1.5'],
    ['negative page', '?page=-1'],
    ['unsafe offset', '?offset=9007199254740992'],
  ])('rejects invalid history pagination (%s) before querying storage', async (_label, query) => {
    const response = await get(`/history${query}`);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ success: false, message: 'Invalid report history page.' });
    expect(mocks.listHistory).not.toHaveBeenCalled();
  });

  it('passes an explicit summary period and defaults malformed query values to seven days', async () => {
    expect((await get('/analytics/summary?period=30d')).status).toBe(200);
    expect(mocks.getSummary).toHaveBeenNthCalledWith(1, '30d');

    expect((await get('/analytics/summary?period[]=30d')).status).toBe(200);
    expect(mocks.getSummary).toHaveBeenNthCalledWith(2, '7d');
  });

  it('returns analytics defaults and caps search while preserving supported filters', async () => {
    const search = 'x'.repeat(120);
    const response = await get(`/analytics?period=30d&page=2&limit=20&sortOrder=asc&search=${search}&status=inactive`);
    expect(response.status).toBe(200);
    expect(mocks.listAnalytics).toHaveBeenCalledWith({
      period: '30d', page: 2, limit: 20, search: 'x'.repeat(100), status: 'inactive', order: 'asc',
    });

    const defaults = await get('/analytics?search[]=ignored&status[]=ignored&sortOrder[]=asc');
    expect(defaults.status).toBe(200);
    expect(mocks.listAnalytics).toHaveBeenNthCalledWith(2, {
      period: '7d', page: 1, limit: 10, search: '', status: undefined, order: 'desc',
    });
  });

  it.each([
    ['zero page', '?page=0'],
    ['oversized limit', '?limit=101'],
    ['unsupported sort', '?sortOrder=random'],
  ])('rejects invalid analytics filters (%s) before querying analytics', async (_label, query) => {
    const response = await get(`/analytics${query}`);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ success: false });
    expect(mocks.listAnalytics).not.toHaveBeenCalled();
  });

  it('forwards unexpected storage failures to the sanitized API error handler', async () => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mocks.listHistory.mockRejectedValueOnce(new Error('private database diagnostic'));

    const response = await get('/history');
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ success: false, message: 'Internal server error' });
    expect(errorLog).toHaveBeenCalledWith('Unhandled API error');
    errorLog.mockRestore();
  });
});
