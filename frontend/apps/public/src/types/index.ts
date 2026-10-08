export type { LightPoint, LightPointApiRow } from './lightPoint';
export type { LightPointStatus } from '@shared/LightPointStatus';
export { isValidLightPointCoords, mapLightPointFromApi } from './lightPoint';
export type { LocalTestSubmitResponse, LocalTestSubmitErrorResponse } from './localTestSubmit';

export interface HealthResponse {
  status: string;
  timestamp: string;
  service: string;
}
