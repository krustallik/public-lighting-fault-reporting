import { pool } from '../db/pool.js';

export interface AdminDashboardRecentReport {
  id: string;
  submitted_at: string;
  locality: string;
  target_kind: 'light-point' | 'custom' | 'device' | 'manual';
  light_point_id: number | null;
  latitude: number | null;
  longitude: number | null;
  fault_type_code: string | null;
  automatic_notes: string[];
}

export async function getAdminDashboardOverview() {
  const [metrics, recent] = await Promise.all([
    pool.query<{
      inventory_total: string;
      reports_24h: string;
      reports_7d: string;
      reports_30d: string;
    }>(
      `WITH bounds AS (SELECT clock_timestamp() AS now)
       SELECT
         (SELECT COUNT(*)::text FROM light_points) AS inventory_total,
         COUNT(*) FILTER (WHERE history.submitted_at >= bounds.now - INTERVAL '24 hours')::text AS reports_24h,
         COUNT(*) FILTER (WHERE history.submitted_at >= bounds.now - INTERVAL '7 days')::text AS reports_7d,
         COUNT(*) FILTER (WHERE history.submitted_at >= bounds.now - INTERVAL '30 days')::text AS reports_30d
       FROM bounds
       LEFT JOIN fault_report_history history ON history.submitted_at <= bounds.now`
    ),
    pool.query<AdminDashboardRecentReport>(
      `SELECT id::text, submitted_at, locality, target_kind, light_point_id,
              ST_Y(target_geom)::float8 AS latitude, ST_X(target_geom)::float8 AS longitude,
              fault_type_code, automatic_notes
         FROM fault_report_history
        ORDER BY submitted_at DESC, id DESC
        LIMIT 8`
    ),
  ]);

  const row = metrics.rows[0];
  return {
    inventoryTotal: Number(row?.inventory_total ?? 0),
    reports24h: Number(row?.reports_24h ?? 0),
    reports7d: Number(row?.reports_7d ?? 0),
    reports30d: Number(row?.reports_30d ?? 0),
    recent: recent.rows,
  };
}
