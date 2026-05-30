/**
 * Optional maintenance: re-geocode light points.
 * Normal operation geocodes automatically on server start and on create/update.
 *
 * Usage: npm run geocode:points -- --force
 */
import { pool } from '../db/pool.js';
import { ensureLightPointAddress, geocodePendingLightPoints } from '../services/lightPoints.service.js';
import { runMigrations } from '../db/migrate.js';

const force = process.argv.includes('--force');

async function main(): Promise<void> {
  await runMigrations();

  if (force) {
    const { rows } = await pool.query<{ id: number }>(
      'SELECT id FROM light_points ORDER BY id'
    );
    for (const row of rows) {
      const address = await ensureLightPointAddress(row.id, true);
      console.log(`[${row.id}] ${address}`);
    }
    console.log(`Force geocoded ${rows.length} light points`);
  } else {
    const count = await geocodePendingLightPoints();
    console.log(`Geocoded ${count} pending light points`);
  }

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
