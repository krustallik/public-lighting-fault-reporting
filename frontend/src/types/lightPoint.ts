export type LightPointStatus = 'active' | 'inactive' | 'maintenance';

/** Raw row shape returned by GET /api/light-points */
export interface LightPointApiRow {
  id: number;
  external_id: string | null;
  latitude: number | string;
  longitude: number | string;
  address: string | null;
  district: string | null;
  lamp_type: string | null;
  status: LightPointStatus;
}

export interface LightPoint {
  id: number;
  inventory_number: string | null;
  latitude: number;
  longitude: number;
  address: string | null;
  type: string | null;
  status: LightPointStatus;
}

export function mapLightPointFromApi(row: LightPointApiRow): LightPoint {
  return {
    id: row.id,
    inventory_number: row.external_id,
    latitude: Number(row.latitude),
    longitude: Number(row.longitude),
    address: row.address,
    type: row.lamp_type,
    status: row.status,
  };
}

export function isValidLightPointCoords(point: Pick<LightPoint, 'latitude' | 'longitude'>): boolean {
  const { latitude, longitude } = point;
  return (
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    longitude >= -180 &&
    longitude <= 180 &&
    !(latitude === 0 && longitude === 0)
  );
}

export const STATUS_LABELS: Record<LightPointStatus, string> = {
  active: 'Aktívny',
  inactive: 'Neaktívny',
  maintenance: 'Údržba',
};
