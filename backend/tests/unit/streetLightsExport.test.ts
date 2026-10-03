import { beforeEach, describe, expect, it, vi } from 'vitest';

const { queryMock } = vi.hoisted(() => ({ queryMock: vi.fn() }));

vi.mock('../../src/db/pool.js', () => ({ pool: { query: queryMock } }));

import { exportStreetLights } from '../../src/services/streetLightsExport.service.js';

describe('street-light CSV export', () => {
  beforeEach(() => {
    queryMock.mockReset();
  });

  it('serializes the current header and quotes comma, quote, and newline values', async () => {
    queryMock.mockResolvedValueOnce({
      rows: [
        {
          id: 2,
          external_id: 'LP-2',
          latitude: '48.1',
          longitude: '17.1',
          address: 'Line A, "North"\nLine B',
          district: 'Staré Mesto',
          lamp_type: null,
          status: 'active',
          created_at: new Date('2026-10-03T00:00:00.000Z'),
          updated_at: new Date('2026-10-03T00:00:00.000Z'),
        },
      ],
    });

    const result = await exportStreetLights('csv', {});

    expect(result.contentType).toBe('text/csv');
    expect(result.filename).toMatch(/^street-lights-\d{4}-\d{2}-\d{2}\.csv$/);
    expect(result.body).toBe(
      'inventoryNumber,latitude,longitude,address,district,lampType,status\n' +
        'LP-2,48.1,17.1,"Line A, ""North""\nLine B",Staré Mesto,,active'
    );
    expect(queryMock).toHaveBeenCalledTimes(1);
  });
});
