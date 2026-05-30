import type {
  ApiResponse,
  HealthResponse,
  ReportFormData,
  SendReportResponse,
} from '@/types';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
    ...options,
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

  sendReport: (payload: ReportFormData) =>
    request<SendReportResponse>('/reports/send', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
};
