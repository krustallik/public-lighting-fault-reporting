import { describe, expect, it, vi } from 'vitest';
import { createAddressProviderConfig } from '../../src/config/addressProvider.js';
import { createGeoapifyAddressProvider, type AddressProviderTransport } from '../../src/providers/geoapifyAddressProvider.js';

const config = createAddressProviderConfig({ GEOAPIFY_API_KEY: 'synthetic-secret' });
const jsonResponse = (value: unknown) => new Response(JSON.stringify(value), { status: 200, headers: { 'Content-Type': 'application/json' } });

describe('Geoapify server adapter with injected transport', () => {
  it('constructs only the approved reverse request and returns allowlisted text', async () => {
    let requested: URL | undefined;
    const transport: AddressProviderTransport = vi.fn(async (url) => {
      requested = url;
      return jsonResponse({ features: [{ properties: { formatted: ' Jarná 12, Košice ', city: 'Košice', lat: 48.7, lon: 21.2 }, geometry: { type: 'Point', coordinates: [21.2, 48.7] } }] });
    });
    const provider = createGeoapifyAddressProvider(config, transport);
    await expect(provider.reverse({ latitude: 48.7, longitude: 21.2, language: 'sk' }, new AbortController().signal))
      .resolves.toEqual({ address: 'Jarná 12, Košice', locality: 'Košice' });
    expect(requested?.origin).toBe('https://api-eu.geoapify.com');
    expect(requested?.pathname).toBe('/v1/geocode/reverse');
    expect(Object.fromEntries(requested!.searchParams)).toEqual({
      lat: '48.7', lon: '21.2', lang: 'sk', limit: '1', format: 'geojson', countrycodes: 'sk', apiKey: 'synthetic-secret',
    });
  });

  it.each([
    [429, 'provider_throttled', 503],
    [500, 'provider_unavailable', 503],
    [400, 'provider_request_rejected', 502],
    [401, 'provider_request_rejected', 502],
    [403, 'provider_request_rejected', 502],
  ])('maps provider HTTP %s to a sanitized contract error', async (status, code, publicStatus) => {
    const provider = createGeoapifyAddressProvider(config, vi.fn(async () => new Response('secret-response-body', { status })));
    await expect(provider.reverse({ latitude: 48.7, longitude: 21.2, language: 'en' }, new AbortController().signal))
      .rejects.toMatchObject({ code, status: publicStatus });
    await expect(provider.reverse({ latitude: 48.7, longitude: 21.2, language: 'en' }, new AbortController().signal))
      .rejects.not.toThrow('secret-response-body');
  });

  it('rejects malformed success bodies and normalizes network errors without exposing URL or key', async () => {
    const malformed = createGeoapifyAddressProvider(config, vi.fn(async () => new Response('not-json', { status: 200 })));
    await expect(malformed.reverse({ latitude: 48.7, longitude: 21.2, language: 'sk' }, new AbortController().signal))
      .rejects.toMatchObject({ code: 'provider_invalid_response', status: 502 });
    const network = createGeoapifyAddressProvider(config, vi.fn(async () => { throw new Error('https://private.example/?apiKey=synthetic-secret'); }));
    await expect(network.reverse({ latitude: 48.7, longitude: 21.2, language: 'sk' }, new AbortController().signal))
      .rejects.toMatchObject({ code: 'provider_unavailable', status: 503, message: 'Address assistance is temporarily unavailable.' });
  });
});
