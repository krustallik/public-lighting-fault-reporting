import type {
  HealthResponse,
  LocalTestSubmitResponse,
} from '@/types';
import type {
  EmailVerificationConfirmResponse,
  EmailVerificationRequestResponse,
  EmailVerificationStatus,
} from '@/types/emailVerification';
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

export class EmailVerificationApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly retryAfterSeconds?: number
  ) {
    super(code);
    this.name = 'EmailVerificationApiError';
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
    (body.status !== 'local_test_received' && body.status !== 'locally_recorded') ||
    typeof body.duplicate !== 'boolean' ||
    typeof body.filesReceived !== 'number' ||
    !Number.isSafeInteger(body.filesReceived) ||
    body.filesReceived < 0 ||
    typeof body.receiptId !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.receiptId)
  ) {
    throw new LocalTestEndpointResponseError();
  }

  return body as unknown as LocalTestSubmitResponse;
}

async function postEmailVerification<T>(path: string, payload: Record<string, string>): Promise<T> {
  const response = await fetch(`${API_BASE}/reports/email-verification/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    credentials: 'same-origin',
  });
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new EmailVerificationApiError(response.status, 'EMAIL_VERIFICATION_UNAVAILABLE');
  }
  if (!isRecord(body)) throw new EmailVerificationApiError(response.status, 'EMAIL_VERIFICATION_UNAVAILABLE');
  if (!response.ok) {
    const error = body.error;
    const code = isRecord(error) && typeof error.code === 'string'
      ? error.code
      : 'EMAIL_VERIFICATION_UNAVAILABLE';
    const retryAfter = Number(response.headers.get('Retry-After'));
    throw new EmailVerificationApiError(
      response.status,
      code,
      Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined
    );
  }
  if (body.success !== true) throw new EmailVerificationApiError(response.status, 'EMAIL_VERIFICATION_UNAVAILABLE');
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

  getEmailVerificationStatus: async (): Promise<EmailVerificationStatus> => {
    const response = await fetch(`${API_BASE}/reports/email-verification/status`, {
      credentials: 'same-origin',
      cache: 'no-store',
    });
    if (!response.ok) throw new EmailVerificationApiError(response.status, 'EMAIL_VERIFICATION_STATUS_UNAVAILABLE');
    const body: unknown = await response.json();
    if (!isRecord(body) || typeof body.enabled !== 'boolean') {
      throw new EmailVerificationApiError(response.status, 'EMAIL_VERIFICATION_STATUS_UNAVAILABLE');
    }
    return { enabled: body.enabled };
  },

  requestEmailVerificationCode: async (
    email: string,
    locale: 'sk' | 'en',
    intentId?: string
  ): Promise<EmailVerificationRequestResponse> => postEmailVerification('request', {
    email,
    locale,
    ...(intentId ? { intentId } : {}),
  }),

  verifyEmailCode: async (
    intentId: string,
    email: string,
    code: string
  ): Promise<EmailVerificationConfirmResponse> => postEmailVerification('verify', { intentId, email, code }),

  sendLocalTestSubmission: async (formData: FormData): Promise<LocalTestSubmitResponse> => {
    let response: Response;
    try {
      response = await postLocalTestSubmission(
        formData,
        API_BASE,
        {
          mode: import.meta.env.MODE,
          productionBuild: import.meta.env.PROD,
          localUatBuild: import.meta.env.VITE_LOCAL_UAT_MODE === 'true',
          hostedLocalPersistence: import.meta.env.VITE_REPORT_SUBMISSION_MODE === 'local-persistence',
          pageOrigin: typeof window === 'undefined' ? undefined : window.location.origin,
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
