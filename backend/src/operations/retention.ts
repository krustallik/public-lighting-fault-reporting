import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { isIP } from 'node:net';
import { RETENTION_ADVISORY_LOCK } from '../db/advisoryLockIds.js';

export const RETENTION_CHUNK_SIZE = 500;
export const RETENTION_MAX_CHUNKS_PER_TABLE = 100;
export const RETENTION_LOCK_TIMEOUT_MS = 2000;
export const RETENTION_STATEMENT_TIMEOUT_MS = 10000;
export const RETENTION_MAX_CONFIGURED_CHUNKS_PER_TABLE = 100;

export interface RetentionCounts {
  admin_activity_logs: number;
  inventory_audit_events: number;
  admin_refresh_sessions: number;
  admin_activity_logs_eligible: number;
  inventory_audit_events_eligible: number;
  admin_refresh_sessions_eligible: number;
  deferred_import_batches: number;
  import_batches_missing_completion: number;
  import_batches_with_pending_rows: number;
  import_batches_referenced_by_retained_audit: number;
  chunks: number;
}

export interface RetentionResultV1 {
  result_version: 1;
  phase: 'retention';
  run_id: string;
  state: 'complete' | 'success_with_backlog' | 'skipped_overlapping' | 'incomplete';
  exit_code: number;
  reason_code: string;
  run_started_at_utc: string;
  run_finished_at_utc: string;
  cutoff_utc: string | null;
  counts: RetentionCounts;
  app_build_sha: string;
}

export interface RetentionOptions {
  appBuildSha: string;
  runId?: string;
  nowForTest?: () => Date;
  maxChunksPerTable?: number;
}

function assertOfflineDisposablePool(pool: Pool): void {
  if (process.env.NODE_ENV === 'production') throw new Error('production_retention_not_approved');
  if (process.env.DATABASE_OPERATIONS_MODE !== 'offline-test') throw new Error('offline_test_mode_required');
  const host = pool.options.host;
  const database = pool.options.database;
  const ipVersion = typeof host === 'string' ? isIP(host) : 0;
  if ((ipVersion !== 4 || host !== '127.0.0.1') && (ipVersion !== 6 || host !== '::1')) {
    throw new Error('retention_requires_loopback_disposable_test_database');
  }
  if (typeof database !== 'string' || !/_test$/i.test(database)) {
    throw new Error('retention_requires_loopback_disposable_test_database');
  }
}

function emptyCounts(): RetentionCounts {
  return {
    admin_activity_logs: 0,
    inventory_audit_events: 0,
    admin_refresh_sessions: 0,
    admin_activity_logs_eligible: 0,
    inventory_audit_events_eligible: 0,
    admin_refresh_sessions_eligible: 0,
    deferred_import_batches: 0,
    import_batches_missing_completion: 0,
    import_batches_with_pending_rows: 0,
    import_batches_referenced_by_retained_audit: 0,
    chunks: 0,
  };
}

export function utcCalendarYearCutoff(value: Date): Date {
  if (!Number.isFinite(value.getTime())) throw new Error('retention_clock_invalid');
  const year = value.getUTCFullYear() - 1;
  const month = value.getUTCMonth();
  const day = Math.min(value.getUTCDate(), new Date(Date.UTC(year, month + 1, 0)).getUTCDate());
  return new Date(Date.UTC(year, month, day, value.getUTCHours(), value.getUTCMinutes(), value.getUTCSeconds(), value.getUTCMilliseconds()));
}

async function deleteChunk(client: PoolClient, table: 'admin_activity_logs' | 'inventory_audit_events' | 'admin_refresh_sessions', timestampColumn: 'created_at' | 'expires_at', cutoff: Date): Promise<number> {
  await client.query('BEGIN');
  try {
    await client.query(`SET LOCAL lock_timeout = '${RETENTION_LOCK_TIMEOUT_MS}ms'`);
    await client.query(`SET LOCAL statement_timeout = '${RETENTION_STATEMENT_TIMEOUT_MS}ms'`);
    const result = await client.query<{ id: number }>(
      `WITH candidates AS (
         SELECT id FROM public.${table}
          WHERE ${timestampColumn} < $1
          ORDER BY ${timestampColumn} ASC, id ASC
          LIMIT $2
       )
       DELETE FROM public.${table} AS target
        USING candidates
        WHERE target.id = candidates.id
          AND target.${timestampColumn} < $1
        RETURNING target.id`,
      [cutoff, RETENTION_CHUNK_SIZE],
    );
    await client.query('COMMIT');
    return result.rowCount ?? 0;
  } catch {
    await client.query('ROLLBACK').catch(() => undefined);
    throw new Error('retention_chunk_failed');
  }
}

async function processTable(
  client: PoolClient,
  table: 'admin_activity_logs' | 'inventory_audit_events' | 'admin_refresh_sessions',
  timestampColumn: 'created_at' | 'expires_at',
  cutoff: Date,
  counts: RetentionCounts,
  maxChunks: number,
): Promise<void> {
  for (let chunk = 0; chunk < maxChunks; chunk += 1) {
    const removed = await deleteChunk(client, table, timestampColumn, cutoff);
    if (removed === 0) return;
    counts[table] += removed;
    counts.chunks += 1;
  }
}

async function inspectBacklog(client: PoolClient, cutoff: Date, startedAt: Date, counts: RetentionCounts): Promise<void> {
  const result = await client.query<{
    old_admin_activity: string;
    old_inventory_audit: string;
    expired_sessions: string;
    eligible: string;
    missing_completion: string;
    pending_rows: string;
    retained_audit: string;
  }>(
    `SELECT
       (SELECT count(*) FROM public.admin_activity_logs WHERE created_at < $1)::text AS old_admin_activity,
       (SELECT count(*) FROM public.inventory_audit_events WHERE created_at < $1)::text AS old_inventory_audit,
       (SELECT count(*) FROM public.admin_refresh_sessions WHERE expires_at < $2)::text AS expired_sessions,
       count(*) FILTER (WHERE b.completed_at < $1
         AND NOT EXISTS (SELECT 1 FROM public.import_batch_rows r WHERE r.batch_id = b.id AND r.outcome = 'pending')
         AND NOT EXISTS (SELECT 1 FROM public.inventory_audit_events e WHERE e.import_batch_id = b.id))::text AS eligible,
       count(*) FILTER (WHERE b.completed_at IS NULL)::text AS missing_completion,
       count(*) FILTER (WHERE b.completed_at < $1
         AND EXISTS (SELECT 1 FROM public.import_batch_rows r WHERE r.batch_id = b.id AND r.outcome = 'pending'))::text AS pending_rows,
       count(*) FILTER (WHERE b.completed_at < $1
         AND EXISTS (SELECT 1 FROM public.inventory_audit_events e WHERE e.import_batch_id = b.id))::text AS retained_audit
      FROM public.import_batches b
     WHERE b.status IN ('completed', 'completed_with_errors', 'failed', 'system_failed')`,
    [cutoff, startedAt],
  );
  const row = result.rows[0];
  if (!row) throw new Error('retention_backlog_inspection_failed');
  counts.admin_activity_logs_eligible = Number(row.old_admin_activity);
  counts.inventory_audit_events_eligible = Number(row.old_inventory_audit);
  counts.admin_refresh_sessions_eligible = Number(row.expired_sessions);
  counts.deferred_import_batches = Number(row.eligible);
  counts.import_batches_missing_completion = Number(row.missing_completion);
  counts.import_batches_with_pending_rows = Number(row.pending_rows);
  counts.import_batches_referenced_by_retained_audit = Number(row.retained_audit);
}

export async function runRetentionOnce(pool: Pool, options: RetentionOptions): Promise<RetentionResultV1> {
  assertOfflineDisposablePool(pool);
  const runId = options.runId ?? randomUUID();
  const counts = emptyCounts();
  let initial = new Date().toISOString();
  let client: PoolClient | undefined;
  let lockHeld = false;
  let cutoff: Date | null = null;
  let reason = 'retention_completed';
  let state: RetentionResultV1['state'] = 'complete';
  let exitCode = 0;
  const maxChunks = options.maxChunksPerTable ?? RETENTION_MAX_CHUNKS_PER_TABLE;
  if (!Number.isSafeInteger(maxChunks) || maxChunks < 1 || maxChunks > RETENTION_MAX_CONFIGURED_CHUNKS_PER_TABLE) {
    return {
      result_version: 1, phase: 'retention', run_id: runId, state: 'incomplete', exit_code: 1,
      reason_code: 'retention_chunk_bound_invalid', run_started_at_utc: initial,
      run_finished_at_utc: new Date().toISOString(), cutoff_utc: null, counts, app_build_sha: options.appBuildSha,
    };
  }
  try {
    client = await pool.connect();
    const lock = await client.query<{ locked: boolean }>(
      'SELECT pg_try_advisory_lock($1, $2) AS locked', [RETENTION_ADVISORY_LOCK.namespace, RETENTION_ADVISORY_LOCK.key],
    );
    if (lock.rows[0]?.locked !== true) {
      state = 'skipped_overlapping';
      exitCode = 10;
      reason = 'retention_already_running';
    } else {
      lockHeld = true;
      let startedAt: Date;
      let capturedCutoff: Date;
      if (options.nowForTest) {
        startedAt = options.nowForTest();
        capturedCutoff = utcCalendarYearCutoff(startedAt);
      } else {
        const captured = (await client.query<{ started_at: Date; cutoff_utc: Date }>(
          `SELECT transaction_timestamp() AS started_at,
                  ((transaction_timestamp() AT TIME ZONE 'UTC') - INTERVAL '1 year') AT TIME ZONE 'UTC' AS cutoff_utc`,
        )).rows[0];
        if (!captured) throw new Error('retention_clock_unavailable');
        startedAt = captured.started_at;
        capturedCutoff = captured.cutoff_utc;
      }
      if (!(startedAt instanceof Date) || !Number.isFinite(startedAt.getTime())) throw new Error('retention_clock_unavailable');
      initial = startedAt.toISOString();
      cutoff = capturedCutoff instanceof Date && Number.isFinite(capturedCutoff.getTime()) ? capturedCutoff : null;
      if (!cutoff) throw new Error('retention_cutoff_unavailable');
      await processTable(client, 'admin_activity_logs', 'created_at', cutoff, counts, maxChunks);
      await processTable(client, 'inventory_audit_events', 'created_at', cutoff, counts, maxChunks);
      await processTable(client, 'admin_refresh_sessions', 'expires_at', startedAt, counts, maxChunks);
      await inspectBacklog(client, cutoff, startedAt, counts);
      const importBacklog = counts.deferred_import_batches + counts.import_batches_missing_completion
        + counts.import_batches_with_pending_rows + counts.import_batches_referenced_by_retained_audit;
      const approvedBacklog = counts.admin_activity_logs_eligible + counts.inventory_audit_events_eligible
        + counts.admin_refresh_sessions_eligible;
      if (approvedBacklog > 0) reason = 'retention_chunk_ceiling_reached';
      if (importBacklog > 0 || approvedBacklog > 0) {
        state = 'success_with_backlog';
        exitCode = 0;
        reason = approvedBacklog > 0 ? 'retention_chunk_ceiling_reached' : 'retention_safe_backlog_present';
      }
    }
  } catch {
    state = 'incomplete';
    exitCode = 1;
    reason = 'retention_chunk_or_preflight_failed';
  } finally {
    if (client && lockHeld) {
      try {
        const unlocked = await client.query<{ unlocked: boolean }>(
          'SELECT pg_advisory_unlock($1, $2) AS unlocked', [RETENTION_ADVISORY_LOCK.namespace, RETENTION_ADVISORY_LOCK.key],
        );
        if (unlocked.rows[0]?.unlocked !== true) throw new Error('retention_unlock_not_confirmed');
      } catch {
        state = 'incomplete';
        exitCode = 1;
        reason = 'retention_lock_release_failed';
        client.release(new Error('retention_lock_client_discarded'));
        client = undefined;
      }
    }
    client?.release();
  }
  const finished = new Date().toISOString();
  return {
    result_version: 1,
    phase: 'retention',
    run_id: runId,
    state,
    exit_code: exitCode,
    reason_code: reason,
    run_started_at_utc: initial,
    run_finished_at_utc: finished,
    cutoff_utc: cutoff?.toISOString() ?? null,
    counts,
    app_build_sha: options.appBuildSha,
  };
}
