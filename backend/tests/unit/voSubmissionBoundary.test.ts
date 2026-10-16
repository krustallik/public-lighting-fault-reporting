import { describe, expect, it } from 'vitest';
import {
  mapLocalVoFieldsToDraft,
  observeVoSubmissionAttempt,
  VoSubmissionTransportError,
  type CanonicalVoReportDraft,
  type VoSubmissionTransport,
} from '../../src/integrations/ausemio/voSubmissionBoundary.js';
import { FakeVoSubmissionTransport } from '../support/FakeVoSubmissionTransport.js';

const literalPublicClientFields = {
  'properties[vyber_sluzby]': '2',
  'properties[ulica_miesto_poruchy_lokalita]': 'Jarná',
  'properties[detail_decription]': 'Synthetic report near a lamp.',
  'properties[lokalizacia_blok]': 'Q11',
  'properties[typ_poruchy]': 'Q99',
  'properties[iny_druh_poruchy]': 'Synthetic other fault description.',
  'properties[tel_cislo]': '+421901234567',
  email: ' resident@example.test ',
  locale: 'sk',
  emailVerificationIntentId: '55c9af58-a37b-4f89-9039-bcc3737cd302',
  emailVerificationToken: 'A'.repeat(43),
};

const literalAttachmentMetadata = [{
  originalName: 'synthetic-photo.bin',
  sizeBytes: 7,
  mediaType: 'application/x-synthetic',
}];

const expectedAttachmentMetadata = [{
  originalName: 'synthetic-photo.bin',
  sizeBytes: 7,
  mediaType: 'application/x-synthetic',
}];

describe('VO internal submission boundary', () => {
  it('maps literal current local client fields to a semantic service-2 DTO without OTP or wire claims', () => {
    const result = mapLocalVoFieldsToDraft(literalPublicClientFields, literalAttachmentMetadata);

    expect(result).toEqual({
      ok: true,
      draft: {
        service: '2',
        locality: 'Jarná',
        detailDescription: 'Synthetic report near a lamp.',
        locationBlock: 'Q11',
        faultType: 'Q99',
        otherFaultText: 'Synthetic other fault description.',
        telephone: '+421901234567',
        email: 'resident@example.test',
        locale: 'sk',
        attachments: expectedAttachmentMetadata,
      },
    });
    if (result.ok) {
      expect(result.draft).not.toHaveProperty('emailVerificationIntentId');
      expect(result.draft).not.toHaveProperty('emailVerificationToken');
      expect(result.draft.attachments[0]).not.toHaveProperty('fieldName');
      expect(result.draft.attachments[0]).not.toHaveProperty('bytes');
    }
  });

  it('omits empty optional fields and never supplies fallback option codes', () => {
    const result = mapLocalVoFieldsToDraft({
      'properties[vyber_sluzby]': '2',
      'properties[ulica_miesto_poruchy_lokalita]': 'Jarná',
      'properties[tel_cislo]': '+421901234567',
      email: 'resident@example.test',
      locale: 'en',
      'properties[detail_decription]': '',
      'properties[lokalizacia_blok]': '',
      'properties[typ_poruchy]': '',
    });

    expect(result).toEqual({
      ok: true,
      draft: {
        service: '2', locality: 'Jarná', telephone: '+421901234567',
        email: 'resident@example.test', locale: 'en', attachments: [],
      },
    });
  });

  it.each([
    ['service 16', { ...literalPublicClientFields, 'properties[vyber_sluzby]': '16' }, 'Only service 2 / VO is accepted by the local test endpoint.'],
    ['unknown locality', { ...literalPublicClientFields, 'properties[ulica_miesto_poruchy_lokalita]': 'Synthetic unknown locality' }, 'Select a locality from the approved VO locality list.'],
    ['missing phone', { ...literalPublicClientFields, 'properties[tel_cislo]': '   ' }, 'A telephone contact is required.'],
    ['invalid email', { ...literalPublicClientFields, email: 'not-an-email' }, 'A valid local email value is required.'],
    ['unsupported locale', { ...literalPublicClientFields, locale: 'de' }, 'Select a supported form locale.'],
    ['invalid block', { ...literalPublicClientFields, 'properties[lokalizacia_blok]': 'Q8' }, 'Select a valid VO location block code.'],
    ['invalid fault', { ...literalPublicClientFields, 'properties[typ_poruchy]': 'Q5' }, 'Select a valid VO fault type code.'],
    ['other detail on non-Q99', { ...literalPublicClientFields, 'properties[typ_poruchy]': 'Q1' }, 'Other-fault text is only valid for Q99.'],
  ])('rejects %s during local VO draft mapping', (_name, fields, message) => {
    expect(mapLocalVoFieldsToDraft(fields)).toEqual({ ok: false, message });
  });

  it('rejects malformed attachment metadata without applying undocumented file acceptance rules', () => {
    expect(mapLocalVoFieldsToDraft(literalPublicClientFields, [{
      originalName: 'synthetic.bin', sizeBytes: -1, mediaType: 'application/x-synthetic',
    }])).toEqual({ ok: false, message: 'Attachment metadata is invalid.' });
    expect(mapLocalVoFieldsToDraft(literalPublicClientFields, [{
      originalName: 'synthetic.bin', sizeBytes: 0, mediaType: 'application/x-synthetic',
    }]).ok).toBe(true);
  });

  it.each([
    ['returned', 'returned'],
    ['rejected', 'transport_rejected'],
    ['timed_out', 'timed_out'],
    ['ambiguous', 'ambiguous'],
  ] as const)('keeps external acceptance unknown for fake %s transport outcomes', async (behavior, kind) => {
    const mapped = mapLocalVoFieldsToDraft(literalPublicClientFields, literalAttachmentMetadata);
    expect(mapped.ok).toBe(true);
    if (!mapped.ok) return;

    const fake = new FakeVoSubmissionTransport(behavior);
    const observation = await observeVoSubmissionAttempt(fake, mapped.draft);

    expect(observation).toEqual({ kind, externalAcceptance: 'unknown' });
    expect(fake.received).toEqual([mapped.draft]);
  });

  it('classifies an untyped transport exception as ambiguous', async () => {
    const mapped = mapLocalVoFieldsToDraft(literalPublicClientFields);
    expect(mapped.ok).toBe(true);
    if (!mapped.ok) return;
    const transport: VoSubmissionTransport = {
      async submit(_draft: CanonicalVoReportDraft) {
        throw new Error('synthetic connection reset');
      },
    };

    expect(await observeVoSubmissionAttempt(transport, mapped.draft)).toEqual({
      kind: 'ambiguous', externalAcceptance: 'unknown',
    });
  });

  it('preserves typed transport observations without exposing internal exception details', async () => {
    const mapped = mapLocalVoFieldsToDraft(literalPublicClientFields);
    expect(mapped.ok).toBe(true);
    if (!mapped.ok) return;
    const transport: VoSubmissionTransport = {
      async submit() {
        throw new VoSubmissionTransportError('timed_out');
      },
    };

    expect(await observeVoSubmissionAttempt(transport, mapped.draft)).toEqual({
      kind: 'timed_out', externalAcceptance: 'unknown',
    });
  });
});
