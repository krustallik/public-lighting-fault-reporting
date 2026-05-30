import { config } from '../config/index.js';
import type { ReverseGeocodeResult } from '../types/geocoding.js';
import { AppError } from '../utils/AppError.js';

const cache = new Map<string, ReverseGeocodeResult>();
let lastRequestAt = 0;

function cacheKey(lat: number, lng: number): string {
  return `${lat.toFixed(5)},${lng.toFixed(5)}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForRateLimit(): Promise<void> {
  const elapsed = Date.now() - lastRequestAt;
  const minInterval = config.geocoding.minIntervalMs;
  if (elapsed < minInterval) {
    await sleep(minInterval - elapsed);
  }
  lastRequestAt = Date.now();
}

function formatNominatimAddress(data: NominatimReverseResponse): string {
  if (data.display_name) {
    return data.display_name;
  }

  const a = data.address;
  if (!a) {
    return `${data.lat}, ${data.lon}`;
  }

  const street = a.road
    ? [a.road, a.house_number].filter(Boolean).join(' ')
    : undefined;

  const parts = [
    street,
    a.suburb ?? a.neighbourhood ?? a.quarter,
    a.city ?? a.town ?? a.village ?? a.municipality,
    a.postcode,
  ].filter(Boolean);

  return parts.length > 0 ? parts.join(', ') : `${data.lat}, ${data.lon}`;
}

interface NominatimReverseResponse {
  lat: string;
  lon: string;
  display_name?: string;
  address?: {
    road?: string;
    house_number?: string;
    suburb?: string;
    neighbourhood?: string;
    quarter?: string;
    city?: string;
    town?: string;
    village?: string;
    municipality?: string;
    postcode?: string;
  };
}

export async function reverseGeocode(
  latitude: number,
  longitude: number
): Promise<ReverseGeocodeResult> {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    throw new AppError(400, 'Invalid coordinates');
  }
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
    throw new AppError(400, 'Coordinates out of range');
  }

  const key = cacheKey(latitude, longitude);
  const cached = cache.get(key);
  if (cached) {
    return cached;
  }

  await waitForRateLimit();

  const url = new URL(`${config.geocoding.nominatimBaseUrl}/reverse`);
  url.searchParams.set('format', 'json');
  url.searchParams.set('lat', String(latitude));
  url.searchParams.set('lon', String(longitude));
  url.searchParams.set('zoom', '18');
  url.searchParams.set('addressdetails', '1');

  const response = await fetch(url, {
    headers: {
      'User-Agent': config.geocoding.userAgent,
      'Accept-Language': config.geocoding.acceptLanguage,
    },
  });

  if (!response.ok) {
    throw new AppError(502, 'Reverse geocoding service unavailable');
  }

  const data = (await response.json()) as NominatimReverseResponse;
  const result: ReverseGeocodeResult = {
    address: formatNominatimAddress(data),
    latitude,
    longitude,
    source: 'nominatim',
  };

  cache.set(key, result);
  return result;
}
