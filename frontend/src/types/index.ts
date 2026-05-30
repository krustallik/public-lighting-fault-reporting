export type { LightPoint, LightPointApiRow, LightPointStatus } from './lightPoint';
export { STATUS_LABELS, isValidLightPointCoords, mapLightPointFromApi } from './lightPoint';
export type {
  AdminUser,
  AdminStreetLight,
  ImportPreview,
  IntegrationSettings,
} from './admin';

export interface ReportFormData {
  lightPointId: number;
  faultType: string;
  description: string;
  reporterName?: string;
  reporterEmail?: string;
  reporterPhone?: string;
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
}
