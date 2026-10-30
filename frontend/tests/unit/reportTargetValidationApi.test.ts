import { afterEach, describe, expect, it, vi } from 'vitest';
import { validateReportTargetLocation } from '../../apps/public/src/services/reportTargetValidationApi';

afterEach(() => vi.unstubAllGlobals());

describe('report target validation API', () => {
  it('sends only the target coordinates to the local validation endpoint', async () => {
    const fetchMock = vi.fn(async () => new Response(
      JSON.stringify({ success: true, data: { valid: true } }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    ));
    vi.stubGlobal('fetch', fetchMock);

    await validateReportTargetLocation({ kind: 'custom', latitude: 48.7, longitude: 21.25 });

    expect(fetchMock).toHaveBeenCalledWith(expect.stringMatching(/\/api\/reports\/target-validation$/), expect.objectContaining({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetKind: 'custom', latitude: 48.7, longitude: 21.25 }),
    }));
  });

  it('surfaces the server outside-area result so the map can block selection', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ success: false, code: 'outside_service_area' }),
      { status: 422, headers: { 'Content-Type': 'application/json' } }
    )));

    await expect(validateReportTargetLocation({ kind: 'light-point', lightPointId: 3 }))
      .rejects.toMatchObject({ code: 'outside_service_area' });
  });

  it.each([
    [400, 'invalid_coordinates'],
    [404, 'light_point_not_found'],
    [503, 'service_area_unavailable'],
  ] as const)('preserves the server failure code for status %i', async (status, code) => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ success: false, code }),
      { status, headers: { 'Content-Type': 'application/json' } }
    )));

    await expect(validateReportTargetLocation({ kind: 'custom', latitude: 48.7, longitude: 21.25 }))
      .rejects.toMatchObject({ code });
  });

  it('does not turn a network failure into a successful or valid selection', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('Synthetic network failure');
    }));

    await expect(validateReportTargetLocation({ kind: 'device', latitude: 48.7, longitude: 21.25 }))
      .rejects.toThrow('Synthetic network failure');
  });

  it('fails closed on malformed responses', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('not json', { status: 200 })));

    await expect(validateReportTargetLocation({ kind: 'device', latitude: 48.7, longitude: 21.25 }))
      .rejects.toMatchObject({ code: 'invalid_response' });
  });

  it('fails closed when success does not contain an explicit valid result', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ success: true, data: { valid: false } }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )));

    await expect(validateReportTargetLocation({ kind: 'custom', latitude: 48.7, longitude: 21.25 }))
      .rejects.toMatchObject({ code: 'invalid_response' });
  });
});
