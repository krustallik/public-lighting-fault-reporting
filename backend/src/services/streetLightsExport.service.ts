import type { ServerResponse } from 'node:http';
import type { PoolClient } from 'pg';
import { pool } from '../db/pool.js';
import type { ListStreetLightsQuery } from './adminStreetLights.service.js';
import { AppError } from '../utils/AppError.js';

type ExportFormat = 'csv' | 'json' | 'geojson';
interface ExportRow {
  id: number;
  inventory_number: string;
  external_id: string | null;
  longitude: number;
  latitude: number;
  address: string | null;
  district: string | null;
  lamp_type: string | null;
  status: string;
  created_at: Date | string;
  updated_at: Date | string;
}

const CHUNK_ROWS = 250;
const WRITE_CHARS = 8_192;
const CSV_HEADER = 'id,inventory_number,external_id,longitude,latitude,address,district,lamp_type,status,created_at,updated_at\r\n';
type ExportResponse = Pick<ServerResponse, 'statusCode' | 'setHeader' | 'write' | 'once' | 'off' | 'destroyed' | 'writableEnded' | 'socket' | 'end' | 'destroy'>;

function buildFilterSql(filters: ListStreetLightsQuery): { where: string; params: unknown[] } {
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (filters.search?.trim()) {
    const term = `%${filters.search.trim()}%`;
    params.push(term, filters.search.trim());
    const index = params.length - 1;
    conditions.push(`(inventory_number ILIKE $${index} OR external_id ILIKE $${index} OR address ILIKE $${index} OR district ILIKE $${index} OR id::text = $${index + 1})`);
  }
  if (filters.status) {
    if (!['active', 'inactive', 'maintenance'].includes(filters.status)) throw new AppError(400, 'Invalid status filter');
    params.push(filters.status);
    conditions.push(`status = $${params.length}`);
  }
  if (filters.district?.trim()) {
    params.push(`%${filters.district.trim()}%`);
    conditions.push(`district ILIKE $${params.length}`);
  }
  return { where: conditions.length ? `WHERE ${conditions.join(' AND ')}` : '', params };
}

function formatTimestamp(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  return date.toISOString();
}

function itemFields(row: ExportRow): Array<[string, string | number | null]> {
  return [
    ['id', row.id], ['inventory_number', row.inventory_number], ['external_id', row.external_id],
    ['longitude', Number(row.longitude)], ['latitude', Number(row.latitude)], ['address', row.address],
    ['district', row.district], ['lamp_type', row.lamp_type], ['status', row.status],
    ['created_at', formatTimestamp(row.created_at)], ['updated_at', formatTimestamp(row.updated_at)],
  ];
}

async function write(response: ExportResponse, value: string): Promise<void> {
  if (response.destroyed || response.writableEnded) throw new Error('Export client disconnected');
  if (response.write(value)) return;
  await new Promise<void>((resolve, reject) => {
    const onDrain = () => { cleanup(); resolve(); };
    const onClose = () => { cleanup(); reject(new Error('Export client disconnected')); };
    const cleanup = () => { response.off('drain', onDrain); response.off('close', onClose); };
    response.once('drain', onDrain);
    response.once('close', onClose);
  });
}

async function writeJsonString(response: ExportResponse, value: string): Promise<void> {
  await write(response, '"');
  let offset = 0;
  while (offset < value.length) {
    let end = Math.min(value.length, offset + WRITE_CHARS);
    if (end < value.length && /[\uD800-\uDBFF]/.test(value[end - 1]) && /[\uDC00-\uDFFF]/.test(value[end])) end -= 1;
    if (end === offset) end += 2;
    await write(response, JSON.stringify(value.slice(offset, end)).slice(1, -1));
    offset = end;
  }
  await write(response, '"');
}

async function writeJsonItem(response: ExportResponse, fields: Array<[string, string | number | null]>): Promise<void> {
  await write(response, '{');
  for (let index = 0; index < fields.length; index += 1) {
    if (index) await write(response, ',');
    const [name, value] = fields[index];
    await writeJsonString(response, name);
    await write(response, ':');
    if (typeof value === 'string') await writeJsonString(response, value);
    else await write(response, value === null ? 'null' : String(value));
  }
  await write(response, '}');
}

async function writeCsvField(response: ExportResponse, value: string | number | null): Promise<void> {
  if (value === null) return;
  const text = String(value);
  const quote = /[,"\r\n]/.test(text);
  if (quote) await write(response, '"');
  let offset = 0;
  while (offset < text.length) {
    const end = Math.min(text.length, offset + WRITE_CHARS);
    const chunk = text.slice(offset, end).replace(/"/g, '""');
    await write(response, chunk);
    offset = end;
  }
  if (quote) await write(response, '"');
}

async function writeCsvRow(response: ExportResponse, fields: Array<[string, string | number | null]>): Promise<void> {
  for (let index = 0; index < fields.length; index += 1) {
    if (index) await write(response, ',');
    await writeCsvField(response, fields[index][1]);
  }
  await write(response, '\r\n');
}

function clientDisconnected(response: ExportResponse): boolean {
  return response.destroyed || (!response.writableEnded && response.socket?.destroyed === true);
}

export async function streamStreetLightsExport(
  format: ExportFormat,
  filters: ListStreetLightsQuery,
  response: ExportResponse
): Promise<void> {
  const { where, params } = buildFilterSql(filters);
  const client: PoolClient = await pool.connect();
  let inTransaction = false;
  let started = false;
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    inTransaction = true;
    const readChunk = async (last: { inventory_number: string; id: number } | null): Promise<ExportRow[]> => {
      const pageParams = [...params];
      const after = last
        ? `AND (inventory_number COLLATE "C", id) > ($${pageParams.push(last.inventory_number)}::text COLLATE "C", $${pageParams.push(last.id)})`
        : '';
      const result = await client.query<ExportRow>(
        `SELECT id, inventory_number, external_id, ST_X(geom)::double precision AS longitude,
                ST_Y(geom)::double precision AS latitude, address, district, lamp_type, status, created_at, updated_at
           FROM light_points ${where} ${where ? after : (last ? `WHERE (inventory_number COLLATE "C", id) > ($${pageParams.push(last.inventory_number)}::text COLLATE "C", $${pageParams.push(last.id)})` : '')}
          ORDER BY inventory_number COLLATE "C", id LIMIT ${CHUNK_ROWS}`,
        pageParams
      );
      return result.rows;
    };
    let chunk = await readChunk(null);
    response.statusCode = 200;
    response.setHeader('Content-Type', format === 'csv' ? 'text/csv; charset=utf-8' : format === 'geojson' ? 'application/geo+json; charset=utf-8' : 'application/json; charset=utf-8');
    response.setHeader('Content-Disposition', `attachment; filename="street-lights-${new Date().toISOString().slice(0, 10)}.${format}"`);
    started = true;
    if (format === 'csv') await write(response, CSV_HEADER);
    else if (format === 'json') await write(response, '{"schemaVersion":1,"items":[');
    else await write(response, '{"type":"FeatureCollection","schemaVersion":1,"features":[');
    let first = true;
    let last: { inventory_number: string; id: number } | null = null;
    while (chunk.length && !clientDisconnected(response)) {
      for (const row of chunk) {
        if (clientDisconnected(response)) break;
        if (format === 'csv') await writeCsvRow(response, itemFields(row));
        else {
          if (!first) await write(response, ',');
          first = false;
          if (format === 'json') await writeJsonItem(response, itemFields(row));
          else {
            await write(response, '{"type":"Feature","geometry":{"type":"Point","coordinates":[');
            await write(response, `${Number(row.longitude)},${Number(row.latitude)}`);
            await write(response, ']},"properties":');
            const props = itemFields(row).filter(([key]) => key !== 'longitude' && key !== 'latitude');
            await writeJsonItem(response, props);
            await write(response, '}');
          }
        }
        last = { inventory_number: row.inventory_number, id: row.id };
      }
      if (chunk.length < CHUNK_ROWS || clientDisconnected(response)) break;
      chunk = await readChunk(last);
    }
    if (clientDisconnected(response)) {
      await client.query('ROLLBACK');
      inTransaction = false;
      return;
    }
    if (format !== 'csv') await write(response, format === 'json' ? ']}' : ']}');
    await client.query('COMMIT');
    inTransaction = false;
    response.end();
  } catch (error) {
    if (inTransaction) {
      try { await client.query('ROLLBACK'); } catch { /* connection may already be gone */ }
      inTransaction = false;
    }
    if (started) response.destroy(error instanceof Error ? error : undefined);
    else throw error;
  } finally {
    client.release();
  }
}
