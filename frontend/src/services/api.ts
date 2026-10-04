import type {
  HealthResponse,
  LocalTestSubmitResponse,
} from '@/types';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';

class ApiRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string
  ) {
    super(message);
  }
}

export class LocalTestTransportUnavailableError extends Error {
  readonly code = 'LOCAL_TEST_TRANSPORT_UNAVAILABLE';

  constructor() {
    super('Local test submission endpoint is unavailable. No alternate transport was attempted.');
    this.name = 'LocalTestTransportUnavailableError';
  }
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {};

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

  let body: {
    success?: boolean;
    data?: unknown;
    message?: string;
    error?: { code?: string; message?: string };
  };
  try {
    body = (await response.json()) as typeof body;
  } catch {
    if (!response.ok) {
      throw new ApiRequestError('Local test endpoint returned an unreadable response.', response.status);
    }
    throw new ApiRequestError('The local test endpoint returned invalid JSON.', response.status);
  }

  if (!response.ok) {
    const code = body.error?.code;
    const message = body.error?.message ?? body.message ?? `Request failed (${response.status})`;
    throw new ApiRequestError(code ? `${code}: ${message}` : message, response.status, code);
  }

  if (body.success === true && 'data' in body) {
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

  sendLocalTestSubmission: async (formData: FormData): Promise<LocalTestSubmitResponse> => {
    try {
      return await request<LocalTestSubmitResponse>('/dev/ausemio-test-submit', {
        method: 'POST',
        body: formData,
      });
    } catch (error) {
      if (
        error instanceof TypeError ||
        (error instanceof ApiRequestError && (error.status === 404 || error.status >= 500))
      ) {
        throw new LocalTestTransportUnavailableError();
      }
      throw error;
    }
  },
};
