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
  /** Stable non-secret provider identifier used only in the in-memory cache key. */
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
  cacheHit: number;
}

export interface ReportAddressSuggestionServiceOptions {
  enabled?: boolean;
  provider?: AddressSuggestionProvider | null;
  admission?: ReportAddressAdmissionSettings;
  cache?: ReportAddressCacheSettings;
  policy?: ReportAddressAdmissionPolicy;
  now?: () => number;
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
    ((cache.maxEntries === 0) !== (cache.ttlMs === 0))
  ) {
    throw new Error('Invalid report address cache settings');
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

function normalizeProviderResult(value: unknown): AddressSuggestion {
  if (!value || typeof value !== 'object') {
    throw new Error('Malformed provider response');
  }

  const candidate = value as { address?: unknown; locality?: unknown };
  if (typeof candidate.address !== 'string' || candidate.address.trim().length === 0) {
    throw new Error('Malformed provider response');
  }

  if (candidate.locality != null && typeof candidate.locality !== 'string') {
    throw new Error('Malformed provider response');
  }

  const locality = typeof candidate.locality === 'string' ? candidate.locality.trim() : '';
  return {
    address: candidate.address.trim(),
    ...(locality ? { locality } : {}),
  };
}

function coordinateKey(value: number): string {
  return (Object.is(value, -0) ? 0 : value).toString();
}

function cacheKey(
  providerId: string,
  request: ReportAddressSuggestionRequest
): string {
  return JSON.stringify([
    providerId,
    request.language,
    coordinateKey(request.latitude),
    coordinateKey(request.longitude),
  ]);
}

interface CacheEntry {
  value: AddressSuggestion;
  expiresAt: number;
}

interface QueueEntry<T> {
  key: string;
  execute: (signal: AbortSignal) => Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
  promise: Promise<T>;
  expiresAt: number;
  expiryTimer?: ReturnType<typeof setTimeout>;
  state: 'queued' | 'starting' | 'running' | 'settled';
}

class BoundedAdmissionController {
  private readonly queue: QueueEntry<AddressSuggestion>[] = [];
  private readonly inFlight = new Map<string, QueueEntry<AddressSuggestion>>();
  private active = 0;
  private nextStartAt = 0;
  private pumpRunning = false;
  private spacingTimer?: ReturnType<typeof setTimeout>;

  constructor(
    private readonly settings: ReportAddressAdmissionSettings,
    private readonly policy: ReportAddressAdmissionPolicy,
    private readonly now: () => number,
    private readonly counters: ReportAddressSuggestionCounters
  ) {}

  run(
    key: string,
    execute: (signal: AbortSignal) => Promise<AddressSuggestion>
  ): Promise<AddressSuggestion> {
    const existing = this.inFlight.get(key);
    if (existing) {
      this.counters.coalesced += 1;
      return existing.promise;
    }

    if (this.policy.admit && !this.policy.admit()) {
      this.counters.rejected += 1;
      return Promise.reject(new ReportAddressSuggestionError(
        'admission_rejected', 429, 'Address suggestion is temporarily unavailable'
      ));
    }

    if (this.active >= this.settings.maxActive && this.queue.length >= this.settings.maxPending) {
      this.counters.rejected += 1;
      return Promise.reject(new ReportAddressSuggestionError(
        'queue_full', 429, 'Address suggestion capacity is temporarily full'
      ));
    }

    let resolve!: (value: AddressSuggestion) => void;
    let reject!: (reason: unknown) => void;
    const promise = new Promise<AddressSuggestion>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    const entry: QueueEntry<AddressSuggestion> = {
      key,
      execute,
      resolve,
      reject,
      promise,
      expiresAt: this.now() + this.settings.queueExpiryMs,
      state: 'queued',
    };

    this.counters.accepted += 1;
    this.inFlight.set(key, entry);
    entry.expiryTimer = setTimeout(() => this.expireQueued(entry), this.settings.queueExpiryMs);
    this.queue.push(entry);
    void this.pump();
    return promise;
  }

  private expireQueued(entry: QueueEntry<AddressSuggestion>): void {
    if (entry.state !== 'queued') return;
    const index = this.queue.indexOf(entry);
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

        if (this.policy.tryConsumeBudget && !this.policy.tryConsumeBudget()) {
          this.active -= 1;
          this.settle(entry, undefined, new ReportAddressSuggestionError(
            'application_cap', 429, 'Address suggestion capacity is temporarily full'
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

  private async executeEntry(entry: QueueEntry<AddressSuggestion>): Promise<void> {
    const controller = new AbortController();
    let timeoutTimer: ReturnType<typeof setTimeout> | undefined;
    let timedOut = false;
    const timeout = new Promise<never>((_resolve, reject) => {
      timeoutTimer = setTimeout(() => {
        timedOut = true;
        controller.abort();
        reject(new ReportAddressSuggestionError('timeout', 504, 'Address suggestion timed out'));
      }, this.settings.timeoutMs);
    });

    let work: Promise<AddressSuggestion>;
    try {
      work = entry.execute(controller.signal);
    } catch (error) {
      work = Promise.reject(error);
    }

    try {
      const result = await Promise.race([work, timeout]);
      this.settle(entry, result);
    } catch {
      if (timedOut) {
        this.counters.timeout += 1;
        this.settle(entry, undefined, new ReportAddressSuggestionError(
          'timeout', 504, 'Address suggestion timed out'
        ));
        // Hold the active slot until the adapter acknowledges abort or completes.
        await work.catch(() => undefined);
      } else {
        this.counters.providerFailure += 1;
        this.settle(entry, undefined, new ReportAddressSuggestionError(
          'provider_error', 502, 'Address suggestion is unavailable'
        ));
      }
    } finally {
      if (timeoutTimer) clearTimeout(timeoutTimer);
      this.active -= 1;
      void this.pump();
    }
  }

  private settle(
    entry: QueueEntry<AddressSuggestion>,
    value?: AddressSuggestion,
    error?: unknown
  ): void {
    if (entry.state === 'settled') return;
    entry.state = 'settled';
    if (entry.expiryTimer) clearTimeout(entry.expiryTimer);
    if (this.inFlight.get(entry.key) === entry) this.inFlight.delete(entry.key);
    if (error !== undefined) entry.reject(error);
    else if (value !== undefined) entry.resolve(value);
    else entry.reject(new ReportAddressSuggestionError(
      'provider_error', 502, 'Address suggestion is unavailable'
    ));
  }
}

const emptyCounters = (): ReportAddressSuggestionCounters => ({
  accepted: 0,
  rejected: 0,
  coalesced: 0,
  timeout: 0,
  providerFailure: 0,
  cacheHit: 0,
});

export function createReportAddressSuggestionService(
  options: ReportAddressSuggestionServiceOptions = {}
) {
  const enabled = options.enabled === true && options.provider != null;
  const provider = options.provider ?? null;
  const counters = emptyCounters();
  const cache = new Map<string, CacheEntry>();
  const now = options.now ?? Date.now;

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

  function getCached(key: string): AddressSuggestion | undefined {
    const entry = cache.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= now()) {
      cache.delete(key);
      return undefined;
    }
    cache.delete(key);
    cache.set(key, entry);
    counters.cacheHit += 1;
    return entry.value;
  }

  function cacheResult(key: string, value: AddressSuggestion): void {
    const settings = options.cache;
    if (!settings || settings.maxEntries === 0 || settings.ttlMs === 0) return;
    cache.delete(key);
    cache.set(key, { value, expiresAt: now() + settings.ttlMs });
    while (cache.size > settings.maxEntries) {
      const oldestKey = cache.keys().next().value as string | undefined;
      if (oldestKey === undefined) break;
      cache.delete(oldestKey);
    }
  }

  return {
    async suggest(request: ReportAddressSuggestionRequest): Promise<AddressSuggestion> {
      validateRequest(request);
      if (!enabled || !provider || !admission) throw DISABLED_ERROR();

      const key = cacheKey(provider.id, request);
      const cached = getCached(key);
      if (cached) return cached;

      try {
        const result = await admission.run(key, async (signal) => {
          const upstreamResult = await provider.reverse({
            latitude: request.latitude,
            longitude: request.longitude,
            language: request.language,
          }, signal);
          try {
            return normalizeProviderResult(upstreamResult);
          } catch {
            throw new Error('Malformed provider response');
          }
        });
        cacheResult(key, result);
        return result;
      } catch (error) {
        if (error instanceof ReportAddressSuggestionError) throw error;
        throw new ReportAddressSuggestionError('provider_error', 502, 'Address suggestion is unavailable');
      }
    },
    counters(): ReportAddressSuggestionCounters {
      return { ...counters };
    },
  };
}

/** Production deliberately has no provider registration until owner/provider/legal approval. */
export const reportAddressSuggestionService = createReportAddressSuggestionService();

export type ReportAddressSuggestionService = ReturnType<typeof createReportAddressSuggestionService>;
