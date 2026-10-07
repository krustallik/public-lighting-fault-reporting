import { describe, expect, it } from 'vitest';
import { parseImportBuffer } from '../../src/services/streetLightsImport.service.js';

describe('import source parser', () => {
  it('parses quoted CSV commas, quotes, CRLF and embedded newlines while retaining field presence', () => {
    const rows = parseImportBuffer(
      Buffer.from('inventory_number,latitude,longitude,address,external_id\r\n" LP-1 ",48.1,17.1,"Main, ""East""\r\nSecond",EXT-9'),
      'text/csv', 'points.csv'
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ rowIndex: 1, inventoryNumber: 'LP-1' });
    expect(rows[0].payload).toMatchObject({
      inventory_number: 'LP-1', latitude: 48.1, longitude: 17.1,
      address: 'Main, "East"\r\nSecond', external_id: 'EXT-9',
    });
    expect(rows[0].payload?.present).toContain('external_id');
  });

  it('keeps malformed source records as row failures instead of filtering them out', () => {
    const rows = parseImportBuffer(
      Buffer.from('inventory_number,latitude,longitude\nLP-1,48.1,17.1\n,48.2,17.2\nLP-3,not-lat,17.3'),
      'text/csv', 'points.csv'
    );
    expect(rows).toHaveLength(3);
    expect(rows.map((row) => row.rowIndex)).toEqual([1, 2, 3]);
    expect(rows.map((row) => row.errorCode)).toEqual([undefined, 'missing_inventory_number', 'invalid_coordinates']);
  });

  it('keeps inventory_number and external_id independent in JSON', () => {
    const rows = parseImportBuffer(
      Buffer.from(JSON.stringify([
        { inventory_number: 'LP-2', external_id: 'EXT-2', lat: 48.2, lon: 17.2, lampType: 'LED' },
        { external_id: 'EXT-ONLY', lat: 48.3, lon: 17.3 },
      ])),
      'application/json', 'points.json'
    );
    expect(rows[0].payload).toMatchObject({ inventory_number: 'LP-2', external_id: 'EXT-2', latitude: 48.2, longitude: 17.2, lamp_type: 'LED' });
    expect(rows[1]).toMatchObject({ errorCode: 'missing_inventory_number' });
  });

  it('distinguishes absent fields from explicit empty and null values in JSON and CSV', () => {
    const jsonRows = parseImportBuffer(
      Buffer.from(JSON.stringify([
        { inventory_number: 'A-1', latitude: 48, longitude: 17 },
        { inventory_number: 'A-2', latitude: 48, longitude: 17, address: '', external_id: null },
      ])),
      'application/json', 'presence.json'
    );
    expect(jsonRows[0].payload?.present).not.toContain('address');
    expect(jsonRows[0].payload?.present).not.toContain('external_id');
    expect(jsonRows[1].payload?.present).toContain('address');
    expect(jsonRows[1].payload?.address).toBeNull();
    expect(jsonRows[1].payload?.present).toContain('external_id');
    expect(jsonRows[1].payload?.external_id).toBeNull();

    const csvRows = parseImportBuffer(
      Buffer.from('inventory_number,latitude,longitude,address\nA-3,48,17,\n'),
      'text/csv', 'presence.csv'
    );
    expect(csvRows[0].payload?.present).toContain('address');
    expect(csvRows[0].payload?.address).toBeNull();
  });

  it('reads GeoJSON Point coordinates as longitude then latitude', () => {
    const rows = parseImportBuffer(
      Buffer.from(JSON.stringify({
        type: 'FeatureCollection',
        features: [{
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [17.3, 48.3] },
          properties: { inventoryNumber: 'LP-3', external_id: 'LEGACY-3', address: '' },
        }],
      })),
      'application/geo+json', 'points.geojson'
    );
    expect(rows[0].payload).toMatchObject({ inventory_number: 'LP-3', external_id: 'LEGACY-3', latitude: 48.3, longitude: 17.3, address: null });
    expect(rows[0].payload?.present).toContain('address');
  });
});
