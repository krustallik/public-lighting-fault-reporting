import { pool } from '../db/pool.js';
import type {
  CreateLightPointInput,
  LightPointRow,
  UpdateLightPointInput,
} from '../types/lightPoint.js';
import { config } from '../config/index.js';
import { AppError } from '../utils/AppError.js';
import { reverseGeocode } from './geocoding.service.js';

const LIGHT_POINT_COLUMNS = `
  id, external_id, latitude, longitude, address, district, lamp_type, status
`;

/** Assign address from coordinates when missing (Nominatim → DB). */
export async function ensureLightPointAddress(
  id: number,
  force = false,
  manual = false
): Promise<string | null> {
  if (!config.geocoding.autoGeocode && !force && !manual) {
    const current = await getLightPointById(id);
    return current?.address ?? null;
  }
  const { rows } = await pool.query<{
    id: number;
    latitude: string;
    longitude: string;
    address_geocoded_at: Date | null;
  }>(
    `SELECT id, latitude, longitude, address_geocoded_at
     FROM light_points WHERE id = $1`,
    [id]
  );

  const row = rows[0];
  if (!row) {
    throw new AppError(404, 'Light point not found');
  }

  if (!force && row.address_geocoded_at) {
    const current = await getLightPointById(id);
    return current?.address ?? null;
  }

  const lat = Number(row.latitude);
  const lng = Number(row.longitude);
  const { address } = await reverseGeocode(lat, lng);

  await pool.query(
    `UPDATE light_points
     SET address = $1, address_geocoded_at = NOW(), updated_at = NOW()
     WHERE id = $2`,
    [address, id]
  );

  return address;
}

/** Geocode all light points that do not have address_geocoded_at yet. */
export async function geocodePendingLightPoints(manual = false): Promise<number> {
  if (!config.geocoding.autoGeocode && !manual) {
    return 0;
  }

  const { rows } = await pool.query<{ id: number }>(
    `SELECT id FROM light_points
     WHERE address_geocoded_at IS NULL
     ORDER BY id`
  );

  let updated = 0;

  for (const row of rows) {
    try {
      await ensureLightPointAddress(row.id, false, manual);
      updated += 1;
      console.log(`Geocoded light point ${row.id}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`Geocoding failed for light point ${row.id}:`, message);
    }
  }

  return updated;
}

export async function getAllLightPoints(): Promise<LightPointRow[]> {
  const { rows } = await pool.query<LightPointRow>(
    `SELECT ${LIGHT_POINT_COLUMNS}
     FROM light_points
     ORDER BY id`
  );
  return rows;
}

export async function getLightPointById(id: string | number): Promise<LightPointRow | null> {
  const numericId = Number(id);
  if (!Number.isFinite(numericId)) {
    return null;
  }

  const { rows } = await pool.query<LightPointRow>(
    `SELECT ${LIGHT_POINT_COLUMNS}
     FROM light_points WHERE id = $1`,
    [numericId]
  );
  return rows[0] ?? null;
}

export async function createLightPoint(input: CreateLightPointInput): Promise<LightPointRow> {
  const status = input.status ?? 'active';

  const { rows } = await pool.query<{ id: number }>(
    `INSERT INTO light_points (
       external_id, latitude, longitude, address, district, lamp_type, status
     ) VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id`,
    [
      input.external_id ?? null,
      input.latitude,
      input.longitude,
      input.address ?? null,
      input.district ?? null,
      input.lamp_type ?? null,
      status,
    ]
  );

  const id = rows[0].id;
  await ensureLightPointAddress(id);

  const point = await getLightPointById(id);
  if (!point) {
    throw new AppError(500, 'Failed to load created light point');
  }

  return point;
}

export async function updateLightPoint(
  id: string | number,
  input: UpdateLightPointInput
): Promise<LightPointRow> {
  const existing = await getLightPointById(id);
  if (!existing) {
    throw new AppError(404, 'Light point not found');
  }

  const numericId = Number(id);
  const latitude = input.latitude ?? Number(existing.latitude);
  const longitude = input.longitude ?? Number(existing.longitude);
  const coordsChanged =
    (input.latitude !== undefined && input.latitude !== Number(existing.latitude)) ||
    (input.longitude !== undefined && input.longitude !== Number(existing.longitude));

  await pool.query(
    `UPDATE light_points SET
       external_id = COALESCE($2, external_id),
       latitude = $3,
       longitude = $4,
       address = CASE WHEN $9 THEN NULL ELSE COALESCE($5, address) END,
       address_geocoded_at = CASE WHEN $9 THEN NULL ELSE address_geocoded_at END,
       district = COALESCE($6, district),
       lamp_type = COALESCE($7, lamp_type),
       status = COALESCE($8, status),
       updated_at = NOW()
     WHERE id = $1`,
    [
      numericId,
      input.external_id ?? null,
      latitude,
      longitude,
      input.address ?? null,
      input.district ?? null,
      input.lamp_type ?? null,
      input.status ?? null,
      coordsChanged,
    ]
  );

  if (coordsChanged || !existing.address) {
    await ensureLightPointAddress(numericId, coordsChanged);
  } else {
    await ensureLightPointAddress(numericId);
  }

  const point = await getLightPointById(numericId);
  if (!point) {
    throw new AppError(500, 'Failed to load updated light point');
  }

  return point;
}

export async function deleteLightPoint(id: string | number): Promise<{ id: number; deleted: true }> {
  const existing = await getLightPointById(id);
  if (!existing) {
    throw new AppError(404, 'Light point not found');
  }

  await pool.query('DELETE FROM light_points WHERE id = $1', [Number(id)]);
  return { id: Number(id), deleted: true };
}
