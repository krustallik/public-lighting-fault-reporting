import pg from 'pg';
import { resetE2EDatabase } from './resetDatabase.js';
import { assertDisposableE2EDatabaseConfig } from './disposableDatabaseConfig.js';

const { Pool } = pg;
const databaseName = process.env.DB_NAME ?? '';
assertDisposableE2EDatabaseConfig(process.env);

const pool = new Pool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT ?? 5432),
  database: databaseName,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});
try {
  await resetE2EDatabase(pool);
  console.log(`P5_E2E_DISPOSABLE_DATABASE_CLEANED database=${databaseName}`);
} finally {
  await pool.end();
}
