import { pool } from '../db/pool.js';
import { withTransaction } from '../db/transaction.js';
import { canonicalizeInventoryNumber } from '../domain/inventoryIdentity.js';
import type {
  CreateLightPointInput,
  LightPointRow,
  UpdateLightPointInput,
} from '../types/lightPoint.js';
import { config } from '../config/index.js';
import { AppError } from '../utils/AppError.js';
import { reverseGeocode } from './geocoding.service.js';

const LIGHT_POINT_COLUMNS = `
  id, inventory_number, external_id,
  ST_Y(geom)::text AS latitude, ST_X(geom)::text AS longitude,
  address, district, lamp_type, status
`;

function normalizeIdentity(value: unknown): string {
  if (typeof value !== 'string') throw new AppError(400, 'Inventory number is required');
  const identity = canonicalizeInventoryNumber(value);
  if (!identity) throw new AppError(400, 'Inventory number is required');
  return identity;
}

function safeChangedFields(before: Record<string, unknown>, after: Record<string, unknown>): Record<string, unknown> {
  const allowed = ['inventory_number', 'external_id', 'longitude', 'latitude', 'address', 'district', 'lamp_type', 'status'];
  const result: Record<string, unknown> = {};
  for (const field of allowed) {
    const same = (field === 'latitude' || field === 'longitude')
      ? Number(before[field]) === Number(after[field])
      : before[field] === after[field];
    if (!same) result[field] = { before: before[field], after: after[field] };
  }
  return result;
}

async function insertAudit(
  client: import('pg').PoolClient,
  actorAdminId: number | null,
  actorUsernameSnapshot: string | null,
  entityId: number,
  inventoryNumber: string,
  action: 'create' | 'update' | 'delete',
  changedFields: Record<string, unknown>
): Promise<void> {
  await client.query(
    `INSERT INTO inventory_audit_events
       (actor_admin_id, actor_username_snapshot, entity_id_snapshot, inventory_number_snapshot, action, changed_fields)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [actorAdminId, actorUsernameSnapshot, entityId, inventoryNumber, action, JSON.stringify(changedFields)]
  );
}

/** Assign address from coordinates only when explicitly enabled/configured. */
export async function ensureLightPointAddress(
  id: number,
  force = false,
  manual = false
): Promise<string | null> {
  if (!config.geocoding.autoGeocode && !force && !manual) {
    const current = await getLightPointById(id);
    return current?.address ?? null;
  }
  const { rows } = await pool.query<{
    id: number;
    latitude: string;
    longitude: string;
    address: string | null;
    address_geocoded_at: Date | null;
  }>(
    `SELECT id, ST_Y(geom)::text AS latitude, ST_X(geom)::text AS longitude,
            address, address_geocoded_at
       FROM light_points WHERE id = $1`,
    [id]
  );
  const row = rows[0];
  if (!row) throw new AppError(404, 'Light point not found');
  if (!force && row.address_geocoded_at) return row.address;

  // Network I/O stays outside the transaction; the coordinate snapshot is checked again under lock.
  const { address } = await reverseGeocode(Number(row.latitude), Number(row.longitude));
  return withTransaction(async (client) => {
    const { rows: currentRows } = await client.query<{
      id: number;
      inventory_number: string;
      latitude: string;
      longitude: string;
      address: string | null;
      address_geocoded_at: Date | null;
    }>(
      `SELECT id, inventory_number, ST_Y(geom)::text AS latitude, ST_X(geom)::text AS longitude,
              address, address_geocoded_at
         FROM light_points WHERE id = $1 FOR UPDATE`,
      [id]
    );
    const current = currentRows[0];
    if (!current) throw new AppError(404, 'Light point not found');
    if (
      Number(current.latitude) !== Number(row.latitude)
      || Number(current.longitude) !== Number(row.longitude)
      || current.address !== row.address
    ) {
      return current.address;
    }
    if (!force && current.address_geocoded_at) return current.address;
    if (current.address === address) return current.address;

    await client.query(
      `UPDATE light_points SET address = $1, address_geocoded_at = NOW(), updated_at = NOW() WHERE id = $2`,
      [address, id]
    );
    await insertAudit(
      client,
      null,
      manual ? 'system:maintenance-geocoding' : 'system:automatic-geocoding',
      id,
      current.inventory_number,
      'update',
      { address: { before: current.address, after: address } }
    );
    return address;
  });
}

async function applyOptionalAutomaticAddressEnrichment(point: LightPointRow): Promise<LightPointRow> {
  try {
    return { ...point, address: await ensureLightPointAddress(point.id) };
  } catch {
    // The inventory mutation already committed; optional enrichment must not misreport it as failed.
    console.warn('Automatic inventory address enrichment failed');
    return point;
  }
}

export async function geocodePendingLightPoints(manual = false): Promise<number> {
  if (!config.geocoding.autoGeocode && !manual) return 0;
  const { rows } = await pool.query<{ id: number }>(
    `SELECT id FROM light_points WHERE address_geocoded_at IS NULL ORDER BY id`
  );
  let updated = 0;
  for (const row of rows) {
    try { await ensureLightPointAddress(row.id, false, manual); updated += 1; console.log('Inventory geocode completed'); }
    catch { console.warn('Inventory geocode failed'); }
  }
  return updated;
}

export async function getAllLightPoints(): Promise<LightPointRow[]> {
  const { rows } = await pool.query<LightPointRow>(
    `SELECT ${LIGHT_POINT_COLUMNS} FROM light_points ORDER BY id`
  );
  return rows;
}

export async function getLightPointsInViewport(bbox: readonly number[]): Promise<LightPointRow[]> {
  if (bbox.length !== 4 || bbox.some((value) => !Number.isFinite(value))) {
    throw new AppError(400, 'Invalid viewport bounds');
  }
  const [west, south, east, north] = bbox;
  if (west < -180 || east > 180 || south < -90 || north > 90 || west >= east || south >= north) {
    throw new AppError(400, 'Invalid viewport bounds');
  }
  const { rows } = await pool.query<LightPointRow>(
    `SELECT ${LIGHT_POINT_COLUMNS}
       FROM light_points
      WHERE ST_Intersects(geom, ST_MakeEnvelope($1, $2, $3, $4, 4326))
      ORDER BY inventory_number COLLATE "C", id`,
    [west, south, east, north]
  );
  return rows;
}

export async function getLightPointById(id: string | number): Promise<LightPointRow | null> {
  const numericId = Number(id);
  if (!Number.isSafeInteger(numericId) || numericId <= 0) return null;
  const { rows } = await pool.query<LightPointRow>(
    `SELECT ${LIGHT_POINT_COLUMNS} FROM light_points WHERE id = $1`, [numericId]
  );
  return rows[0] ?? null;
}

export async function createLightPoint(
  input: CreateLightPointInput,
  actorAdminId: number | null = null,
  actorUsernameSnapshot: string | null = null,
  importBatchId: number | null = null
): Promise<LightPointRow> {
  const inventoryNumber = normalizeIdentity(input.inventory_number);
  const status = input.status ?? 'active';
  const point = await withTransaction(async (client) => {
    const { rows } = await client.query<{ id: number }>(
      `INSERT INTO light_points
         (inventory_number, external_id, geom, address, district, lamp_type, status)
       VALUES ($1, $2, ST_SetSRID(ST_MakePoint($3, $4), 4326), $5, $6, $7, $8)
       RETURNING id`,
      [inventoryNumber, input.external_id ?? null, input.longitude, input.latitude,
        input.address ?? null, input.district ?? null, input.lamp_type ?? null, status]
    );
    const id = rows[0].id;
    await client.query(
      `INSERT INTO inventory_audit_events
         (actor_admin_id, actor_username_snapshot, entity_id_snapshot, inventory_number_snapshot, action, import_batch_id, changed_fields)
       VALUES ($1, $2, $3, $4, 'create', $5, $6)`,
      [actorAdminId, actorUsernameSnapshot, id, inventoryNumber, importBatchId, JSON.stringify({
        inventory_number: { before: null, after: inventoryNumber },
        external_id: { before: null, after: input.external_id ?? null },
        longitude: { before: null, after: input.longitude }, latitude: { before: null, after: input.latitude },
        address: { before: null, after: input.address ?? null }, district: { before: null, after: input.district ?? null },
        lamp_type: { before: null, after: input.lamp_type ?? null }, status: { before: null, after: status },
      })]
    );
    const { rows: result } = await client.query<LightPointRow>(
      `SELECT ${LIGHT_POINT_COLUMNS} FROM light_points WHERE id = $1`, [id]
    );
    return result[0];
  });
  if (!point) throw new AppError(500, 'Failed to load created light point');
  // Legacy geocoding is opt-in; the import worker writes rows through its own transaction path.
  return applyOptionalAutomaticAddressEnrichment(point);
}

export async function updateLightPoint(
  id: string | number,
  input: UpdateLightPointInput,
  actorAdminId: number | null = null,
  actorUsernameSnapshot: string | null = null,
  importBatchId: number | null = null
): Promise<LightPointRow> {
  const numericId = Number(id);
  if (!Number.isSafeInteger(numericId) || numericId <= 0) throw new AppError(404, 'Light point not found');
  const point = await withTransaction(async (client) => {
    const { rows: found } = await client.query<LightPointRow>(
      `SELECT ${LIGHT_POINT_COLUMNS} FROM light_points WHERE id = $1 FOR UPDATE`, [numericId]
    );
    const existing = found[0];
    if (!existing) throw new AppError(404, 'Light point not found');
    const next: LightPointRow = {
      ...existing,
      inventory_number: input.inventory_number === undefined ? existing.inventory_number : normalizeIdentity(input.inventory_number),
      external_id: input.external_id === undefined ? existing.external_id : input.external_id,
      latitude: String(input.latitude ?? Number(existing.latitude)),
      longitude: String(input.longitude ?? Number(existing.longitude)),
      address: input.address === undefined ? existing.address : input.address,
      district: input.district === undefined ? existing.district : input.district,
      lamp_type: input.lamp_type === undefined ? existing.lamp_type : input.lamp_type,
      status: input.status ?? existing.status,
    };
    const changedFields = safeChangedFields(existing as unknown as Record<string, unknown>, next as unknown as Record<string, unknown>);
    if (Object.keys(changedFields).length === 0) return existing;
    const coordsChanged = Number(existing.latitude) !== Number(next.latitude) || Number(existing.longitude) !== Number(next.longitude);
    await client.query(
      `UPDATE light_points SET inventory_number = $2, external_id = $3,
         geom = ST_SetSRID(ST_MakePoint($4, $5), 4326), address = $6,
         address_geocoded_at = CASE WHEN $7 THEN NULL ELSE address_geocoded_at END,
         district = $8, lamp_type = $9, status = $10, updated_at = NOW()
       WHERE id = $1`,
      [numericId, next.inventory_number, next.external_id, Number(next.longitude), Number(next.latitude),
        next.address, coordsChanged, next.district, next.lamp_type, next.status]
    );
    await client.query(
      `INSERT INTO inventory_audit_events
         (actor_admin_id, actor_username_snapshot, entity_id_snapshot, inventory_number_snapshot, action, import_batch_id, changed_fields)
       VALUES ($1, $2, $3, $4, 'update', $5, $6)`,
      [actorAdminId, actorUsernameSnapshot, numericId, next.inventory_number, importBatchId, JSON.stringify(changedFields)]
    );
    const { rows } = await client.query<LightPointRow>(
      `SELECT ${LIGHT_POINT_COLUMNS} FROM light_points WHERE id = $1`, [numericId]
    );
    return rows[0];
  });
  if (!point) throw new AppError(500, 'Failed to load updated light point');
  return applyOptionalAutomaticAddressEnrichment(point);
}

export async function deleteLightPoint(
  id: string | number,
  actorAdminId: number | null = null,
  actorUsernameSnapshot: string | null = null
): Promise<{ id: number; deleted: true }> {
  const numericId = Number(id);
  return withTransaction(async (client) => {
    const { rows } = await client.query<{ id: number; inventory_number: string; external_id: string | null; geom: string; address: string | null }>(
      `SELECT id, inventory_number, external_id, ST_AsText(geom) AS geom, address
         FROM light_points WHERE id = $1 FOR UPDATE`, [numericId]
    );
    const existing = rows[0];
    if (!existing) throw new AppError(404, 'Street light not found');
    await insertAudit(client, actorAdminId, actorUsernameSnapshot, numericId, existing.inventory_number, 'delete', {
      inventory_number: { before: existing.inventory_number, after: null },
      external_id: { before: existing.external_id, after: null },
      geom: { before: existing.geom, after: null }, address: { before: existing.address, after: null },
    });
    await client.query('DELETE FROM light_points WHERE id = $1', [numericId]);
    return { id: numericId, deleted: true as const };
  });
}
