import { afterEach, describe, expect, it, vi } from 'vitest';
import { getReportAddressAssistanceCapability, suggestReportAddress } from '@/services/geocodingApi';

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

  it('uses a backend-authoritative boolean capability and forwards cancellation', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({
      success: true,
      data: { enabled: true },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    const controller = new AbortController();
    await expect(getReportAddressAssistanceCapability(controller.signal)).resolves.toBe(true);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toMatch(/\/api\/reports\/address-assistance-capability$/);
    expect(init?.method).toBeUndefined();
    expect(init?.signal).toBe(controller.signal);
    expect(init?.body).toBeUndefined();
  });

  it.each([
    ['non-200 response', async () => new Response(JSON.stringify({ success: true, data: { enabled: true } }), { status: 503 })],
    ['malformed capability', async () => new Response(JSON.stringify({ success: true, data: { enabled: 'true' } }), { status: 200 })],
    ['unknown capability', async () => new Response(JSON.stringify({ success: true, data: { provider: 'geoapify' } }), { status: 200 })],
  ])('fails closed for %s', async (_label, makeResponse) => {
    vi.stubGlobal('fetch', vi.fn(makeResponse));
    await expect(getReportAddressAssistanceCapability()).resolves.toBe(false);
  });

  it('fails closed when the capability endpoint is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline'); }));
    await expect(getReportAddressAssistanceCapability()).resolves.toBe(false);
  });
});
