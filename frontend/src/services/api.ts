import type { ApiResponse, HealthResponse, SendReportResponse } from '@/types';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {};

  // FormData: browser sets Content-Type with boundary automatically
  if (!(options?.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
  }

  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      ...headers,
      ...options?.headers,
    },
  });

  const body = (await response.json()) as ApiResponse<T> & T;

  if (!response.ok) {
    const message =
      'message' in body && typeof body.message === 'string'
        ? body.message
        : `Request failed (${response.status})`;
    throw new Error(message);
  }

  if ('success' in body && body.success && 'data' in body) {
    return body.data as T;
  }

  return body as T;
}

export const api = {
  getHealth: async (): Promise<HealthResponse> => {
    const response = await fetch(`${API_BASE}/health`);
    if (!response.ok) {
      throw new Error(`Health check failed (${response.status})`);
    }
    return response.json() as Promise<HealthResponse>;
  },

  /** multipart/form-data — AUSEMIO field names (properties[...], files[], email, locale). */
  sendReport: (formData: FormData, options?: { lightPointId?: number }) => {
    const params = new URLSearchParams();
    if (options?.lightPointId != null) {
      params.set('lightPointId', String(options.lightPointId));
    }
    const query = params.toString();

    return request<SendReportResponse>(`/reports/send${query ? `?${query}` : ''}`, {
      method: 'POST',
      body: formData,
    });
  },
};
