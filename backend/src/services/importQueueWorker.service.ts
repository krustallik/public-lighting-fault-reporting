import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { pool } from '../db/pool.js';
import { withTransaction } from '../db/transaction.js';

const WORKER_LOCK = 812_771_039;
const LEASE_SECONDS = 30;
const ROWS_PER_QUERY = 100;
const IDLE_DELAY_MS = 1_000;
let running = false;
let stopped = false;
let lockClient: PoolClient | undefined;
let loopPromise: Promise<void> | undefined;

type RowOutcome = 'created' | 'updated' | 'unchanged' | 'skipped' | 'failed';

function safeFailure(error: unknown): { code: string; reason: string } {
  const code = (error as { code?: unknown } | null)?.code;
  if (code === '23505') return { code: 'inventory_identity_conflict', reason: 'Inventory number already exists' };
  if (code === '23502' || code === '23514' || code === '22003' || code === '22P02') {
    return { code: 'invalid_row', reason: 'Row violates inventory data requirements' };
  }
  throw error;
}

const PROCESS_PENDING_ROW_SQL = `
WITH selected AS MATERIALIZED (
  SELECT b.id AS batch_id, b.worker_token, b.uploaded_by_admin_id, b.uploaded_by_username_snapshot, b.update_existing,
         r.id AS row_id, r.payload
    FROM import_batches b
    JOIN import_batch_rows r ON r.batch_id = b.id
   WHERE b.id = $1 AND b.status = 'processing' AND b.worker_token = $2 AND r.outcome = 'pending'
   ORDER BY r.source_row_number
   LIMIT $4
   FOR UPDATE OF b, r SKIP LOCKED
), existing AS MATERIALIZED (
  SELECT s.batch_id, s.row_id, s.worker_token, s.uploaded_by_admin_id, s.uploaded_by_username_snapshot,
         s.update_existing, s.payload, p.id AS point_id, p.inventory_number, p.external_id, p.geom,
         ST_X(p.geom)::double precision AS longitude, ST_Y(p.geom)::double precision AS latitude,
         p.address, p.district, p.lamp_type, p.status
    FROM selected s
    JOIN light_points p ON p.inventory_number COLLATE "C" = (s.payload->>'inventory_number') COLLATE "C"
   FOR UPDATE OF p
), inserted AS (
  INSERT INTO light_points (inventory_number, external_id, geom, address, district, lamp_type, status)
  SELECT s.payload->>'inventory_number', s.payload->>'external_id',
         ST_SetSRID(ST_MakePoint((s.payload->>'longitude')::double precision, (s.payload->>'latitude')::double precision), 4326),
         s.payload->>'address', s.payload->>'district', s.payload->>'lamp_type', COALESCE(s.payload->>'status', 'active')
    FROM selected s
   WHERE NOT EXISTS (SELECT 1 FROM existing e WHERE e.row_id = s.row_id)
  RETURNING id, inventory_number, external_id, ST_X(geom)::double precision AS longitude,
            ST_Y(geom)::double precision AS latitude, address, district, lamp_type, status
), updated AS (
  UPDATE light_points p
     SET inventory_number = e.payload->>'inventory_number',
         external_id = CASE WHEN (e.payload->'present') ? 'external_id' THEN e.payload->>'external_id' ELSE p.external_id END,
         geom = ST_SetSRID(ST_MakePoint((e.payload->>'longitude')::double precision, (e.payload->>'latitude')::double precision), 4326),
         address = CASE WHEN (e.payload->'present') ? 'address' THEN e.payload->>'address' ELSE p.address END,
         district = CASE WHEN (e.payload->'present') ? 'district' THEN e.payload->>'district' ELSE p.district END,
         lamp_type = CASE WHEN (e.payload->'present') ? 'lamp_type' THEN e.payload->>'lamp_type' ELSE p.lamp_type END,
         status = CASE WHEN (e.payload->'present') ? 'status' THEN e.payload->>'status' ELSE p.status END,
         updated_at = NOW()
    FROM existing e
   WHERE p.id = e.point_id AND e.update_existing
     AND (p.inventory_number IS DISTINCT FROM e.payload->>'inventory_number'
       OR p.external_id IS DISTINCT FROM CASE WHEN (e.payload->'present') ? 'external_id' THEN e.payload->>'external_id' ELSE p.external_id END
       OR ST_X(p.geom)::double precision IS DISTINCT FROM (e.payload->>'longitude')::double precision
       OR ST_Y(p.geom)::double precision IS DISTINCT FROM (e.payload->>'latitude')::double precision
       OR p.address IS DISTINCT FROM CASE WHEN (e.payload->'present') ? 'address' THEN e.payload->>'address' ELSE p.address END
       OR p.district IS DISTINCT FROM CASE WHEN (e.payload->'present') ? 'district' THEN e.payload->>'district' ELSE p.district END
       OR p.lamp_type IS DISTINCT FROM CASE WHEN (e.payload->'present') ? 'lamp_type' THEN e.payload->>'lamp_type' ELSE p.lamp_type END
       OR p.status IS DISTINCT FROM CASE WHEN (e.payload->'present') ? 'status' THEN e.payload->>'status' ELSE p.status END)
  RETURNING p.id, p.inventory_number, p.external_id, ST_X(p.geom)::double precision AS longitude,
            ST_Y(p.geom)::double precision AS latitude, p.address, p.district, p.lamp_type, p.status
), audit AS (
  INSERT INTO inventory_audit_events
    (actor_admin_id, actor_username_snapshot, entity_id_snapshot, inventory_number_snapshot, action, import_batch_id, changed_fields)
  SELECT s.uploaded_by_admin_id, s.uploaded_by_username_snapshot, c.id, c.inventory_number, 'create', s.batch_id,
         jsonb_strip_nulls(jsonb_build_object(
           'inventory_number', jsonb_build_object('before', NULL::text, 'after', c.inventory_number),
           'external_id', jsonb_build_object('before', NULL::text, 'after', c.external_id),
           'longitude', jsonb_build_object('before', NULL::double precision, 'after', c.longitude),
           'latitude', jsonb_build_object('before', NULL::double precision, 'after', c.latitude),
           'address', jsonb_build_object('before', NULL::text, 'after', c.address),
           'district', jsonb_build_object('before', NULL::text, 'after', c.district),
           'lamp_type', jsonb_build_object('before', NULL::text, 'after', c.lamp_type),
           'status', jsonb_build_object('before', NULL::text, 'after', c.status)))
    FROM inserted c
    JOIN selected s ON c.inventory_number = s.payload->>'inventory_number'
  UNION ALL
  SELECT e.uploaded_by_admin_id, e.uploaded_by_username_snapshot, u.id, u.inventory_number, 'update', e.batch_id,
         jsonb_strip_nulls(jsonb_build_object(
           'inventory_number', CASE WHEN e.inventory_number IS DISTINCT FROM u.inventory_number THEN jsonb_build_object('before', e.inventory_number, 'after', u.inventory_number) END,
           'external_id', CASE WHEN e.external_id IS DISTINCT FROM u.external_id THEN jsonb_build_object('before', e.external_id, 'after', u.external_id) END,
           'longitude', CASE WHEN e.longitude IS DISTINCT FROM u.longitude THEN jsonb_build_object('before', e.longitude, 'after', u.longitude) END,
           'latitude', CASE WHEN e.latitude IS DISTINCT FROM u.latitude THEN jsonb_build_object('before', e.latitude, 'after', u.latitude) END,
           'address', CASE WHEN e.address IS DISTINCT FROM u.address THEN jsonb_build_object('before', e.address, 'after', u.address) END,
           'district', CASE WHEN e.district IS DISTINCT FROM u.district THEN jsonb_build_object('before', e.district, 'after', u.district) END,
           'lamp_type', CASE WHEN e.lamp_type IS DISTINCT FROM u.lamp_type THEN jsonb_build_object('before', e.lamp_type, 'after', u.lamp_type) END,
           'status', CASE WHEN e.status IS DISTINCT FROM u.status THEN jsonb_build_object('before', e.status, 'after', u.status) END))
    FROM updated u
    JOIN existing e ON e.point_id = u.id
  RETURNING id
), outcomes AS MATERIALIZED (
  SELECT s.batch_id, s.row_id, 'created'::text AS outcome, i.id AS entity_id, NULL::varchar AS reason_code, NULL::text AS safe_reason
    FROM selected s JOIN inserted i ON i.inventory_number = s.payload->>'inventory_number'
  UNION ALL
  SELECT e.batch_id, e.row_id, 'updated'::text, u.id, NULL::varchar, NULL::text
    FROM existing e JOIN updated u ON u.id = e.point_id
  UNION ALL
  SELECT e.batch_id, e.row_id,
         CASE WHEN e.update_existing THEN 'unchanged' ELSE 'skipped' END::text,
         e.point_id,
         CASE WHEN e.update_existing THEN NULL::varchar ELSE 'existing_update_disabled'::varchar END,
         CASE WHEN e.update_existing THEN NULL::text ELSE 'Existing inventory number was left unchanged'::text END
    FROM existing e
   WHERE NOT EXISTS (SELECT 1 FROM updated u WHERE u.id = e.point_id)
), marked AS (
  UPDATE import_batch_rows r
     SET outcome = o.outcome, entity_id = o.entity_id, reason_code = o.reason_code,
         safe_reason = o.safe_reason, payload = NULL, updated_at = NOW()
    FROM outcomes o
   WHERE r.id = o.row_id AND r.batch_id = o.batch_id AND r.outcome = 'pending'
  RETURNING r.batch_id, r.outcome
), counts AS (
  SELECT batch_id,
         COUNT(*) FILTER (WHERE outcome = 'created')::integer AS created,
         COUNT(*) FILTER (WHERE outcome = 'updated')::integer AS updated,
         COUNT(*) FILTER (WHERE outcome = 'unchanged')::integer AS unchanged,
         COUNT(*) FILTER (WHERE outcome = 'skipped')::integer AS skipped
    FROM marked
   GROUP BY batch_id
), batch_update AS (
  UPDATE import_batches b
     SET created_rows = b.created_rows + c.created,
         updated_rows = b.updated_rows + c.updated,
         unchanged_rows = b.unchanged_rows + c.unchanged,
         skipped_rows = b.skipped_rows + c.skipped,
         applied_rows = b.applied_rows + c.created + c.updated,
         successful_rows = b.successful_rows + c.created + c.updated + c.unchanged,
         lease_until = NOW() + ($3 * INTERVAL '1 second')
    FROM counts c
   WHERE b.id = c.batch_id AND b.status = 'processing' AND b.worker_token = $2
  RETURNING b.id
)
SELECT marked.outcome
  FROM marked
  CROSS JOIN (SELECT COUNT(*) FROM audit) audit_done
  CROSS JOIN (SELECT COUNT(*) FROM batch_update) batch_done
`;

async function processImportRows(batch: { id: number; worker_token: string }, limit = ROWS_PER_QUERY): Promise<RowOutcome[]> {
  const { rows } = await pool.query<{ outcome: RowOutcome }>(PROCESS_PENDING_ROW_SQL, [batch.id, batch.worker_token, LEASE_SECONDS, limit]);
  return rows.map((row) => row.outcome);
}

async function failNextPendingRow(batch: { id: number; worker_token: string }, failure: { code: string; reason: string }): Promise<void> {
  await pool.query(
    `WITH batch AS MATERIALIZED (
       SELECT id FROM import_batches WHERE id = $1 AND status = 'processing' AND worker_token = $2 FOR UPDATE
     ), candidate AS MATERIALIZED (
       SELECT r.id, r.batch_id FROM import_batch_rows r JOIN batch b ON b.id = r.batch_id
        WHERE r.outcome = 'pending' ORDER BY r.source_row_number LIMIT 1 FOR UPDATE OF r
     ), failed AS (
       UPDATE import_batch_rows r SET outcome = 'failed', reason_code = $3, safe_reason = $4, payload = NULL, updated_at = NOW()
        FROM candidate c WHERE r.id = c.id AND r.batch_id = c.batch_id AND r.outcome = 'pending'
       RETURNING r.batch_id
     ), counts AS (SELECT batch_id, COUNT(*)::integer AS failed FROM failed GROUP BY batch_id)
     UPDATE import_batches b SET failed_rows = b.failed_rows + c.failed,
       lease_until = NOW() + ($5 * INTERVAL '1 second')
       FROM counts c WHERE b.id = c.batch_id AND b.worker_token = $2`,
    [batch.id, batch.worker_token, failure.code, failure.reason, LEASE_SECONDS]
  );
}

async function completeBatch(batch: { id: number; worker_token: string }): Promise<void> {
  await pool.query(
    `UPDATE import_batches b
        SET status = CASE WHEN b.failed_rows > 0 THEN 'completed_with_errors' ELSE 'completed' END,
            completed_at = NOW(), lease_until = NULL, worker_token = NULL
      WHERE b.id = $1 AND b.status = 'processing' AND b.worker_token = $2
        AND NOT EXISTS (SELECT 1 FROM import_batch_rows r WHERE r.batch_id = b.id AND r.outcome = 'pending')`,
    [batch.id, batch.worker_token]
  );
}

async function claimBatch() {
  return withTransaction(async (client) => {
    await client.query("DELETE FROM import_batches WHERE status = 'preview' AND preview_expires_at <= NOW()");
    await client.query(`UPDATE import_batches SET status = 'queued', worker_token = NULL, lease_until = NULL
      WHERE status = 'processing' AND lease_until < NOW()`);
    const { rows } = await client.query<{ id: number; worker_token: string; uploaded_by_admin_id: number | null; uploaded_by_username_snapshot: string | null }>(
      `SELECT id FROM import_batches WHERE status = 'queued' ORDER BY queued_at, id LIMIT 1 FOR UPDATE SKIP LOCKED`
    );
    const candidate = rows[0];
    if (!candidate) return null;
    const token = randomUUID();
    const { rows: claimed } = await client.query<{ id: number; worker_token: string; uploaded_by_admin_id: number | null; uploaded_by_username_snapshot: string | null }>(
      `UPDATE import_batches SET status = 'processing', worker_token = $2,
         lease_until = NOW() + ($3 * INTERVAL '1 second'), started_at = COALESCE(started_at, NOW()), attempt_count = attempt_count + 1
       WHERE id = $1 RETURNING id, worker_token, uploaded_by_admin_id, uploaded_by_username_snapshot`,
      [candidate.id, token, LEASE_SECONDS]
    );
    return claimed[0] ?? null;
  });
}

async function processBatch(batch: NonNullable<Awaited<ReturnType<typeof claimBatch>>>): Promise<void> {
  while (!stopped) {
    try {
      const outcomes = await processImportRows(batch);
      if (!outcomes.length) {
        await completeBatch(batch);
        return;
      }
    }
    catch (error) {
      // A data constraint in one record rolls back this whole bounded SQL batch.
      // Replay its rows one at a time to keep the existing per-row error semantics.
      safeFailure(error);
      for (let index = 0; index < ROWS_PER_QUERY; index += 1) {
        try {
          if (!(await processImportRows(batch, 1)).length) break;
        } catch (rowError) {
          await failNextPendingRow(batch, safeFailure(rowError));
        }
      }
    }
  }
}

function delay(ms: number): Promise<void> { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function loop(): Promise<void> {
  while (!stopped) {
    try {
      const batch = await claimBatch();
      if (batch) await processBatch(batch);
      else await delay(IDLE_DELAY_MS);
    } catch {
      console.warn('Import queue worker paused after a database error');
      await delay(2_000);
    }
  }
}

export async function startImportQueueWorker(): Promise<void> {
  if (running) return;
  running = true;
  stopped = false;
  lockClient = await pool.connect();
  const { rows } = await lockClient.query<{ locked: boolean }>('SELECT pg_try_advisory_lock($1) AS locked', [WORKER_LOCK]);
  if (!rows[0]?.locked) {
    lockClient.release();
    lockClient = undefined;
    running = false;
    console.log('Import queue worker is active in another backend process');
    return;
  }
  loopPromise = loop();
  console.log('Import queue worker started');
}

export async function stopImportQueueWorker(): Promise<void> {
  stopped = true;
  await loopPromise;
  loopPromise = undefined;
  if (lockClient) {
    try { await lockClient.query('SELECT pg_advisory_unlock($1)', [WORKER_LOCK]); } catch { /* pool shutdown may already be underway */ }
    lockClient.release();
    lockClient = undefined;
  }
  running = false;
}
