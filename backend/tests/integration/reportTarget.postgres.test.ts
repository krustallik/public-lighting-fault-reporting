import { afterAll, describe, expect, it } from 'vitest';
import { pool } from '../../src/db/pool.js';
import { postgresLightPointCoordinateRepository, resolveAndValidateReportTarget } from '../../src/domain/reportTarget.js';

const enabled = process.env.P2C_POSTGRES_INTEGRATION === 'true';
let insertedId: number | undefined;

describe.skipIf(!enabled)('PostgreSQL 16 report target integration', () => {
  afterAll(async () => {
    try {
      if (insertedId !== undefined) await pool.query('DELETE FROM light_points WHERE id = $1', [insertedId]);
    } finally {
      await pool.end();
    }
  });

  it('uses canonical PostgreSQL coordinates when client coordinates conflict', async () => {
    const inserted = await pool.query<{ id: number }>(
      `INSERT INTO light_points (inventory_number, geom, address, status)
       VALUES ('P2C-TEST-001', ST_SetSRID(ST_MakePoint(21.2611, 48.7164), 4326), 'Synthetic integration fixture', 'active') RETURNING id`
    );
    insertedId = inserted.rows[0].id;
    const resolved = await resolveAndValidateReportTarget({
      kind: 'light-point', lightPointId: insertedId, latitude: 0, longitude: 0,
    }, postgresLightPointCoordinateRepository);
    expect(resolved).toEqual({
      kind: 'light-point', lightPointId: insertedId, latitude: 48.7164, longitude: 21.2611,
    });
  });
});
