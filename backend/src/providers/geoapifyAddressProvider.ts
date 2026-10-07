import type { AddressProviderConfig } from '../config/addressProvider.js';

export interface ReverseProviderResult { address: string; locality?: string }
export interface AddressProviderTransport {
  (url: URL, signal: AbortSignal): Promise<Response>;
}

export class AddressProviderError extends Error {
  constructor(
    readonly code: 'provider_invalid_response' | 'provider_request_rejected' | 'provider_throttled' | 'provider_unavailable',
    readonly status: 502 | 503,
    message: string
  ) {
    super(message);
    this.name = 'AddressProviderError';
  }
}

function safeText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.normalize('NFC').trim();
  return normalized && normalized.length <= 500 ? normalized : undefined;
}

function properties(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const result = value as Record<string, unknown>;
  return result.properties && typeof result.properties === 'object' && !Array.isArray(result.properties)
    ? result.properties as Record<string, unknown>
    : undefined;
}

function featureList(value: unknown): unknown[] {
  if (!value || typeof value !== 'object' || !('features' in value)) {
    throw new AddressProviderError('provider_invalid_response', 502, 'Address provider returned an invalid response.');
  }
  const features = (value as { features?: unknown }).features;
  if (!Array.isArray(features)) {
    throw new AddressProviderError('provider_invalid_response', 502, 'Address provider returned an invalid response.');
  }
  return features;
}

export function createGeoapifyAddressProvider(
  config: AddressProviderConfig,
  transport: AddressProviderTransport = async (url, signal) => fetch(url, { method: 'GET', signal })
) {
  const base = new URL(config.baseUrl);
  const makeUrl = (params: Record<string, string>) => {
    const url = new URL('/v1/geocode/reverse', base);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    url.searchParams.set('apiKey', config.apiKey);
    return url;
  };

  async function get(url: URL, signal: AbortSignal): Promise<unknown> {
    try {
      const response = await transport(url, signal);
      if (response.status === 429) {
        throw new AddressProviderError('provider_throttled', 503, 'Address assistance is temporarily unavailable.');
      }
      if (response.status >= 500) {
        throw new AddressProviderError('provider_unavailable', 503, 'Address assistance is temporarily unavailable.');
      }
      if (!response.ok) {
        throw new AddressProviderError('provider_request_rejected', 502, 'Address assistance is unavailable.');
      }
      try {
        return await response.json() as unknown;
      } catch {
        throw new AddressProviderError('provider_invalid_response', 502, 'Address provider returned an invalid response.');
      }
    } catch (error) {
      if (error instanceof AddressProviderError) throw error;
      if (signal.aborted) throw error;
      throw new AddressProviderError('provider_unavailable', 503, 'Address assistance is temporarily unavailable.');
    }
  }

  return {
    id: 'geoapify-address-v1',
    async reverse(request: { latitude: number; longitude: number; language: 'sk' | 'en' }, signal: AbortSignal): Promise<ReverseProviderResult | null> {
      const body = await get(makeUrl({
        lat: String(request.latitude), lon: String(request.longitude), lang: request.language,
        limit: '1', format: 'geojson', countrycodes: 'sk',
      }), signal);
      const first = featureList(body)[0];
      if (!first) return null;
      const props = properties(first);
      if (!props) throw new AddressProviderError('provider_invalid_response', 502, 'Address provider returned an invalid response.');
      const address = safeText(props.formatted);
      if (!address) throw new AddressProviderError('provider_invalid_response', 502, 'Address provider returned an invalid response.');
      const locality = safeText(props.city) ?? safeText(props.town) ?? safeText(props.village);
      return { address, ...(locality ? { locality } : {}) };
    },
  };
}
