import { pool } from '../db/pool.js';

export async function logAdminActivity(
  adminId: number | null,
  action: string,
  entityType: string | null,
  entityId: number | null,
  details: Record<string, unknown>
): Promise<void> {
  await pool.query(
    `INSERT INTO admin_activity_logs (admin_id, action, entity_type, entity_id, details, actor_username_snapshot)
     VALUES ($1, $2, $3, $4, $5,
             (SELECT username FROM admins WHERE id = $1))`,
    [adminId, action, entityType, entityId, JSON.stringify(details)]
  );
}

export async function listAdminActivityLogs(limit = 25, offset = 0) {
  const safeLimit = Math.min(100, Math.max(1, Math.trunc(limit)));
  const safeOffset = Math.max(0, Math.trunc(offset));
  const [{ rows }, count] = await Promise.all([
    pool.query(
    `SELECT l.id, l.action, l.entity_type, l.entity_id, l.created_at,
            COALESCE(l.actor_username_snapshot, a.username) AS admin_username
     FROM admin_activity_logs l
     LEFT JOIN admins a ON a.id = l.admin_id
     ORDER BY l.created_at DESC, l.id DESC
     LIMIT $1 OFFSET $2`,
    [safeLimit, safeOffset]
    ),
    pool.query<{ total: string }>('SELECT COUNT(*)::text AS total FROM admin_activity_logs'),
  ]);
  return { items: rows, total: Number(count.rows[0]?.total ?? 0), limit: safeLimit, offset: safeOffset };
}
