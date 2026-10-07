import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  isRecoverableAddressEnrichmentFailure,
  isReportTargetValidationFailure,
  ReportAddressSuggestionError,
  suggestReportAddress,
} from '@/services/geocodingApi';

describe('product report address suggestion API client', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('uses one product-scoped local POST contract and normalizes the returned address', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({
      success: true,
      data: { address: ' Jarná 12, Košice ', locality: 'Jarná' },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    const request = {
      latitude: 48.7,
      longitude: 21.25,
      targetKind: 'device' as const,
      language: 'sk' as const,
    };

    await expect(suggestReportAddress(request)).resolves.toEqual({
      address: 'Jarná 12, Košice',
      locality: 'Jarná',
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toMatch(/\/api\/reports\/address-suggestion$/);
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toEqual(request);
  });

  it('marks a provider failure recoverable only after explicit target validation', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      success: false,
      code: 'daily_budget_exceeded',
      message: 'Never expose upstream detail',
      targetValidated: true,
    }), { status: 429, headers: { 'Content-Type': 'application/json' } })));

    let failure: unknown;
    try {
      await suggestReportAddress({
        latitude: 48.7, longitude: 21.25, targetKind: 'custom', language: 'sk',
      });
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(ReportAddressSuggestionError);
    expect(isRecoverableAddressEnrichmentFailure(failure)).toBe(true);
    expect(isReportTargetValidationFailure(failure)).toBe(false);
    expect((failure as Error).message).not.toContain('Never expose');
  });

  it('treats an exhausted local limiter entry capacity as recoverable after target validation', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      success: false,
      code: 'limiter_capacity',
      message: 'Address assistance is temporarily unavailable.',
      targetValidated: true,
    }), { status: 429, headers: { 'Content-Type': 'application/json' } })));

    let failure: unknown;
    try {
      await suggestReportAddress({
        latitude: 48.7, longitude: 21.25, targetKind: 'custom', language: 'sk',
      });
    } catch (error) {
      failure = error;
    }
    expect(isRecoverableAddressEnrichmentFailure(failure)).toBe(true);
  });

  it('keeps target validation errors blocking and does not mark them recoverable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      success: false,
      code: 'outside_service_area',
      message: 'Selected coordinates are outside the service area.',
    }), { status: 422, headers: { 'Content-Type': 'application/json' } })));

    let failure: unknown;
    try {
      await suggestReportAddress({
        latitude: 48.7, longitude: 21.25, targetKind: 'custom', language: 'sk',
      });
    } catch (error) {
      failure = error;
    }
    expect(isReportTargetValidationFailure(failure)).toBe(true);
    expect(isRecoverableAddressEnrichmentFailure(failure)).toBe(false);
  });

  it('does not treat an unverified server/network failure as an optional provider failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline'); }));
    await expect(suggestReportAddress({
      latitude: 48.7, longitude: 21.25, targetKind: 'custom', language: 'sk',
    })).rejects.toThrow('offline');
  });

  it('rejects malformed successful payloads', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      success: true,
      data: { address: '  ' },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })));
    await expect(suggestReportAddress({
      latitude: 48.7, longitude: 21.25, targetKind: 'custom', language: 'sk',
    })).rejects.toMatchObject({ code: 'invalid_response', targetValidated: true });
  });
});
