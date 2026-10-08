import bcrypt from 'bcrypt';
import type { Pool as PgPool, PoolClient } from 'pg';

const BOOTSTRAP_LOCK_NAMESPACE = 1_701_669_235;
const BOOTSTRAP_LOCK_KEY = 17;

export interface BootstrapAdminInput {
  username: string;
  password: string;
  fullName?: string;
}

export interface BootstrapAdminResult { id: number; username: string }

export class BootstrapAdminError extends Error {
  constructor(readonly code: 'invalid_input' | 'already_initialized' | 'failed') {
    super(code === 'invalid_input' ? 'Bootstrap input is invalid.'
      : code === 'already_initialized' ? 'An administrator already exists.'
        : 'Administrator bootstrap failed.');
    this.name = 'BootstrapAdminError';
  }
}

export function validateBootstrapAdminInput(input: BootstrapAdminInput): BootstrapAdminInput {
  const username = input.username.trim();
  const fullName = input.fullName?.trim() ?? '';
  if (!/^[A-Za-z0-9._-]{3,80}$/.test(username) ||
    input.password.length < 12 || input.password.length > 128 ||
    (input.fullName !== undefined && (fullName.length < 1 || fullName.length > 200))) {
    throw new BootstrapAdminError('invalid_input');
  }
  return { username, password: input.password, ...(fullName ? { fullName } : {}) };
}

/** Creates one first administrator atomically, using only the supplied bootstrap capability. */
export async function createFirstAdmin(
  database: Pick<PgPool, 'connect'>,
  untrustedInput: BootstrapAdminInput
): Promise<BootstrapAdminResult> {
  const input = validateBootstrapAdminInput(untrustedInput);
  const client: PoolClient = await database.connect();
  let transactionOpen = false;
  try {
    await client.query('BEGIN');
    transactionOpen = true;
    await client.query('SELECT pg_advisory_xact_lock($1, $2)', [BOOTSTRAP_LOCK_NAMESPACE, BOOTSTRAP_LOCK_KEY]);
    const { rows: existing } = await client.query<{ id: number }>('SELECT id FROM admins LIMIT 1');
    if (existing.length > 0) {
      await client.query('ROLLBACK');
      transactionOpen = false;
      throw new BootstrapAdminError('already_initialized');
    }

    const passwordHash = await bcrypt.hash(input.password, 12);
    const { rows } = await client.query<{ id: number }>(
      `INSERT INTO admins (username, password_hash, full_name)
       VALUES ($1, $2, $3)
       RETURNING id`,
      [input.username, passwordHash, input.fullName ?? null]
    );
    const admin = rows[0];
    if (!admin) throw new Error('Bootstrap insert returned no row.');
    await client.query(
      `INSERT INTO admin_activity_logs (admin_id, action, entity_type, entity_id, details)
       VALUES (NULL, 'bootstrap_admin_created', 'admin', $1, '{}'::jsonb)`,
      [admin.id]
    );
    await client.query('COMMIT');
    transactionOpen = false;
    return { id: admin.id, username: input.username };
  } catch (error) {
    if (transactionOpen) await client.query('ROLLBACK').catch(() => undefined);
    if (error instanceof BootstrapAdminError) throw error;
    throw new BootstrapAdminError('failed');
  } finally {
    client.release();
  }
}
