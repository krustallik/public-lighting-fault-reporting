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
    expect(countSql).toContain('status = $2');
    expect(countSql).toContain('district ILIKE $1');
    expect(countParams).toEqual(['%LED%', 'active', 'Staré Mesto']);
    expect(rowsSql).toContain('ORDER BY id ASC NULLS LAST, id ASC');
    expect(rowsParams).toEqual(['%LED%', 'active', 'Staré Mesto', 20, 0]);
  });

  it('maps Slovak status labels to stored status values using parameterized equality', async () => {
    await listStreetLights({ search: 'Neaktívny' });
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain('status = ANY($2::varchar[])');
    expect(sql).not.toContain('Neaktívny');
    expect(params).toEqual(['%Neaktívny%', ['inactive']]);
  });

  it('combines exact type, explicit missing district and bounded search without interpolating values', async () => {
    await listStreetLights({ search: "x%' OR TRUE --", districtMissing: true, lampType: 'LED', page: 2, limit: 50 });
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain("(district IS NULL OR BTRIM(district) = '')");
    expect(sql).toContain('BTRIM(lamp_type) = $2');
    expect(sql).not.toContain("x%' OR TRUE");
    expect(params).toEqual(["%x%' OR TRUE --%", 'LED']);
    expect(query.mock.calls[1][1]).toEqual(["%x%' OR TRUE --%", 'LED', 50, 50]);
  });

  it('uses the exact primary-key lookup branch for numeric internal IDs', async () => {
    await listStreetLights({ search: '12345' });
    expect(query.mock.calls[0][0]).toContain('id = $2::integer');
    expect(query.mock.calls[0][1]).toEqual(['%12345%', 12345]);
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
