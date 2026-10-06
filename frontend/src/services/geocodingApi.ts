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

export interface ReportAddressAutocompleteRequest { text: string; language: 'sk' | 'en' }
export interface ReportAddressTextSuggestion { label: string; locality?: string }

export async function suggestReportAddress(
  request: ReportAddressSuggestionRequest,
  signal?: AbortSignal
): Promise<ReportAddressSuggestion | null> {
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
  if (body.data === null) return null;
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

export async function autocompleteReportAddress(
  request: ReportAddressAutocompleteRequest,
  signal?: AbortSignal
): Promise<ReportAddressTextSuggestion[]> {
  const response = await fetch(`${API_BASE}/reports/address-autocomplete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
    signal,
  });
  let body: unknown;
  try { body = await response.json() as unknown; } catch { throw new Error('Address suggestions are unavailable'); }
  if (!response.ok || !body || typeof body !== 'object' || !('success' in body) || (body as { success?: unknown }).success !== true) {
    throw new Error('Address suggestions are unavailable');
  }
  const data = (body as { data?: unknown }).data;
  const suggestions = data && typeof data === 'object' && 'suggestions' in data
    ? (data as { suggestions?: unknown }).suggestions
    : undefined;
  if (!Array.isArray(suggestions) || suggestions.length > 5) throw new Error('Address suggestions are unavailable');
  return suggestions.map((value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Address suggestions are unavailable');
    const item = value as Record<string, unknown>;
    if (Object.keys(item).some((key) => key !== 'label' && key !== 'locality') ||
      typeof item.label !== 'string' || !item.label.trim() || item.label.length > 500 ||
      (item.locality !== undefined && (typeof item.locality !== 'string' || item.locality.length > 200))) {
      throw new Error('Address suggestions are unavailable');
    }
    return { label: item.label.trim(), ...(typeof item.locality === 'string' && item.locality.trim() ? { locality: item.locality.trim() } : {}) };
  });
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
