import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertLiveProviderLocalUatEnvironment, assertLiveProviderLocalUatWorkingDirectory } from './liveEnvironment.js';
import { createLiveUatStatusHandler } from './liveStatus.js';

const BACKEND_PORT = 5000;
const LOOPBACK = '127.0.0.1';

let closePool: (() => Promise<void>) | undefined;

async function start(): Promise<void> {
  assertLiveProviderLocalUatEnvironment(process.env);
  const expectedStateDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../.local-uat');
  assertLiveProviderLocalUatWorkingDirectory(process.cwd(), expectedStateDirectory);

  const [appModule, poolModule, migrationModule, queueModule, configModule, providerModule] = await Promise.all([
    import('../../src/app.js'),
    import('../../src/db/pool.js'),
    import('../../src/db/migrate.js'),
    import('../../src/services/importQueueWorker.service.js'),
    import('../../src/config/index.js'),
    import('./liveProviders.js'),
  ]);
  const { pool } = poolModule;
  const { config } = configModule;
  closePool = () => pool.end();
  await pool.query('SELECT postgis_full_version()');
  await migrationModule.assertMigrationsCurrent(pool);
  const { rows } = await pool.query<{ count: string }>('SELECT COUNT(*)::text AS count FROM light_points');
  const inventoryRows = Number(rows[0]?.count ?? 0);
  if (!Number.isSafeInteger(inventoryRows) || inventoryRows < 1) {
    throw new Error('Live provider local UAT requires at least one inventory row in the dedicated local database.');
  }

  const evidence = new providerModule.LiveProviderEvidence();
  const emailProvider = providerModule.createLiveUatResendProvider({
    apiKey: config.emailVerification.resendApiKey,
    fromEmail: config.emailVerification.resendFromEmail,
    approvedRecipient: process.env.LOCAL_UAT_APPROVED_EMAIL_RECIPIENT!,
    evidence,
  });
  const addressService = providerModule.createLiveUatAddressService({
    config: config.addressProvider,
    evidence,
  });
  const app = appModule.createApp(process.env, {
    emailVerificationProvider: emailProvider,
    reportAddressSuggestionService: addressService,
  });
  const queue = queueModule;
  const statusHandler = createLiveUatStatusHandler(() => ({
      database: { postgisVerified: true, migrationsCurrent: true, inventoryRows },
      providers: {
        resend: {
          configured: true,
          ownerAccountConfirmation: 'required',
          fromConfigured: true,
          approvedRecipientAllowlist: true,
          maxSendsPerProcess: providerModule.LIVE_UAT_MAX_RESEND_ATTEMPTS,
        },
        geoapify: {
          configured: true,
          maxRequestsPerProcess: providerModule.LIVE_UAT_MAX_GEOAPIFY_REQUESTS_PER_PROCESS,
        },
        carto: {
          configured: true,
          tileEvidence: 'reported_in_public_browser',
          attribution: 'owner_browser_confirmation_required',
        },
        observations: evidence.snapshot(),
      },
      submission: { status: 'ON_HOLD', result: 'local simulated sink only', externalRequests: 0 },
    }));
  const backendServer = createServer((request, response) => {
    if (!statusHandler(request, response)) app(request, response);
  });
  let workerStarted = false;
  try {
    await queue.startImportQueueWorker();
    workerStarted = true;
    await new Promise<void>((resolve, reject) => {
      backendServer.once('error', reject);
      backendServer.listen(BACKEND_PORT, LOOPBACK, resolve);
    });
  } catch {
    if (backendServer.listening) await new Promise<void>((resolve) => backendServer.close(() => resolve()));
    if (workerStarted) await queue.stopImportQueueWorker();
    throw new Error('Live provider local UAT could not start its loopback-only application server.');
  }

  process.stdout.write('LIVE_PROVIDER_UAT_READY backend=127.0.0.1:5000 providers=owner-configured submission=local-simulated-only\n');
  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    await queue.stopImportQueueWorker();
    if (backendServer.listening) await new Promise<void>((resolve) => backendServer.close(() => resolve()));
    await pool.end();
  };
  process.once('SIGINT', () => { void shutdown(); });
  process.once('SIGTERM', () => { void shutdown(); });
}

const invokedFile = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedFile && invokedFile === fileURLToPath(import.meta.url)) {
  void start().catch(async () => {
    console.error('Live provider local UAT failed its safety, configuration, or local database checks.');
    await closePool?.().catch(() => undefined);
    process.exitCode = 1;
  });
}
