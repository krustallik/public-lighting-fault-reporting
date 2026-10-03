import { describe, expect, it } from 'vitest';
import { parseImportBuffer } from '../../src/services/streetLightsImport.service.js';

describe('current import parsers', () => {
  it('parses a basic comma-separated CSV row', () => {
    const rows = parseImportBuffer(
      Buffer.from('inventoryNumber,latitude,longitude,address\nLP-1,48.1,17.1,Hlavna'),
      'text/csv',
      'lights.csv'
    );

    expect(rows).toEqual([
      {
        inventoryNumber: 'LP-1',
        latitude: 48.1,
        longitude: 17.1,
        address: 'Hlavna',
        district: null,
        lampType: null,
        status: undefined,
      },
    ]);
  });

  it('parses a JSON array using current accepted field aliases', () => {
    const rows = parseImportBuffer(
      Buffer.from(JSON.stringify([{ external_id: 'LP-2', lat: 48.2, lon: 17.2, type: 'LED' }])),
      'application/json',
      'lights.json'
    );

    expect(rows).toEqual([
      {
        inventoryNumber: 'LP-2',
        latitude: 48.2,
        longitude: 17.2,
        address: null,
        district: null,
        lampType: 'LED',
        status: undefined,
      },
    ]);
  });

  it('reads GeoJSON point coordinates in longitude/latitude order', () => {
    const rows = parseImportBuffer(
      Buffer.from(
        JSON.stringify({
          type: 'FeatureCollection',
          features: [
            {
              type: 'Feature',
              geometry: { type: 'Point', coordinates: [17.3, 48.3] },
              properties: { inventoryNumber: 'LP-3' },
            },
          ],
        })
      ),
      'application/geo+json',
      'lights.geojson'
    );

    expect(rows[0]).toMatchObject({ inventoryNumber: 'LP-3', latitude: 48.3, longitude: 17.3 });
  });
});
