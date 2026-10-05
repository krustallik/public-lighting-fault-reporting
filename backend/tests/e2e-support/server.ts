import { createServer } from 'node:http';
import { createApp } from '../../src/app.js';

if (process.env.NODE_ENV !== 'test' || process.env.LOCAL_TEST_SUBMIT_ENABLED !== 'true') {
  throw new Error('The E2E support server requires explicit test-only local-submit settings.');
}

const port = Number(process.env.PORT ?? 5000);
const server = createServer(createApp(process.env));

server.listen(port, '127.0.0.1', () => {
  process.stdout.write(`LOCAL_TEST_E2E_BACKEND_READY ${port}\n`);
});

const shutdown = () => {
  server.close(() => process.exit(0));
};

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
