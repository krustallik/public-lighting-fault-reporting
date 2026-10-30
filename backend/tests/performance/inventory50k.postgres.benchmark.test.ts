import { createHash, randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { createWriteStream } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { once } from 'node:events';
import { finished } from 'node:stream/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../../src/db/pool.js';
import { runMigrations } from '../../src/db/migrate.js';
import { listStreetLights, getStreetLightFilterOptions } from '../../src/services/adminStreetLights.service.js';
import { buildStreetLightFilters } from '../../src/services/adminStreetLightsFilters.js';
import { streamStreetLightsExport } from '../../src/services/streetLightsExport.service.js';
import { buildImportPreview, confirmImport, getImportBatch, parseImportSource } from '../../src/services/streetLightsImport.service.js';
import { startImportQueueWorker, stopImportQueueWorker } from '../../src/services/importQueueWorker.service.js';
import { generateSyntheticInventory, importMimeType, serializeSyntheticInventory, type InventoryImportFormat } from './inventory50k.fixtures.js';

const enabled = process.env.INVENTORY_50K_BENCHMARK === 'true';
const requiredDatabase = 'p3_50k_benchmark_test';
const formats = (process.env.INVENTORY_50K_FORMATS ?? 'csv,json,geojson').split(',').filter((value): value is InventoryImportFormat => ['csv', 'json', 'geojson'].includes(value));
const requestedRunId = process.env.INVENTORY_50K_RUN_ID ?? '';
const runId = /^[a-f0-9]{12}$/.test(requestedRunId) ? requestedRunId : randomUUID().replaceAll('-', '').slice(0, 12);
const inventoryPrefix = `BENCH50K-${runId}`;
const filePrefix = `bench50k-${runId}`;
let adminId: number | undefined;
let workerStarted = false;
let exportServer: Server | undefined;

interface SearchCase { name: string; query: Parameters<typeof listStreetLights>[0]; }
interface ExportRecord {
  inventory_number: string;
  external_id: string | null;
  longitude: number;
  latitude: number;
  address: string | null;
  district: string | null;
  lamp_type: string | null;
  status: string;
}

function percentile(values: number[], fraction: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)] ?? 0;
}

async function waitForBatch(batchId: number): Promise<Record<string, unknown>> {
  const deadline = Date.now() + 30 * 60_000;
  while (Date.now() < deadline) {
    const batch = await getImportBatch(batchId) as Record<string, unknown> | null;
    if (batch && ['completed', 'completed_with_errors', 'failed', 'system_failed'].includes(String(batch.status))) return batch;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error('50k benchmark import job did not reach a terminal state within 30 minutes');
}

async function closeExportServer(): Promise<void> {
  if (!exportServer?.listening) return;
  await new Promise<void>((resolve, reject) => exportServer?.close((error) => error ? reject(error) : resolve()));
  exportServer = undefined;
}

function exportRecordChecksum(records: ExportRecord[]): string {
  const digest = createHash('sha256');
  for (const row of records) digest.update(`${JSON.stringify([
    row.inventory_number, row.external_id, row.longitude, row.latitude, row.address, row.district, row.lamp_type, row.status,
  ])}\n`);
  return digest.digest('hex');
}

async function databaseInventoryChecksum(): Promise<{ checksum: string; count: number }> {
  const digest = createHash('sha256');
  let last: { inventory_number: string; id: number } | undefined;
  let count = 0;
  while (true) {
    const params: unknown[] = [`${inventoryPrefix}-%`];
    const after = last
      ? `AND (inventory_number COLLATE "C", id) > ($${params.push(last.inventory_number)}::text COLLATE "C", $${params.push(last.id)})`
      : '';
    const { rows } = await pool.query<ExportRecord & { id: number }>(
      `SELECT id, inventory_number, external_id, ST_X(geom)::double precision AS longitude,
              ST_Y(geom)::double precision AS latitude, address, district, lamp_type, status
         FROM light_points WHERE inventory_number LIKE $1 ${after}
        ORDER BY inventory_number COLLATE "C", id LIMIT 500`, params
    );
    if (!rows.length) break;
    for (const row of rows) {
      digest.update(`${JSON.stringify([
        row.inventory_number, row.external_id, row.longitude, row.latitude, row.address, row.district, row.lamp_type, row.status,
      ])}\n`);
    }
    count += rows.length;
    const lastRow = rows[rows.length - 1];
    last = { inventory_number: lastRow.inventory_number, id: lastRow.id };
  }
  return { checksum: digest.digest('hex'), count };
}

async function downloadToFile(url: string, filePath: string): Promise<{ bytes: number; sha256: string; elapsedMs: number; peakRssBytes: number; baselineRssBytes: number }> {
  const baselineRssBytes = process.memoryUsage().rss;
  let peakRssBytes = baselineRssBytes;
  let sampleBusy = false;
  const sampleTimer = setInterval(() => {
    if (sampleBusy) return;
    sampleBusy = true;
    peakRssBytes = Math.max(peakRssBytes, process.memoryUsage().rss);
    sampleBusy = false;
  }, 50);
  const started = performance.now();
  let output: ReturnType<typeof createWriteStream> | undefined;
  let finishedOutput: Promise<void> | undefined;
  try {
    const response = await fetch(url);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toMatch(/charset=utf-8/);
    output = createWriteStream(filePath);
    finishedOutput = finished(output);
    const digest = createHash('sha256');
    let bytes = 0;
    if (!response.body) throw new Error('Export response body is empty');
    for await (const part of response.body) {
      const chunk = Buffer.from(part);
      bytes += chunk.length;
      digest.update(chunk);
      if (!output.write(chunk)) await once(output, 'drain');
      // A small consumer pause forces the HTTP response path to exercise backpressure.
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
    output.end();
    await finishedOutput;
    peakRssBytes = Math.max(peakRssBytes, process.memoryUsage().rss);
    return { bytes, sha256: digest.digest('hex'), elapsedMs: performance.now() - started, peakRssBytes, baselineRssBytes };
  } finally {
    clearInterval(sampleTimer);
    if (output && !output.closed) {
      output.destroy();
      await finishedOutput?.catch(() => undefined);
    }
  }
}

function parseExportRecords(format: InventoryImportFormat, content: string): ExportRecord[] {
  if (format === 'csv') {
    return parseImportSource(Buffer.from(content, 'utf8'), 'text/csv', 'export.csv').map((row) => {
      const value = row.payload;
      if (!value) throw new Error(`CSV export row ${row.rowIndex} did not parse`);
      return {
        inventory_number: value.inventory_number, external_id: value.external_id ?? null,
        longitude: value.longitude, latitude: value.latitude, address: value.address ?? null,
        district: value.district ?? null, lamp_type: value.lamp_type ?? null, status: value.status ?? 'active',
      };
    });
  }
  const parsed = JSON.parse(content) as { items?: Array<Record<string, unknown>>; features?: Array<{ geometry?: { coordinates?: unknown[] }; properties?: Record<string, unknown> }> };
  const items: Array<Record<string, unknown>> = format === 'json'
    ? parsed.items ?? []
    : (parsed.features ?? []).map((feature) => ({
      ...feature.properties,
      longitude: feature.geometry?.coordinates?.[0],
      latitude: feature.geometry?.coordinates?.[1],
    }));
  return items.map((value) => ({
    inventory_number: String(value.inventory_number), external_id: value.external_id === null ? null : String(value.external_id),
    longitude: Number(value.longitude), latitude: Number(value.latitude),
    address: value.address === null ? null : String(value.address), district: value.district === null ? null : String(value.district),
    lamp_type: value.lamp_type === null ? null : String(value.lamp_type), status: String(value.status),
  }));
}

describe.skipIf(!enabled)('isolated 50k inventory performance benchmark', () => {
  beforeAll(async () => {
    if (process.env.DB_HOST !== '127.0.0.1' && process.env.DB_HOST !== 'localhost') throw new Error('50k benchmark requires a loopback PostgreSQL host');
    if (process.env.DB_NAME !== requiredDatabase || process.env.INVENTORY_50K_DISPOSABLE_DB !== requiredDatabase) throw new Error('50k benchmark requires the exact disposable database p3_50k_benchmark_test');
    if (!formats.length) throw new Error('50k benchmark requires at least one supported format');
    const { rows } = await pool.query<{ database_name: string; has_trgm: boolean; has_postgis: boolean }>(
      `SELECT current_database() AS database_name,
              EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') AS has_trgm,
              EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'postgis') AS has_postgis`
    );
    expect(rows[0]).toMatchObject({ database_name: requiredDatabase, has_trgm: true, has_postgis: true });
    await runMigrations(pool);
    const username = `synthetic-${runId}`;
    const existingAdmin = await pool.query<{ id: number }>('SELECT id FROM admins WHERE username = $1', [username]);
    if (existingAdmin.rows[0]) adminId = existingAdmin.rows[0].id;
    else {
      const admin = await pool.query<{ id: number }>(
        'INSERT INTO admins(username, password_hash) VALUES ($1, $2) RETURNING id',
        [username, 'synthetic-benchmark-hash']
      );
      adminId = admin.rows[0].id;
    }
  }, 120_000);

  afterAll(async () => {
    await closeExportServer();
    if (workerStarted) await stopImportQueueWorker();
    if (adminId) {
      await pool.query('DELETE FROM inventory_audit_events WHERE inventory_number_snapshot LIKE $1', [`${inventoryPrefix}-%`]);
      await pool.query('DELETE FROM import_batches WHERE filename LIKE $1', [`${filePrefix}-%`]);
      await pool.query('DELETE FROM light_points WHERE inventory_number LIKE $1', [`${inventoryPrefix}-%`]);
      await pool.query('DELETE FROM admins WHERE id = $1', [adminId]);
    }
  }, 120_000);

  it.each(formats)('imports and measures 50,000 deterministic synthetic rows from %s', async (format) => {
    const dataStarted = performance.now();
    const records = generateSyntheticInventory(50_000, 20261030, inventoryPrefix);
    expect(new Set(records.map((record) => record.inventory_number)).size).toBe(50_000);
    expect(records.every((record) => record.latitude >= 48.62 && record.latitude <= 48.79 && record.longitude >= 21.13 && record.longitude <= 21.32)).toBe(true);
    const buffer = serializeSyntheticInventory(records, format);
    const generatedMs = performance.now() - dataStarted;

    const beforeCount = await pool.query<{ count: string }>('SELECT COUNT(*)::text AS count FROM light_points WHERE inventory_number LIKE $1', [`${inventoryPrefix}-%`]);
    const isFirstImport = Number(beforeCount.rows[0]?.count ?? 0) === 0;
    const cpuBefore = process.cpuUsage();
    let peakRssBytes = process.memoryUsage().rss;
    let sampleBusy = false;
    const dbMetrics = { maxConnections: 0, maxLockWaiters: 0 };
    let samplePromise: Promise<void> | undefined;
    const sampleTimer = setInterval(() => {
      peakRssBytes = Math.max(peakRssBytes, process.memoryUsage().rss);
      if (sampleBusy) return;
      sampleBusy = true;
      samplePromise = pool.query<{ connections: string; waiting: string }>(
        `SELECT COUNT(*)::text AS connections,
                COUNT(*) FILTER (WHERE wait_event_type = 'Lock')::text AS waiting
           FROM pg_stat_activity WHERE datname = current_database()`
      ).then(({ rows }) => {
        dbMetrics.maxConnections = Math.max(dbMetrics.maxConnections, Number(rows[0]?.connections ?? 0));
        dbMetrics.maxLockWaiters = Math.max(dbMetrics.maxLockWaiters, Number(rows[0]?.waiting ?? 0));
      }).then(() => undefined).finally(() => { sampleBusy = false; });
    }, 250);

    let completed: Record<string, unknown> | undefined;
    let parseMs = 0;
    let previewMs = 0;
    let queueMs: number | null = null;
    let processingMs = 0;
    let error: unknown;
    try {
      const parseStarted = performance.now();
      const parsedRows = parseImportSource(buffer, importMimeType(format), `${filePrefix}-${format}.${format}`);
      parseMs = performance.now() - parseStarted;
      const previewStarted = performance.now();
      const preview = await buildImportPreview(adminId!, `${filePrefix}-${format}.${format}`, parsedRows, 'Synthetic 50k benchmark', 1, 25);
      previewMs = performance.now() - previewStarted;
      expect(preview.totalRows).toBe(50_000);
      expect(preview.summary.errors).toBe(0);
      expect(preview.summary.toCreate + preview.summary.toUpdate).toBe(50_000);

      const updateExisting = !isFirstImport && format !== 'json';
      const [queued, concurrentConfirmation] = await Promise.all([
        confirmImport(adminId!, preview.previewId, updateExisting),
        confirmImport(adminId!, preview.previewId, updateExisting),
      ]);
      expect(concurrentConfirmation.batchId).toBe(queued.batchId);
      const confirmationRows = await pool.query<{ count: string }>(
        'SELECT COUNT(*)::text AS count FROM import_batches WHERE confirmation_key = $1', [preview.previewId]
      );
      expect(confirmationRows.rows[0]?.count).toBe('1');
      await startImportQueueWorker();
      workerStarted = true;
      completed = await waitForBatch(queued.batchId);
      const queuedAt = completed.queued_at instanceof Date ? completed.queued_at : null;
      const startedAt = completed.started_at instanceof Date ? completed.started_at : null;
      const completedAt = completed.completed_at instanceof Date ? completed.completed_at : null;
      queueMs = queuedAt && startedAt ? startedAt.getTime() - queuedAt.getTime() : null;
      processingMs = startedAt && completedAt ? completedAt.getTime() - startedAt.getTime() : 0;
      await stopImportQueueWorker();
      workerStarted = false;

      if (isFirstImport) expect(completed).toMatchObject({ status: 'completed', total_rows: 50_000, created_rows: 50_000, failed_rows: 0 });
      else if (format === 'json') expect(completed).toMatchObject({ status: 'completed', total_rows: 50_000, skipped_rows: 50_000, applied_rows: 0, failed_rows: 0 });
      else expect(completed).toMatchObject({ status: 'completed', total_rows: 50_000, unchanged_rows: 50_000, applied_rows: 0, failed_rows: 0 });

      const finalRows = await pool.query<{ count: string }>('SELECT COUNT(*)::text AS count FROM light_points WHERE inventory_number LIKE $1', [`${inventoryPrefix}-%`]);
      expect(finalRows.rows[0]?.count).toBe('50000');
      const cpu = process.cpuUsage(cpuBefore);
      console.info(`INVENTORY_50K_IMPORT ${JSON.stringify({ format, scenario: isFirstImport ? 'first-import' : format === 'json' ? 'repeat-update-disabled' : 'repeat-update-enabled', rows: 50_000, bytes: buffer.length,
        generateMs: Math.round(generatedMs), parseMs: Math.round(parseMs), previewMs: Math.round(previewMs), queueMs,
        processingMs, rowsPerSecond: Math.round(50_000 / (processingMs / 1000)), peakRssMiB: Number((peakRssBytes / 1024 / 1024).toFixed(1)),
        processCpuMs: Math.round((cpu.user + cpu.system) / 1000), dbMaxConnections: dbMetrics.maxConnections,
        dbMaxLockWaiters: dbMetrics.maxLockWaiters })}`);
    } catch (caught) {
      error = caught;
      throw caught;
    } finally {
      clearInterval(sampleTimer);
      if (workerStarted) {
        await stopImportQueueWorker();
        workerStarted = false;
      }
      await samplePromise;
      if (error) peakRssBytes = Math.max(peakRssBytes, process.memoryUsage().rss);
    }
  }, 35 * 60_000);

  it('measures 50k filters, search, stable pagination, PostgreSQL plans, and concurrent admin reads', async () => {
    const { rows: targetRows } = await pool.query<{ id: number; inventory_number: string; external_id: string | null; address: string; district: string; lamp_type: string }>(
      `SELECT id, inventory_number, external_id, address, district, lamp_type
         FROM light_points WHERE inventory_number LIKE $1 ORDER BY inventory_number COLLATE "C" LIMIT 25001`, [`${inventoryPrefix}-%`]
    );
    expect(targetRows).toHaveLength(25_001);
    await pool.query('ANALYZE light_points');
    const target = targetRows[24_999];
    const internalIdSearch = await listStreetLights({ search: String(target.id) });
    expect(internalIdSearch.items.some((row) => row.id === target.id)).toBe(true);
    const externalIdSearch = await listStreetLights({ search: target.external_id ?? 'VO-010001' });
    expect(externalIdSearch.items.length).toBeGreaterThan(0);
    const cases: SearchCase[] = [
      { name: 'inventory-number-partial', query: { search: target.inventory_number.slice(-6) } },
      { name: 'internal-id', query: { search: String(target.id) } },
      { name: 'external-id', query: { search: target.external_id ?? 'VO-010001' } },
      { name: 'address-unicode', query: { search: target.address.slice(0, 12) } },
      { name: 'district-unicode', query: { search: 'Ťahanovce' } },
      { name: 'lamp-type-unicode', query: { search: 'Výbojková' } },
      { name: 'status-filter', query: { status: 'maintenance' } },
      { name: 'combined-filters', query: { search: 'LED', status: 'active', district: 'Staré Mesto', lampType: 'LED 24 W' } },
      { name: 'first-page', query: { search: inventoryPrefix, page: 1, limit: 20, sortBy: 'inventory_number', sortOrder: 'asc' } },
      { name: 'middle-page', query: { search: inventoryPrefix, page: 1250, limit: 20, sortBy: 'inventory_number', sortOrder: 'asc' } },
      { name: 'last-page', query: { search: inventoryPrefix, page: 2500, limit: 20, sortBy: 'inventory_number', sortOrder: 'desc' } },
    ];
    const latencyResults: Array<{ name: string; averageMs: number; p50Ms: number; p95Ms: number; slowestMs: number; total: number }> = [];
    for (const item of cases) {
      const samples: number[] = [];
      let result: Awaited<ReturnType<typeof listStreetLights>> | undefined;
      for (let sample = 0; sample < 20; sample += 1) {
        const started = performance.now();
        result = await listStreetLights(item.query);
        samples.push(performance.now() - started);
      }
      expect(result?.pagination.total).toBeGreaterThan(0);
      latencyResults.push({ name: item.name, averageMs: samples.reduce((sum, value) => sum + value, 0) / samples.length,
        p50Ms: percentile(samples, 0.5), p95Ms: percentile(samples, 0.95), slowestMs: Math.max(...samples), total: result!.pagination.total });
    }
    expect(latencyResults.every((item) => item.p95Ms < 500)).toBe(true);

    const asc = await listStreetLights({ search: inventoryPrefix, page: 1, limit: 20, sortBy: 'inventory_number', sortOrder: 'asc' });
    const secondPage = await listStreetLights({ search: inventoryPrefix, page: 2, limit: 20, sortBy: 'inventory_number', sortOrder: 'asc' });
    const desc = await listStreetLights({ search: inventoryPrefix, page: 1, limit: 20, sortBy: 'inventory_number', sortOrder: 'desc' });
    const middle = await listStreetLights({ search: inventoryPrefix, page: 1250, limit: 20, sortBy: 'inventory_number', sortOrder: 'asc' });
    const last = await listStreetLights({ search: inventoryPrefix, page: 2500, limit: 20, sortBy: 'inventory_number', sortOrder: 'desc' });
    expect(asc.items).toHaveLength(20);
    expect(asc.pagination.total).toBe(50_000);
    expect(secondPage.items).toHaveLength(20);
    expect(asc.items.at(-1)!.inventory_number < secondPage.items[0].inventory_number).toBe(true);
    expect(desc.items).toHaveLength(20);
    expect(middle.items).toHaveLength(20);
    expect(last.items).toHaveLength(20);
    expect(asc.items[0].inventory_number < asc.items[1].inventory_number).toBe(true);
    expect(desc.items[0].inventory_number > desc.items[1].inventory_number).toBe(true);
    expect(new Set(middle.items.map((row) => row.id)).size).toBe(20);
    const options = await getStreetLightFilterOptions();
    expect(options.districts).toContain('Sídlisko Ťahanovce');

    const { where, params } = buildStreetLightFilters({ search: target.inventory_number.slice(-6) });
    const explain = await pool.query<{ 'QUERY PLAN': Array<Record<string, unknown>> }>(
      `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
       SELECT id FROM light_points ${where}
       ORDER BY inventory_number COLLATE "C" ASC NULLS LAST, id ASC LIMIT 20`, params
    );
    const planText = JSON.stringify(explain.rows[0]?.['QUERY PLAN'] ?? []);
    const indexNames = [...new Set(planText.match(/light_points_[a-z_]+_trgm_idx/g) ?? [])];
    const executionMs = Number(planText.match(/"Execution Time":([\d.]+)/)?.[1] ?? NaN);
    expect(Number.isFinite(executionMs)).toBe(true);
    expect(indexNames.length).toBeGreaterThan(0);

    const concurrentSamples: number[] = [];
    const concurrentRoundMs: number[] = [];
    for (let round = 0; round < 10; round += 1) {
      const started = performance.now();
      const results = await Promise.all(Array.from({ length: 10 }, async (_, index) => {
        const requestStarted = performance.now();
        const result = await listStreetLights({ search: index % 2 ? target.district : target.inventory_number.slice(-6), page: index + 1, limit: 20, sortBy: 'updated_at', sortOrder: index % 2 ? 'desc' : 'asc' });
        return { result, latencyMs: performance.now() - requestStarted };
      }));
      concurrentRoundMs.push(performance.now() - started);
      concurrentSamples.push(...results.map((item) => item.latencyMs));
      expect(results.every((item) => item.result.pagination.total > 0)).toBe(true);
    }
    console.info(`INVENTORY_50K_SEARCH ${JSON.stringify({ rows: 50_000, samplesPerCase: 20, latency: latencyResults,
      concurrentRequests: concurrentSamples.length, concurrentRequestP50Ms: Number(percentile(concurrentSamples, 0.5).toFixed(2)),
      concurrentRequestP95Ms: Number(percentile(concurrentSamples, 0.95).toFixed(2)), concurrentRoundP95Ms: Number(percentile(concurrentRoundMs, 0.95).toFixed(2)),
      planExecutionMs: executionMs, indexNames })}`);
  }, 120_000);

  it.each(['csv', 'json', 'geojson'] as const)('streams and validates a complete consistent 50k %s export', async (format) => {
    const disposableDirectory = await mkdtemp(path.join(tmpdir(), 'plfr-inventory-50k-export-'));
    try {
      const filePath = path.join(disposableDirectory, `inventory.${format}`);
      const databaseDigest = await databaseInventoryChecksum();
      expect(databaseDigest.count).toBe(50_000);
      exportServer = createServer((request, response) => {
        const requestFormat = request.url?.slice(1) as InventoryImportFormat;
        void streamStreetLightsExport(requestFormat, { search: inventoryPrefix }, response).catch(() => {
          if (!response.headersSent) response.statusCode = 500;
          response.end();
        });
      });
      await new Promise<void>((resolve, reject) => {
        exportServer?.once('error', reject);
        exportServer?.listen(0, '127.0.0.1', resolve);
      });
      const address = exportServer.address();
      if (!address || typeof address === 'string') throw new Error('Export benchmark server did not bind a TCP port');
      const measured = await downloadToFile(`http://127.0.0.1:${address.port}/${format}`, filePath);
      await closeExportServer();
      const content = await readFile(filePath, 'utf8');
      const records = parseExportRecords(format, content);
      expect(records).toHaveLength(50_000);
      expect(records.every((row) => row.latitude >= -90 && row.latitude <= 90 && row.longitude >= -180 && row.longitude <= 180)).toBe(true);
      expect(records.some((row) => row.address?.includes('Košice') || row.district?.includes('Ťahanovce'))).toBe(true);
      expect(exportRecordChecksum(records)).toBe(databaseDigest.checksum);
      if (format === 'csv') {
        expect(content.startsWith('id,inventory_number,external_id,longitude,latitude,address,district,lamp_type,status,created_at,updated_at\r\n')).toBe(true);
        expect(content).toContain('"Hlavná 1, Košice"');
      } else if (format === 'geojson') {
        expect(JSON.parse(content)).toMatchObject({ type: 'FeatureCollection', schemaVersion: 1 });
      } else {
        expect(JSON.parse(content)).toMatchObject({ schemaVersion: 1, items: expect.any(Array) });
      }
      expect(measured.peakRssBytes - measured.baselineRssBytes).toBeLessThan(128 * 1024 * 1024);
      console.info(`INVENTORY_50K_EXPORT ${JSON.stringify({ format, rows: records.length, bytes: measured.bytes,
        transferMs: Math.round(measured.elapsedMs), sha256: measured.sha256,
        exportRssDeltaMiB: Number(((measured.peakRssBytes - measured.baselineRssBytes) / 1024 / 1024).toFixed(1)),
        clientBackpressure: 'exercised by throttled file consumer', checksumMatchedPostgres: true })}`);
    } finally {
      await closeExportServer();
      const resolvedTemp = path.resolve(disposableDirectory);
      const resolvedTempRoot = `${path.resolve(tmpdir())}${path.sep}`;
      if (!resolvedTemp.startsWith(resolvedTempRoot) || !path.basename(resolvedTemp).startsWith('plfr-inventory-50k-export-')) {
        throw new Error('Refusing to remove an export path outside the benchmark temporary directory');
      }
      await rm(resolvedTemp, { recursive: true, force: true });
    }
  }, 180_000);
});
