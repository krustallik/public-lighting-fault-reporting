import type { AusemioDebugPayload } from './ausemio.js';

/** File metadata from client (names only — no binary upload yet). */
export interface ReportFileMetadata {
  name: string;
  size?: number;
  mimeType?: string;
}

/** Incoming report payload from frontend — forwarded to AUSEMIO/DPMK, not stored locally. */
export interface ReportPayload {
  lightPointId?: number;
  service?: string;
  streetOrLocation?: string;
  detailDescription?: string;
  locationBlock?: string;
  faultType?: string;
  otherFaultText?: string;
  phone?: string;
  email?: string;
  failureOn?: string;
  consent?: boolean;
  locale?: string;
  files?: ReportFileMetadata[];
}

/** Validated payload ready for in-memory AUSEMIO mapping (PII not persisted). */
export interface NormalizedReportPayload {
  lightPointId?: number;
  service: '2';
  streetOrLocation: string;
  detailDescription: string;
  locationBlock: string;
  faultType: string;
  otherFaultText?: string;
  phone?: string;
  email: string;
  failureOn?: string;
  consent: true;
  locale: string;
  files: ReportFileMetadata[];
}

export interface SendReportResult {
  referenceCode: string;
  status: 'simulated';
  message: string;
  ausemioPayload: AusemioDebugPayload;
}

export const REPORT_DEFAULTS = {
  service: '2',
  locale: 'sk',
} as const;

export const SIMULATED_REPORT_MESSAGE =
  'Report accepted in test mode — not sent to real AUSEMIO/DPMK';
