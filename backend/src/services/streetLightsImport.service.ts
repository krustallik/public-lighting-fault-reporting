import crypto from 'crypto';
import { pool } from '../db/pool.js';
import type { LightPointStatus } from '../types/index.js';
import { createLightPoint, updateLightPoint } from './lightPoints.service.js';
import { AppError } from '../utils/AppError.js';
import { logAdminActivity } from './adminActivity.service.js';

// noinspection SqlDialectInspection,SqlNoDataSourceInspection,SqlResolveInspection

export interface ImportRow {
  inventoryNumber: string;
  latitude: number;
  longitude: number;
  address?: string | null;
  district?: string | null;
  lampType?: string | null;
  status?: LightPointStatus;
}

export interface ImportRowResult {
  rowIndex: number;
  inventoryNumber: string;
  action: 'create' | 'update' | 'skip' | 'error';
  message?: string;
  existingId?: number;
}

export interface ImportPreview {
  previewId: string;
  filename: string;
  totalRows: number;
  validRows: ImportRow[];
  results: ImportRowResult[];
  summary: {
    toCreate: number;
    toUpdate: number;
    skipped: number;
    errors: number;
  };
}

interface StoredPreview extends ImportPreview {
  adminId: number;
  expiresAt: number;
}

const previews = new Map<string, StoredPreview>();
const PREVIEW_TTL_MS = 15 * 60 * 1000;

function cleanupPreviews(): void {
  const now = Date.now();
  for (const [id, preview] of previews) {
    if (preview.expiresAt < now) previews.delete(id);
  }
}

function normalizeStatus(value: unknown): LightPointStatus | undefined {
  if (typeof value !== 'string') return undefined;
  const s = value.toLowerCase();
  if (s === 'active' || s === 'inactive' || s === 'maintenance') return s;
  return undefined;
}

function pickString(obj: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const v = obj[key];
    if (typeof v === 'string' && v.trim()) return v.trim();
    if (typeof v === 'number') return String(v);
  }
  return undefined;
}

function pickNumber(obj: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const v = obj[key];
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string' && v.trim() && Number.isFinite(Number(v))) return Number(v);
  }
  return undefined;
}

export function validateCoordinates(lat: number, lng: number): string | null {
  if (lat < -90 || lat > 90) return 'Latitude must be between -90 and 90';
  if (lng < -180 || lng > 180) return 'Longitude must be between -180 and 180';
  return null;
}

export function parseImportBuffer(
  buffer: Buffer,
  mimetype: string,
  originalname: string
): ImportRow[] {
  const text = buffer.toString('utf-8').trim();
  if (!text) return [];

  const lower = originalname.toLowerCase();
  const isJson = mimetype.includes('json') || lower.endsWith('.json') || lower.endsWith('.geojson');

  if (isJson) {
    const parsed = JSON.parse(text) as unknown;
    if (Array.isArray(parsed)) {
      return parsed.map((item) => mapRawRow(item as Record<string, unknown>)).filter(Boolean) as ImportRow[];
    }
    if (parsed && typeof parsed === 'object' && 'features' in parsed) {
      const fc = parsed as { features: Array<{ properties?: Record<string, unknown>; geometry?: { coordinates?: number[] } }> };
      return fc.features.map((feature) => {
        const props = feature.properties ?? {};
        const coords = feature.geometry?.coordinates;
        if (coords && coords.length >= 2) {
          props.longitude = coords[0];
          props.latitude = coords[1];
        }
        return mapRawRow(props);
      }).filter(Boolean) as ImportRow[];
    }
    if (parsed && typeof parsed === 'object') {
      const row = mapRawRow(parsed as Record<string, unknown>);
      return row ? [row] : [];
    }
    throw new AppError(400, 'Unsupported JSON import structure');
  }

  return parseCsv(text);
}

function mapRawRow(raw: Record<string, unknown>): ImportRow | null {
  const inventoryNumber = pickString(raw, [
    'inventoryNumber',
    'inventory_number',
    'external_id',
    'externalId',
    'inventory',
  ]);
  const latitude = pickNumber(raw, ['latitude', 'lat']);
  const longitude = pickNumber(raw, ['longitude', 'lng', 'lon']);

  if (!inventoryNumber || latitude === undefined || longitude === undefined) {
    return null;
  }

  return {
    inventoryNumber,
    latitude,
    longitude,
    address: pickString(raw, ['address', 'street', 'location']) ?? null,
    district: pickString(raw, ['district', 'block', 'locationDetail']) ?? null,
    lampType: pickString(raw, ['lampType', 'lamp_type', 'type', 'category']) ?? null,
    status: normalizeStatus(raw.status),
  };
}

function parseCsv(text: string): ImportRow[] {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'));

  if (lines.length < 2) return [];

  const headerLine = lines[0].replace(/^\uFEFF/, '');
  const headers = headerLine.split(',').map((h) => h.trim().replace(/^"|"$/g, ''));
  const rows: ImportRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(',').map((v) => v.trim().replace(/^"|"$/g, ''));
    const obj: Record<string, unknown> = {};
    headers.forEach((h, idx) => {
      obj[h] = values[idx] ?? '';
    });
    const row = mapRawRow(obj);
    if (row) rows.push(row);
  }

  return rows;
}

async function resolveExisting(inventoryNumber: string): Promise<number | null> {
  const { rows } = await pool.query<{ id: number }>(
    `SELECT id FROM light_points WHERE external_id = $1`,
    [inventoryNumber]
  );
  return rows[0]?.id ?? null;
}

export async function buildImportPreview(
  adminId: number,
  filename: string,
  rows: ImportRow[]
): Promise<ImportPreview> {
  cleanupPreviews();

  const results: ImportRowResult[] = [];
  const validRows: ImportRow[] = [];
  let toCreate = 0;
  let toUpdate = 0;
  let skipped = 0;
  let errors = 0;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowIndex = i + 1;

    if (!row.inventoryNumber?.trim()) {
      results.push({ rowIndex, inventoryNumber: '', action: 'error', message: 'Missing inventory number' });
      errors += 1;
      continue;
    }

    const coordError = validateCoordinates(row.latitude, row.longitude);
    if (coordError) {
      results.push({
        rowIndex,
        inventoryNumber: row.inventoryNumber,
        action: 'error',
        message: coordError,
      });
      errors += 1;
      continue;
    }

    const existingId = await resolveExisting(row.inventoryNumber);
    validRows.push(row);

    if (existingId) {
      results.push({
        rowIndex,
        inventoryNumber: row.inventoryNumber,
        action: 'update',
        existingId,
        message: 'Exists — confirm import with allowUpdate to apply',
      });
      toUpdate += 1;
    } else {
      results.push({
        rowIndex,
        inventoryNumber: row.inventoryNumber,
        action: 'create',
      });
      toCreate += 1;
    }
  }

  const previewId = crypto.randomUUID();
  const preview: StoredPreview = {
    previewId,
    filename,
    totalRows: rows.length,
    validRows,
    results,
    summary: { toCreate, toUpdate, skipped, errors },
    adminId,
    expiresAt: Date.now() + PREVIEW_TTL_MS,
  };

  previews.set(previewId, preview);

  return {
    previewId,
    filename,
    totalRows: rows.length,
    validRows,
    results,
    summary: preview.summary,
  };
}

export async function confirmImport(
  adminId: number,
  previewId: string,
  allowUpdate: boolean
): Promise<{ batchId: number; summary: ImportPreview['summary'] }> {
  const preview = previews.get(previewId);
  if (!preview || preview.adminId !== adminId || preview.expiresAt < Date.now()) {
    throw new AppError(400, 'Import preview expired or not found');
  }

  let created = 0;
  let updated = 0;
  let skipped = 0;
  let failed = preview.summary.errors;

  for (const row of preview.validRows) {
    const existingId = await resolveExisting(row.inventoryNumber);

    try {
      if (existingId) {
        if (!allowUpdate) {
          skipped += 1;
          continue;
        }
        await updateLightPoint(existingId, {
          external_id: row.inventoryNumber,
          latitude: row.latitude,
          longitude: row.longitude,
          address: row.address,
          district: row.district,
          lamp_type: row.lampType,
          status: row.status,
        });
        updated += 1;
      } else {
        await createLightPoint({
          external_id: row.inventoryNumber,
          latitude: row.latitude,
          longitude: row.longitude,
          address: row.address,
          district: row.district,
          lamp_type: row.lampType,
          status: row.status ?? 'active',
        });
        created += 1;
      }
    } catch {
      failed += 1;
    }
  }

  const { rows } = await pool.query<{ id: number }>(
    `INSERT INTO import_batches (
       filename, uploaded_by_admin_id, total_rows, created_rows, updated_rows, skipped_rows, failed_rows
     ) VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id`,
    [preview.filename, adminId, preview.totalRows, created, updated, skipped, failed]
  );

  previews.delete(previewId);

  await logAdminActivity(adminId, 'import_confirm', 'import_batch', rows[0].id, {
    filename: preview.filename,
    created,
    updated,
    skipped,
    failed,
  });

  return {
    batchId: rows[0].id,
    summary: {
      toCreate: created,
      toUpdate: updated,
      skipped,
      errors: failed,
    },
  };
}

export async function listImportBatches(limit = 30) {
  const { rows } = await pool.query(
    `SELECT b.*, a.username AS uploaded_by_username
     FROM import_batches b
     LEFT JOIN admins a ON a.id = b.uploaded_by_admin_id
     ORDER BY b.created_at DESC
     LIMIT $1`,
    [limit]
  );
  return rows;
}
