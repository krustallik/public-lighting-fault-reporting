import { pool } from '../db/pool.js';
import type { LightPointStatus } from '../types/lightPoint.js';
import { AppError } from '../utils/AppError.js';
import { matchingInventoryStatuses } from './adminStreetLightsFilters.js';

export type AnalyticsPeriod = '24h' | '7d' | '30d' | '90d';
export type AnalyticsOrder = 'asc' | 'desc';

const PERIOD_SECONDS: Record<AnalyticsPeriod, number> = {
  '24h': 86_400, '7d': 604_800, '30d': 2_592_000, '90d': 7_776_000,
};
const STATUSES = new Set<LightPointStatus>(['active', 'inactive', 'maintenance']);

function validatePeriod(period: string): asserts period is AnalyticsPeriod {
  if (!Object.hasOwn(PERIOD_SECONDS, period)) throw new AppError(400, 'Invalid analytics period');
}

export async function getReportAnalyticsSummary(period: string, referenceTime = new Date()) {
  validatePeriod(period);
  const { rows } = await pool.query<{
    period_start: Date | string; period_end: Date | string; total_reports: string;
    assigned_reports: string; unassigned_reports: string; orphaned_assigned_reports: string;
  }>(
    `WITH bounds AS (
       SELECT $2::timestamptz - ($1::integer * INTERVAL '1 second') AS period_start,
              $2::timestamptz AS period_end
     )
     SELECT bounds.period_start, bounds.period_end,
            COUNT(history.id)::text AS total_reports,
            COUNT(history.id) FILTER (WHERE history.target_kind = 'light-point')::text AS assigned_reports,
            COUNT(history.id) FILTER (WHERE history.target_kind <> 'light-point')::text AS unassigned_reports,
            COUNT(history.id) FILTER (WHERE history.target_kind = 'light-point' AND point.id IS NULL)::text AS orphaned_assigned_reports
       FROM bounds
       LEFT JOIN fault_report_history history
         ON history.submitted_at >= bounds.period_start AND history.submitted_at < bounds.period_end
       LEFT JOIN light_points point
         ON history.target_kind = 'light-point' AND point.id = history.light_point_id
      GROUP BY bounds.period_start, bounds.period_end`,
    [PERIOD_SECONDS[period], referenceTime]
  );
  const row = rows[0];
  return {
    period, periodStart: row ? new Date(row.period_start).toISOString() : null,
    periodEnd: row ? new Date(row.period_end).toISOString() : null,
    totalLocalReports: Number(row?.total_reports ?? 0),
    assignedToInventoryPoints: Number(row?.assigned_reports ?? 0),
    customOrManualReports: Number(row?.unassigned_reports ?? 0),
    reportsForDeletedPoints: Number(row?.orphaned_assigned_reports ?? 0),
  };
}

export interface ListReportAnalyticsQuery {
  period: string; page?: number; limit?: number; search?: string;
  status?: LightPointStatus; order?: AnalyticsOrder;
}

/** Returns every inventory point and counts only anonymous reports explicitly assigned to it. */
export async function listReportAnalytics(query: ListReportAnalyticsQuery, referenceTime = new Date()) {
  validatePeriod(query.period);
  if (query.status && !STATUSES.has(query.status)) throw new AppError(400, 'Invalid status filter');
  if (query.order && !['asc', 'desc'].includes(query.order)) throw new AppError(400, 'Invalid report-count order');
  const page = Number.isSafeInteger(query.page) && (query.page ?? 0) > 0 ? query.page! : 1;
  const limit = Math.min(100, Math.max(1, Number.isSafeInteger(query.limit) ? query.limit ?? 25 : 25));
  const offset = (page - 1) * limit;
  const order = query.order === 'asc' ? 'ASC' : 'DESC';
  const params: unknown[] = [PERIOD_SECONDS[query.period as AnalyticsPeriod], referenceTime];
  const conditions: string[] = [];
  const search = query.search?.trim().slice(0, 100) ?? '';
  if (search) {
    const term = params.push(`%${search}%`);
    const matches = [`inventory_number ILIKE $${term} OR external_id ILIKE $${term}
      OR address ILIKE $${term} OR district ILIKE $${term} OR lamp_type ILIKE $${term}`];
    const statusMatches = matchingInventoryStatuses(search);
    if (statusMatches.length) matches.push(`status = ANY($${params.push(statusMatches)}::varchar[])`);
    if (/^\d+$/.test(search) && Number(search) <= 2_147_483_647) matches.push(`id = $${params.push(Number(search))}::integer`);
    conditions.push(`(${matches.join(' OR ')})`);
  }
  if (query.status) conditions.push(`status = $${params.push(query.status)}`);

  const base = `WITH bounds AS (
       SELECT $2::timestamptz - ($1::integer * INTERVAL '1 second') AS period_start,
              $2::timestamptz AS period_end
     ), counts AS (
       SELECT point.id, point.inventory_number, point.external_id, point.address, point.district, point.lamp_type, point.status,
              COUNT(history.id)::integer AS report_count, MAX(history.submitted_at) AS last_report
         FROM light_points point CROSS JOIN bounds
         LEFT JOIN fault_report_history history
           ON history.light_point_id = point.id AND history.target_kind = 'light-point'
          AND history.submitted_at >= bounds.period_start AND history.submitted_at < bounds.period_end
        GROUP BY point.id
     ), filtered AS (
       SELECT * FROM counts ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''}
     )`;
  const count = await pool.query<{ total: string }>(`${base} SELECT COUNT(*)::text AS total FROM filtered`, params);
  const listParams = [...params, limit, offset];
  const { rows } = await pool.query(
    `${base}
     SELECT id, inventory_number, address, district, status, report_count, last_report
       FROM filtered
      ORDER BY report_count ${order}, inventory_number COLLATE "C" ASC, id ASC
      LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`,
    listParams
  );
  const total = Number(count.rows[0]?.total ?? 0);
  return { items: rows, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) || 1 } };
}
