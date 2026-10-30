import { pool } from '../db/pool.js';
import type { LightPointRow, LightPointStatus } from '../types/lightPoint.js';
import {
  createLightPoint,
  deleteLightPoint,
  getLightPointById,
  updateLightPoint,
} from './lightPoints.service.js';
import { AppError } from '../utils/AppError.js';
import { buildStreetLightFilters } from './adminStreetLightsFilters.js';

export interface ListStreetLightsQuery {
  page?: number;
  limit?: number;
  search?: string;
  status?: LightPointStatus;
  district?: string;
  districtMissing?: boolean;
  lampType?: string;
  lampTypeMissing?: boolean;
  sortBy?: 'id' | 'inventory_number' | 'external_id' | 'address' | 'district' | 'lamp_type' | 'status' | 'created_at' | 'updated_at';
  sortOrder?: 'asc' | 'desc';
}

const SORT_COLUMNS: Record<string, string> = {
  id: 'id',
  inventory_number: 'inventory_number COLLATE "C"',
  external_id: 'external_id',
  address: 'address',
  district: `NULLIF(BTRIM(district), '') COLLATE "C"`,
  lamp_type: `NULLIF(BTRIM(lamp_type), '') COLLATE "C"`,
  status: 'status',
  created_at: 'created_at',
  updated_at: 'updated_at',
};

export async function listStreetLights(query: ListStreetLightsQuery) {
  const page = Math.max(1, query.page ?? 1);
  const limit = Math.min(100, Math.max(1, query.limit ?? 20));
  const offset = (page - 1) * limit;
  const sortBy = SORT_COLUMNS[query.sortBy ?? 'id'] ?? 'id';
  const sortOrder = query.sortOrder === 'desc' ? 'DESC' : 'ASC';

  const { where, params } = buildStreetLightFilters(query);
  const pageParamIndex = params.length + 1;

  const countResult = await pool.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM light_points ${where}`,
    params
  );
  const total = Number(countResult.rows[0]?.count ?? 0);

  const listParams = [...params, limit, offset];
  const { rows } = await pool.query<LightPointRow & { created_at: Date; updated_at: Date }>(
    `SELECT id, inventory_number, external_id, ST_Y(geom)::text AS latitude, ST_X(geom)::text AS longitude, address, district, lamp_type, status,
            created_at, updated_at
     FROM light_points
     ${where}
     ORDER BY ${sortBy} ${sortOrder} NULLS LAST, id ASC
     LIMIT $${pageParamIndex} OFFSET $${pageParamIndex + 1}`,
    listParams
  );

  return {
    items: rows,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit) || 1,
    },
  };
}

export interface StreetLightFilterOptions {
  lampTypes: string[];
  hasMissingLampType: boolean;
  districts: string[];
  hasMissingDistrict: boolean;
  hasMoreLampTypes: boolean;
  hasMoreDistricts: boolean;
  statuses: Array<{ value: LightPointStatus; label: string }>;
}

export async function getStreetLightFilterOptions(): Promise<StreetLightFilterOptions> {
  const { rows } = await pool.query<{
    lamp_types: string[] | null;
    districts: string[] | null;
    has_missing_district: boolean;
    has_missing_lamp_type: boolean;
    lamp_type_count: string;
    district_count: string;
    statuses: LightPointStatus[] | null;
  }>(
    `SELECT
       COALESCE((SELECT array_agg(options.value ORDER BY options.value COLLATE "C") FROM (
         SELECT distinct_options.value FROM (
           SELECT DISTINCT BTRIM(lamp_type) AS value FROM light_points
            WHERE lamp_type IS NOT NULL AND BTRIM(lamp_type) <> '' AND LENGTH(BTRIM(lamp_type)) <= 120
         ) distinct_options
         ORDER BY distinct_options.value COLLATE "C" LIMIT 101
       ) options), ARRAY[]::text[]) AS lamp_types,
       COALESCE((SELECT array_agg(options.value ORDER BY options.value COLLATE "C") FROM (
         SELECT distinct_options.value FROM (
           SELECT DISTINCT BTRIM(district) AS value FROM light_points
            WHERE district IS NOT NULL AND BTRIM(district) <> '' AND LENGTH(BTRIM(district)) <= 120
         ) distinct_options
         ORDER BY distinct_options.value COLLATE "C" LIMIT 101
       ) options), ARRAY[]::text[]) AS districts,
       EXISTS (SELECT 1 FROM light_points WHERE district IS NULL OR BTRIM(district) = '') AS has_missing_district,
       EXISTS (SELECT 1 FROM light_points WHERE lamp_type IS NULL OR BTRIM(lamp_type) = '') AS has_missing_lamp_type,
       (SELECT COUNT(DISTINCT BTRIM(lamp_type)) FROM light_points
         WHERE lamp_type IS NOT NULL AND BTRIM(lamp_type) <> '')::text AS lamp_type_count,
       (SELECT COUNT(DISTINCT BTRIM(district)) FROM light_points
         WHERE district IS NOT NULL AND BTRIM(district) <> '')::text AS district_count,
       COALESCE((SELECT array_agg(DISTINCT status ORDER BY status) FROM light_points
         WHERE status = ANY(ARRAY['active', 'inactive', 'maintenance']::varchar[])), ARRAY[]::varchar[]) AS statuses`
  );
  const row = rows[0];
  const lampTypes = row?.lamp_types ?? [];
  const districts = row?.districts ?? [];
  return {
    lampTypes: lampTypes.slice(0, 100),
    hasMissingLampType: row?.has_missing_lamp_type ?? false,
    districts: districts.slice(0, 100),
    hasMissingDistrict: row?.has_missing_district ?? false,
    hasMoreLampTypes: Number(row?.lamp_type_count ?? 0) > 100,
    hasMoreDistricts: Number(row?.district_count ?? 0) > 100,
    statuses: (row?.statuses ?? []).map((value) => ({ value, label: ({ active: 'Aktívny', inactive: 'Neaktívny', maintenance: 'Údržba' } as const)[value] })),
  };
}

export async function getStreetLightDetail(id: string | number) {
  const numericId = Number(id);
  if (!Number.isSafeInteger(numericId) || numericId <= 0) {
    throw new AppError(400, 'Invalid street light id');
  }
  const { rows } = await pool.query<LightPointRow & { created_at: Date; updated_at: Date }>(
    `SELECT id, inventory_number, external_id, ST_Y(geom)::text AS latitude, ST_X(geom)::text AS longitude, address, district, lamp_type, status,
            created_at, updated_at
     FROM light_points WHERE id = $1`,
    [numericId]
  );
  const row = rows[0];
  if (!row) {
    throw new AppError(404, 'Street light not found');
  }
  return row;
}

export { createLightPoint, updateLightPoint, deleteLightPoint, getLightPointById };
