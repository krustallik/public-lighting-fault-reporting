import { createServer, request as httpRequest, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../../src/db/pool.js';
import { runMigrations } from '../../src/db/migrate.js';
import { streamStreetLightsExport } from '../../src/services/streetLightsExport.service.js';

const enabled = process.env.P3_POSTGRES_INTEGRATION === 'true';
const resourceEnabled = process.env.P3_RESOURCE_VALIDATION === 'true';
const prefix = `P3-EXPORT-${process.pid}-${Date.now()}-`;
let server: Server | undefined;
let baseUrl = '';

async function startServer(): Promise<void> {
  server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const format = url.searchParams.get('format') ?? 'csv';
    void streamStreetLightsExport(format as 'csv' | 'json' | 'geojson', {
      search: url.searchParams.get('search') ?? '',
    }, res).catch((error) => {
      if (res.headersSent) res.destroy(error instanceof Error ? error : undefined);
      else {
        res.statusCode = 500;
        res.end(error instanceof Error ? error.message : 'failed');
      }
    });
  });
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

async function closeServer(): Promise<void> {
  if (server?.listening) await new Promise<void>((resolve) => server!.close(() => resolve()));
  server = undefined;
}

async function get(format: string): Promise<{ body: string; contentType: string }> {
  const response = await fetch(`${baseUrl}/?format=${format}&search=${encodeURIComponent(prefix)}`);
  return { body: await response.text(), contentType: response.headers.get('content-type') ?? '' };
}

describe.skipIf(!enabled)('P3 PostgreSQL export integration', () => {
  beforeAll(async () => {
    await runMigrations();
    await pool.query(
      `INSERT INTO light_points (inventory_number, external_id, geom, address, district, lamp_type, status)
       SELECT $1 || lpad(n::text, 4, '0'),
              CASE WHEN n % 2 = 0 THEN 'DUPLICATE-EXTERNAL' ELSE NULL END,
              ST_SetSRID(ST_MakePoint(17 + n / 100000.0, 48 + n / 100000.0), 4326),
              CASE WHEN n = 1 THEN E'Line A, "North"\r\nLine B' ELSE 'Synthetic address ' || n END,
              CASE WHEN n % 2 = 0 THEN 'Synthetic district' ELSE NULL END,
              CASE WHEN n % 3 = 0 THEN NULL ELSE 'LED' END,
              CASE WHEN n % 4 = 0 THEN 'maintenance' ELSE 'active' END
         FROM generate_series(1, 260) n`, [prefix]
    );
    await startServer();
  });
  afterAll(async () => {
    await closeServer();
    await pool.query('DELETE FROM light_points WHERE inventory_number LIKE $1', [`${prefix}%`]);
  });

  it('streams all formats across multiple database chunks with shared filters and fields', async () => {
    const json = await get('json');
    expect(json.contentType).toContain('application/json');
    const parsed = JSON.parse(json.body) as { schemaVersion: number; items: Array<Record<string, unknown>> };
    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.items).toHaveLength(260);
    expect(parsed.items[0]).toMatchObject({ inventory_number: `${prefix}0001`, external_id: null, longitude: 17.00001, latitude: 48.00001 });
    expect(parsed.items[0]).toHaveProperty('created_at');
    expect(parsed.items[0]).toHaveProperty('updated_at');
    expect(parsed.items).toEqual([...parsed.items].sort((a, b) => String(a.inventory_number).localeCompare(String(b.inventory_number), 'en')));

    const geo = await get('geojson');
    const geoParsed = JSON.parse(geo.body) as { type: string; features: Array<{ geometry: { coordinates: number[] }; properties: Record<string, unknown> }> };
    expect(geoParsed.type).toBe('FeatureCollection');
    expect(geoParsed.features).toHaveLength(260);
    expect(geoParsed.features[0].geometry.coordinates).toEqual([17.00001, 48.00001]);
    expect(geoParsed.features[0].properties).toMatchObject({ inventory_number: `${prefix}0001`, external_id: null });

    const csv = await get('csv');
    expect(csv.contentType).toContain('text/csv');
    expect(csv.body.startsWith('id,inventory_number,external_id,longitude,latitude,address,district,lamp_type,status,created_at,updated_at\r\n')).toBe(true);
    expect(csv.body).toContain('"Line A, ""North""\r\nLine B"');
  });

  it('honors bounded output under a paused client and releases the PostgreSQL client on disconnect', async () => {
    const baselineIdle = pool.idleCount;
    const slowResult = await new Promise<{ bytes: number; ended: boolean }>((resolve, reject) => {
      const req = httpRequest(`${baseUrl}/?format=csv&search=${encodeURIComponent(prefix)}`);
      let bytes = 0;
      req.on('response', (response) => {
        let pausedOnce = false;
        response.on('data', (chunk: Buffer) => {
          bytes += chunk.length;
          if (!pausedOnce) {
            pausedOnce = true;
            response.pause();
            setTimeout(() => response.resume(), 50);
          }
        });
        response.on('end', () => resolve({ bytes, ended: true }));
        response.on('error', reject);
      });
      req.on('error', reject);
      req.end();
    });
    expect(slowResult.ended).toBe(true);
    expect(slowResult.bytes).toBeGreaterThan(20_000);

    const released = new Promise<void>((resolve, reject) => {
      const req = httpRequest(`${baseUrl}/?format=json&search=${encodeURIComponent(prefix)}`);
      req.on('response', (response) => {
        response.once('data', () => {
          response.destroy();
          const deadline = Date.now() + 1_000;
          const waitForRelease = () => {
            if (pool.idleCount >= baselineIdle) resolve();
            else if (Date.now() >= deadline) reject(new Error('Export client was not returned to pool'));
            else setTimeout(waitForRelease, 5);
          };
          waitForRelease();
        });
      });
      req.on('error', () => resolve());
      req.end();
    });
    await released;
  });

  it.skipIf(!resourceEnabled)('streams 100,000 synthetic rows with bounded chunks and records process resource observations', async () => {
    const resourcePrefix = `${prefix}RESOURCE-`;
    const start = performance.now();
    const baseRss = process.memoryUsage().rss;
    let peakRss = baseRss;
    await pool.query(
      `INSERT INTO light_points (inventory_number, external_id, geom, address, district, lamp_type, status)
       SELECT $1 || lpad(n::text, 6, '0'),
              'EXT-' || lpad((n % 1000)::text, 3, '0'),
              ST_SetSRID(ST_MakePoint(17 + (n % 10000) / 100000.0, 48 + (n % 5000) / 100000.0), 4326),
              repeat('Representative synthetic address ', 5) || n,
              'District ' || (n % 20), 'LED', CASE WHEN n % 4 = 0 THEN 'maintenance' ELSE 'active' END
         FROM generate_series(1, 100000) AS n`, [resourcePrefix]
    );
    const insertedAt = performance.now();
    const idleBefore = pool.idleCount;
    let bytes = 0;
    let lineBreaks = 0;
    let previousWasCr = false;
    let pausedOnce = false;
    const sample = setInterval(() => { peakRss = Math.max(peakRss, process.memoryUsage().rss); }, 10);
    try {
      const result = await new Promise<{ durationMs: number }>((resolve, reject) => {
        const exportStarted = performance.now();
        const req = httpRequest(`${baseUrl}/?format=csv&search=${encodeURIComponent(resourcePrefix)}`);
        req.on('response', (response) => {
          response.on('data', (chunk: Buffer) => {
            bytes += chunk.length;
            for (const byte of chunk) {
              if (byte === 10 && previousWasCr) lineBreaks += 1;
              previousWasCr = byte === 13;
            }
            if (!pausedOnce) {
              pausedOnce = true;
              response.pause();
              setTimeout(() => response.resume(), 50);
            }
          });
          response.on('end', () => resolve({ durationMs: performance.now() - exportStarted }));
          response.on('error', reject);
        });
        req.on('error', reject);
        req.setTimeout(120_000, () => req.destroy(new Error('100k export resource request timed out')));
        req.end();
      });
      peakRss = Math.max(peakRss, process.memoryUsage().rss);
      expect(lineBreaks).toBe(100001);
      expect(bytes).toBeGreaterThan(20_000_000);
      expect(pool.idleCount).toBeGreaterThanOrEqual(idleBefore);
      console.info('P3_RESOURCE_EVIDENCE', JSON.stringify({
        rows: 100000, chunkRows: 250, outputChunkChars: 8192,
        insertedRowsMs: Math.round(insertedAt - start), exportMs: Math.round(result.durationMs),
        totalMs: Math.round(performance.now() - start), bytes, bytesPerSecond: Math.round(bytes / (result.durationMs / 1000)),
        baselineRssBytes: baseRss, peakRssBytes: peakRss, peakRssDeltaBytes: peakRss - baseRss,
        pausedClient: true, completedRows: lineBreaks - 1, postgresClientReleased: true,
      }));
    } finally {
      clearInterval(sample);
      await pool.query('DELETE FROM light_points WHERE inventory_number LIKE $1', [`${resourcePrefix}%`]);
    }
  }, 120_000);
});
