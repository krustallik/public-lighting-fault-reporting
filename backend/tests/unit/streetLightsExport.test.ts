import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { queryMock, releaseMock, connectMock } = vi.hoisted(() => ({
  queryMock: vi.fn(), releaseMock: vi.fn(), connectMock: vi.fn(),
}));
vi.mock('../../src/db/pool.js', () => ({ pool: { connect: connectMock } }));

import { streamStreetLightsExport } from '../../src/services/streetLightsExport.service.js';

let server: ReturnType<typeof createServer> | undefined;
let baseUrl = '';
const row = {
  id: 2, inventory_number: 'LP-2', external_id: 'EXT-"2', longitude: 17.1, latitude: 48.1,
  address: 'Line A, "North"\r\nLine B', district: 'Staré Mesto', lamp_type: null,
  status: 'active', created_at: new Date('2026-10-03T00:00:00.000Z'), updated_at: new Date('2026-10-04T00:00:00.000Z'),
};

async function start(format: string): Promise<string> {
  server = createServer((_req, res) => {
    void streamStreetLightsExport(format as 'csv' | 'json' | 'geojson', {}, res).catch(() => {
      res.statusCode = 500;
      res.end('failed');
    });
  });
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

async function stop(): Promise<void> {
  if (server?.listening) await new Promise<void>((resolve) => server!.close(() => resolve()));
}

async function fetchExport(format: string): Promise<{ body: string; contentType: string }> {
  const response = await fetch(`${baseUrl}/${format}`);
  return { body: await response.text(), contentType: response.headers.get('content-type') ?? '' };
}

describe('streamed street-light export', () => {
  beforeEach(() => {
    queryMock.mockReset(); releaseMock.mockReset(); connectMock.mockReset();
    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT id, inventory_number')) return { rows: [row] };
      return { rows: [] };
    });
    connectMock.mockResolvedValue({ query: queryMock, release: releaseMock });
  });
  afterEach(stop);

  it('streams CSV v1 with full fields, UTC timestamps, CR/LF and quote escaping', async () => {
    baseUrl = await start('csv');
    const result = await fetchExport('csv');
    expect(result.contentType).toContain('text/csv');
    expect(result.body).toBe(
      'id,inventory_number,external_id,longitude,latitude,address,district,lamp_type,status,created_at,updated_at\r\n' +
      '2,LP-2,"EXT-""2",17.1,48.1,"Line A, ""North""\r\nLine B",Staré Mesto,,active,2026-10-03T00:00:00.000Z,2026-10-04T00:00:00.000Z\r\n'
    );
    expect(queryMock).toHaveBeenCalledWith(expect.stringContaining('REPEATABLE READ READ ONLY'));
    expect(releaseMock).toHaveBeenCalledTimes(1);
  });

  it('streams a versioned JSON object and preserves nulls', async () => {
    baseUrl = await start('json');
    const result = await fetchExport('json');
    const decoded = JSON.parse(result.body) as { schemaVersion: number; items: Array<Record<string, unknown>> };
    expect(decoded.schemaVersion).toBe(1);
    expect(decoded.items[0]).toMatchObject({ inventory_number: 'LP-2', external_id: 'EXT-"2', lamp_type: null, longitude: 17.1, latitude: 48.1 });
  });

  it('streams RFC 7946 GeoJSON with longitude-first coordinates', async () => {
    baseUrl = await start('geojson');
    const result = await fetchExport('geojson');
    const decoded = JSON.parse(result.body) as { type: string; features: Array<{ geometry: { coordinates: number[] }; properties: Record<string, unknown> }> };
    expect(decoded.type).toBe('FeatureCollection');
    expect(decoded.features[0].geometry.coordinates).toEqual([17.1, 48.1]);
    expect(decoded.features[0].properties).toMatchObject({ inventory_number: 'LP-2', external_id: 'EXT-"2', lamp_type: null });
  });
});
