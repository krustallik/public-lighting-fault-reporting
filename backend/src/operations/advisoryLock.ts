import type { Pool, PoolClient } from 'pg';

export interface AdvisoryLockIdentity { namespace: number; key: number }

export interface SessionLock {
  client: PoolClient;
  release(): Promise<void>;
}

/** Obtains a session-scoped lock and always returns the client to the pool safely. */
export async function tryAcquireSessionLock(
  pool: Pick<Pool, 'connect'>,
  identity: AdvisoryLockIdentity,
): Promise<SessionLock | null> {
  const client = await pool.connect();
  let acquired = false;
  let discard = false;
  try {
    const result = await client.query<{ locked: boolean }>(
      'SELECT pg_try_advisory_lock($1, $2) AS locked', [identity.namespace, identity.key],
    );
    acquired = result.rows[0]?.locked === true;
    if (!acquired) {
      client.release();
      return null;
    }
    let released = false;
    return {
      client,
      async release() {
        if (released) return;
        released = true;
        try {
          const unlocked = await client.query<{ unlocked: boolean }>(
            'SELECT pg_advisory_unlock($1, $2) AS unlocked', [identity.namespace, identity.key],
          );
          if (unlocked.rows[0]?.unlocked !== true) throw new Error('operations_advisory_unlock_not_confirmed');
        } catch {
          discard = true;
          throw new Error('operations_advisory_unlock_failed');
        } finally {
          client.release(discard ? new Error('operations_lock_client_discarded') : undefined);
        }
      },
    };
  } catch (error) {
    discard = acquired;
    client.release(discard ? (error instanceof Error ? error : new Error('operations_lock_acquire_failed')) : undefined);
    throw error;
  }
}
