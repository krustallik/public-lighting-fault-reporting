import { createServer } from 'node:http';
import { createApp } from '../../src/app.js';
import { createReportAddressSuggestionService } from '../../src/services/reportAddressSuggestion.service.js';
import { pool } from '../../src/db/pool.js';
import { startImportQueueWorker, stopImportQueueWorker } from '../../src/services/importQueueWorker.service.js';
import type { VerificationEmail } from '../../src/services/emailVerificationProvider.js';

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
const emailPort = Number(process.env.EMAIL_E2E_PORT ?? 5001);
const emailTestJwtSecret = Buffer.from([
  19, 203, 44, 91, 7, 166, 230, 51, 116, 9, 189, 64, 233, 18, 143, 78,
  91, 4, 172, 225, 36, 105, 252, 11, 147, 55, 204, 63, 18, 171, 99, 240,
]).toString('base64url');
let latestVerification: VerificationEmail | undefined;
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
const publicApp = createApp(process.env, { reportAddressSuggestionService: fakeAddressService });
const emailVerificationApp = createApp({
  ...process.env,
  EMAIL_VERIFICATION_ENABLED: 'true',
  RESEND_API_KEY: 'e2e-fake-key-never-used-for-network-requests',
  RESEND_FROM_EMAIL: 'lighting@example.test',
  JWT_SECRET: emailTestJwtSecret,
}, {
  reportAddressSuggestionService: fakeAddressService,
  emailVerificationProvider: {
    async sendVerificationCode(message) { latestVerification = message; },
  },
});
const server = createServer(publicApp);
const emailVerificationServer = createServer((request, response) => {
  if (request.method === 'GET' && request.url === '/__test/email-verification/latest-code') {
    response.setHeader('Cache-Control', 'no-store');
    if (!latestVerification) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ code: latestVerification.code, email: latestVerification.email }));
    return;
  }
  emailVerificationApp(request, response);
});

async function start(): Promise<void> {
  const { rows } = await pool.query<{ version: string | null; migrations: string[] }>(
    `SELECT postgis_full_version() AS version,
            ARRAY(SELECT version FROM schema_migrations ORDER BY version) AS migrations`
  );
  if (!rows[0]?.version || rows[0].migrations.join(',') !== '0001,0002,0003,0004,0005,0006,0007') {
    throw new Error('The E2E backend requires the canonical PostGIS migration chain.');
  }
  await startImportQueueWorker();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve());
  });
  await new Promise<void>((resolve, reject) => {
    emailVerificationServer.once('error', reject);
    emailVerificationServer.listen(emailPort, '127.0.0.1', () => resolve());
  });
  process.stdout.write(`LOCAL_TEST_E2E_BACKEND_READY ${port},${emailPort} POSTGIS_MIGRATIONS=0001,0002,0003,0004,0005,0006,0007\n`);
}

void start().catch(async () => {
  await pool.end();
  process.exitCode = 1;
});

const shutdown = () => {
  void stopImportQueueWorker().finally(() => {
    const closePublic = new Promise<void>((resolve) => {
      if (server.listening) server.close(() => resolve()); else resolve();
    });
    const closeEmail = new Promise<void>((resolve) => {
      if (emailVerificationServer.listening) emailVerificationServer.close(() => resolve()); else resolve();
    });
    void Promise.all([closePublic, closeEmail]).finally(() => { void pool.end(); });
  });
};

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
