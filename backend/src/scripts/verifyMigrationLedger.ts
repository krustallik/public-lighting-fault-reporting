import dotenv from 'dotenv';
import type { PoolClient } from 'pg';
import { createMigrationPool } from '../db/migrationPool.js';
import { assertMigrationsCurrent } from '../db/migrate.js';

dotenv.config();

const migrationPool = createMigrationPool(process.env);
const client = await migrationPool.connect();
try {
  await client.query('BEGIN READ ONLY');
  const readOnlyClient = {
    query: client.query.bind(client),
    release: () => undefined,
  } as unknown as PoolClient;
  await assertMigrationsCurrent({ connect: async () => readOnlyClient }, { statementTimeoutMs: 5000 });
  await client.query('COMMIT');
  console.info('Database migration ledger matches this release.');
} catch {
  await client.query('ROLLBACK').catch(() => undefined);
  console.error('Database migration ledger is not ready for this release.');
  process.exitCode = 1;
} finally {
  client.release();
  await migrationPool.end();
}
