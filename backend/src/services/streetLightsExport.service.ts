import { pool } from '../db/pool.js';
import type { ListStreetLightsQuery } from './adminStreetLights.service.js';

function escapeCsv(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export async function exportStreetLights(
  format: 'csv' | 'json' | 'geojson',
  filters: ListStreetLightsQuery
): Promise<{ contentType: string; body: string; filename: string }> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  let paramIndex = 1;

  if (filters.search?.trim()) {
    const term = `%${filters.search.trim()}%`;
    conditions.push(
      `(external_id ILIKE $${paramIndex} OR address ILIKE $${paramIndex} OR district ILIKE $${paramIndex})`
    );
    params.push(term);
    paramIndex += 1;
  }

  if (filters.status) {
    conditions.push(`status = $${paramIndex}`);
    params.push(filters.status);
    paramIndex += 1;
  }

  if (filters.district?.trim()) {
    conditions.push(`district ILIKE $${paramIndex}`);
    params.push(`%${filters.district.trim()}%`);
    paramIndex += 1;
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const { rows } = await pool.query<{
    id: number;
    external_id: string | null;
    latitude: string;
    longitude: string;
    address: string | null;
    district: string | null;
    lamp_type: string | null;
    status: string;
    created_at: Date;
    updated_at: Date;
  }>(
    `SELECT id, external_id, latitude, longitude, address, district, lamp_type, status, created_at, updated_at
     FROM light_points ${where}
     ORDER BY id`,
    params
  );

  const timestamp = new Date().toISOString().slice(0, 10);

  if (format === 'json') {
    const mapped = rows.map(mapExportRow);
    return {
      contentType: 'application/json',
      filename: `street-lights-${timestamp}.json`,
      body: JSON.stringify(mapped, null, 2),
    };
  }

  if (format === 'geojson') {
    const features = rows.map((row) => ({
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: [Number(row.longitude), Number(row.latitude)],
      },
      properties: {
        id: row.id,
        inventoryNumber: row.external_id,
        address: row.address,
        district: row.district,
        lampType: row.lamp_type,
        status: row.status,
      },
    }));
    return {
      contentType: 'application/geo+json',
      filename: `street-lights-${timestamp}.geojson`,
      body: JSON.stringify({ type: 'FeatureCollection', features }, null, 2),
    };
  }

  const header = 'inventoryNumber,latitude,longitude,address,district,lampType,status';
  const lines = rows.map((row) => {
    const m = mapExportRow(row);
    return [
      escapeCsv(m.inventoryNumber ?? ''),
      m.latitude,
      m.longitude,
      escapeCsv(m.address ?? ''),
      escapeCsv(m.district ?? ''),
      escapeCsv(m.lampType ?? ''),
      m.status,
    ].join(',');
  });

  return {
    contentType: 'text/csv',
    filename: `street-lights-${timestamp}.csv`,
    body: [header, ...lines].join('\n'),
  };
}

function mapExportRow(row: {
  id: number;
  external_id: string | null;
  latitude: string;
  longitude: string;
  address: string | null;
  district: string | null;
  lamp_type: string | null;
  status: string;
}) {
  return {
    id: row.id,
    inventoryNumber: row.external_id,
    latitude: Number(row.latitude),
    longitude: Number(row.longitude),
    address: row.address,
    district: row.district,
    lampType: row.lamp_type,
    status: row.status,
  };
}
