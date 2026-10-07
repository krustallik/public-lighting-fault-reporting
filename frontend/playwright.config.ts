import { defineConfig, devices } from '@playwright/test';

const apiUrl = 'http://127.0.0.1:5000/api';
const probeIp = process.env.PROBE_IPV4;
if (process.env.PROCESS_EGRESS_ISOLATED !== '1') {
  throw new Error('Browser E2E must run inside the proven process-egress network namespace.');
}
const browserArgs = [
  '--disable-background-networking',
  '--disable-component-update',
  '--disable-default-apps',
  '--disable-sync',
  '--no-first-run',
  '--no-default-browser-check',
  '--no-proxy-server',
];

if (probeIp) {
  browserArgs.push(`--host-resolver-rules=MAP example.com ${probeIp}`);
}

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: 1,
  timeout: 45_000,
  expect: { timeout: 8_000 },
  outputDir: 'test-results',
  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
  ],
  use: {
    ...devices['Desktop Chrome'],
    hasTouch: true,
    baseURL: 'http://127.0.0.1:5173',
    browserName: 'chromium',
    serviceWorkers: 'block',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    launchOptions: { args: browserArgs },
  },
  webServer: [
    {
      command: 'npm run e2e:test-server',
      cwd: '../backend',
      reuseExistingServer: false,
      port: 5000,
      timeout: 30_000,
      wait: { stdout: /LOCAL_TEST_E2E_BACKEND_READY/ },
      env: {
        NODE_ENV: 'test',
        LOCAL_TEST_SUBMIT_ENABLED: 'true',
        PORT: '5000',
        CORS_ORIGIN: 'http://127.0.0.1:5173',
        LOCAL_TEST_MAX_FILE_BYTES: '64',
        LOCAL_TEST_MAX_FILES: '2',
        LOCAL_TEST_MAX_TOTAL_UPLOAD_BYTES: '96',
        AUSEMIO_BASE_URL: 'http://127.0.0.1:1/blocked-test-placeholder',
        NOMINATIM_AUTO_GEOCODE: 'false',
        GEOAPIFY_ENABLED: 'false',
      },
      stdout: 'pipe',
      stderr: 'pipe',
    },
    {
      command: 'npm run dev -- --host 127.0.0.1 --port 5173 --strictPort',
      cwd: '.',
      url: 'http://127.0.0.1:5173',
      reuseExistingServer: false,
      timeout: 30_000,
      env: {
        VITE_API_URL: apiUrl,
        VITE_MAP_TILE_PROVIDER: 'synthetic',
        VITE_CARTO_TILES_APPROVED: 'false',
        VITE_CARTO_PUBLIC_KEY: '',
        VITE_ALLOW_DEVICE_MAP_RECENTER: 'true',
      },
      stdout: 'pipe',
      stderr: 'pipe',
    },
  ],
});
