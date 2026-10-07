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

export class ReportAddressSuggestionError extends Error {
  constructor(
    readonly code: string,
    readonly targetValidated: boolean
  ) {
    super('Address enrichment is unavailable');
    this.name = 'ReportAddressSuggestionError';
  }
}

const RECOVERABLE_ENRICHMENT_CODES = new Set([
  'disabled',
  'rate_limited',
  'limiter_capacity',
  'admission_rejected',
  'queue_full',
  'queue_expired',
  'daily_budget_exceeded',
  'address_provider_timeout',
  'provider_throttled',
  'provider_unavailable',
  'provider_invalid_response',
  'provider_request_rejected',
]);

const TARGET_VALIDATION_CODES = new Set([
  'invalid_coordinates',
  'light_point_not_found',
  'outside_service_area',
  'service_area_unavailable',
]);

export function isRecoverableAddressEnrichmentFailure(error: unknown): boolean {
  return error instanceof ReportAddressSuggestionError &&
    error.targetValidated && RECOVERABLE_ENRICHMENT_CODES.has(error.code);
}

export function isReportTargetValidationFailure(error: unknown): boolean {
  return error instanceof ReportAddressSuggestionError && TARGET_VALIDATION_CODES.has(error.code);
}

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

  let body: (ApiResponse<ReportAddressSuggestion | null> & {
    code?: string;
    targetValidated?: boolean;
  }) | null;
  try {
    body = (await response.json()) as typeof body;
  } catch {
    throw new ReportAddressSuggestionError('invalid_response', false);
  }

  if (!body || typeof body !== 'object' || typeof body.success !== 'boolean') {
    throw new ReportAddressSuggestionError('invalid_response', false);
  }

  if (!response.ok || !body.success) {
    throw new ReportAddressSuggestionError(
      typeof body.code === 'string' ? body.code : 'unknown_error',
      body.targetValidated === true
    );
  }

  if (body.data === null) return null;
  const address = body.data?.address;
  const locality = body.data?.locality;
  if (
    typeof address !== 'string' || !address.trim() ||
    (locality != null && typeof locality !== 'string')
  ) {
    throw new ReportAddressSuggestionError('invalid_response', true);
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
