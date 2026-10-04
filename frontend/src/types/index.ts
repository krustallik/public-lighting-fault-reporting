export type { LightPoint, LightPointApiRow, LightPointStatus } from './lightPoint';
export { STATUS_LABELS, isValidLightPointCoords, mapLightPointFromApi } from './lightPoint';
export type { LocalTestSubmitResponse, LocalTestSubmitErrorResponse } from './localTestSubmit';
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
