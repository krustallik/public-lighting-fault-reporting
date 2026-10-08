import { createServer } from 'node:http';
import { createApp } from '../../src/app.js';
import { createReportAddressSuggestionService } from '../../src/services/reportAddressSuggestion.service.js';
import { pool } from '../../src/db/pool.js';
import { startImportQueueWorker, stopImportQueueWorker } from '../../src/services/importQueueWorker.service.js';

if (
  process.env.NODE_ENV !== 'test' ||
  process.env.LOCAL_TEST_SUBMIT_ENABLED !== 'true' ||
  process.env.P5_E2E_ALLOW_DB_RESET !== 'true' ||
  !/^p5_e2e_[a-z0-9_]+$/.test(process.env.DB_NAME ?? '') ||
  !process.env.DB_HOST?.startsWith('/')
) {
  throw new Error('The E2E support server requires explicit test-only local-submit and disposable PostGIS settings.');
}

const port = Number(process.env.PORT ?? 5000);
const fakeAddressProvider = {
  id: 'local-e2e-fake-provider',
  async reverse(_request: { latitude: number; longitude: number; language: 'sk' | 'en' }) {
    return { address: 'Jarná 12, Košice', locality: 'Jarná' };
  },
};
const fakeAddressService = createReportAddressSuggestionService({
  enabled: true,
  provider: fakeAddressProvider,
  admission: { maxActive: 1, maxPending: 1, minStartIntervalMs: 0, timeoutMs: 3000, queueExpiryMs: 4000 },
  cache: { maxEntries: 0, ttlMs: 0 },
});
const server = createServer(createApp(process.env, { reportAddressSuggestionService: fakeAddressService }));

async function start(): Promise<void> {
  const { rows } = await pool.query<{ version: string | null; migrations: string[] }>(
    `SELECT postgis_full_version() AS version,
            ARRAY(SELECT version FROM schema_migrations ORDER BY version) AS migrations`
  );
  if (!rows[0]?.version || rows[0].migrations.join(',') !== '0001,0002') {
    throw new Error('The E2E backend requires the canonical PostGIS migration chain.');
  }
  await startImportQueueWorker();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve());
  });
  process.stdout.write(`LOCAL_TEST_E2E_BACKEND_READY ${port} POSTGIS_MIGRATIONS=0001,0002\n`);
}

void start().catch(async () => {
  await pool.end();
  process.exitCode = 1;
});

const shutdown = () => {
  void stopImportQueueWorker().finally(() => {
    if (server.listening) server.close(() => { void pool.end(); });
    else void pool.end();
  });
};

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
