import type { ApiResponse } from '@/types';
import type { ReverseGeocodeResult } from '@/types/geocoding';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';

const addressCache = new Map<string, string>();

function cacheKey(lat: number, lng: number): string {
  return `${lat.toFixed(5)},${lng.toFixed(5)}`;
}

export async function reverseGeocode(
  latitude: number,
  longitude: number
): Promise<string> {
  const key = cacheKey(latitude, longitude);
  const cached = addressCache.get(key);
  if (cached) {
    return cached;
  }

  const params = new URLSearchParams({
    lat: String(latitude),
    lng: String(longitude),
  });

  const response = await fetch(`${API_BASE}/geocode/reverse?${params}`);

  if (!response.ok) {
    throw new Error(`Geocoding failed (${response.status})`);
  }

  const body = (await response.json()) as ApiResponse<ReverseGeocodeResult>;

  if (!body.success || !body.data?.address) {
    throw new Error(body.message ?? 'Adresa sa nepodarila načítať');
  }

  addressCache.set(key, body.data.address);
  return body.data.address;
}

export async function reverseGeocodeForLightPoint(lightPointId: number): Promise<string> {
  const response = await fetch(`${API_BASE}/light-points/${lightPointId}/address`);

  if (!response.ok) {
    throw new Error(`Geocoding failed (${response.status})`);
  }

  const body = (await response.json()) as ApiResponse<ReverseGeocodeResult>;

  if (!body.success || !body.data?.address) {
    throw new Error(body.message ?? 'Adresa sa nepodarila načítať');
  }

  const { address, latitude, longitude } = body.data;
  addressCache.set(cacheKey(latitude, longitude), address);
  return address;
}
