import {
  AUSEMIO_FIELDS,
  AUSEMIO_SERVICE_VO,
  isValidSubmitLocale,
} from '../../config/ausemioMapping.js';
import {
  AUSEMIO_FAULT_TYPE_OTHER,
  AUSEMIO_FAULT_TYPE_VALUES,
  AUSEMIO_LOCATION_BLOCK_VALUES,
  isValidFaultType,
  isValidLocationBlock,
} from '../../config/ausemioFormOptions.js';
import { AUSEMIO_VO_LOCALITIES } from '../../config/data/ausemioVoLocalities.generated.js';

export type VoFaultType = (typeof AUSEMIO_FAULT_TYPE_VALUES)[number];
export type VoLocationBlock = (typeof AUSEMIO_LOCATION_BLOCK_VALUES)[number];

/** Metadata only. This type contains neither file bytes nor an assumed upstream part name. */
export interface VoAttachmentMetadata {
  originalName: string;
  sizeBytes: number;
  mediaType: string;
}

/**
 * Internal VO form semantics. This is not an AUSEMIO wire DTO and does not imply acceptance.
 * Inventory/map target identity is not present in the current local multipart contract.
 */
export interface CanonicalVoReportDraft {
  service: typeof AUSEMIO_SERVICE_VO;
  locality: string;
  detailDescription?: string;
  locationBlock?: VoLocationBlock;
  faultType?: VoFaultType;
  otherFaultText?: string;
  telephone: string;
  email: string;
  locale: 'sk' | 'en';
  attachments: readonly VoAttachmentMetadata[];
}

export type VoDraftMappingResult =
  | { ok: true; draft: CanonicalVoReportDraft }
  | { ok: false; message: string };

const validLocalities = new Set<string>(AUSEMIO_VO_LOCALITIES.map(({ value }) => value));

/**
 * Validates and maps the already-flattened local form fields into internal VO semantics.
 * Literal keys reflect the repository's local form contract; external serialization and
 * server acceptance remain unknown.
 */
export function mapLocalVoFieldsToDraft(
  fields: Readonly<Record<string, string>>,
  attachments: readonly VoAttachmentMetadata[] = []
): VoDraftMappingResult {
  const service = fields[AUSEMIO_FIELDS.service];
  if (service !== AUSEMIO_SERVICE_VO) {
    return { ok: false, message: 'Only service 2 / VO is accepted by the local test endpoint.' };
  }

  const locality = fields[AUSEMIO_FIELDS.location];
  if (!locality || !validLocalities.has(locality)) {
    return { ok: false, message: 'Select a locality from the approved VO locality list.' };
  }

  const telephone = fields[AUSEMIO_FIELDS.phone];
  if (!telephone || !telephone.trim()) {
    return { ok: false, message: 'A telephone contact is required.' };
  }

  const rawEmail = fields[AUSEMIO_FIELDS.email];
  if (!rawEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawEmail.trim())) {
    return { ok: false, message: 'A valid local email value is required.' };
  }

  const locale = fields[AUSEMIO_FIELDS.locale];
  if (!locale || !isValidSubmitLocale(locale)) {
    return { ok: false, message: 'Select a supported form locale.' };
  }

  const rawLocationBlock = fields[AUSEMIO_FIELDS.locationBlock];
  if (rawLocationBlock && !isValidLocationBlock(rawLocationBlock)) {
    return { ok: false, message: 'Select a valid VO location block code.' };
  }

  const rawFaultType = fields[AUSEMIO_FIELDS.faultType];
  if (rawFaultType && !isValidFaultType(rawFaultType)) {
    return { ok: false, message: 'Select a valid VO fault type code.' };
  }

  const rawOtherFault = fields[AUSEMIO_FIELDS.otherFault];
  if (rawOtherFault !== undefined && rawFaultType !== AUSEMIO_FAULT_TYPE_OTHER) {
    return { ok: false, message: 'Other-fault text is only valid for Q99.' };
  }

  for (const attachment of attachments) {
    if (typeof attachment.originalName !== 'string' ||
      !Number.isSafeInteger(attachment.sizeBytes) || attachment.sizeBytes < 0 ||
      typeof attachment.mediaType !== 'string') {
      return { ok: false, message: 'Attachment metadata is invalid.' };
    }
  }

  const draft: CanonicalVoReportDraft = {
    service: AUSEMIO_SERVICE_VO,
    locality,
    telephone,
    email: rawEmail.trim(),
    locale,
    attachments: attachments.map((attachment) => ({ ...attachment })),
  };
  const detailDescription = fields[AUSEMIO_FIELDS.detailDescription];
  if (detailDescription) draft.detailDescription = detailDescription;
  if (rawLocationBlock) draft.locationBlock = rawLocationBlock as VoLocationBlock;
  if (rawFaultType) draft.faultType = rawFaultType as VoFaultType;
  if (rawOtherFault) draft.otherFaultText = rawOtherFault;
  return { ok: true, draft };
}

export type VoTransportFailureKind = 'transport_rejected' | 'timed_out' | 'ambiguous';

/** A transport observation, deliberately independent of AUSEMIO response semantics. */
export type VoSubmissionObservation =
  | { kind: 'returned'; externalAcceptance: 'unknown' }
  | { kind: VoTransportFailureKind; externalAcceptance: 'unknown' };

export interface VoSubmissionTransport {
  submit(draft: CanonicalVoReportDraft): Promise<void>;
}

/** Typed classification for a future transport port; no HTTP/AUSEMIO response meaning is assigned. */
export class VoSubmissionTransportError extends Error {
  constructor(readonly kind: VoTransportFailureKind) {
    super('VO submission transport outcome is unknown.');
    this.name = 'VoSubmissionTransportError';
  }
}

/**
 * Observes an injected port. It is not wired into the application or local test sink.
 * Unknown errors are conservatively ambiguous because the write may have happened.
 */
export async function observeVoSubmissionAttempt(
  transport: VoSubmissionTransport,
  draft: CanonicalVoReportDraft
): Promise<VoSubmissionObservation> {
  try {
    await transport.submit(draft);
    return { kind: 'returned', externalAcceptance: 'unknown' };
  } catch (error) {
    const kind = error instanceof VoSubmissionTransportError ? error.kind : 'ambiguous';
    return { kind, externalAcceptance: 'unknown' };
  }
}
