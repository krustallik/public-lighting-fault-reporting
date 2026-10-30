import type { LightPointStatus } from '../types/lightPoint.js';
import { AppError } from '../utils/AppError.js';

export interface StreetLightFilters {
  search?: string;
  status?: LightPointStatus;
  district?: string;
  districtMissing?: boolean;
  lampType?: string;
  lampTypeMissing?: boolean;
}

const VALID_STATUSES = new Set<LightPointStatus>(['active', 'inactive', 'maintenance']);
const STATUS_SEARCH_LABELS: Record<LightPointStatus, string> = {
  active: 'Aktívny', inactive: 'Neaktívny', maintenance: 'Údržba',
};

function normalizeSearch(value: string): string {
  return value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLocaleLowerCase('sk-SK');
}

export function matchingInventoryStatuses(value: string): LightPointStatus[] {
  const normalized = normalizeSearch(value);
  return (Object.keys(STATUS_SEARCH_LABELS) as LightPointStatus[])
    .filter((status) => normalizeSearch(status).includes(normalized) || normalizeSearch(STATUS_SEARCH_LABELS[status]).includes(normalized));
}

/** Shared parameterized filters keep list and export results identical. */
export function buildStreetLightFilters(filters: StreetLightFilters): { where: string; params: unknown[] } {
  const conditions: string[] = [];
  const params: unknown[] = [];
  const search = filters.search?.trim().slice(0, 100) ?? '';

  if (search) {
    const termIndex = params.push(`%${search}%`);
    const searchAlternatives = [`inventory_number ILIKE $${termIndex}
      OR external_id ILIKE $${termIndex}
      OR address ILIKE $${termIndex}
      OR district ILIKE $${termIndex}
      OR lamp_type ILIKE $${termIndex}`];
    const statusMatches = matchingInventoryStatuses(search);
    if (statusMatches.length) searchAlternatives.push(`status = ANY($${params.push(statusMatches)}::varchar[])`);
    if (/^\d+$/.test(search) && Number(search) <= 2_147_483_647) {
      searchAlternatives.push(`id = $${params.push(Number(search))}::integer`);
    }
    conditions.push(`(${searchAlternatives.join(' OR ')})`);
  }

  if (filters.status) {
    if (!VALID_STATUSES.has(filters.status)) throw new AppError(400, 'Invalid status filter');
    conditions.push(`status = $${params.push(filters.status)}`);
  }

  if (filters.districtMissing) {
    conditions.push(`(district IS NULL OR BTRIM(district) = '')`);
  } else if (filters.district?.trim()) {
    conditions.push(`BTRIM(district) = $${params.push(filters.district.trim())}`);
  }

  if (filters.lampType?.trim()) {
    conditions.push(`BTRIM(lamp_type) = $${params.push(filters.lampType.trim())}`);
  } else if (filters.lampTypeMissing) {
    conditions.push(`(lamp_type IS NULL OR BTRIM(lamp_type) = '')`);
  }

  return { where: conditions.length ? `WHERE ${conditions.join(' AND ')}` : '', params };
}
