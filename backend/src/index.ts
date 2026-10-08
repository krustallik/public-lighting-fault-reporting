import { config } from './config/index.js';
import { pool } from './db/pool.js';
import { assertMigrationsCurrent } from './db/migrate.js';
import { createApp } from './app.js';
import { startImportQueueWorker, stopImportQueueWorker } from './services/importQueueWorker.service.js';

const app = createApp(process.env);

async function start(): Promise<void> {
  let server: ReturnType<typeof app.listen> | undefined;
  try {
    await pool.query('SELECT 1');
    await assertMigrationsCurrent(pool);
    await startImportQueueWorker();
    console.log('Database connection and migration ledger verified');
  } catch {
    console.error('Database connection failed');
    process.exit(1);
  }

  server = app.listen(config.port, () => {
    console.log(`Backend listening on port ${config.port}`);
  });

  const shutdown = async () => {
    await stopImportQueueWorker();
    if (server?.listening) await new Promise<void>((resolve) => server!.close(() => resolve()));
    await pool.end();
  };
  process.once('SIGINT', () => { void shutdown(); });
  process.once('SIGTERM', () => { void shutdown(); });
}

start();
