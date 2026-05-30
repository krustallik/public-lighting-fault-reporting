import type { ApiResponse } from '@/types';
import type { LightPoint, LightPointApiRow } from '@/types/lightPoint';
import { isValidLightPointCoords, mapLightPointFromApi } from '@/types/lightPoint';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';

export async function getLightPoints(): Promise<LightPoint[]> {
  const response = await fetch(`${API_BASE}/light-points`);

  if (!response.ok) {
    throw new Error(`Načítanie svetelných bodov zlyhalo (${response.status})`);
  }

  const body = (await response.json()) as ApiResponse<LightPointApiRow[]>;

  if (!body.success || !body.data) {
    throw new Error(body.message ?? 'Neplatná odpoveď servera');
  }

  return body.data
    .map(mapLightPointFromApi)
    .filter(isValidLightPointCoords);
}

export async function getLightPoint(id: number): Promise<LightPoint> {
  const response = await fetch(`${API_BASE}/light-points/${id}`);

  if (!response.ok) {
    throw new Error(`Svetelný bod sa nenašiel (${response.status})`);
  }

  const body = (await response.json()) as ApiResponse<LightPointApiRow>;

  if (!body.success || !body.data) {
    throw new Error(body.message ?? 'Neplatná odpoveď servera');
  }

  const point = mapLightPointFromApi(body.data);
  if (!isValidLightPointCoords(point)) {
    throw new Error('Svetelný bod má neplatné súradnice');
  }

  return point;
}
