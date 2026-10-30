import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { pool } from '../../src/db/pool.js';
import { postgresLightPointCoordinateRepository, resolveAndValidateReportTarget } from '../../src/domain/reportTarget.js';

const enabled = process.env.P2C_POSTGRES_INTEGRATION === 'true';
const insertedIds = new Set<number>();

describe.skipIf(!enabled)('PostgreSQL 16 report target integration', () => {
  afterEach(async () => {
    if (insertedIds.size === 0) return;
    await pool.query('DELETE FROM light_points WHERE id = ANY($1::integer[])', [[...insertedIds]]);
    insertedIds.clear();
  });

  afterAll(async () => {
    await pool.end();
  });

  it('uses canonical PostgreSQL coordinates when client coordinates conflict', async () => {
    const inserted = await pool.query<{ id: number }>(
      `INSERT INTO light_points (inventory_number, geom, address, status)
       VALUES ($1, ST_SetSRID(ST_MakePoint(21.2611, 48.7164), 4326), 'Synthetic integration fixture', 'active') RETURNING id`,
      [`P2C-TEST-${randomUUID()}`]
    );
    const id = inserted.rows[0].id;
    insertedIds.add(id);
    const resolved = await resolveAndValidateReportTarget({
      kind: 'light-point', lightPointId: id, latitude: 0, longitude: 0,
    }, postgresLightPointCoordinateRepository);
    expect(resolved).toEqual({
      kind: 'light-point', lightPointId: id, latitude: 48.7164, longitude: 21.2611,
    });
  });

  it('rejects an inventory point whose canonical PostgreSQL location is outside Košice', async () => {
    const inserted = await pool.query<{ id: number }>(
      `INSERT INTO light_points (inventory_number, geom, address, status)
       VALUES ($1, ST_SetSRID(ST_MakePoint(22, 48.7164), 4326), 'Synthetic outside fixture', 'active') RETURNING id`,
      [`P2C-TEST-${randomUUID()}`]
    );
    const id = inserted.rows[0].id;
    insertedIds.add(id);

    await expect(resolveAndValidateReportTarget({ kind: 'light-point', lightPointId: id }, postgresLightPointCoordinateRepository))
      .rejects.toMatchObject({ status: 422, code: 'outside_service_area' });
  });

  it('returns not-found when the selected inventory point no longer exists', async () => {
    const inserted = await pool.query<{ id: number }>(
      `INSERT INTO light_points (inventory_number, geom, address, status)
       VALUES ($1, ST_SetSRID(ST_MakePoint(21.2611, 48.7164), 4326), 'Synthetic deleted fixture', 'active') RETURNING id`,
      [`P2C-TEST-${randomUUID()}`]
    );
    const id = inserted.rows[0].id;
    await pool.query('DELETE FROM light_points WHERE id = $1', [id]);

    await expect(resolveAndValidateReportTarget({ kind: 'light-point', lightPointId: id }, postgresLightPointCoordinateRepository))
      .rejects.toMatchObject({ status: 404, code: 'light_point_not_found' });
  });
});
