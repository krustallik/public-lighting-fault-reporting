import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import bcrypt from 'bcrypt';
import { pool } from './pool.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function runSqlFile(relativePath: string): Promise<void> {
  const fullPath = path.join(__dirname, relativePath);
  if (!fs.existsSync(fullPath)) return;
  const sql = fs.readFileSync(fullPath, 'utf-8');
  await pool.query(sql);
}

/** Lightweight migrations safe to run on every server start. */
export async function runMigrations(): Promise<void> {
  await pool.query(`
    ALTER TABLE light_points
      ADD COLUMN IF NOT EXISTS address_geocoded_at TIMESTAMPTZ
  `);

  await runSqlFile('../../../database/migrations/003_admin_auth_and_batches.sql');

  const initialPassword = process.env.ADMIN_INITIAL_PASSWORD;
  if (initialPassword) {
    const hash = await bcrypt.hash(initialPassword, 10);
    await pool.query(
      `UPDATE admins SET password_hash = $1
       WHERE password_hash = 'PLACEHOLDER_HASH'`,
      [hash]
    );
  }
}
