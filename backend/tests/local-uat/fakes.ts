import type { AddressProviderConfig } from '../../src/config/addressProvider.js';
import type { AddressProviderTransport } from '../../src/providers/geoapifyAddressProvider.js';
import { createGeoapifyAddressProvider } from '../../src/providers/geoapifyAddressProvider.js';
import {
  createReportAddressSuggestionService,
  type ReportAddressSuggestionRequest,
} from '../../src/services/reportAddressSuggestion.service.js';
import type {
  EmailVerificationProvider,
  VerificationEmail,
} from '../../src/services/emailVerificationProvider.js';

export type LocalUatAddressScenario =
  | 'success'
  | 'no-result'
  | 'unavailable'
  | 'timeout'
  | 'rate-limited'
  | 'budget-exhausted'
  | 'outside-area';

const ADDRESS_SCENARIOS: readonly LocalUatAddressScenario[] = [
  'success', 'no-result', 'unavailable', 'timeout', 'rate-limited', 'budget-exhausted', 'outside-area',
];

export function isLocalUatAddressScenario(value: unknown): value is LocalUatAddressScenario {
  return typeof value === 'string' && ADDRESS_SCENARIOS.includes(value as LocalUatAddressScenario);
}

export class LocalUatEmailProvider implements EmailVerificationProvider {
  private message: { code: string; locale: VerificationEmail['locale']; sentAt: string } | undefined;
  private rejectNext = false;

  async sendVerificationCode(message: VerificationEmail): Promise<void> {
    if (this.rejectNext) {
      this.rejectNext = false;
      throw new Error('Local UAT fake email delivery failure.');
    }
    this.message = { code: message.code, locale: message.locale, sentAt: new Date().toISOString() };
  }

  latest(): Readonly<{ code: string; locale: VerificationEmail['locale']; sentAt: string }> | undefined {
    return this.message;
  }

  failNextDelivery(): void {
    this.rejectNext = true;
  }
}

export interface LocalUatAddressOptions {
  timeoutMs?: number;
}

export class LocalUatAddressProvider {
  private currentScenario: LocalUatAddressScenario = 'success';
  private requests = 0;
  readonly service;

  constructor(options: LocalUatAddressOptions = {}) {
    const settings: AddressProviderConfig = {
      enabled: true,
      baseUrl: 'https://api-eu.geoapify.com',
      // This marker is only inserted into a URL passed to the fake transport below.
      apiKey: 'local-uat-no-network',
      timeoutMs: options.timeoutMs ?? 800,
      maxActive: 1,
      maxPending: 1,
      startIntervalMs: 0,
      queueExpiryMs: 1500,
      dailyBudget: 100,
    };
    const transport: AddressProviderTransport = async (url, signal) => {
      if (url.origin !== 'https://api-eu.geoapify.com' || signal.aborted) {
        throw new Error('Local UAT fake transport rejected an unexpected request.');
      }
      this.requests += 1;
      switch (this.currentScenario) {
        case 'no-result':
          return Response.json({ features: [] });
        case 'unavailable':
          return new Response('unavailable', { status: 503 });
        case 'rate-limited':
          return new Response('rate limited', { status: 429 });
        case 'timeout':
          return new Promise<Response>((_resolve, reject) => {
            const abort = () => reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
            if (signal.aborted) abort();
            else signal.addEventListener('abort', abort, { once: true });
          });
        case 'success':
        case 'budget-exhausted':
        case 'outside-area':
          return new Response(JSON.stringify({
            features: [{ properties: { formatted: '12 Jarná Street, Košice, Slovakia', city: 'Košice' } }],
          }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
    };
    const provider = createGeoapifyAddressProvider(settings, transport);
    this.service = createReportAddressSuggestionService({
      enabled: true,
      provider,
      admission: {
        maxPending: settings.maxPending,
        maxActive: settings.maxActive,
        queueExpiryMs: settings.queueExpiryMs,
        timeoutMs: settings.timeoutMs,
        minStartIntervalMs: settings.startIntervalMs,
        dailyBudget: settings.dailyBudget,
      },
      cache: { maxEntries: 0, ttlMs: 0 },
      policy: { tryConsumeBudget: () => this.currentScenario !== 'budget-exhausted' },
    });
  }

  scenario(): LocalUatAddressScenario {
    return this.currentScenario;
  }

  setScenario(scenario: LocalUatAddressScenario): void {
    this.currentScenario = scenario;
  }

  requestCount(): number {
    return this.requests;
  }

  classifyPoint(
    point: unknown,
    normalClassifier: (value: unknown) => 'inside' | 'outside' | 'invalid-coordinate' | 'unavailable'
  ): 'inside' | 'outside' | 'invalid-coordinate' | 'unavailable' {
    return this.currentScenario === 'outside-area' ? 'outside' : normalClassifier(point);
  }

  suggest(request: ReportAddressSuggestionRequest, signal?: AbortSignal) {
    return this.service.suggest(request, signal);
  }
}
