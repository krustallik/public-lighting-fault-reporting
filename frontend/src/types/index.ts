export type { LightPoint, LightPointApiRow, LightPointStatus } from './lightPoint';
export { STATUS_LABELS, isValidLightPointCoords, mapLightPointFromApi } from './lightPoint';
export type {
  AdminUser,
  AdminStreetLight,
  ImportPreview,
  IntegrationSettings,
} from './admin';

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  message?: string;
}

export interface HealthResponse {
  status: string;
  timestamp: string;
  service: string;
}

export interface AusemioDebugPayload {
  testMode: true;
  targetUrl: string;
  method: 'POST';
  contentType: 'multipart/form-data';
  fields: Record<string, string>;
  files: Array<{
    fieldName: 'files[]';
    originalName: string;
    size: number;
    mimeType: string;
  }>;
}

export interface SendReportResponse {
  referenceCode: string;
  status: 'simulated';
  message: string;
  ausemioPayload: AusemioDebugPayload;
}
