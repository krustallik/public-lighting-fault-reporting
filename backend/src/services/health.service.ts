import { pool } from '../db/pool.js';
import type { HealthResponse } from '../types/api.js';

export async function checkHealth(): Promise<HealthResponse> {
  await pool.query('SELECT 1');

  return {
    status: 'ok',
    timestamp: new Date().toISOString(),
    service: 'public-lighting-api',
  };
}
