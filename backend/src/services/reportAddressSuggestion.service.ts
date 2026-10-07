import { createHmac, randomBytes } from 'node:crypto';
import { addressProviderConfig } from '../config/addressProvider.js';
import { AddressProviderError, createGeoapifyAddressProvider } from '../providers/geoapifyAddressProvider.js';

export type ReportAddressTargetKind = 'custom' | 'device';
export type ReportAddressLanguage = 'sk' | 'en';

export interface ReportAddressSuggestionRequest {
  latitude: number;
  longitude: number;
  targetKind: ReportAddressTargetKind;
  language: ReportAddressLanguage;
}

export interface AddressSuggestion {
  address: string;
  locality?: string;
}

export interface AddressSuggestionProvider {
  /** Stable non-secret provider identifier used only inside a keyed in-memory coalescing digest. */
  id: string;
  reverse(
    request: Pick<ReportAddressSuggestionRequest, 'latitude' | 'longitude' | 'language'>,
    signal: AbortSignal
  ): Promise<unknown>;
}

export interface ReportAddressAdmissionSettings {
  maxPending: number;
  maxActive: number;
  queueExpiryMs: number;
  timeoutMs: number;
  minStartIntervalMs: number;
  dailyBudget?: number;
}

export interface ReportAddressCacheSettings {
  maxEntries: number;
  ttlMs: number;
}

export interface ReportAddressAdmissionPolicy {
  /** Synchronous admission seam; deliberately receives no IP or coordinate data. */
  admit?: () => boolean;
  /** Synchronous application/provider budget reservation immediately before transport. */
  tryConsumeBudget?: () => boolean;
}

export interface ReportAddressSuggestionCounters {
  accepted: number;
  rejected: number;
  coalesced: number;
  timeout: number;
  providerFailure: number;
}

export interface ReportAddressSuggestionServiceOptions {
  enabled?: boolean;
  provider?: AddressSuggestionProvider | null;
  admission?: ReportAddressAdmissionSettings;
  cache?: ReportAddressCacheSettings;
  policy?: ReportAddressAdmissionPolicy;
  now?: () => number;
  coalescingSecret?: Buffer;
}

export class ReportAddressSuggestionError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status: number, message: string) {
    super(message);
    this.name = 'ReportAddressSuggestionError';
    this.code = code;
    this.status = status;
  }
}

function publicProviderError(error: unknown): ReportAddressSuggestionError {
  if (error instanceof ReportAddressSuggestionError) return error;
  if (error instanceof AddressProviderError) {
    return new ReportAddressSuggestionError(error.code, error.status, error.message);
  }
  return new ReportAddressSuggestionError(
    'provider_unavailable', 503, 'Address assistance is temporarily unavailable'
  );
}

const DISABLED_ERROR = () =>
  new ReportAddressSuggestionError('disabled', 503, 'Address suggestion is unavailable');

function isSafeIntegerAtLeast(value: number, min: number): boolean {
  return Number.isSafeInteger(value) && value >= min;
}

function validateSettings(
  admission: ReportAddressAdmissionSettings,
  cache: ReportAddressCacheSettings,
  providerId: string
): void {
  if (
    !providerId.trim() ||
    !isSafeIntegerAtLeast(admission.maxPending, 0) ||
    !isSafeIntegerAtLeast(admission.maxActive, 1) ||
    !isSafeIntegerAtLeast(admission.queueExpiryMs, 1) ||
    !isSafeIntegerAtLeast(admission.timeoutMs, 1) ||
    !isSafeIntegerAtLeast(admission.minStartIntervalMs, 0)
  ) {
    throw new Error('Invalid report address admission settings');
  }

  if (
    !isSafeIntegerAtLeast(cache.maxEntries, 0) ||
    !isSafeIntegerAtLeast(cache.ttlMs, 0) ||
    cache.maxEntries !== 0 || cache.ttlMs !== 0
  ) {
    throw new Error('Completed address-result caching must remain disabled');
  }
}

function validateRequest(request: ReportAddressSuggestionRequest): void {
  if (
    !request ||
    !Number.isFinite(request.latitude) ||
    !Number.isFinite(request.longitude) ||
    request.latitude < -90 || request.latitude > 90 ||
    request.longitude < -180 || request.longitude > 180 ||
    (request.targetKind !== 'custom' && request.targetKind !== 'device') ||
    (request.language !== 'sk' && request.language !== 'en')
  ) {
    throw new ReportAddressSuggestionError('invalid_request', 400, 'Invalid address suggestion request');
  }
}

function normalizeProviderResult(value: unknown): AddressSuggestion | null {
  if (value === null) return null;
  if (!value || typeof value !== 'object') {
    throw new AddressProviderError('provider_invalid_response', 502, 'Address provider returned an invalid response.');
  }

  const candidate = value as { address?: unknown; locality?: unknown };
  if (typeof candidate.address !== 'string' || candidate.address.trim().length === 0) {
    throw new AddressProviderError('provider_invalid_response', 502, 'Address provider returned an invalid response.');
  }

  if (candidate.locality != null && typeof candidate.locality !== 'string') {
    throw new AddressProviderError('provider_invalid_response', 502, 'Address provider returned an invalid response.');
  }

  const address = candidate.address.normalize('NFC').trim();
  if (!address || address.length > 500) throw new AddressProviderError('provider_invalid_response', 502, 'Address provider returned an invalid response.');
  const locality = typeof candidate.locality === 'string' ? candidate.locality.normalize('NFC').trim() : '';
  if (locality.length > 200) throw new AddressProviderError('provider_invalid_response', 502, 'Address provider returned an invalid response.');
  return {
    address,
    ...(locality ? { locality } : {}),
  };
}

interface QueueEntry<T> {
  key: string;
  execute: (signal: AbortSignal) => Promise<T>;
  subscribers: Set<QueueSubscriber<T>>;
  controller?: AbortController;
  expiresAt: number;
  expiryTimer?: ReturnType<typeof setTimeout>;
  state: 'queued' | 'starting' | 'running' | 'settled';
}

interface QueueSubscriber<T> {
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
  signal?: AbortSignal;
  abortHandler?: () => void;
}

class BoundedAdmissionController {
  private readonly queue: QueueEntry<unknown>[] = [];
  private readonly inFlight = new Map<string, QueueEntry<unknown>>();
  private active = 0;
  private nextStartAt = 0;
  private pumpRunning = false;
  private spacingTimer?: ReturnType<typeof setTimeout>;
  private dailyBudgetDate = '';
  private dailyBudgetUsed = 0;

  constructor(
    private readonly settings: ReportAddressAdmissionSettings,
    private readonly policy: ReportAddressAdmissionPolicy,
    private readonly now: () => number,
    private readonly counters: ReportAddressSuggestionCounters
  ) {}

  run<T>(
    key: string,
    execute: (signal: AbortSignal) => Promise<T>,
    signal?: AbortSignal
  ): Promise<T> {
    if (signal?.aborted) return Promise.reject(this.cancellationError());

    const existing = this.inFlight.get(key);
    if (existing) {
      this.counters.coalesced += 1;
      return this.subscribe(existing as QueueEntry<T>, signal);
    }

    if (this.policy.admit && !this.policy.admit()) {
      this.counters.rejected += 1;
      return Promise.reject(new ReportAddressSuggestionError(
        'admission_rejected', 429, 'Address suggestion is temporarily unavailable'
      ));
    }

    const canStartImmediately = this.active < this.settings.maxActive &&
      this.queue.length === 0 && this.nextStartAt <= this.now();
    if (!canStartImmediately && this.queue.length >= this.settings.maxPending) {
      this.counters.rejected += 1;
      return Promise.reject(new ReportAddressSuggestionError(
        'queue_full', 429, 'Address suggestion capacity is temporarily full'
      ));
    }

    const entry: QueueEntry<T> = {
      key,
      execute,
      subscribers: new Set(),
      expiresAt: this.now() + this.settings.queueExpiryMs,
      state: 'queued',
    };

    this.counters.accepted += 1;
    this.inFlight.set(key, entry as QueueEntry<unknown>);
    entry.expiryTimer = setTimeout(() => this.expireQueued(entry), this.settings.queueExpiryMs);
    const subscriberPromise = this.subscribe(entry, signal);
    this.queue.push(entry as QueueEntry<unknown>);
    void this.pump();
    return subscriberPromise;
  }

  private cancellationError(): ReportAddressSuggestionError {
    return new ReportAddressSuggestionError('cancelled', 499, 'Address suggestion request was cancelled');
  }

  private subscribe<T>(
    entry: QueueEntry<T>,
    signal?: AbortSignal
  ): Promise<T> {
    if (signal?.aborted) return Promise.reject(this.cancellationError());

    return new Promise<T>((resolve, reject) => {
      const subscriber: QueueSubscriber<T> = { resolve, reject, signal };
      if (signal) {
        subscriber.abortHandler = () => {
          if (!entry.subscribers.delete(subscriber)) return;
          reject(this.cancellationError());
          this.cancelWhenUnobserved(entry);
        };
        signal.addEventListener('abort', subscriber.abortHandler, { once: true });
      }
      entry.subscribers.add(subscriber);
      if (signal?.aborted) subscriber.abortHandler?.();
    });
  }

  private cancelWhenUnobserved<T>(entry: QueueEntry<T>): void {
    if (entry.subscribers.size > 0 || entry.state === 'settled') return;
    if (entry.state === 'queued') {
      const index = this.queue.indexOf(entry as unknown as QueueEntry<unknown>);
      if (index >= 0) this.queue.splice(index, 1);
    } else {
      entry.controller?.abort();
    }
    if (entry.expiryTimer) clearTimeout(entry.expiryTimer);
    entry.expiryTimer = undefined;
    entry.state = 'settled';
    if (this.inFlight.get(entry.key) === (entry as unknown as QueueEntry<unknown>)) this.inFlight.delete(entry.key);
    void this.pump();
  }

  private expireQueued<T>(entry: QueueEntry<T>): void {
    if (entry.state !== 'queued') return;
    const index = this.queue.indexOf(entry as unknown as QueueEntry<unknown>);
    if (index >= 0) this.queue.splice(index, 1);
    this.settle(entry, undefined, new ReportAddressSuggestionError(
      'queue_expired', 429, 'Address suggestion expired before processing'
    ));
    this.counters.rejected += 1;
    void this.pump();
  }

  private schedulePump(delayMs: number): void {
    if (this.spacingTimer) return;
    this.spacingTimer = setTimeout(() => {
      this.spacingTimer = undefined;
      void this.pump();
    }, Math.max(1, delayMs));
  }

  private async pump(): Promise<void> {
    if (this.pumpRunning) return;
    this.pumpRunning = true;
    try {
      while (this.active < this.settings.maxActive && this.queue.length > 0) {
        const entry = this.queue[0];
        if (entry.expiresAt <= this.now()) {
          this.expireQueued(entry);
          continue;
        }

        const waitMs = this.nextStartAt - this.now();
        if (waitMs > 0) {
          this.schedulePump(waitMs);
          break;
        }

        this.queue.shift();
        if (entry.expiryTimer) clearTimeout(entry.expiryTimer);
        entry.expiryTimer = undefined;
        entry.state = 'starting';
        this.active += 1;

        if (entry.expiresAt <= this.now()) {
          this.active -= 1;
          this.settle(entry, undefined, new ReportAddressSuggestionError(
            'queue_expired', 429, 'Address suggestion expired before processing'
          ));
          this.counters.rejected += 1;
          continue;
        }

        let budgetAllowed = true;
        try {
          if (this.policy.tryConsumeBudget) budgetAllowed = this.policy.tryConsumeBudget();
          else if (this.settings.dailyBudget !== undefined) {
            const today = new Date(this.now()).toISOString().slice(0, 10);
            if (today !== this.dailyBudgetDate) {
              this.dailyBudgetDate = today;
              this.dailyBudgetUsed = 0;
            }
            budgetAllowed = this.dailyBudgetUsed < this.settings.dailyBudget;
            if (budgetAllowed) this.dailyBudgetUsed += 1;
          }
        } catch {
          // Budget infrastructure failure is fail-closed and must release this slot.
          budgetAllowed = false;
        }
        if (!budgetAllowed) {
          this.active -= 1;
          this.settle(entry, undefined, new ReportAddressSuggestionError(
            'daily_budget_exceeded', 429, 'Address assistance daily capacity is exhausted'
          ));
          this.counters.rejected += 1;
          continue;
        }

        this.nextStartAt = this.now() + this.settings.minStartIntervalMs;
        entry.state = 'running';
        void this.executeEntry(entry);
      }
    } finally {
      this.pumpRunning = false;
    }
  }

  private async executeEntry(entry: QueueEntry<unknown>): Promise<void> {
    const controller = new AbortController();
    entry.controller = controller;
    let timeoutTimer: ReturnType<typeof setTimeout> | undefined;
    let timedOut = false;
    const timeout = new Promise<never>((_resolve, reject) => {
      timeoutTimer = setTimeout(() => {
        timedOut = true;
        controller.abort();
        reject(new ReportAddressSuggestionError('address_provider_timeout', 504, 'Address assistance timed out'));
      }, this.settings.timeoutMs);
    });

    let work: Promise<unknown>;
    try {
      work = entry.execute(controller.signal);
    } catch (error) {
      work = Promise.reject(error);
    }

    try {
      const result = await Promise.race([work, timeout]);
      this.settle(entry, result);
    } catch (error) {
      if (timedOut) {
        this.counters.timeout += 1;
        this.settle(entry, undefined, new ReportAddressSuggestionError(
          'address_provider_timeout', 504, 'Address assistance timed out'
        ));
        // Hold the active slot until the adapter acknowledges abort or completes.
        await work.catch(() => undefined);
      } else {
        if (entry.state !== 'settled') {
          this.counters.providerFailure += 1;
          this.settle(entry, undefined, publicProviderError(error));
        }
      }
    } finally {
      if (timeoutTimer) clearTimeout(timeoutTimer);
      this.active -= 1;
      void this.pump();
    }
  }

  private settle<T>(
    entry: QueueEntry<T>,
    value?: T,
    error?: unknown
  ): void {
    if (entry.state === 'settled') return;
    entry.state = 'settled';
    if (entry.expiryTimer) clearTimeout(entry.expiryTimer);
    if (this.inFlight.get(entry.key) === (entry as unknown as QueueEntry<unknown>)) this.inFlight.delete(entry.key);
    const settledError = error !== undefined
      ? error
      : value !== undefined
        ? undefined
        : publicProviderError(new Error('Provider returned no result'));
    for (const subscriber of entry.subscribers) {
      if (subscriber.signal && subscriber.abortHandler) {
        subscriber.signal.removeEventListener('abort', subscriber.abortHandler);
      }
      if (settledError !== undefined) subscriber.reject(settledError);
      else if (value !== undefined) subscriber.resolve(value);
    }
    entry.subscribers.clear();
  }
}

const emptyCounters = (): ReportAddressSuggestionCounters => ({
  accepted: 0,
  rejected: 0,
  coalesced: 0,
  timeout: 0,
  providerFailure: 0,
});

export function createReportAddressSuggestionService(
  options: ReportAddressSuggestionServiceOptions = {}
) {
  const enabled = options.enabled === true && options.provider != null;
  const provider = options.provider ?? null;
  const counters = emptyCounters();
  const now = options.now ?? Date.now;
  const hmacSecret = options.coalescingSecret ?? randomBytes(32);
  if (hmacSecret.length !== 32) throw new Error('Coalescing key must be 32 bytes');

  const coalescingKey = (value: unknown) => createHmac('sha256', hmacSecret)
    .update(JSON.stringify(value))
    .digest('hex');

  let admission: BoundedAdmissionController | undefined;
  if (enabled && provider) {
    if (!options.admission || !options.cache) {
      throw new Error('Report address admission and cache settings are required when enabled');
    }
    validateSettings(options.admission, options.cache, provider.id);
    admission = new BoundedAdmissionController(
      options.admission,
      options.policy ?? {},
      now,
      counters
    );
  }

  return {
    enabled,
    async suggest(
      request: ReportAddressSuggestionRequest,
      signal?: AbortSignal
    ): Promise<AddressSuggestion | null> {
      validateRequest(request);
      if (!enabled || !provider || !admission) throw DISABLED_ERROR();
      if (signal?.aborted) throw new ReportAddressSuggestionError(
        'cancelled', 499, 'Address suggestion request was cancelled'
      );

      const key = coalescingKey({
        operation: 'reverse', provider: provider.id, version: 1,
        latitude: Object.is(request.latitude, -0) ? 0 : request.latitude,
        longitude: Object.is(request.longitude, -0) ? 0 : request.longitude,
        language: request.language,
      });

      try {
        const result = await admission.run(key, async (providerSignal) => {
          const upstreamResult = await provider.reverse({
            latitude: request.latitude,
            longitude: request.longitude,
            language: request.language,
          }, providerSignal);
          return normalizeProviderResult(upstreamResult);
        }, signal);
        return result;
      } catch (error) {
        throw publicProviderError(error);
      }
    },
    counters(): ReportAddressSuggestionCounters {
      return { ...counters };
    },
  };
}

const configuredProvider = addressProviderConfig.enabled
  ? createGeoapifyAddressProvider(addressProviderConfig)
  : null;

/** Provider activation is explicitly off by default and requires a server-only key. */
export const reportAddressSuggestionService = createReportAddressSuggestionService({
  enabled: addressProviderConfig.enabled,
  provider: configuredProvider,
  ...(addressProviderConfig.enabled ? {
    admission: {
      maxPending: addressProviderConfig.maxPending,
      maxActive: addressProviderConfig.maxActive,
      queueExpiryMs: addressProviderConfig.queueExpiryMs,
      timeoutMs: addressProviderConfig.timeoutMs,
      minStartIntervalMs: addressProviderConfig.startIntervalMs,
      dailyBudget: addressProviderConfig.dailyBudget,
    },
    cache: { maxEntries: 0, ttlMs: 0 },
  } : {}),
});

export type ReportAddressSuggestionService = ReturnType<typeof createReportAddressSuggestionService>;
