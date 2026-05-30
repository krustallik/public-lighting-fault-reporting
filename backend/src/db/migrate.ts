import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import bcrypt from 'bcrypt';
import { pool } from './pool.js';

// noinspection SqlDialectInspection,SqlNoDataSourceInspection,SqlResolveInspection

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

async function runSqlFile(filePath: string): Promise<void> {
  const sql = fs.readFileSync(filePath, 'utf-8');
  await pool.query(sql);
}

/** Lightweight migrations safe to run on every server start. */
export async function runMigrations(): Promise<void> {
  await pool.query(
    `
    ALTER TABLE light_points
      ADD COLUMN IF NOT EXISTS address_geocoded_at TIMESTAMPTZ
  `);

  if (fs.existsSync(MIGRATIONS_DIR)) {
    const files = fs
      .readdirSync(MIGRATIONS_DIR)
      .filter((name) => name.endsWith('.sql'))
      .sort();

    for (const file of files) {
      const filePath = path.join(MIGRATIONS_DIR, file);
      await runSqlFile(filePath);
      console.log(`Migration applied: ${file}`);
    }
  } else {
    console.warn(`Migrations directory not found: ${MIGRATIONS_DIR}`);
  }

  const initialPassword = process.env.ADMIN_INITIAL_PASSWORD;
  if (initialPassword) {
    const hash = await bcrypt.hash(initialPassword, 10);
    const { rowCount } = await pool.query(
      `UPDATE admins SET password_hash = $1
       WHERE password_hash = 'PLACEHOLDER_HASH'`,
      [hash]
    );
    if (rowCount && rowCount > 0) {
      console.log('Admin seed password applied from ADMIN_INITIAL_PASSWORD');
    }
  }
}
