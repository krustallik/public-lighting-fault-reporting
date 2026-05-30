import { pool } from '../db/pool.js';
import type { LightPointRow, LightPointStatus } from '../types/lightPoint.js';
import {
  createLightPoint,
  deleteLightPoint,
  getLightPointById,
  updateLightPoint,
} from './lightPoints.service.js';
import { AppError } from '../utils/AppError.js';

export interface ListStreetLightsQuery {
  page?: number;
  limit?: number;
  search?: string;
  status?: LightPointStatus;
  district?: string;
  sortBy?: 'id' | 'external_id' | 'address' | 'status' | 'created_at' | 'updated_at';
  sortOrder?: 'asc' | 'desc';
}

const SORT_COLUMNS: Record<string, string> = {
  id: 'id',
  external_id: 'external_id',
  address: 'address',
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

  const conditions: string[] = [];
  const params: unknown[] = [];
  let paramIndex = 1;

  if (query.search?.trim()) {
    const raw = query.search.trim();
    const term = `%${raw}%`;
    conditions.push(
      `(external_id ILIKE $${paramIndex}
        OR address ILIKE $${paramIndex}
        OR district ILIKE $${paramIndex}
        OR id::text = $${paramIndex + 1})`
    );
    params.push(term, raw);
    paramIndex += 2;
  }

  if (query.status) {
    conditions.push(`status = $${paramIndex}`);
    params.push(query.status);
    paramIndex += 1;
  }

  if (query.district?.trim()) {
    conditions.push(`district ILIKE $${paramIndex}`);
    params.push(`%${query.district.trim()}%`);
    paramIndex += 1;
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const countResult = await pool.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM light_points ${where}`,
    params
  );
  const total = Number(countResult.rows[0]?.count ?? 0);

  const listParams = [...params, limit, offset];
  const { rows } = await pool.query<LightPointRow & { created_at: Date; updated_at: Date }>(
    `SELECT id, external_id, latitude, longitude, address, district, lamp_type, status,
            created_at, updated_at
     FROM light_points
     ${where}
     ORDER BY ${sortBy} ${sortOrder}
     LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
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

export async function getStreetLightDetail(id: string | number) {
  const { rows } = await pool.query<LightPointRow & { created_at: Date; updated_at: Date }>(
    `SELECT id, external_id, latitude, longitude, address, district, lamp_type, status,
            created_at, updated_at
     FROM light_points WHERE id = $1`,
    [Number(id)]
  );
  const row = rows[0];
  if (!row) {
    throw new AppError(404, 'Street light not found');
  }
  return row;
}

export { createLightPoint, updateLightPoint, deleteLightPoint, getLightPointById };
