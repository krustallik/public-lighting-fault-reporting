import type { AddressProviderConfig } from '../../src/config/addressProvider.js';
import type { AddressProviderTransport } from '../../src/providers/geoapifyAddressProvider.js';
import { createGeoapifyAddressProvider } from '../../src/providers/geoapifyAddressProvider.js';
import {
  createReportAddressSuggestionService,
  type ReportAddressSuggestionService,
} from '../../src/services/reportAddressSuggestion.service.js';
import {
  EmailDeliveryError,
  ResendEmailVerificationProvider,
  type EmailVerificationProvider,
  type VerificationEmail,
} from '../../src/services/emailVerificationProvider.js';

export const LIVE_UAT_MAX_RESEND_ATTEMPTS = 3;
export const LIVE_UAT_MAX_GEOAPIFY_REQUESTS_PER_PROCESS = 10;

export type LiveEmailOutcome = 'not_requested' | 'api_accepted' | 'rejected' | 'ambiguous';
export type LiveAddressOutcome = 'not_requested' | 'response_received' | 'rejected' | 'ambiguous';

export interface LiveProviderStatus {
  email: {
    attempts: number;
    apiAccepted: number;
    rejected: number;
    ambiguous: number;
    blocked: number;
    lastOutcome: LiveEmailOutcome;
    maxAttempts: number;
    inboxReceipt: 'owner_confirmation_required';
  };
  address: {
    requests: number;
    responses: number;
    rejected: number;
    ambiguous: number;
    blocked: number;
    lastOutcome: LiveAddressOutcome;
    maxRequestsPerProcess: number;
  };
}

export class LiveProviderEvidence {
  private emailAttempts = 0;
  private emailAccepted = 0;
  private emailRejected = 0;
  private emailAmbiguous = 0;
  private emailBlocked = 0;
  private emailLastOutcome: LiveEmailOutcome = 'not_requested';
  private addressRequests = 0;
  private addressResponses = 0;
  private addressRejected = 0;
  private addressAmbiguous = 0;
  private addressBlocked = 0;
  private addressLastOutcome: LiveAddressOutcome = 'not_requested';

  beginEmailAttempt(): boolean {
    if (this.emailAttempts >= LIVE_UAT_MAX_RESEND_ATTEMPTS) {
      this.emailBlocked += 1;
      return false;
    }
    this.emailAttempts += 1;
    return true;
  }

  recordEmail(outcome: Exclude<LiveEmailOutcome, 'not_requested'>): void {
    this.emailLastOutcome = outcome;
    if (outcome === 'api_accepted') this.emailAccepted += 1;
    else if (outcome === 'rejected') this.emailRejected += 1;
    else this.emailAmbiguous += 1;
  }

  blockEmailAttempt(): void {
    this.emailBlocked += 1;
  }

  beginAddressRequest(): boolean {
    if (this.addressRequests >= LIVE_UAT_MAX_GEOAPIFY_REQUESTS_PER_PROCESS) {
      this.addressBlocked += 1;
      return false;
    }
    this.addressRequests += 1;
    return true;
  }

  recordAddress(outcome: Exclude<LiveAddressOutcome, 'not_requested'>): void {
    this.addressLastOutcome = outcome;
    if (outcome === 'response_received') this.addressResponses += 1;
    else if (outcome === 'rejected') this.addressRejected += 1;
    else this.addressAmbiguous += 1;
  }

  blockAddressRequest(): void {
    this.addressBlocked += 1;
  }

  snapshot(): LiveProviderStatus {
    return {
      email: {
        attempts: this.emailAttempts,
        apiAccepted: this.emailAccepted,
        rejected: this.emailRejected,
        ambiguous: this.emailAmbiguous,
        blocked: this.emailBlocked,
        lastOutcome: this.emailLastOutcome,
        maxAttempts: LIVE_UAT_MAX_RESEND_ATTEMPTS,
        inboxReceipt: 'owner_confirmation_required',
      },
      address: {
        requests: this.addressRequests,
        responses: this.addressResponses,
        rejected: this.addressRejected,
        ambiguous: this.addressAmbiguous,
        blocked: this.addressBlocked,
        lastOutcome: this.addressLastOutcome,
        maxRequestsPerProcess: LIVE_UAT_MAX_GEOAPIFY_REQUESTS_PER_PROCESS,
      },
    };
  }
}

function normalizedEmail(value: string): string {
  return value.trim().toLowerCase();
}

function requestedEmail(body: string | undefined): string | null {
  if (!body) return null;
  try {
    const parsed: unknown = JSON.parse(body);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const to = (parsed as { to?: unknown }).to;
    if (!Array.isArray(to) || to.length !== 1 || typeof to[0] !== 'string') return null;
    return to[0];
  } catch {
    return null;
  }
}

export interface LiveResendProviderOptions {
  apiKey: string;
  fromEmail: string;
  approvedRecipient: string;
  evidence: LiveProviderEvidence;
  fetcher?: typeof fetch;
}

/** Real Resend adapter with a local-UAT recipient and process-level send cap. */
export function createLiveUatResendProvider(options: LiveResendProviderOptions): EmailVerificationProvider {
  const fetcher = options.fetcher ?? fetch;
  const guardedFetch: typeof fetch = async (input, init) => {
    const requestUrl = input instanceof Request ? input.url : String(input);
    const recipient = requestedEmail(typeof init?.body === 'string' ? init.body : undefined);
    if (
      requestUrl !== 'https://api.resend.com/emails' || init?.method !== 'POST' ||
      recipient === null || normalizedEmail(recipient) !== normalizedEmail(options.approvedRecipient)
    ) {
      options.evidence.blockEmailAttempt();
      throw new EmailDeliveryError();
    }
    if (!options.evidence.beginEmailAttempt()) throw new EmailDeliveryError();
    try {
      const response = await fetcher(input, init);
      options.evidence.recordEmail(response.ok ? 'api_accepted' : 'rejected');
      return response;
    } catch {
      // No response means the provider may have accepted the request before the connection failed.
      options.evidence.recordEmail('ambiguous');
      throw new EmailDeliveryError();
    }
  };
  const resend = new ResendEmailVerificationProvider(options.apiKey, options.fromEmail, guardedFetch);
  return {
    async sendVerificationCode(message: VerificationEmail): Promise<void> {
      if (normalizedEmail(message.email) !== normalizedEmail(options.approvedRecipient)) {
        options.evidence.blockEmailAttempt();
        throw new EmailDeliveryError();
      }
      await resend.sendVerificationCode(message);
    },
  };
}

export interface LiveGeoapifyOptions {
  config: AddressProviderConfig;
  evidence: LiveProviderEvidence;
  transport?: AddressProviderTransport;
  /** Only used by deterministic unit tests; production composition omits it. */
  testMinStartIntervalMs?: number;
}

/** Real Geoapify adapter with an exact origin/path guard and a ten-request local cap. */
export function createLiveUatAddressService(options: LiveGeoapifyOptions): ReportAddressSuggestionService {
  if (!options.config.enabled || options.config.baseUrl !== 'https://api-eu.geoapify.com' || !options.config.apiKey.trim()) {
    throw new Error('Live local UAT requires the configured EU Geoapify provider.');
  }
  const fetcher: AddressProviderTransport = options.transport ?? (async (url, signal) =>
    fetch(url, { method: 'GET', signal })
  );
  const transport: AddressProviderTransport = async (url, signal) => {
    if (
      url.origin !== 'https://api-eu.geoapify.com' || url.pathname !== '/v1/geocode/reverse' ||
      url.searchParams.get('apiKey') !== options.config.apiKey
    ) {
      options.evidence.blockAddressRequest();
      throw new Error('Live local UAT rejected an unexpected Geoapify request.');
    }
    if (!options.evidence.beginAddressRequest()) throw new Error('Live local UAT Geoapify request cap reached.');
    try {
      const response = await fetcher(url, signal);
      options.evidence.recordAddress(response.ok ? 'response_received' : 'rejected');
      return response;
    } catch {
      options.evidence.recordAddress('ambiguous');
      throw new Error('Live local UAT Geoapify request outcome is unknown.');
    }
  };
  const provider = createGeoapifyAddressProvider(options.config, transport);
  return createReportAddressSuggestionService({
    enabled: true,
    provider,
    admission: {
      maxPending: 1,
      maxActive: 1,
      queueExpiryMs: 4000,
      timeoutMs: Math.min(options.config.timeoutMs, 3000),
      minStartIntervalMs: options.testMinStartIntervalMs ?? 1000,
    },
    cache: { maxEntries: 0, ttlMs: 0 },
  });
}
