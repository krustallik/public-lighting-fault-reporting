import pg from 'pg';
import { config } from '../config/index.js';

const { Pool } = pg;

export function createPool(settings: {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
}): pg.Pool {
  return new Pool({
    ...settings,
    max: 10,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30000,
    allowExitOnIdle: false,
    application_name: config.nodeEnv === 'production' ? 'lighting-http' : 'lighting-app',
  });
}

export const pool = createPool(config.db);
