import { beforeEach, describe, expect, it, vi } from 'vitest';

const { query } = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('../../src/db/pool.js', () => ({ pool: { query } }));
vi.mock('../../src/services/lightPoints.service.js', () => ({
  createLightPoint: vi.fn(), deleteLightPoint: vi.fn(), getLightPointById: vi.fn(), updateLightPoint: vi.fn(),
}));

import { listStreetLights } from '../../src/services/adminStreetLights.service.js';

beforeEach(() => {
  query.mockReset();
  query.mockResolvedValueOnce({ rows: [{ count: '2' }] }).mockResolvedValueOnce({ rows: [] });
});

describe('admin inventory search and sort SQL', () => {
  it('searches the full query across exact ID, inventory, external ID, address, district and lamp type with parameter values', async () => {
    await listStreetLights({ search: 'LED', status: 'active', district: 'Staré Mesto' });
    const [countSql, countParams] = query.mock.calls[0];
    const [rowsSql, rowsParams] = query.mock.calls[1];
    expect(countSql).toContain('lamp_type ILIKE $1');
    expect(countSql).toContain('id::text = $2');
    expect(countSql).toContain('status = $3');
    expect(countSql).toContain('district ILIKE $4');
    expect(countParams).toEqual(['%LED%', 'LED', 'active', '%Staré Mesto%']);
    expect(rowsSql).toContain('ORDER BY id ASC NULLS LAST, id ASC');
    expect(rowsParams).toEqual(['%LED%', 'LED', 'active', '%Staré Mesto%', 20, 0]);
  });

  it.each([
    ['district', `ORDER BY NULLIF(BTRIM(district), '') COLLATE "C" DESC NULLS LAST, id ASC`],
    ['lamp_type', `ORDER BY NULLIF(BTRIM(lamp_type), '') COLLATE "C" ASC NULLS LAST, id ASC`],
  ] as const)('uses an allowlisted deterministic expression for %s sorting', async (sortBy, expected) => {
    await listStreetLights({ sortBy, sortOrder: sortBy === 'district' ? 'desc' : 'asc', page: 3, limit: 10 });
    expect(query.mock.calls[1][0]).toContain(expected);
    expect(query.mock.calls[1][1]).toEqual([10, 20]);
  });

  it('falls back to the safe ID order for an unrecognized sort key', async () => {
    await listStreetLights({ sortBy: 'id); DROP TABLE light_points;--' as never, sortOrder: 'desc' });
    expect(query.mock.calls[1][0]).toContain('ORDER BY id DESC NULLS LAST, id ASC');
  });
});
