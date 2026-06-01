import type { AusemioDebugPayload } from './ausemio.js';

/** Technical metadata only — no PII (no email, phone, detail, files). */
export interface IntegrationLogTechnicalPayload {
  service: string;
  faultType: string;
  locationBlock: string;
  fileCount: number;
  locale: string;
  testMode: true;
  referenceCode: string;
  timestamp: string;
  simulatedStatus: 201;
  lightPointId?: number | null;
}

export interface IntegrationLogSimulatedResponse {
  testMode: true;
  referenceCode: string;
  timestamp: string;
  simulatedExternalStatus: 'simulated';
  httpStatus: 201;
}

export interface IntegrationResult {
  referenceCode: string;
  status: 'simulated';
  externalResponse: IntegrationLogSimulatedResponse;
  ausemioPayload: AusemioDebugPayload;
}
