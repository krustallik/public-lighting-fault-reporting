import crypto from 'node:crypto';
import path from 'node:path';
import { pool } from '../db/pool.js';
import { canonicalizeInventoryNumber } from '../domain/inventoryIdentity.js';
import type { LightPointStatus } from '../types/index.js';
import { AppError } from '../utils/AppError.js';

export interface ImportPayload {
  inventory_number: string;
  external_id?: string | null;
  latitude: number;
  longitude: number;
  address?: string | null;
  district?: string | null;
  lamp_type?: string | null;
  status?: LightPointStatus;
  present: string[];
}

export interface ParsedImportRow {
  rowIndex: number;
  inventoryNumber: string;
  payload: ImportPayload | null;
  errorCode?: string;
  message?: string;
  duplicateOf?: number;
}

export interface ImportRowResult {
  rowIndex: number;
  inventoryNumber: string;
  action: 'create' | 'update' | 'unchanged' | 'skip' | 'error';
  message?: string;
  existingId?: number;
  code?: string;
}

export interface ImportPreview {
  previewId: string;
  filename: string;
  totalRows: number;
  results: ImportRowResult[];
  pagination: { page: number; limit: number; totalPages: number };
  summary: { toCreate: number; toUpdate: number; unchanged: number; skipped: number; errors: number };
}

const ALLOWED_FIELDS = ['inventory_number', 'external_id', 'latitude', 'longitude', 'address', 'district', 'lamp_type', 'status'] as const;

async function cleanupExpiredPreviews(): Promise<void> {
  await pool.query("DELETE FROM import_batches WHERE status = 'preview' AND preview_expires_at <= NOW()");
}

function safeFilename(filename: string): string {
  return path.basename(filename.replace(/\\/g, '/')).replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 255) || 'import';
}

function asOptionalText(value: unknown): string | null | undefined {
  if (value === null || value === '') return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return undefined;
}

function firstOwn(record: Record<string, unknown>, keys: string[]): { found: boolean; value?: unknown } {
  const key = keys.find((candidate) => Object.prototype.hasOwnProperty.call(record, candidate));
  return key === undefined ? { found: false } : { found: true, value: record[key] };
}

function parseNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return undefined;
}

function parseRecord(raw: unknown, rowIndex: number, coordinates?: unknown): ParsedImportRow {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { rowIndex, inventoryNumber: '', payload: null, errorCode: 'invalid_row', message: 'Row must be an object' };
  }
  const record = raw as Record<string, unknown>;
  const identityField = firstOwn(record, ['inventory_number', 'inventoryNumber']);
  const rawIdentity = typeof identityField.value === 'string' ? identityField.value : '';
  const inventoryNumber = canonicalizeInventoryNumber(rawIdentity);
  if (!inventoryNumber) return { rowIndex, inventoryNumber: '', payload: null, errorCode: 'missing_inventory_number', message: 'Missing inventory number' };

  const geo = Array.isArray(coordinates) ? coordinates : undefined;
  const longitudeField = geo ? { found: true, value: geo[0] } : firstOwn(record, ['longitude', 'lon', 'lng']);
  const latitudeField = geo ? { found: true, value: geo[1] } : firstOwn(record, ['latitude', 'lat']);
  const longitude = parseNumber(longitudeField.value);
  const latitude = parseNumber(latitudeField.value);
  if (!longitudeField.found || !latitudeField.found || latitude === undefined || longitude === undefined) {
    return { rowIndex, inventoryNumber, payload: null, errorCode: 'invalid_coordinates', message: 'Valid latitude and longitude are required' };
  }
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
    return { rowIndex, inventoryNumber, payload: null, errorCode: 'invalid_coordinates', message: 'Coordinates are outside the valid range' };
  }

  const payload: ImportPayload = { inventory_number: inventoryNumber, latitude, longitude, present: ['inventory_number', 'latitude', 'longitude'] };
  const external = firstOwn(record, ['external_id', 'externalId']);
  if (external.found) {
    const value = asOptionalText(external.value);
    if (value === undefined) return { rowIndex, inventoryNumber, payload: null, errorCode: 'invalid_external_id', message: 'External ID must be text or null' };
    payload.external_id = value;
    payload.present.push('external_id');
  }
  const fields: Array<[string, string[]]> = [
    ['address', ['address']], ['district', ['district']], ['lamp_type', ['lamp_type', 'lampType']],
  ];
  for (const [target, aliases] of fields) {
    const field = firstOwn(record, aliases);
    if (!field.found) continue;
    const value = asOptionalText(field.value);
    if (value === undefined) return { rowIndex, inventoryNumber, payload: null, errorCode: `invalid_${target}`, message: `${target} must be text or null` };
    (payload as unknown as Record<string, unknown>)[target] = value;
    payload.present.push(target);
  }
  const status = firstOwn(record, ['status']);
  if (status.found) {
    if (typeof status.value !== 'string' || !['active', 'inactive', 'maintenance'].includes(status.value)) {
      return { rowIndex, inventoryNumber, payload: null, errorCode: 'invalid_status', message: 'Status must be active, inactive, or maintenance' };
    }
    payload.status = status.value as LightPointStatus;
    payload.present.push('status');
  }
  return { rowIndex, inventoryNumber, payload };
}

/** Parse RFC-style quoted CSV records, including embedded CR/LF and doubled quotes. */
function parseCsvRecords(text: string): string[][] {
  const records: string[][] = [];
  let record: string[] = [];
  let cell = '';
  let quoted = false;
  let closedQuote = false;
  const finishCell = () => { record.push(cell); cell = ''; closedQuote = false; };
  const finishRecord = () => {
    finishCell();
    if (!(record.length === 1 && record[0].trim() === '')) records.push(record);
    record = [];
  };
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i += 1; }
      else if (ch === '"') { quoted = false; closedQuote = true; }
      else cell += ch;
      continue;
    }
    if (closedQuote && ch !== ',' && ch !== '\r' && ch !== '\n' && ch !== ' ' && ch !== '\t') {
      throw new AppError(400, 'Malformed quoted CSV field');
    }
    if (ch === '"' && cell.length === 0) { quoted = true; continue; }
    if (ch === ',') { finishCell(); continue; }
    if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && text[i + 1] === '\n') i += 1;
      finishRecord();
      continue;
    }
    if (!closedQuote) cell += ch;
  }
  if (quoted) throw new AppError(400, 'Unclosed quoted CSV field');
  if (cell.length || record.length || closedQuote) finishRecord();
  return records.filter((row) => !(row.length === 1 && row[0].trimStart().startsWith('#')));
}

function parseCsv(text: string): ParsedImportRow[] {
  const records = parseCsvRecords(text.replace(/^\uFEFF/, ''));
  if (records.length < 2) throw new AppError(400, 'Import file has no data records');
  const headers = records[0].map((cell) => cell.trim());
  if (new Set(headers).size !== headers.length) throw new AppError(400, 'CSV header contains duplicate fields');
  const findHeader = (aliases: string[]) => headers.findIndex((header) => aliases.includes(header));
  const identity = findHeader(['inventory_number', 'inventoryNumber']);
  const latitude = findHeader(['latitude', 'lat']);
  const longitude = findHeader(['longitude', 'lon', 'lng']);
  if (identity < 0 || latitude < 0 || longitude < 0) throw new AppError(400, 'CSV requires inventory number, latitude, and longitude columns');
  const rows: ParsedImportRow[] = [];
  for (let rowIdx = 1; rowIdx < records.length; rowIdx += 1) {
    const values = records[rowIdx];
    if (values.length !== headers.length) {
      rows.push({ rowIndex: rowIdx, inventoryNumber: '', payload: null, errorCode: 'malformed_record', message: 'CSV row has a different number of fields than its header' });
      continue;
    }
    const obj: Record<string, unknown> = {};
    headers.forEach((header, index) => { obj[header] = values[index]; });
    rows.push(parseRecord(obj, rowIdx));
  }
  return rows;
}

export function parseImportSource(buffer: Buffer, mimetype: string, originalname: string): ParsedImportRow[] {
  const text = buffer.toString('utf8');
  if (!text.trim()) throw new AppError(400, 'Import file is empty');
  const name = originalname.toLowerCase();
  const isJson = mimetype.includes('json') || name.endsWith('.json') || name.endsWith('.geojson');
  if (!isJson) return parseCsv(text);
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { throw new AppError(400, 'Import file is not valid JSON'); }
  if (Array.isArray(parsed)) return parsed.map((item, index) => parseRecord(item, index + 1));
  if (parsed && typeof parsed === 'object' && 'features' in parsed) {
    const features = (parsed as { features?: unknown }).features;
    if (!Array.isArray(features)) throw new AppError(400, 'GeoJSON FeatureCollection requires a features array');
    return features.map((item, index) => {
      if (!item || typeof item !== 'object') return parseRecord(null, index + 1);
      const feature = item as { properties?: unknown; geometry?: { type?: unknown; coordinates?: unknown } | null };
      if (!feature.geometry || feature.geometry.type !== 'Point' || !Array.isArray(feature.geometry.coordinates)) {
        return { rowIndex: index + 1, inventoryNumber: '', payload: null, errorCode: 'invalid_geometry', message: 'GeoJSON feature must contain a Point geometry' };
      }
      return parseRecord(feature.properties, index + 1, feature.geometry.coordinates);
    });
  }
  if (parsed && typeof parsed === 'object') return [parseRecord(parsed, 1)];
  throw new AppError(400, 'Unsupported JSON import structure');
}

/** Backward-named export retained for focused parser callers; now returns all source rows with errors. */
export const parseImportBuffer = parseImportSource;

function sameEffectivePayload(left: ImportPayload, right: ImportPayload): boolean {
  return JSON.stringify({ ...left, present: [...left.present].sort() }) ===
    JSON.stringify({ ...right, present: [...right.present].sort() });
}

export async function buildImportPreview(
  adminId: number,
  filename: string,
  parsedRows: ParsedImportRow[],
  uploaderUsername: string | null = null,
  page = 1,
  limit = 50
): Promise<ImportPreview> {
  await cleanupExpiredPreviews();
  const duplicateGroups = new Map<string, ParsedImportRow[]>();
  for (const row of parsedRows) if (row.inventoryNumber) duplicateGroups.set(row.inventoryNumber, [...(duplicateGroups.get(row.inventoryNumber) ?? []), row]);
  const duplicateSkips = new Set<number>();
  const duplicateConflicts = new Set<number>();
  for (const [identity, group] of duplicateGroups) {
    if (group.length < 2) continue;
    const payloads = group.map((row) => row.payload);
    const allSame = payloads.every((payload): payload is ImportPayload => payload !== null) &&
      payloads.slice(1).every((payload) => sameEffectivePayload(payloads[0]!, payload));
    if (!allSame) {
      group.forEach((row) => { duplicateConflicts.add(row.rowIndex); row.errorCode = 'conflicting_duplicate_inventory_number'; row.message = 'Conflicting rows use the same inventory number'; });
    } else {
      for (const duplicate of group.slice(1)) { duplicateSkips.add(duplicate.rowIndex); duplicate.duplicateOf = group[0].rowIndex; }
      for (const row of group) row.inventoryNumber = identity;
    }
  }

  const identities = [...new Set(parsedRows.filter((row) => row.payload && !duplicateConflicts.has(row.rowIndex) && !duplicateSkips.has(row.rowIndex)).map((row) => row.payload!.inventory_number))];
  const existing = new Map<string, number>();
  for (let offset = 0; offset < identities.length; offset += 500) {
    const chunk = identities.slice(offset, offset + 500);
    const { rows } = await pool.query<{ inventory_number: string; id: number }>(
      `SELECT inventory_number, id FROM light_points WHERE inventory_number = ANY($1::text[])`, [chunk]
    );
    for (const row of rows) existing.set(row.inventory_number, row.id);
  }
  const results: ImportRowResult[] = [];
  const summary = { toCreate: 0, toUpdate: 0, unchanged: 0, skipped: 0, errors: 0 };
  for (const row of parsedRows) {
    const existingId = row.payload ? existing.get(row.payload.inventory_number) : undefined;
    let result: ImportRowResult;
    if (duplicateSkips.has(row.rowIndex)) {
      result = { rowIndex: row.rowIndex, inventoryNumber: row.inventoryNumber, action: 'skip', message: `Identical duplicate of row ${row.duplicateOf}`, code: 'duplicate_in_same_import' };
      summary.skipped += 1;
    } else if (row.errorCode || !row.payload || duplicateConflicts.has(row.rowIndex)) {
      result = { rowIndex: row.rowIndex, inventoryNumber: row.inventoryNumber, action: 'error', message: row.message ?? 'Invalid row', code: row.errorCode ?? 'invalid_row' };
      summary.errors += 1;
    } else if (existingId) {
      result = { rowIndex: row.rowIndex, inventoryNumber: row.inventoryNumber, action: 'update', existingId, message: 'Matching inventory number exists; checkbox controls whether represented fields are replaced' };
      summary.toUpdate += 1;
    } else {
      result = { rowIndex: row.rowIndex, inventoryNumber: row.inventoryNumber, action: 'create' };
      summary.toCreate += 1;
    }
    results.push(result);
  }
  const previewId = crypto.randomUUID();
  const safePage = Math.max(1, Math.trunc(page));
  const safeLimit = Math.min(100, Math.max(1, Math.trunc(limit)));
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: batchRows } = await client.query<{ id: number }>(
      `INSERT INTO import_batches
         (filename, uploaded_by_admin_id, uploaded_by_username_snapshot, total_rows, status, update_existing,
          confirmation_key, preview_expires_at, skipped_rows, failed_rows)
       VALUES ($1, $2, $3, $4, 'preview', FALSE, $5, NOW() + INTERVAL '15 minutes', $6, $7)
       RETURNING id`,
      [safeFilename(filename), adminId, uploaderUsername, parsedRows.length, previewId, summary.skipped, summary.errors]
    );
    const batchId = batchRows[0].id;
    for (let index = 0; index < parsedRows.length; index += 1) {
      const row = parsedRows[index];
      const result = results[index];
      const outcome = result.action === 'error' ? 'failed' : result.action === 'skip' ? 'skipped' : 'pending';
      const payload = outcome === 'pending' ? JSON.stringify(row.payload) : null;
      await client.query(
        `INSERT INTO import_batch_rows
           (batch_id, source_row_number, inventory_number, outcome, preview_action, preview_existing_id,
            reason_code, safe_reason, payload)
         VALUES ($1, $2, NULLIF($3, ''), $4, $5, $6, $7, $8, $9::jsonb)`,
        [batchId, row.rowIndex, row.inventoryNumber, outcome, result.action, result.existingId ?? null,
          result.code ?? null, result.message ?? null, payload]
      );
    }
    await client.query('COMMIT');
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { /* preserve the original error */ }
    throw error;
  } finally { client.release(); }
  const start = (safePage - 1) * safeLimit;
  return {
    previewId, filename: safeFilename(filename), totalRows: parsedRows.length,
    results: results.slice(start, start + safeLimit), summary,
    pagination: { page: safePage, limit: safeLimit, totalPages: Math.ceil(results.length / safeLimit) || 1 },
  };
}

export async function getImportPreviewPage(adminId: number, previewId: string, page = 1, limit = 50): Promise<ImportPreview> {
  await cleanupExpiredPreviews();
  const safePage = Math.max(1, Math.trunc(page));
  const safeLimit = Math.min(100, Math.max(1, Math.trunc(limit)));
  const start = (safePage - 1) * safeLimit;
  const { rows: batches } = await pool.query<{ filename: string; total_rows: number }>(
    `SELECT filename, total_rows FROM import_batches
      WHERE confirmation_key = $1 AND uploaded_by_admin_id = $2 AND status = 'preview'`, [previewId, adminId]
  );
  const batch = batches[0];
  if (!batch) throw new AppError(404, 'Import preview expired or not found');
  const { rows } = await pool.query<{
    source_row_number: number; inventory_number: string | null; preview_action: ImportRowResult['action'];
    preview_existing_id: number | null; reason_code: string | null; safe_reason: string | null;
  }>(
    `SELECT source_row_number, inventory_number, preview_action, preview_existing_id, reason_code, safe_reason
       FROM import_batch_rows WHERE batch_id = (SELECT id FROM import_batches WHERE confirmation_key = $1)
      ORDER BY source_row_number LIMIT $2 OFFSET $3`, [previewId, safeLimit, start]
  );
  const { rows: counts } = await pool.query<{
    to_create: string; to_update: string; unchanged: string; skipped: string; errors: string;
  }>(
    `SELECT COUNT(*) FILTER (WHERE preview_action = 'create')::text AS to_create,
            COUNT(*) FILTER (WHERE preview_action = 'update')::text AS to_update,
            COUNT(*) FILTER (WHERE preview_action = 'unchanged')::text AS unchanged,
            COUNT(*) FILTER (WHERE outcome = 'skipped')::text AS skipped,
            COUNT(*) FILTER (WHERE outcome = 'failed')::text AS errors
       FROM import_batch_rows WHERE batch_id = (SELECT id FROM import_batches WHERE confirmation_key = $1)`, [previewId]
  );
  const resultCounts = counts[0];
  return {
    previewId, filename: batch.filename, totalRows: batch.total_rows,
    results: rows.map((row) => ({
      rowIndex: row.source_row_number, inventoryNumber: row.inventory_number ?? '', action: row.preview_action,
      ...(row.preview_existing_id === null ? {} : { existingId: row.preview_existing_id }),
      ...(row.reason_code ? { code: row.reason_code } : {}),
      ...(row.safe_reason ? { message: row.safe_reason } : {}),
    })),
    summary: {
      toCreate: Number(resultCounts.to_create), toUpdate: Number(resultCounts.to_update),
      unchanged: Number(resultCounts.unchanged), skipped: Number(resultCounts.skipped), errors: Number(resultCounts.errors),
    },
    pagination: { page: safePage, limit: safeLimit, totalPages: Math.ceil(batch.total_rows / safeLimit) || 1 },
  };
}

export async function confirmImport(
  adminId: number,
  previewId: string,
  allowUpdate: boolean
): Promise<{ batchId: number; status: string; totalRows: number }> {
  await cleanupExpiredPreviews();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query<{
      id: number; status: string; total_rows: number; preview_expires_at: Date | null;
    }>(
      `SELECT id, status, total_rows, preview_expires_at FROM import_batches
        WHERE confirmation_key = $1 AND uploaded_by_admin_id = $2 FOR UPDATE`, [previewId, adminId]
    );
    const batch = rows[0];
    if (!batch) throw new AppError(400, 'Import preview expired or not found');
    if (batch.status === 'preview') {
      if (!batch.preview_expires_at || batch.preview_expires_at.getTime() <= Date.now()) {
        throw new AppError(400, 'Import preview expired or not found');
      }
      await client.query(
        `UPDATE import_batches SET status = 'queued', update_existing = $2, queued_at = NOW(), preview_expires_at = NULL,
           successful_rows = 0, applied_rows = 0, created_rows = 0, updated_rows = 0, unchanged_rows = 0,
           skipped_rows = (SELECT COUNT(*) FROM import_batch_rows WHERE batch_id = $1 AND outcome = 'skipped'),
           failed_rows = (SELECT COUNT(*) FROM import_batch_rows WHERE batch_id = $1 AND outcome = 'failed')
         WHERE id = $1`, [batch.id, allowUpdate]
      );
      batch.status = 'queued';
    }
    await client.query('COMMIT');
    return { batchId: batch.id, status: batch.status, totalRows: batch.total_rows };
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { /* preserve the original error */ }
    throw error;
  } finally { client.release(); }
}

export async function listImportBatches(limit = 50, offset = 0) {
  const safeLimit = Math.min(100, Math.max(1, Math.trunc(limit)));
  const safeOffset = Math.max(0, Math.trunc(offset));
  const { rows } = await pool.query(
    `SELECT b.id, b.filename, b.uploaded_by_admin_id,
            COALESCE(b.uploaded_by_username_snapshot, a.username) AS uploaded_by_username,
            b.total_rows, b.created_rows, b.updated_rows, b.skipped_rows, b.failed_rows,
            b.successful_rows, b.applied_rows, b.unchanged_rows, b.status,
            b.created_at, b.queued_at, b.started_at, b.completed_at
       FROM import_batches b LEFT JOIN admins a ON a.id = b.uploaded_by_admin_id
      ORDER BY b.created_at DESC, b.id DESC LIMIT $1 OFFSET $2`, [safeLimit, safeOffset]
  );
  return rows;
}

export async function getImportBatch(batchId: number) {
  const { rows } = await pool.query(
    `SELECT b.id, b.filename, b.uploaded_by_admin_id,
            COALESCE(b.uploaded_by_username_snapshot, a.username) AS uploaded_by_username,
            b.total_rows, b.created_rows, b.updated_rows, b.skipped_rows, b.failed_rows,
            b.successful_rows, b.applied_rows, b.unchanged_rows, b.status,
            b.created_at, b.queued_at, b.started_at, b.completed_at
       FROM import_batches b LEFT JOIN admins a ON a.id = b.uploaded_by_admin_id
      WHERE b.id = $1`, [batchId]
  );
  return rows[0] ?? null;
}

export async function listImportBatchRows(batchId: number, outcome: string | undefined, limit: number, cursor: number) {
  const safeLimit = Math.min(100, Math.max(1, Math.trunc(limit)));
  const conditions = ['batch_id = $1', 'source_row_number > $2'];
  const params: unknown[] = [batchId, Math.max(0, Math.trunc(cursor))];
  if (outcome && ['pending', 'created', 'updated', 'unchanged', 'skipped', 'failed'].includes(outcome)) {
    params.push(outcome); conditions.push(`outcome = $${params.length}`);
  } else if (outcome) throw new AppError(400, 'Invalid import outcome filter');
  params.push(safeLimit);
  const { rows } = await pool.query(
    `SELECT source_row_number, inventory_number, outcome, entity_id, reason_code, safe_reason, created_at, updated_at
       FROM import_batch_rows WHERE ${conditions.join(' AND ')}
      ORDER BY source_row_number LIMIT $${params.length}`, params
  );
  return { items: rows, nextCursor: rows.length === safeLimit ? Number(rows[rows.length - 1].source_row_number) : null };
}

export const importFieldAllowlist = ALLOWED_FIELDS;
