import { spawn } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const { reverseGeocodeMock } = vi.hoisted(() => ({ reverseGeocodeMock: vi.fn() }));
vi.mock('../../src/services/geocoding.service.js', () => ({ reverseGeocode: reverseGeocodeMock }));

import { pool } from '../../src/db/pool.js';
import { runMigrations } from '../../src/db/migrate.js';
import { canonicalizeInventoryNumber } from '../../src/domain/inventoryIdentity.js';
import { getLightPointsInViewport, createLightPoint, deleteLightPoint, updateLightPoint, ensureLightPointAddress, geocodePendingLightPoints } from '../../src/services/lightPoints.service.js';
import { buildImportPreview, confirmImport, getImportBatch, getImportPreviewPage, listImportBatchRows, parseImportSource } from '../../src/services/streetLightsImport.service.js';
import { startImportQueueWorker, stopImportQueueWorker } from '../../src/services/importQueueWorker.service.js';
import { config } from '../../src/config/index.js';

const enabled = process.env.P3_POSTGRES_INTEGRATION === 'true';
const prefix = `p3-integration-${process.pid}-${Date.now()}-`;
let adminId = 0;
let workerStarted = false;
const mutableGeocodingConfig = config.geocoding as unknown as { autoGeocode: boolean };

function enableAutomaticGeocoding(): () => void {
  const previous = mutableGeocodingConfig.autoGeocode;
  mutableGeocodingConfig.autoGeocode = true;
  return () => { mutableGeocodingConfig.autoGeocode = previous; };
}

function mockGeocodedAddress(address: string): void {
  reverseGeocodeMock.mockResolvedValue({
    address, latitude: 48.75, longitude: 21.25, source: 'nominatim',
  });
}

async function insertFixture(inventoryNumber: string, values: {
  externalId?: string | null; longitude?: number; latitude?: number; address?: string | null;
  district?: string | null; lampType?: string | null; status?: 'active' | 'inactive' | 'maintenance';
} = {}): Promise<number> {
  const { rows } = await pool.query<{ id: number }>(
    `INSERT INTO light_points(inventory_number, external_id, geom, address, district, lamp_type, status)
     VALUES ($1, $2, ST_SetSRID(ST_MakePoint($3, $4), 4326), $5, $6, $7, $8) RETURNING id`,
    [inventoryNumber, values.externalId ?? null, values.longitude ?? 21.25, values.latitude ?? 48.75,
      values.address ?? null, values.district ?? null, values.lampType ?? null, values.status ?? 'active']
  );
  return rows[0].id;
}

async function waitForBatch(batchId: number): Promise<Record<string, unknown>> {
  const deadline = Date.now() + 12_000;
  while (Date.now() < deadline) {
    const batch = await getImportBatch(batchId) as Record<string, unknown> | null;
    if (batch && ['completed', 'completed_with_errors', 'failed', 'system_failed'].includes(String(batch.status))) return batch;
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  throw new Error(`Import batch ${batchId} did not reach a terminal state`);
}

async function createPreview(filename: string, value: unknown[], pageLimit = 100) {
  const rows = parseImportSource(Buffer.from(JSON.stringify(value)), 'application/json', `${filename}.json`);
  return buildImportPreview(adminId, `${prefix}${filename}.json`, rows, 'P3 integration admin', 1, pageLimit);
}

async function stopTestWorker(): Promise<void> {
  if (!workerStarted) return;
  console.info('P3 crash/restart evidence: stopping replacement worker');
  await stopImportQueueWorker();
  workerStarted = false;
  console.info('P3 crash/restart evidence: replacement worker stopped');
}

describe.skipIf(!enabled)('P3 PostgreSQL inventory persistence and import jobs', () => {
  beforeAll(async () => {
    await runMigrations();
    const { rows } = await pool.query<{ id: number }>(
      `INSERT INTO admins(username, password_hash) VALUES ($1, 'synthetic-test-hash') RETURNING id`, [`${prefix}admin`]
    );
    adminId = rows[0].id;
  });

  afterAll(async () => {
    if (workerStarted) await stopImportQueueWorker();
    await pool.query('DELETE FROM inventory_audit_events WHERE inventory_number_snapshot LIKE $1', [`${prefix}%`]);
    await pool.query('DELETE FROM import_batches WHERE filename LIKE $1', [`${prefix}%`]);
    await pool.query('DELETE FROM light_points WHERE inventory_number LIKE $1', [`${prefix}%`]);
    if (adminId) await pool.query('DELETE FROM admins WHERE id = $1', [adminId]);
  });

  it('uses geometry for viewport reads and commits CRUD mutations with exactly-one atomic audit', async () => {
    const identity = `${prefix}crud`;
    const created = await createLightPoint({
      inventory_number: identity, external_id: 'duplicate-metadata', longitude: 21.2, latitude: 48.7,
      address: 'Initial', district: 'Test', lamp_type: 'LED', status: 'active',
    }, adminId, 'P3 integration admin');
    expect(Number(created.longitude)).toBeCloseTo(21.2, 6);
    expect(Number(created.latitude)).toBeCloseTo(48.7, 6);

    const inside = await getLightPointsInViewport([21.19, 48.69, 21.21, 48.71]);
    expect(inside.some((point) => point.inventory_number === identity)).toBe(true);
    const outside = await getLightPointsInViewport([21.3, 48.8, 21.4, 48.9]);
    expect(outside.some((point) => point.inventory_number === identity)).toBe(false);

    await updateLightPoint(created.id, { address: 'Initial' }, adminId, 'P3 integration admin');
    let audit = await pool.query<{ action: string; changed_fields: Record<string, unknown> }>(
      'SELECT action, changed_fields FROM inventory_audit_events WHERE entity_id_snapshot = $1 ORDER BY id', [created.id]
    );
    expect(audit.rows.map((row) => row.action)).toEqual(['create']);

    const renamedIdentity = `${identity}-renamed`;
    await updateLightPoint(created.id, { address: 'Changed', inventory_number: renamedIdentity }, adminId, 'P3 integration admin');
    audit = await pool.query<{ action: string; changed_fields: Record<string, unknown> }>(
      'SELECT action, changed_fields FROM inventory_audit_events WHERE entity_id_snapshot = $1 ORDER BY id', [created.id]
    );
    expect(audit.rows).toHaveLength(2);
    expect(audit.rows[1].changed_fields).toHaveProperty('address');
    expect(audit.rows[1].changed_fields).toHaveProperty('inventory_number');

    const identityLiteral = identity.replace(/'/g, "''");
    await pool.query(`ALTER TABLE inventory_audit_events ADD CONSTRAINT p3_test_force_audit_failure CHECK (inventory_number_snapshot <> '${identityLiteral}-audit-fail')`);
    await expect(createLightPoint({
      inventory_number: `${identity}-audit-fail`, external_id: null, longitude: 21.2, latitude: 48.7,
      status: 'active',
    }, adminId, 'P3 integration admin')).rejects.toThrow();
    await pool.query('ALTER TABLE inventory_audit_events DROP CONSTRAINT p3_test_force_audit_failure');
    const rollback = await pool.query('SELECT id FROM light_points WHERE inventory_number = $1', [`${identity}-audit-fail`]);
    expect(rollback.rows).toHaveLength(0);

    await deleteLightPoint(created.id, adminId, 'P3 integration admin');
    const deleted = await pool.query<{ action: string; inventory_number_snapshot: string; changed_fields: Record<string, unknown> }>(
      'SELECT action, inventory_number_snapshot, changed_fields FROM inventory_audit_events WHERE entity_id_snapshot = $1 ORDER BY id', [created.id]
    );
    expect(deleted.rows.map((row) => row.action)).toEqual(['create', 'update', 'delete']);
    expect(deleted.rows[2].inventory_number_snapshot).toBe(renamedIdentity);
    expect(deleted.rows[2].changed_fields).toHaveProperty('geom');
    expect((await pool.query('SELECT 1 FROM light_points WHERE id = $1', [created.id])).rows).toHaveLength(0);
  });

  it('persists a malformed hash-prefixed CSV record as a failed source row', async () => {
    const parsedRows = parseImportSource(
      Buffer.from('inventory_number,latitude,longitude\n#something\n"#ordinary-value",48.2,17.2\nLP-AFTER-HASH,48.3,17.3'),
      'text/csv', `${prefix}hash-records.csv`
    );
    expect(parsedRows.map((row) => row.rowIndex)).toEqual([1, 2, 3]);
    expect(parsedRows[0].errorCode).toBe('malformed_record');
    expect(parsedRows[1].payload?.inventory_number).toBe('#ordinary-value');

    const preview = await buildImportPreview(adminId, `${prefix}hash-records.csv`, parsedRows, 'P3 integration admin');
    expect(preview.totalRows).toBe(3);
    expect(preview.summary).toMatchObject({ toCreate: 2, errors: 1 });
    expect(preview.results.map((row) => [row.rowIndex, row.action, row.code])).toEqual([
      [1, 'error', 'malformed_record'], [2, 'create', undefined], [3, 'create', undefined],
    ]);
    const { rows } = await pool.query<{ source_row_number: number; outcome: string; reason_code: string | null }>(
      `SELECT r.source_row_number, r.outcome, r.reason_code
         FROM import_batch_rows r JOIN import_batches b ON b.id = r.batch_id
        WHERE b.confirmation_key = $1 ORDER BY r.source_row_number`, [preview.previewId]
    );
    expect(rows).toEqual([
      { source_row_number: 1, outcome: 'failed', reason_code: 'malformed_record' },
      { source_row_number: 2, outcome: 'pending', reason_code: null },
      { source_row_number: 3, outcome: 'pending', reason_code: null },
    ]);
  });

  it('commits automatic geocoding as a separate audited inventory update', async () => {
    const restoreConfig = enableAutomaticGeocoding();
    const identity = `${prefix}geocode-audit`;
    reverseGeocodeMock.mockReset();
    mockGeocodedAddress('Synthetic create address');
    try {
      const created = await createLightPoint({
        inventory_number: identity, longitude: 21.25, latitude: 48.75,
      }, adminId, 'P3 integration admin');
      expect(created.address).toBe('Synthetic create address');
      let audit = await pool.query<{
        action: string; actor_admin_id: number | null; actor_username_snapshot: string | null;
        changed_fields: Record<string, unknown>;
      }>(
        `SELECT action, actor_admin_id, actor_username_snapshot, changed_fields
           FROM inventory_audit_events WHERE entity_id_snapshot = $1 ORDER BY id`, [created.id]
      );
      expect(audit.rows.map((row) => row.action)).toEqual(['create', 'update']);
      expect(audit.rows[1]).toMatchObject({
        actor_admin_id: null,
        actor_username_snapshot: 'system:automatic-geocoding',
        changed_fields: { address: { before: null, after: 'Synthetic create address' } },
      });

      mockGeocodedAddress('Synthetic updated address');
      const updated = await updateLightPoint(created.id, { latitude: 48.751 }, adminId, 'P3 integration admin');
      expect(updated.address).toBe('Synthetic updated address');
      audit = await pool.query(
        `SELECT action, actor_admin_id, actor_username_snapshot, changed_fields
           FROM inventory_audit_events WHERE entity_id_snapshot = $1 ORDER BY id`, [created.id]
      );
      expect(audit.rows.map((row) => row.action)).toEqual(['create', 'update', 'update', 'update']);
      expect(audit.rows[3]).toMatchObject({
        actor_admin_id: null,
        actor_username_snapshot: 'system:automatic-geocoding',
        changed_fields: { address: { before: 'Synthetic create address', after: 'Synthetic updated address' } },
      });
      expect(reverseGeocodeMock).toHaveBeenCalledTimes(2);
    } finally {
      restoreConfig();
      reverseGeocodeMock.mockReset();
    }
  });

  it('keeps committed create and update results successful when optional geocoding fails', async () => {
    const restoreConfig = enableAutomaticGeocoding();
    reverseGeocodeMock.mockReset();
    try {
      const createIdentity = `${prefix}geocode-fail-create`;
      reverseGeocodeMock.mockRejectedValueOnce(new Error('synthetic provider failure'));
      const created = await createLightPoint({
        inventory_number: createIdentity, longitude: 21.25, latitude: 48.75,
      }, adminId, 'P3 integration admin');
      expect(created.inventory_number).toBe(createIdentity);
      const createAudit = await pool.query<{ action: string }>(
        'SELECT action FROM inventory_audit_events WHERE entity_id_snapshot = $1 ORDER BY id', [created.id]
      );
      expect(createAudit.rows.map((row) => row.action)).toEqual(['create']);

      const updateId = await insertFixture(`${prefix}geocode-fail-update`, { district: 'Before' });
      reverseGeocodeMock.mockRejectedValueOnce(new Error('synthetic provider failure'));
      const updated = await updateLightPoint(updateId, { district: 'Committed' }, adminId, 'P3 integration admin');
      expect(updated.district).toBe('Committed');
      const updateAudit = await pool.query<{ action: string; changed_fields: Record<string, unknown> }>(
        'SELECT action, changed_fields FROM inventory_audit_events WHERE entity_id_snapshot = $1 ORDER BY id', [updateId]
      );
      expect(updateAudit.rows.map((row) => row.action)).toEqual(['update']);
      expect(updateAudit.rows[0].changed_fields).toHaveProperty('district');
    } finally {
      restoreConfig();
      reverseGeocodeMock.mockReset();
    }
  });

  it('rolls back a geocode address change when its audit event cannot be recorded', async () => {
    const identity = `${prefix}geocode-audit-fail`;
    const id = await insertFixture(identity, { address: 'Original address' });
    const before = await pool.query<{ address: string | null; address_geocoded_at: Date | null; updated_at: Date }>(
      'SELECT address, address_geocoded_at, updated_at FROM light_points WHERE id = $1', [id]
    );
    await pool.query(`ALTER TABLE inventory_audit_events ADD CONSTRAINT p3_test_geocode_audit_failure
      CHECK (actor_username_snapshot <> 'system:maintenance-geocoding')`);
    reverseGeocodeMock.mockReset();
    mockGeocodedAddress('Replacement address');
    try {
      await expect(ensureLightPointAddress(id, true, true)).rejects.toThrow();
      const after = await pool.query<{ address: string | null; address_geocoded_at: Date | null; updated_at: Date }>(
        'SELECT address, address_geocoded_at, updated_at FROM light_points WHERE id = $1', [id]
      );
      expect(after.rows[0].address).toBe(before.rows[0].address);
      expect(after.rows[0].address_geocoded_at).toBe(before.rows[0].address_geocoded_at);
      expect(after.rows[0].updated_at.toISOString()).toBe(before.rows[0].updated_at.toISOString());
      expect((await pool.query('SELECT id FROM inventory_audit_events WHERE entity_id_snapshot = $1', [id])).rows).toHaveLength(0);
    } finally {
      await pool.query('ALTER TABLE inventory_audit_events DROP CONSTRAINT IF EXISTS p3_test_geocode_audit_failure');
      reverseGeocodeMock.mockReset();
    }
  });

  it('does not write or audit when a forced geocode returns the unchanged address', async () => {
    const id = await insertFixture(`${prefix}geocode-unchanged`, { address: 'Already correct' });
    const before = await pool.query<{ updated_at: Date; address_geocoded_at: Date | null }>(
      'SELECT updated_at, address_geocoded_at FROM light_points WHERE id = $1', [id]
    );
    reverseGeocodeMock.mockReset();
    mockGeocodedAddress('Already correct');
    try {
      await expect(ensureLightPointAddress(id, true, true)).resolves.toBe('Already correct');
      const after = await pool.query<{ updated_at: Date; address_geocoded_at: Date | null }>(
        'SELECT updated_at, address_geocoded_at FROM light_points WHERE id = $1', [id]
      );
      expect(after.rows[0].updated_at.toISOString()).toBe(before.rows[0].updated_at.toISOString());
      expect(after.rows[0].address_geocoded_at).toBe(before.rows[0].address_geocoded_at);
      expect((await pool.query('SELECT id FROM inventory_audit_events WHERE entity_id_snapshot = $1', [id])).rows).toHaveLength(0);
    } finally {
      reverseGeocodeMock.mockReset();
    }
  });

  it('persists previews and confirmation across requests; accounts partial outcomes, OFF/ON semantics, and retries', async () => {
    const existingOff = `${prefix}existing-off`;
    const existingOffId = await insertFixture(existingOff, { externalId: 'same-ext', address: 'leave me', district: 'D1' });
    const offUpdatedAt = await pool.query<{ updated_at: Date }>('SELECT updated_at FROM light_points WHERE id = $1', [existingOffId]);

    const preview = await createPreview('partial', [
      { inventory_number: ` ${prefix}new `, longitude: 21.1, latitude: 48.1, address: 'New', external_id: 'same-ext' },
      { inventory_number: `${prefix}new`, longitude: 21.1, latitude: 48.1, address: 'New', external_id: 'same-ext' },
      { inventory_number: existingOff, longitude: 21.2, latitude: 48.2, address: 'must stay unchanged' },
      { inventory_number: `${prefix}invalid`, longitude: 'not-a-number', latitude: 48.2 },
      { inventory_number: `${prefix}conflict`, longitude: 21.3, latitude: 48.3, address: 'A' },
      { inventory_number: `${prefix}conflict`, longitude: 21.3, latitude: 48.3, address: 'B' },
      { inventory_number: `${prefix}other`, longitude: 0, latitude: 0 },
      { inventory_number: `${prefix}import-audit-fail`, longitude: 21.5, latitude: 48.5 },
    ]);
    expect(preview.totalRows).toBe(8);
    expect(preview.summary).toMatchObject({ toCreate: 3, toUpdate: 1, skipped: 1, errors: 3 });

    const persistedBeforeConfirm = await pool.query<{ status: string; confirmation_key: string }>(
      'SELECT status, confirmation_key FROM import_batches WHERE confirmation_key = $1', [preview.previewId]
    );
    expect(persistedBeforeConfirm.rows).toMatchObject([{ status: 'preview', confirmation_key: preview.previewId }]);
    const recoveredPreview = await getImportPreviewPage(adminId, preview.previewId, 1, 3);
    expect(recoveredPreview.results).toEqual(preview.results.slice(0, 3));
    expect(recoveredPreview.totalRows).toBe(8);
    expect((await getImportPreviewPage(adminId, preview.previewId, 2, 3)).results).toEqual(preview.results.slice(3, 6));

    const [confirmed1, confirmed2] = await Promise.all([
      confirmImport(adminId, preview.previewId, false), confirmImport(adminId, preview.previewId, false),
    ]);
    expect(confirmed1.batchId).toBe(confirmed2.batchId);
    const duplicateHeaders = await pool.query('SELECT id FROM import_batches WHERE confirmation_key = $1', [preview.previewId]);
    expect(duplicateHeaders.rows).toHaveLength(1);

    const failIdentityLiteral = `${prefix}import-audit-fail`.replace(/'/g, "''");
    await pool.query(`ALTER TABLE inventory_audit_events ADD CONSTRAINT p3_test_force_import_audit_failure CHECK (inventory_number_snapshot <> '${failIdentityLiteral}')`);
    let batch: Record<string, unknown>;
    try {
      await startImportQueueWorker();
      workerStarted = true;
      const competing = await pool.connect();
      try {
        const { rows: lockState } = await competing.query<{ locked: boolean }>(
          'SELECT pg_try_advisory_lock($1) AS locked', [812_771_039]
        );
        expect(lockState[0].locked).toBe(false);
      } finally { competing.release(); }
      batch = await waitForBatch(confirmed1.batchId);
    } finally {
      await pool.query('ALTER TABLE inventory_audit_events DROP CONSTRAINT p3_test_force_import_audit_failure');
    }
    expect(batch).toMatchObject({ status: 'completed_with_errors', total_rows: 8, successful_rows: 2, created_rows: 2, updated_rows: 0, unchanged_rows: 0, skipped_rows: 2, failed_rows: 4 });
    expect(Number(batch.successful_rows) + Number(batch.skipped_rows) + Number(batch.failed_rows)).toBe(Number(batch.total_rows));
    const offAfter = await pool.query<{ address: string; updated_at: Date }>('SELECT address, updated_at FROM light_points WHERE id = $1', [existingOffId]);
    expect(offAfter.rows[0].address).toBe('leave me');
    expect(offAfter.rows[0].updated_at.toISOString()).toBe(offUpdatedAt.rows[0].updated_at.toISOString());
    const offAudit = await pool.query('SELECT id FROM inventory_audit_events WHERE inventory_number_snapshot = $1', [existingOff]);
    expect(offAudit.rows).toHaveLength(0);
    const importedAudit = await pool.query('SELECT id FROM inventory_audit_events WHERE import_batch_id = $1', [confirmed1.batchId]);
    expect(importedAudit.rows).toHaveLength(2);
    const zeroCoordinateAudit = await pool.query<{ changed_fields: Record<string, unknown> }>(
      'SELECT changed_fields FROM inventory_audit_events WHERE import_batch_id = $1 AND inventory_number_snapshot = $2',
      [confirmed1.batchId, `${prefix}other`]
    );
    expect(zeroCoordinateAudit.rows[0].changed_fields).toHaveProperty('longitude');
    expect(zeroCoordinateAudit.rows[0].changed_fields).toHaveProperty('latitude');
    const rows = await listImportBatchRows(confirmed1.batchId, undefined, 100, 0);
    expect(rows.items).toHaveLength(8);
    expect(rows.items.filter((row) => row.outcome === 'created')).toHaveLength(2);
    expect(rows.items.filter((row) => row.outcome === 'skipped')).toHaveLength(2);
    expect(rows.items.filter((row) => row.outcome === 'failed')).toHaveLength(4);
    expect((await pool.query('SELECT id FROM light_points WHERE inventory_number = $1', [`${prefix}import-audit-fail`])).rows).toHaveLength(0);
    expect((await pool.query('SELECT id FROM inventory_audit_events WHERE inventory_number_snapshot = $1', [`${prefix}import-audit-fail`])).rows).toHaveLength(0);
    const terminalPayloads = await pool.query('SELECT id FROM import_batch_rows WHERE batch_id = $1 AND payload IS NOT NULL', [confirmed1.batchId]);
    expect(terminalPayloads.rows).toHaveLength(0);

    const updateIdentity = `${prefix}update-on`;
    const unchangedIdentity = `${prefix}unchanged-on`;
    const updateId = await insertFixture(updateIdentity, { externalId: 'shared-ext', address: 'clear me', district: 'Preserve', lampType: 'HPS', status: 'active' });
    const unchangedId = await insertFixture(unchangedIdentity, { externalId: 'shared-ext', address: 'same', district: 'same-district', lampType: 'LED', status: 'active' });
    const unchangedBefore = await pool.query<{ updated_at: Date }>('SELECT updated_at FROM light_points WHERE id = $1', [unchangedId]);
    const onPreview = await createPreview('update-on', [
      { inventory_number: updateIdentity, longitude: 21.25, latitude: 48.75, address: '' },
      { inventory_number: unchangedIdentity, external_id: 'shared-ext', longitude: 21.25, latitude: 48.75, address: 'same', district: 'same-district', lamp_type: 'LED', status: 'active' },
      { inventory_number: `${prefix}created-on`, longitude: 21.26, latitude: 48.76, external_id: 'shared-ext', address: null },
    ]);
    const on = await confirmImport(adminId, onPreview.previewId, true);
    const onBatch = await waitForBatch(on.batchId);
    expect(onBatch).toMatchObject({ status: 'completed', total_rows: 3, successful_rows: 3, created_rows: 1, updated_rows: 1, unchanged_rows: 1, skipped_rows: 0, failed_rows: 0 });
    const updated = await pool.query<{ address: string | null; district: string | null; external_id: string | null }>(
      'SELECT address, district, external_id FROM light_points WHERE id = $1', [updateId]
    );
    expect(updated.rows[0]).toEqual({ address: null, district: 'Preserve', external_id: 'shared-ext' });
    const unchangedAfter = await pool.query<{ updated_at: Date }>('SELECT updated_at FROM light_points WHERE id = $1', [unchangedId]);
    const unchangedAudit = await pool.query('SELECT id FROM inventory_audit_events WHERE inventory_number_snapshot = $1', [unchangedIdentity]);
    expect(unchangedAudit.rows).toHaveLength(0);
    expect(unchangedAfter.rows).toHaveLength(1);
    expect(unchangedAfter.rows[0].updated_at.toISOString()).toBe(unchangedBefore.rows[0].updated_at.toISOString());
    const onAudit = await pool.query<{ action: string; changed_fields: Record<string, unknown> }>(
      'SELECT action, changed_fields FROM inventory_audit_events WHERE import_batch_id = $1 ORDER BY id', [on.batchId]
    );
    expect(onAudit.rows.map((row) => row.action).sort()).toEqual(['create', 'update']);
    expect(onAudit.rows.some((row) => JSON.stringify(row.changed_fields).includes('address'))).toBe(true);
    expect(canonicalizeInventoryNumber(`${prefix}new`)).toBe(`${prefix}new`);
    await stopTestWorker();
  });

  it('removes expired unconfirmed preview staging without retaining a raw file or stale job', async () => {
    const preview = await createPreview('expires', [{
      inventory_number: `${prefix}preview-expired`, longitude: 21.4, latitude: 48.4, address: 'Normalized only',
    }]);
    await pool.query('UPDATE import_batches SET preview_expires_at = NOW() - INTERVAL \'1 second\' WHERE confirmation_key = $1', [preview.previewId]);
    await expect(getImportPreviewPage(adminId, preview.previewId)).rejects.toThrow(/expired or not found/i);
    const staged = await pool.query('SELECT id FROM import_batch_rows WHERE inventory_number = $1', [`${prefix}preview-expired`]);
    expect(staged.rows).toHaveLength(0);
    const batch = await pool.query('SELECT id FROM import_batches WHERE confirmation_key = $1', [preview.previewId]);
    expect(batch.rows).toHaveLength(0);
  });

  it('recovers pending work after a real worker-process crash, preserves completed rows, and drains FIFO jobs', async () => {
    const identities = [`${prefix}restart-first`, `${prefix}restart-second`];
    const preview = await createPreview('restart', identities.map((inventory_number, index) => ({
      inventory_number, longitude: 21.1 + index / 100, latitude: 48.1 + index / 100,
    })));
    const { batchId } = await confirmImport(adminId, preview.previewId, false);
    const secondPreview = await createPreview('fifo-second', [{
      inventory_number: `${prefix}restart-third`, longitude: 21.3, latitude: 48.3,
    }]);
    const secondBatch = await confirmImport(adminId, secondPreview.previewId, false);
    const sqlPrefix = prefix.replace(/'/g, "''");
    await pool.query(`CREATE FUNCTION p3_test_pause_import_insert() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.inventory_number LIKE '${sqlPrefix}restart-%' THEN PERFORM pg_sleep(2); END IF;
        RETURN NEW;
      END
    $$`);
    await pool.query('CREATE TRIGGER p3_test_pause_import_insert BEFORE INSERT ON light_points FOR EACH ROW EXECUTE FUNCTION p3_test_pause_import_insert()');
    let child: ReturnType<typeof spawn> | undefined;
    let childOutput = '';
    try {
      const childScript = `import { startImportQueueWorker } from './src/services/importQueueWorker.service.ts'; await startImportQueueWorker(); console.log('P3_WORKER_CHILD_READY'); setInterval(() => {}, 1000);`;
      child = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '--eval', childScript], {
        cwd: process.cwd(), env: process.env, stdio: ['ignore', 'pipe', 'pipe'],
      });
      console.info('P3 crash/restart evidence: worker child spawned');
      child.stdout?.on('data', (chunk: Buffer) => { childOutput += chunk.toString(); console.info('P3 worker child stdout:', chunk.toString().trim()); });
      child.stderr?.on('data', (chunk: Buffer) => { childOutput += chunk.toString(); console.info('P3 worker child stderr:', chunk.toString().trim()); });
      const deadline = Date.now() + 20_000;
      let partialCommitObserved = false;
      while (Date.now() < deadline) {
        const { rows } = await pool.query<{ outcome: string }>(
          'SELECT outcome FROM import_batch_rows WHERE batch_id = $1 ORDER BY source_row_number', [batchId]
        );
        if (rows[0]?.outcome === 'created' && rows[1]?.outcome === 'pending') {
          partialCommitObserved = true;
          console.info('P3 crash/restart evidence: first row committed while second row remained pending');
          break;
        }
        if (child.exitCode !== null) throw new Error(`Worker child exited early: ${childOutput}`);
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(childOutput).toContain('P3_WORKER_CHILD_READY');
      expect(partialCommitObserved).toBe(true);

      const competing = await pool.connect();
      try {
        const { rows } = await competing.query<{ locked: boolean }>('SELECT pg_try_advisory_lock($1) AS locked', [812_771_039]);
        expect(rows[0].locked).toBe(false);
      } finally { competing.release(); }

      const childExit = new Promise<void>((resolve) => child!.once('exit', () => resolve()));
      child.kill();
      await childExit;
      console.info('P3 crash/restart evidence: worker process exited');
      await pool.query("UPDATE import_batches SET lease_until = NOW() - INTERVAL '1 second' WHERE id = $1", [batchId]);
      // Remove the deliberate slow trigger before the replacement worker resumes the batch.
      await pool.query('DROP TRIGGER p3_test_pause_import_insert ON light_points');
      await pool.query('DROP FUNCTION p3_test_pause_import_insert()');

      await startImportQueueWorker();
      workerStarted = true;
      console.info('P3 crash/restart evidence: replacement worker acquired queue');
    } finally {
      if (child && child.exitCode === null && child.signalCode === null) {
        const childExit = new Promise<void>((resolve) => child!.once('exit', () => resolve()));
        child.kill();
        await childExit;
      }
      if (!workerStarted) {
        console.info('P3 crash/restart evidence: cleaning trigger before worker restart');
        await pool.query('DROP TRIGGER IF EXISTS p3_test_pause_import_insert ON light_points');
        await pool.query('DROP FUNCTION IF EXISTS p3_test_pause_import_insert()');
      }
    }
    console.info('P3 crash/restart evidence: child cleanup complete');

    const batch = await waitForBatch(batchId);
    console.info('P3 crash/restart evidence: recovered batch reached terminal state');
    const laterBatch = await waitForBatch(secondBatch.batchId);
    console.info('P3 crash/restart evidence: FIFO batch reached terminal state');
    expect(batch).toMatchObject({ status: 'completed', total_rows: 2, successful_rows: 2, created_rows: 2 });
    expect(laterBatch).toMatchObject({ status: 'completed', total_rows: 1, successful_rows: 1, created_rows: 1 });
    expect(new Date(String(batch.started_at)).getTime()).toBeLessThanOrEqual(new Date(String(laterBatch.started_at)).getTime());
    const attempts = await pool.query<{ attempt_count: number }>('SELECT attempt_count FROM import_batches WHERE id = $1', [batchId]);
    expect(attempts.rows[0].attempt_count).toBe(2);
    const firstAudit = await pool.query('SELECT id FROM inventory_audit_events WHERE import_batch_id = $1 AND inventory_number_snapshot = $2', [batchId, identities[0]]);
    expect(firstAudit.rows).toHaveLength(1);
    const inventory = await pool.query('SELECT id FROM light_points WHERE inventory_number = ANY($1::text[])', [identities]);
    expect(inventory.rows).toHaveLength(2);
    const owner = await pool.query<{ worker_token: string | null; lease_until: Date | null }>(
      'SELECT worker_token, lease_until FROM import_batches WHERE id = $1', [batchId]
    );
    expect(owner.rows[0]).toMatchObject({ worker_token: null, lease_until: null });
    console.info('P3 crash/restart evidence: results and audit assertions passed');
    await stopTestWorker();
  }, 60_000);

  it('keeps imports geocoder-free and audits startup/background geocoding with a system actor', async () => {
    const restoreConfig = enableAutomaticGeocoding();
    reverseGeocodeMock.mockReset();
    mockGeocodedAddress('Synthetic background address');
    try {
      const existingIdentity = `${prefix}geocode-import-update`;
      await insertFixture(existingIdentity, { address: 'Before import' });
      const preview = await createPreview('geocode-import', [
        { inventory_number: `${prefix}geocode-import-create`, longitude: 21.3, latitude: 48.8 },
        { inventory_number: existingIdentity, longitude: 21.31, latitude: 48.81, address: 'After import' },
      ]);
      const confirmed = await confirmImport(adminId, preview.previewId, true);
      await startImportQueueWorker();
      workerStarted = true;
      const imported = await waitForBatch(confirmed.batchId);
      expect(imported).toMatchObject({ status: 'completed', total_rows: 2, created_rows: 1, updated_rows: 1 });
      expect(reverseGeocodeMock).not.toHaveBeenCalled();
      await stopTestWorker();

      const backgroundId = await insertFixture(`${prefix}geocode-background`, { address: null });
      reverseGeocodeMock.mockClear();
      const processed = await geocodePendingLightPoints();
      expect(processed).toBeGreaterThan(0);
      expect(reverseGeocodeMock).toHaveBeenCalled();
      const background = await pool.query<{ address: string | null }>(
        'SELECT address FROM light_points WHERE id = $1', [backgroundId]
      );
      expect(background.rows[0].address).toBe('Synthetic background address');
      const audit = await pool.query<{
        actor_admin_id: number | null; actor_username_snapshot: string | null;
        action: string; changed_fields: Record<string, unknown>;
      }>(
        `SELECT actor_admin_id, actor_username_snapshot, action, changed_fields
           FROM inventory_audit_events WHERE entity_id_snapshot = $1 ORDER BY id`, [backgroundId]
      );
      expect(audit.rows).toEqual([{
        actor_admin_id: null,
        actor_username_snapshot: 'system:automatic-geocoding',
        action: 'update',
        changed_fields: { address: { before: null, after: 'Synthetic background address' } },
      }]);
    } finally {
      if (workerStarted) await stopTestWorker();
      restoreConfig();
      reverseGeocodeMock.mockReset();
    }
  }, 60_000);
});
