import type {
  HealthResponse,
  LocalTestSubmitResponse,
} from '@/types';
import {
  postLocalTestSubmission,
} from '@/utils/localTestSubmissionTransport';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';

export class LocalTestEndpointError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string
  ) {
    super(message);
    this.name = 'LocalTestEndpointError';
  }
}

export class LocalTestEndpointResponseError extends Error {
  readonly code = 'LOCAL_TEST_ENDPOINT_RESPONSE_ERROR';

  constructor() {
    super('The local test endpoint returned an unreadable or malformed response.');
    this.name = 'LocalTestEndpointResponseError';
  }
}

export class LocalTestTransportUnavailableError extends Error {
  readonly code = 'LOCAL_TEST_TRANSPORT_UNAVAILABLE';

  constructor() {
    super('Local test submission endpoint is unavailable. No alternate transport was attempted.');
    this.name = 'LocalTestTransportUnavailableError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

async function readLocalTestResponse(response: Response): Promise<LocalTestSubmitResponse> {
  if (response.status === 404) {
    throw new LocalTestTransportUnavailableError();
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new LocalTestEndpointResponseError();
  }

  if (!isRecord(body)) throw new LocalTestEndpointResponseError();

  if (!response.ok) {
    const error = body.error;
    if (
      body.success !== false ||
      !isRecord(error) ||
      typeof error.code !== 'string' ||
      typeof error.message !== 'string'
    ) {
      throw new LocalTestEndpointResponseError();
    }
    throw new LocalTestEndpointError(
      `${error.code}: ${error.message}`,
      response.status,
      error.code
    );
  }

  if (
    body.success !== true ||
    body.status !== 'local_test_received' ||
    !isRecord(body.fields) ||
    !Array.isArray(body.files)
  ) {
    throw new LocalTestEndpointResponseError();
  }

  return body as unknown as LocalTestSubmitResponse;
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
    let response: Response;
    try {
      response = await postLocalTestSubmission(
        formData,
        API_BASE,
        {
          mode: import.meta.env.MODE,
          productionBuild: import.meta.env.PROD,
        }
      );
    } catch (error) {
      if (error instanceof TypeError) {
        throw new LocalTestTransportUnavailableError();
      }
      throw error;
    }
    return readLocalTestResponse(response);
  },
};
