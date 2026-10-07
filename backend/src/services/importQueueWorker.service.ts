import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { pool } from '../db/pool.js';
import { withTransaction } from '../db/transaction.js';
import type { ImportPayload } from './streetLightsImport.service.js';

const WORKER_LOCK = 812_771_039;
const LEASE_SECONDS = 30;
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

function changedFields(before: Record<string, unknown> | null, after: Record<string, unknown>): Record<string, unknown> {
  const fields = ['inventory_number', 'external_id', 'longitude', 'latitude', 'address', 'district', 'lamp_type', 'status'];
  const changed: Record<string, unknown> = {};
  for (const field of fields) {
    const oldValue = before?.[field] ?? null;
    const nextValue = after[field] ?? null;
    const equal = before !== null && before !== undefined && (field === 'longitude' || field === 'latitude'
      ? Number(oldValue) === Number(nextValue)
      : oldValue === nextValue);
    if (!equal) changed[field] = { before: oldValue, after: nextValue };
  }
  return changed;
}

async function bumpCounters(client: PoolClient, batchId: number, outcome: RowOutcome): Promise<void> {
  const columns: Record<RowOutcome, string> = {
    created: 'created_rows', updated: 'updated_rows', unchanged: 'unchanged_rows', skipped: 'skipped_rows', failed: 'failed_rows',
  };
  const { rowCount } = await client.query(
    `UPDATE import_batches SET ${columns[outcome]} = ${columns[outcome]} + 1,
       applied_rows = applied_rows + CASE WHEN $2 IN ('created', 'updated') THEN 1 ELSE 0 END,
       successful_rows = successful_rows + CASE WHEN $2 IN ('created', 'updated', 'unchanged') THEN 1 ELSE 0 END
     WHERE id = $1`, [batchId, outcome]
  );
  if (rowCount !== 1) throw new Error('Import batch disappeared during row accounting');
}

async function setOutcome(
  client: PoolClient,
  batchId: number,
  rowId: number,
  outcome: RowOutcome,
  entityId: number | null,
  code: string | null = null,
  reason: string | null = null
): Promise<void> {
  const { rowCount } = await client.query(
    `UPDATE import_batch_rows SET outcome = $3, entity_id = $4, reason_code = $5,
       safe_reason = $6, payload = NULL, updated_at = NOW()
     WHERE id = $1 AND batch_id = $2 AND outcome = 'pending'`,
    [rowId, batchId, outcome, entityId, code, reason]
  );
  if (rowCount !== 1) throw new Error('Import row was not pending when terminal outcome was written');
  await bumpCounters(client, batchId, outcome);
}

async function processImportRow(batch: { id: number; worker_token: string; uploaded_by_admin_id: number | null; uploaded_by_username_snapshot: string | null }, row: { id: number; payload: ImportPayload }): Promise<void> {
  await withTransaction(async (client) => {
    const { rows: batchRows } = await client.query(
      `SELECT id FROM import_batches WHERE id = $1 AND status = 'processing' AND worker_token = $2 FOR UPDATE`,
      [batch.id, batch.worker_token]
    );
    if (!batchRows[0]) throw new Error('Import worker lease was lost');
    const { rows: rowRows } = await client.query(
      `SELECT id, outcome FROM import_batch_rows WHERE id = $1 AND batch_id = $2 FOR UPDATE`, [row.id, batch.id]
    );
    if (rowRows[0]?.outcome !== 'pending') return;
    const payload = row.payload;
    const { rows: existingRows } = await client.query<Record<string, unknown>>(
      `SELECT id, inventory_number, external_id, ST_X(geom)::double precision AS longitude,
              ST_Y(geom)::double precision AS latitude, address, district, lamp_type, status
         FROM light_points WHERE inventory_number COLLATE "C" = $1 COLLATE "C" FOR UPDATE`,
      [payload.inventory_number]
    );
    const current = existingRows[0];
    const { rows: batchInfoRows } = await client.query<{ update_existing: boolean }>(
      'SELECT update_existing FROM import_batches WHERE id = $1', [batch.id]
    );
    let outcome: RowOutcome;
    let entityId: number | null;
    let before: Record<string, unknown> | null = current ?? null;
    let after: Record<string, unknown>;
    if (current && !batchInfoRows[0].update_existing) {
      await setOutcome(client, batch.id, row.id, 'skipped', Number(current.id), 'existing_update_disabled', 'Existing inventory number was left unchanged');
      await client.query('UPDATE import_batches SET lease_until = NOW() + ($2 * INTERVAL \'1 second\') WHERE id = $1', [batch.id, LEASE_SECONDS]);
      return;
    }
    if (!current) {
      after = {
        inventory_number: payload.inventory_number,
        external_id: payload.present.includes('external_id') ? payload.external_id ?? null : null,
        longitude: payload.longitude,
        latitude: payload.latitude,
        address: payload.present.includes('address') ? payload.address ?? null : null,
        district: payload.present.includes('district') ? payload.district ?? null : null,
        lamp_type: payload.present.includes('lamp_type') ? payload.lamp_type ?? null : null,
        status: payload.present.includes('status') ? payload.status : 'active',
      };
      const { rows } = await client.query<{ id: number }>(
        `INSERT INTO light_points
           (inventory_number, external_id, geom, address, district, lamp_type, status)
         VALUES ($1, $2, ST_SetSRID(ST_MakePoint($3, $4), 4326), $5, $6, $7, $8) RETURNING id`,
        [after.inventory_number, after.external_id, after.longitude, after.latitude, after.address, after.district, after.lamp_type, after.status]
      );
      entityId = rows[0].id;
      outcome = 'created';
    } else {
      after = { ...current };
      for (const field of payload.present) {
        if (field === 'latitude' || field === 'longitude') after[field] = payload[field];
        else if (field === 'external_id' || field === 'address' || field === 'district' || field === 'lamp_type' || field === 'status' || field === 'inventory_number') {
          after[field] = payload[field] ?? null;
        }
      }
      const changes = changedFields(current, after);
      if (Object.keys(changes).length === 0) {
        await setOutcome(client, batch.id, row.id, 'unchanged', Number(current.id));
        await client.query('UPDATE import_batches SET lease_until = NOW() + ($2 * INTERVAL \'1 second\') WHERE id = $1', [batch.id, LEASE_SECONDS]);
        return;
      }
      await client.query(
        `UPDATE light_points SET inventory_number = $2, external_id = $3,
           geom = ST_SetSRID(ST_MakePoint($4, $5), 4326), address = $6,
           district = $7, lamp_type = $8, status = $9, updated_at = NOW()
         WHERE id = $1`,
        [current.id, after.inventory_number, after.external_id, after.longitude, after.latitude, after.address,
          after.district, after.lamp_type, after.status]
      );
      entityId = Number(current.id);
      outcome = 'updated';
    }
    const changes = changedFields(before, after);
    await client.query(
      `INSERT INTO inventory_audit_events
         (actor_admin_id, actor_username_snapshot, entity_id_snapshot, inventory_number_snapshot,
          action, import_batch_id, changed_fields)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [batch.uploaded_by_admin_id, batch.uploaded_by_username_snapshot, entityId, payload.inventory_number,
        outcome === 'created' ? 'create' : 'update', batch.id, JSON.stringify(changes)]
    );
    await setOutcome(client, batch.id, row.id, outcome, entityId);
    await client.query('UPDATE import_batches SET lease_until = NOW() + ($2 * INTERVAL \'1 second\') WHERE id = $1', [batch.id, LEASE_SECONDS]);
  });
}

async function failPendingRow(batchId: number, rowId: number, failure: { code: string; reason: string }): Promise<void> {
  await withTransaction(async (client) => {
    const { rowCount } = await client.query(
      `UPDATE import_batch_rows SET outcome = 'failed', reason_code = $3, safe_reason = $4,
         payload = NULL, updated_at = NOW()
       WHERE id = $1 AND batch_id = $2 AND outcome = 'pending'`, [rowId, batchId, failure.code, failure.reason]
    );
    if (rowCount === 1) await bumpCounters(client, batchId, 'failed');
  });
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
    const { rows } = await pool.query<{ id: number; payload: ImportPayload }>(
      `SELECT id, payload FROM import_batch_rows WHERE batch_id = $1 AND outcome = 'pending' ORDER BY source_row_number LIMIT 1`, [batch.id]
    );
    const row = rows[0];
    if (!row) {
      await withTransaction(async (client) => {
        const { rows: counts } = await client.query<{ failed_rows: number }>(
          'SELECT failed_rows FROM import_batches WHERE id = $1 AND worker_token = $2 FOR UPDATE', [batch.id, batch.worker_token]
        );
        if (!counts[0]) return;
        const status = counts[0].failed_rows > 0 ? 'completed_with_errors' : 'completed';
        await client.query(
          `UPDATE import_batches SET status = $3, completed_at = NOW(), lease_until = NULL, worker_token = NULL
           WHERE id = $1 AND worker_token = $2`, [batch.id, batch.worker_token, status]
        );
      });
      return;
    }
    try { await processImportRow(batch, row); }
    catch (error) {
      try { await failPendingRow(batch.id, row.id, safeFailure(error)); }
      catch (failure) { throw failure; }
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
