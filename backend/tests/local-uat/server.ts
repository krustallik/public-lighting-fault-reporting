import { createServer, type Server } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertLocalUatEnvironment, assertLocalUatWorkingDirectory } from './environment.js';

const BACKEND_PORT = 5000;
const EMAIL_INBOX_PORT = 5001;
const LOOPBACK = '127.0.0.1';

let closePool: (() => Promise<void>) | undefined;

async function start(): Promise<void> {
  assertLocalUatEnvironment(process.env);
  const expectedStateDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../.local-uat');
  assertLocalUatWorkingDirectory(process.cwd(), expectedStateDirectory);
  const [appModule, poolModule, migrationModule, queueModule, serviceAreaModule, httpModule, fakeModule] = await Promise.all([
    import('../../src/app.js'),
    import('../../src/db/pool.js'),
    import('../../src/db/migrate.js'),
    import('../../src/services/importQueueWorker.service.js'),
    import('../../src/domain/serviceArea.js'),
    import('./http.js'),
    import('./fakes.js'),
  ]);
  const { createApp } = appModule;
  const { pool } = poolModule;
  closePool = () => pool.end();
  const { assertMigrationsCurrent } = migrationModule;
  const { startImportQueueWorker, stopImportQueueWorker } = queueModule;
  const { kosiceServiceAreaClassifier } = serviceAreaModule;
  const { createEmailInboxServer, createLocalUatTools } = httpModule;
  const { LocalUatAddressProvider, LocalUatEmailProvider } = fakeModule;
  await pool.query('SELECT postgis_full_version()');
  await assertMigrationsCurrent(pool);
  const { rows } = await pool.query<{ count: string }>('SELECT COUNT(*)::text AS count FROM light_points');
  if (Number(rows[0]?.count ?? 0) < 1) {
    throw new Error('Local UAT requires the synthetic inventory seed. Run the guarded local reset command.');
  }

  const emailProvider = new LocalUatEmailProvider();
  const addressProvider = new LocalUatAddressProvider();
  const app = createApp(process.env, {
    emailVerificationProvider: emailProvider,
    reportAddressSuggestionService: addressProvider.service,
    serviceAreaClassifier: (point) => addressProvider.classifyPoint(point, kosiceServiceAreaClassifier),
  });
  const tools = createLocalUatTools(addressProvider, emailProvider);
  const backendServer = createServer((request, response) => {
    const pathname = new URL(request.url ?? '/', `http://${LOOPBACK}:${BACKEND_PORT}`).pathname;
    if (pathname === '/api/dev/local-uat' || pathname.startsWith('/api/dev/local-uat/')) {
      tools(request, response);
    } else {
      app(request, response);
    }
  });
  const inboxServer = createEmailInboxServer(emailProvider);
  let workerStarted = false;
  try {
    await startImportQueueWorker();
    workerStarted = true;
    await new Promise<void>((resolve, reject) => {
      backendServer.once('error', reject);
      backendServer.listen(BACKEND_PORT, LOOPBACK, resolve);
    });
    await new Promise<void>((resolve, reject) => {
      inboxServer.once('error', reject);
      inboxServer.listen(EMAIL_INBOX_PORT, LOOPBACK, resolve);
    });
  } catch (error) {
    const close = (server: Server) => new Promise<void>((resolve) => {
      if (server.listening) server.close(() => resolve()); else resolve();
    });
    await Promise.all([close(backendServer), close(inboxServer)]);
    if (workerStarted) await stopImportQueueWorker();
    throw error;
  }
  process.stdout.write('LOCAL_UAT_READY backend=127.0.0.1:5000 inbox=127.0.0.1:5001 email=fake address=fake submission=local-only\n');

  const shutdown = async () => {
    await stopImportQueueWorker();
    const close = (server: Server) => new Promise<void>((resolve) => {
      if (server.listening) server.close(() => resolve()); else resolve();
    });
    await Promise.all([close(backendServer), close(inboxServer)]);
    await pool.end();
  };
  process.once('SIGINT', () => { void shutdown(); });
  process.once('SIGTERM', () => { void shutdown(); });
}

const invokedFile = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedFile && invokedFile === fileURLToPath(import.meta.url)) {
  void start().catch(async (error: unknown) => {
    console.error(error instanceof Error ? error.message : 'Local UAT failed to start.');
    await closePool?.();
    process.exitCode = 1;
  });
}
