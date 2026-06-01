export type { LightPoint, LightPointApiRow, LightPointStatus } from './lightPoint';
export { STATUS_LABELS, isValidLightPointCoords, mapLightPointFromApi } from './lightPoint';
export type {
  AdminUser,
  AdminStreetLight,
  ImportPreview,
  IntegrationSettings,
} from './admin';

/** Payload sent to POST /api/reports/send (JSON; files prepared client-side only for now). */
export interface ReportFormData {
  lightPointId: number;
  service: string;
  streetOrLocation: string;
  detailDescription?: string;
  locationBlock: string;
  faultType: string;
  otherFaultText?: string;
  phone?: string;
  failureOn?: string;
  email: string;
  consent: boolean;
  locale?: string;
  files?: Array<{ name: string; size?: number; mimeType?: string }>;
}

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

export interface SendReportResponse {
  referenceCode: string;
  status: string;
  message: string;
  ausemioPayload?: {
    testMode: true;
    targetUrl: string;
    method: 'POST';
    contentType: 'multipart/form-data';
    fields: Record<string, string>;
    files: Array<{
      fieldName: 'files[]';
      name: string;
      size: number;
      mimeType: string;
    }>;
  };
}
