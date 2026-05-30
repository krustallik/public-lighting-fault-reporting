import { pool } from '../db/pool.js';

export async function logAdminActivity(
  adminId: number | null,
  action: string,
  entityType: string | null,
  entityId: number | null,
  details: Record<string, unknown>
): Promise<void> {
  await pool.query(
    `INSERT INTO admin_activity_logs (admin_id, action, entity_type, entity_id, details)
     VALUES ($1, $2, $3, $4, $5)`,
    [adminId, action, entityType, entityId, JSON.stringify(details)]
  );
}

export async function listAdminActivityLogs(limit = 50) {
  const { rows } = await pool.query(
    `SELECT l.id, l.action, l.entity_type, l.entity_id, l.details, l.created_at,
            a.username AS admin_username
     FROM admin_activity_logs l
     LEFT JOIN admins a ON a.id = l.admin_id
     ORDER BY l.created_at DESC
     LIMIT $1`,
    [limit]
  );
  return rows;
}
