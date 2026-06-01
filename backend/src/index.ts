import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { config } from './config/index.js';
import { pool } from './db/pool.js';
import { runMigrations } from './db/migrate.js';
import { geocodePendingLightPoints } from './services/lightPoints.service.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import healthRoutes from './routes/health.routes.js';
import lightPointsRoutes from './routes/lightPoints.routes.js';
import reportsRoutes from './routes/reports.routes.js';
import adminRoutes from './routes/admin.routes.js';
import geocodingRoutes from './routes/geocoding.routes.js';

const app = express();

app.use(
  cors({
    origin: config.corsOrigin,
    credentials: true,
  })
);
app.use(cookieParser());
app.use(express.json());

app.use('/api', healthRoutes);
app.use('/api/geocode', geocodingRoutes);
app.use('/api/light-points', lightPointsRoutes);
app.use('/api/reports', reportsRoutes);
app.use('/api/admin', adminRoutes);

app.use(notFoundHandler);
app.use(errorHandler);

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
        .catch((err) => {
          console.warn('Automatic geocoding failed:', err);
        });
    } else {
      console.log(
        'Automatic geocoding disabled (set NOMINATIM_AUTO_GEOCODE=true to enable)'
      );
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('Database connection failed:', message);
    process.exit(1);
  }

  app.listen(config.port, () => {
    console.log(`Backend listening on port ${config.port}`);
  });
}

start();
