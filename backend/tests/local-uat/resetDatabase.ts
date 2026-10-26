import bcrypt from 'bcrypt';
import { pool } from '../../src/db/pool.js';

function assertDisposableTarget(env: NodeJS.ProcessEnv): void {
  if (
    env.NODE_ENV !== 'development' || env.LOCAL_UAT_MODE !== 'true' ||
    env.ALLOW_DESTRUCTIVE_SEED !== 'true' || env.DB_HOST !== '127.0.0.1' ||
    env.DB_PORT !== '5433' || env.DB_NAME !== 'lighting_faults_local_uat_dev' ||
    env.DB_USER !== 'plfr_uat' || !env.ADMIN_INITIAL_PASSWORD
  ) {
    throw new Error('UAT reset refused: only the guarded loopback local UAT database can be reset.');
  }
}

async function reset(): Promise<void> {
  assertDisposableTarget(process.env);
  const passwordHash = await bcrypt.hash(process.env.ADMIN_INITIAL_PASSWORD!, 10);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`
      TRUNCATE TABLE
        email_verification_challenges,
        email_verification_rate_limits,
        inventory_audit_events,
        import_batch_rows,
        import_batches,
        admin_activity_logs,
        admin_refresh_sessions,
        integration_logs,
        fault_report_history
      RESTART IDENTITY CASCADE
    `);
    const result = await client.query(
      `UPDATE admins SET password_hash = $1 WHERE username = 'admin'`,
      [passwordHash]
    );
    if (result.rowCount !== 1) throw new Error('Local UAT admin seed is missing.');
    await client.query('COMMIT');
    console.info('Local UAT transient state cleared and the synthetic admin credential restored.');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

void reset().catch(async (error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Local UAT reset failed.');
  await pool.end();
  process.exitCode = 1;
});
