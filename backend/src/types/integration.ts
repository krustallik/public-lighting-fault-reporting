import type { AusemioDebugPayload } from './ausemio.js';

export interface IntegrationLogTechnicalPayload {
  lightPointId: number | null;
  faultType: string;
  service: string;
  locationBlock: string;
  fileCount: number;
  ausemioLocale: string;
  testMode: true;
  referenceCode: string;
  timestamp: string;
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
