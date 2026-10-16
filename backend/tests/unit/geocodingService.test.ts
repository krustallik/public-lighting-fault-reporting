import { afterEach, describe, expect, it, vi } from 'vitest';
import { reverseGeocode } from '../../src/services/geocoding.service.js';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('legacy inventory reverse-geocoding service', () => {
  it('validates coordinates before transport and reports provider HTTP failures safely', async () => {
    const fetchMock = vi.fn(async () => new Response('private upstream body', { status: 503 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(reverseGeocode(Number.NaN, 21)).rejects.toMatchObject({ status: 400, message: 'Invalid coordinates' });
    await expect(reverseGeocode(91, 21)).rejects.toMatchObject({ status: 400, message: 'Coordinates out of range' });
    await expect(reverseGeocode(48.701, 21.201)).rejects.toMatchObject({ status: 502, message: 'Reverse geocoding service unavailable' });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('formats provider address alternatives, validates the request URL, and caches successful results', async () => {
    vi.useFakeTimers();
    const bodies = [
      { lat: '48.701', lon: '21.201', address: { road: 'Main', house_number: '7', suburb: 'Center', city: 'Košice', postcode: '04001' } },
      { lat: '48.702', lon: '21.202', display_name: 'Full provider address' },
      { lat: '48.703', lon: '21.203', address: { neighbourhood: 'Old Town', town: 'Košice' } },
      { lat: '48.704', lon: '21.204', address: { quarter: 'District', village: 'Small village' } },
      { lat: '48.705', lon: '21.205' },
      { lat: '48.706', lon: '21.206', address: { house_number: '4', postcode: '01001' } },
    ];
    const fetchMock = vi.fn(async (_input: string | URL, _options?: RequestInit) =>
      new Response(JSON.stringify(bodies.shift()), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const reverse = async (latitude: number, longitude: number) => {
      const result = reverseGeocode(latitude, longitude);
      await vi.runAllTimersAsync();
      return result;
    };

    await expect(reverse(48.701, 21.201)).resolves.toMatchObject({ address: 'Main 7, Center, Košice, 04001', source: 'nominatim' });
    await expect(reverse(48.702, 21.202)).resolves.toMatchObject({ address: 'Full provider address' });
    await expect(reverse(48.703, 21.203)).resolves.toMatchObject({ address: 'Old Town, Košice' });
    await expect(reverse(48.704, 21.204)).resolves.toMatchObject({ address: 'District, Small village' });
    await expect(reverse(48.705, 21.205)).resolves.toMatchObject({ address: '48.705, 21.205' });
    await expect(reverse(48.706, 21.206)).resolves.toMatchObject({ address: '01001' });

    const [url, options] = fetchMock.mock.calls[0]!;
    expect(Object.fromEntries(new URL(url as string).searchParams)).toEqual({
      format: 'json', lat: '48.701', lon: '21.201', zoom: '18', addressdetails: '1',
    });
    expect(options?.headers).toMatchObject({ 'User-Agent': expect.any(String), 'Accept-Language': expect.any(String) });
    await expect(reverse(48.701, 21.201)).resolves.toMatchObject({ address: 'Main 7, Center, Košice, 04001' });
    expect(fetchMock).toHaveBeenCalledTimes(6);
  });
});
