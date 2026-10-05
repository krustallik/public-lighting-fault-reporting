import type { ApiResponse } from '@/types';
import type { ReverseGeocodeResult } from '@/types/geocoding';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';

export interface ReportAddressSuggestionRequest {
  latitude: number;
  longitude: number;
  targetKind: 'custom' | 'device';
  language: 'sk' | 'en';
}

export interface ReportAddressSuggestion {
  address: string;
  locality?: string;
}

export async function suggestReportAddress(
  request: ReportAddressSuggestionRequest,
  signal?: AbortSignal
): Promise<ReportAddressSuggestion> {
  const response = await fetch(`${API_BASE}/reports/address-suggestion`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
    signal,
  });

  let body: ApiResponse<ReportAddressSuggestion> & { code?: string };
  try {
    body = (await response.json()) as ApiResponse<ReportAddressSuggestion> & { code?: string };
  } catch {
    throw new Error('Address suggestion is unavailable');
  }

  if (!response.ok || !body.success) {
    throw new Error(body.message ?? 'Address suggestion is unavailable');
  }

  const address = body.data?.address;
  const locality = body.data?.locality;
  if (
    typeof address !== 'string' || !address.trim() ||
    (locality != null && typeof locality !== 'string')
  ) {
    throw new Error('Address suggestion is unavailable');
  }

  return {
    address: address.trim(),
    ...(typeof locality === 'string' && locality.trim() ? { locality: locality.trim() } : {}),
  };
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

  return body.data.address;
}
