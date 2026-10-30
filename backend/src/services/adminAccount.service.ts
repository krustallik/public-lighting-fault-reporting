import bcrypt from 'bcrypt';
import type { PoolClient } from 'pg';
import { pool } from '../db/pool.js';
import { AppError } from '../utils/AppError.js';

export async function provisionAdmin(input: {
  username: string; password: string; fullName?: string;
}, actor: { id: number; username: string }): Promise<{ id: number; username: string }> {
  const username = input.username.trim();
  const fullName = input.fullName?.trim() ?? '';
  if (!/^[A-Za-z0-9._-]{3,80}$/.test(username) || input.password.length < 12 || input.password.length > 128 ||
    (input.fullName !== undefined && (fullName.length < 1 || fullName.length > 200))) {
    throw new AppError(400, 'Invalid administrator details');
  }
  const client: PoolClient = await pool.connect();
  let transactionOpen = false;
  try {
    const passwordHash = await bcrypt.hash(input.password, 12);
    await client.query('BEGIN'); transactionOpen = true;
    const inserted = await client.query<{ id: number }>(
      `INSERT INTO admins (username, password_hash, full_name, is_active)
       VALUES ($1, $2, $3, TRUE) RETURNING id`, [username, passwordHash, fullName || null]
    );
    const newId = inserted.rows[0]?.id;
    if (!newId) throw new Error('Admin insert returned no row');
    await client.query(
      `INSERT INTO admin_activity_logs (admin_id, action, entity_type, entity_id, details, actor_username_snapshot)
       VALUES ($1, 'admin_created', 'admin', $2, '{}'::jsonb, $3)`,
      [actor.id, newId, actor.username]
    );
    await client.query('COMMIT'); transactionOpen = false;
    return { id: newId, username };
  } catch (error) {
    if (transactionOpen) await client.query('ROLLBACK').catch(() => undefined);
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === '23505') {
      throw new AppError(409, 'An administrator with this username already exists');
    }
    throw error;
  } finally { client.release(); }
}
