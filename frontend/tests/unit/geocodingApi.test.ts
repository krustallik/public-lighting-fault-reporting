import { afterEach, describe, expect, it, vi } from 'vitest';
import { suggestReportAddress } from '@/services/geocodingApi';

describe('product report address suggestion API client', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('uses only the product-scoped local POST contract and forwards cancellation', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({
      success: true,
      data: { address: 'Jarná 12, Košice', locality: 'Jarná' },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    const controller = new AbortController();
    const request = {
      latitude: 48.7,
      longitude: 21.25,
      targetKind: 'device' as const,
      language: 'sk' as const,
    };

    await expect(suggestReportAddress(request, controller.signal)).resolves.toEqual({
      address: 'Jarná 12, Košice',
      locality: 'Jarná',
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toMatch(/\/api\/reports\/address-suggestion$/);
    expect(init?.method).toBe('POST');
    expect(init?.signal).toBe(controller.signal);
    expect(JSON.parse(String(init?.body))).toEqual(request);
  });

  it('rejects malformed success payloads without caching them', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({
      success: true,
      data: { address: '  ' },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    const request = {
      latitude: 48.7,
      longitude: 21.25,
      targetKind: 'custom' as const,
      language: 'sk' as const,
    };

    await expect(suggestReportAddress(request)).rejects.toThrow();
    await expect(suggestReportAddress(request)).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('normalizes provider-disabled responses for manual fallback', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({
      success: false,
      code: 'disabled',
      message: 'Address suggestion is unavailable',
    }), { status: 503, headers: { 'Content-Type': 'application/json' } })));
    await expect(suggestReportAddress({
      latitude: 48.7,
      longitude: 21.25,
      targetKind: 'custom',
      language: 'sk',
    })).rejects.toThrow('Address suggestion is unavailable');
  });
});
