// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { adminApi } from '@admin/services/adminApi';

function response(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('admin API client', () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends credentialed JSON for authentication and unwraps API envelopes', async () => {
    fetchMock.mockImplementation(async () => response({ success: true, data: { id: 4, username: 'operator' } }));

    await expect(adminApi.login('operator', 'correct horse')).resolves.toEqual({ id: 4, username: 'operator' });
    await adminApi.logout();
    await adminApi.me();

    expect(fetchMock).toHaveBeenNthCalledWith(1, expect.stringMatching(/\/admin\/auth\/login$/), expect.objectContaining({
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'operator', password: 'correct horse' }),
    }));
    expect(fetchMock).toHaveBeenNthCalledWith(2, expect.stringMatching(/\/admin\/auth\/logout$/), expect.objectContaining({ method: 'POST' }));
    expect(fetchMock).toHaveBeenNthCalledWith(3, expect.stringMatching(/\/admin\/auth\/me$/), expect.objectContaining({ credentials: 'include' }));
  });

  it('serializes inventory filters and CRUD payloads using the server field names', async () => {
    fetchMock.mockImplementation(async () => response({ success: true, data: { items: [] } }));

    await adminApi.listStreetLights({ page: 2, limit: 30, search: 'park & ride', status: 'active', district: 'Košice II', sortBy: 'address', sortOrder: 'asc' });
    await adminApi.getStreetLight(18);
    await adminApi.createStreetLight({ inventoryNumber: 'INV-18', latitude: 48.7, longitude: 21.2, status: 'active' });
    await adminApi.updateStreetLight(18, { inventoryNumber: 'INV-18A', address: null, status: 'maintenance' });
    await adminApi.deleteStreetLight(18);

    const listUrl = new URL(fetchMock.mock.calls[0][0] as string);
    expect(listUrl.pathname).toBe('/api/admin/street-lights');
    expect(Object.fromEntries(listUrl.searchParams)).toEqual({ page: '2', limit: '30', search: 'park & ride', status: 'active', district: 'Košice II', sortBy: 'address', sortOrder: 'asc' });
    expect(fetchMock.mock.calls[1][0]).toMatch(/\/admin\/street-lights\/18$/);
    expect(JSON.parse(String(fetchMock.mock.calls[2][1]?.body))).toEqual({
      inventory_number: 'INV-18', external_id: null, latitude: 48.7, longitude: 21.2,
      address: undefined, district: undefined, lamp_type: undefined, status: 'active',
    });
    expect(JSON.parse(String(fetchMock.mock.calls[3][1]?.body))).toEqual({
      inventory_number: 'INV-18A', external_id: undefined, latitude: undefined, longitude: undefined,
      address: null, district: undefined, lamp_type: undefined, status: 'maintenance',
    });
    expect(fetchMock.mock.calls[4][1]?.method).toBe('DELETE');
  });

  it('keeps multipart boundaries browser-managed and encodes import preview identifiers', async () => {
    fetchMock.mockImplementation(async () => response({ success: true, data: { previewId: 'preview' } }));
    const file = new File(['inventory_number,latitude,longitude\nINV-1,48.7,21.2'], 'inventory.csv', { type: 'text/csv' });

    await adminApi.importPreview(file);
    await adminApi.getImportPreviewRows('preview/with space', 3, 25, 'action', 'desc');
    await adminApi.importConfirm('preview', true);
    await adminApi.getImportStatus(71);
    await adminApi.getImportRows(71, { outcome: 'created', limit: 12, cursor: 9 });

    const multipart = fetchMock.mock.calls[0][1] as RequestInit;
    expect(multipart.body).toBeInstanceOf(FormData);
    expect(new Headers(multipart.headers).has('Content-Type')).toBe(false);
    expect((multipart.body as FormData).get('file')).toBe(file);
    expect(fetchMock.mock.calls[1][0]).toContain('/preview/preview%2Fwith%20space?page=3&limit=25&sortBy=action&sortOrder=desc');
    expect(JSON.parse(String(fetchMock.mock.calls[2][1]?.body))).toEqual({ previewId: 'preview', allowUpdate: true });
    expect(fetchMock.mock.calls[3][0]).toMatch(/\/imports\/71$/);
    expect(fetchMock.mock.calls[4][0]).toContain('/imports/71/rows?outcome=created&limit=12&cursor=9');
  });

  it('downloads a filtered export through the authenticated API client and loads technical settings and logs', async () => {
    fetchMock.mockImplementation(async (input) => String(input).includes('/street-lights/export')
      ? new Response('id,inventory_number\r\n1,INV-1\r\n', {
        status: 200,
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': 'attachment; filename="street-lights-2026-10-18.csv"',
        },
      })
      : response({ success: true, data: [] }));
    const anchor = document.createElement('a');
    const click = vi.spyOn(anchor, 'click').mockImplementation(() => undefined);
    const createElement = vi.spyOn(document, 'createElement').mockReturnValue(anchor);
    const NativeUrl = globalThis.URL;
    const createObjectUrl = vi.fn((_blob: Blob) => 'blob:local-street-light-export');
    const revokeObjectUrl = vi.fn();
    vi.stubGlobal('URL', class URLWithObjectUrl extends NativeUrl {
      static createObjectURL = createObjectUrl;
      static revokeObjectURL = revokeObjectUrl;
    });

    await adminApi.exportStreetLights('csv', { search: 'main street', status: 'inactive', district: 'Košice IV' });
    await adminApi.getIntegrationSettings();
    await adminApi.getActivityLogs();
    await adminApi.getImportBatches({ limit: 7, offset: 14 });
    await adminApi.getIntegrationLogs();

    expect(anchor.rel).toBe('noopener');
    expect(anchor.href).toBe('blob:local-street-light-export');
    expect(anchor.download).toBe('street-lights-2026-10-18.csv');
    expect(click).toHaveBeenCalledOnce();
    expect(createElement).toHaveBeenCalledWith('a');
    expect(fetchMock.mock.calls[0][0]).toContain('/api/admin/street-lights/export?format=csv&search=main+street&status=inactive&district=Ko%C5%A1ice+IV');
    expect(fetchMock.mock.calls[0][1]).toEqual({ credentials: 'include' });
    expect(fetchMock.mock.calls.slice(1).map(([url]) => new URL(url as string).pathname)).toEqual([
      '/api/admin/integration/settings', '/api/admin/logs/activity', '/api/admin/logs/imports', '/api/admin/logs/integration',
    ]);
    expect(fetchMock.mock.calls[3][0]).toContain('?limit=7&offset=14');
    expect(createObjectUrl).toHaveBeenCalledOnce();
    expect(await createObjectUrl.mock.calls[0][0].text()).toContain('1,INV-1');
    expect(revokeObjectUrl).not.toHaveBeenCalled();
  });

  it('surfaces an export server error instead of silently downloading an error body', async () => {
    fetchMock.mockImplementation(async () => response({ success: false, error: { message: 'Export unavailable' } }, 503));
    await expect(adminApi.exportStreetLights('csv')).rejects.toThrow('Export unavailable');
  });

  it('shares a single refresh request across concurrent expired-session calls and retries each once', async () => {
    let refreshCount = 0;
    const firstUnauthorized = new Set<string>();
    fetchMock.mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('/admin/auth/refresh')) {
        refreshCount += 1;
        await Promise.resolve();
        return response({ success: true, data: { refreshed: true } });
      }
      if (!firstUnauthorized.has(url)) {
        firstUnauthorized.add(url);
        return response({ message: 'expired' }, 401);
      }
      return response({ success: true, data: { ok: true } });
    });

    await expect(Promise.all([adminApi.listStreetLights(), adminApi.getActivityLogs()])).resolves.toEqual([{ ok: true }, { ok: true }]);

    expect(refreshCount).toBe(1);
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes('/admin/street-lights')).length).toBe(2);
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes('/admin/logs/activity')).length).toBe(2);
  });

  it('does not refresh login responses, reports server errors, and keeps silent session probes from redirecting', async () => {
    fetchMock
      .mockResolvedValueOnce(response({ message: 'Invalid credentials' }, 401))
      .mockResolvedValueOnce(response({ message: 'refresh rejected' }, 401))
      .mockResolvedValueOnce(response({ message: 'refresh rejected' }, 401));

    await expect(adminApi.login('operator', 'bad password')).rejects.toThrow('Invalid credentials');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await expect(adminApi.me()).rejects.toThrow('Relácia vypršala');
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[1][0]).toMatch(/\/admin\/auth\/me$/);
    expect(fetchMock.mock.calls[2][0]).toMatch(/\/admin\/auth\/refresh$/);
  });
});
