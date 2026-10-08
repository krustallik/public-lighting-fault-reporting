/**
 * Development-only maintenance: re-geocode light points through the legacy Nominatim path.
 * Production inventory/light-point enrichment is intentionally disabled.
 *
 * Usage: npm run geocode:points -- --force
 */
import { pool } from '../db/pool.js';
import { createMigrationPool } from '../db/migrationPool.js';
import { ensureLightPointAddress, geocodePendingLightPoints } from '../services/lightPoints.service.js';
import { runMigrations } from '../db/migrate.js';

const force = process.argv.includes('--force');

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Legacy inventory geocoding is disabled in production.');
  }
  const migrationPool = createMigrationPool(process.env);
  try {
    await runMigrations(migrationPool);
  } finally {
    await migrationPool.end();
  }

  if (force) {
    const { rows } = await pool.query<{ id: number }>(
      'SELECT id FROM light_points ORDER BY id'
    );
    for (const row of rows) {
      await ensureLightPointAddress(row.id, true, true);
      console.log('Inventory address updated');
    }
    console.log(`Force geocoded ${rows.length} light points`);
  } else {
    const count = await geocodePendingLightPoints(true);
    console.log(`Geocoded ${count} pending light points`);
  }

  await pool.end();
}

main().catch(() => {
  console.error('Inventory geocoding failed');
  process.exit(1);
});
