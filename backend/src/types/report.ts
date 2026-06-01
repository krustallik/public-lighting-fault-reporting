import type { AusemioDebugPayload } from './ausemio.js';

export interface SendReportResult {
  referenceCode: string;
  status: 'simulated';
  message: string;
  ausemioPayload: AusemioDebugPayload;
}

export const SIMULATED_REPORT_MESSAGE =
  'Report accepted in test mode — not sent to real AUSEMIO/DPMK';
