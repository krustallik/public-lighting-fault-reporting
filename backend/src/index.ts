import { config } from './config/index.js';
import { pool } from './db/pool.js';
import { runMigrations } from './db/migrate.js';
import { geocodePendingLightPoints } from './services/lightPoints.service.js';
import { createApp } from './app.js';

const app = createApp(process.env);

async function start(): Promise<void> {
  try {
    await pool.query('SELECT 1');
    await runMigrations();
    console.log('Database connection established');

    if (config.geocoding.autoGeocode) {
      void geocodePendingLightPoints()
        .then((count) => {
          if (count > 0) {
            console.log(`Automatic geocoding finished (${count} light points)`);
          }
        })
        .catch(() => {
          console.warn('Automatic inventory geocoding failed');
        });
    } else {
      console.log(
        'Automatic geocoding disabled (set NOMINATIM_AUTO_GEOCODE=true to enable)'
      );
    }
  } catch {
    console.error('Database connection failed');
    process.exit(1);
  }

  app.listen(config.port, () => {
    console.log(`Backend listening on port ${config.port}`);
  });
}

start();
