import type { Pool } from 'pg';

export async function resetE2EDatabase(pool: Pick<Pool, 'query'>): Promise<void> {
  await pool.query(`
    TRUNCATE TABLE
      email_verification_challenges,
      email_verification_rate_limits,
      import_batch_rows,
      inventory_audit_events,
      import_batches,
      admin_activity_logs,
      admin_refresh_sessions,
      integration_logs,
      light_points,
      admins
    RESTART IDENTITY CASCADE
  `);
}
