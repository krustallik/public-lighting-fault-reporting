import { describe, expect, it, vi } from 'vitest';
import { createAddressProviderConfig } from '../../src/config/addressProvider.js';
import { EmailDeliveryError, type VerificationEmail } from '../../src/services/emailVerificationProvider.js';
import {
  LIVE_UAT_MAX_GEOAPIFY_REQUESTS_PER_PROCESS,
  LIVE_UAT_MAX_RESEND_ATTEMPTS,
  LiveProviderEvidence,
  createLiveUatAddressService,
  createLiveUatResendProvider,
} from '../local-uat/liveProviders.js';

const message: VerificationEmail = { email: 'owner@example.test', code: '482913', locale: 'en' };

function configuredAddressProvider() {
  return createAddressProviderConfig({
    GEOAPIFY_ENABLED: 'true',
    GEOAPIFY_BASE_URL: 'https://api-eu.geoapify.com',
    GEOAPIFY_API_KEY: 'test-geo-key',
  });
}

describe('LIVE_PROVIDER_UAT provider adapters', () => {
  it('uses the real Resend adapter seam and reports API acceptance without claiming inbox delivery', async () => {
    const evidence = new LiveProviderEvidence();
    const fetcher = vi.fn<typeof fetch>(async () => new Response('{}', { status: 200 }));
    const provider = createLiveUatResendProvider({
      apiKey: 'test-resend-key',
      fromEmail: 'reports@example.test',
      approvedRecipient: 'owner@example.test',
      evidence,
      fetcher,
    });

    await provider.sendVerificationCode(message);

    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls[0][0]).toBe('https://api.resend.com/emails');
    expect(evidence.snapshot().email).toMatchObject({
      attempts: 1, apiAccepted: 1, rejected: 0, ambiguous: 0,
      lastOutcome: 'api_accepted', inboxReceipt: 'owner_confirmation_required',
    });
    expect(JSON.stringify(evidence.snapshot())).not.toContain(message.code);
    expect(JSON.stringify(evidence.snapshot())).not.toContain(message.email);
  });

  it('records an explicit provider rejection and does not fall back to a fake inbox', async () => {
    const evidence = new LiveProviderEvidence();
    const fetcher = vi.fn<typeof fetch>(async () => new Response('{}', { status: 403 }));
    const provider = createLiveUatResendProvider({
      apiKey: 'test-resend-key', fromEmail: 'reports@example.test',
      approvedRecipient: message.email, evidence, fetcher,
    });

    await expect(provider.sendVerificationCode(message)).rejects.toBeInstanceOf(EmailDeliveryError);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(evidence.snapshot().email.lastOutcome).toBe('rejected');
    expect(evidence.snapshot().email.apiAccepted).toBe(0);
  });

  it('records a missing Resend response as ambiguous, caps sends, and rejects unapproved recipients before egress', async () => {
    const ambiguousEvidence = new LiveProviderEvidence();
    const failingFetch = vi.fn<typeof fetch>(async () => { throw new Error('private network failure'); });
    const ambiguousProvider = createLiveUatResendProvider({
      apiKey: 'test-resend-key', fromEmail: 'reports@example.test',
      approvedRecipient: message.email, evidence: ambiguousEvidence, fetcher: failingFetch,
    });
    await expect(ambiguousProvider.sendVerificationCode(message)).rejects.toBeInstanceOf(EmailDeliveryError);
    expect(ambiguousEvidence.snapshot().email.lastOutcome).toBe('ambiguous');

    const cappedEvidence = new LiveProviderEvidence();
    const acceptedFetch = vi.fn<typeof fetch>(async () => new Response('{}', { status: 202 }));
    const cappedProvider = createLiveUatResendProvider({
      apiKey: 'test-resend-key', fromEmail: 'reports@example.test',
      approvedRecipient: message.email, evidence: cappedEvidence, fetcher: acceptedFetch,
    });
    for (let index = 0; index < LIVE_UAT_MAX_RESEND_ATTEMPTS; index += 1) {
      await cappedProvider.sendVerificationCode(message);
    }
    await expect(cappedProvider.sendVerificationCode(message)).rejects.toBeInstanceOf(EmailDeliveryError);
    expect(acceptedFetch).toHaveBeenCalledTimes(LIVE_UAT_MAX_RESEND_ATTEMPTS);
    expect(cappedEvidence.snapshot().email.blocked).toBe(1);

    const allowlistEvidence = new LiveProviderEvidence();
    const neverCalledFetch = vi.fn<typeof fetch>();
    const restrictedProvider = createLiveUatResendProvider({
      apiKey: 'test-resend-key', fromEmail: 'reports@example.test',
      approvedRecipient: message.email, evidence: allowlistEvidence, fetcher: neverCalledFetch,
    });
    await expect(restrictedProvider.sendVerificationCode({ ...message, email: 'other@example.test' }))
      .rejects.toBeInstanceOf(EmailDeliveryError);
    expect(neverCalledFetch).not.toHaveBeenCalled();
    expect(allowlistEvidence.snapshot().email.blocked).toBe(1);
  });

  it('uses the real Geoapify adapter and records a response without exposing its key or address', async () => {
    const evidence = new LiveProviderEvidence();
    const transport = vi.fn(async (url: URL) => {
      expect(url.origin).toBe('https://api-eu.geoapify.com');
      expect(url.pathname).toBe('/v1/geocode/reverse');
      expect(url.searchParams.get('apiKey')).toBe('test-geo-key');
      return Response.json({ features: [{ properties: { formatted: 'Synthetic Test Street', city: 'Košice' } }] });
    });
    const service = createLiveUatAddressService({ config: configuredAddressProvider(), evidence, transport });

    await expect(service.suggest({ latitude: 48.7164, longitude: 21.2611, targetKind: 'custom', language: 'en' }))
      .resolves.toEqual({ address: 'Synthetic Test Street', locality: 'Košice' });
    expect(transport).toHaveBeenCalledOnce();
    expect(evidence.snapshot().address).toMatchObject({ requests: 1, responses: 1, lastOutcome: 'response_received' });
    expect(JSON.stringify(evidence.snapshot())).not.toContain('test-geo-key');
    expect(JSON.stringify(evidence.snapshot())).not.toContain('Synthetic Test Street');
  });

  it('preserves no-result, HTTP rejection and ambiguous Geoapify outcomes', async () => {
    const request = { latitude: 48.7164, longitude: 21.2611, targetKind: 'device' as const, language: 'sk' as const };
    const emptyEvidence = new LiveProviderEvidence();
    const emptyService = createLiveUatAddressService({
      config: configuredAddressProvider(), evidence: emptyEvidence,
      transport: async () => Response.json({ features: [] }),
    });
    await expect(emptyService.suggest(request)).resolves.toBeNull();

    const rejectedEvidence = new LiveProviderEvidence();
    const rejectedService = createLiveUatAddressService({
      config: configuredAddressProvider(), evidence: rejectedEvidence,
      transport: async () => new Response('{}', { status: 429 }),
    });
    await expect(rejectedService.suggest(request)).rejects.toMatchObject({ code: 'provider_throttled', status: 503 });
    expect(rejectedEvidence.snapshot().address.lastOutcome).toBe('rejected');

    const ambiguousEvidence = new LiveProviderEvidence();
    const ambiguousService = createLiveUatAddressService({
      config: configuredAddressProvider(), evidence: ambiguousEvidence,
      transport: async () => { throw new Error('private network failure'); },
    });
    await expect(ambiguousService.suggest(request)).rejects.toMatchObject({ code: 'provider_unavailable', status: 503 });
    expect(ambiguousEvidence.snapshot().address.lastOutcome).toBe('ambiguous');
  });

  it('requires an enabled allowlisted EU Geoapify config and enforces a local request cap', async () => {
    const evidence = new LiveProviderEvidence();
    expect(() => createLiveUatAddressService({
      config: { ...configuredAddressProvider(), enabled: false }, evidence,
    })).toThrow('Live local UAT requires the configured EU Geoapify provider.');
    expect(() => createLiveUatAddressService({
      config: { ...configuredAddressProvider(), baseUrl: 'https://example.test' }, evidence,
    })).toThrow('Live local UAT requires the configured EU Geoapify provider.');
    expect(() => createLiveUatAddressService({
      config: { ...configuredAddressProvider(), apiKey: '' }, evidence,
    })).toThrow('Live local UAT requires the configured EU Geoapify provider.');
    expect(LIVE_UAT_MAX_GEOAPIFY_REQUESTS_PER_PROCESS).toBe(10);

    const capEvidence = new LiveProviderEvidence();
    const transport = vi.fn(async () => Response.json({ features: [] }));
    const service = createLiveUatAddressService({
      config: configuredAddressProvider(), evidence: capEvidence,
      testMinStartIntervalMs: 0, transport,
    });
    for (let index = 0; index < LIVE_UAT_MAX_GEOAPIFY_REQUESTS_PER_PROCESS; index += 1) {
      await service.suggest({
        latitude: 48 + index / 10_000,
        longitude: 21.2,
        targetKind: 'custom',
        language: 'en',
      });
    }
    await expect(service.suggest({
      latitude: 48.5, longitude: 21.2, targetKind: 'custom', language: 'en',
    })).rejects.toMatchObject({ code: 'provider_unavailable' });
    expect(transport).toHaveBeenCalledTimes(LIVE_UAT_MAX_GEOAPIFY_REQUESTS_PER_PROCESS);
    expect(capEvidence.snapshot().address).toMatchObject({
      requests: LIVE_UAT_MAX_GEOAPIFY_REQUESTS_PER_PROCESS, blocked: 1,
    });
  });
});
