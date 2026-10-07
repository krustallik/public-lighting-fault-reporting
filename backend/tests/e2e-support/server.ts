import { createServer } from 'node:http';
import { createApp } from '../../src/app.js';
import { createReportAddressSuggestionService } from '../../src/services/reportAddressSuggestion.service.js';

if (process.env.NODE_ENV !== 'test' || process.env.LOCAL_TEST_SUBMIT_ENABLED !== 'true') {
  throw new Error('The E2E support server requires explicit test-only local-submit settings.');
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

server.listen(port, '127.0.0.1', () => {
  process.stdout.write(`LOCAL_TEST_E2E_BACKEND_READY ${port}\n`);
});

const shutdown = () => {
  server.close(() => process.exit(0));
};

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
