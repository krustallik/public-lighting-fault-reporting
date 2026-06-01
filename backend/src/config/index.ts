import dotenv from 'dotenv';

dotenv.config();

export const config = {
  port: Number(process.env.PORT) || 5000,
  nodeEnv: process.env.NODE_ENV || 'development',
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  db: {
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 5432,
    database: process.env.DB_NAME || 'lighting_faults',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
  },
  aussemio: {
    baseUrl: process.env.AUSEMIO_BASE_URL || 'https://kosice.ausemio.io/public_issues',
    apiKey: process.env.AUSEMIO_API_KEY || '',
    testMode: process.env.AUSEMIO_TEST_MODE !== 'false',
    locale: process.env.AUSEMIO_LOCALE || 'sk',
  },
  geocoding: {
    /** When false, skip automatic Nominatim calls on startup and create/update. Manual script still works. */
    autoGeocode: process.env.NOMINATIM_AUTO_GEOCODE === 'true',
    nominatimBaseUrl:
      process.env.NOMINATIM_BASE_URL || 'https://nominatim.openstreetmap.org',
    userAgent:
      process.env.NOMINATIM_USER_AGENT ||
      'PublicLightingFaultReporting/1.0 (thesis; contact: admin@example.com)',
    acceptLanguage: process.env.NOMINATIM_ACCEPT_LANGUAGE || 'sk',
    minIntervalMs: Number(process.env.NOMINATIM_MIN_INTERVAL_MS) || 1100,
  },
} as const;
