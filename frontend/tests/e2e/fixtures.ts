import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { expect, test as base } from '@playwright/test';

export interface RequestLedgerEntry {
  method: string;
  origin: string;
  pathname: string;
  permitted: boolean;
  disposition: 'pending' | 'forwarded' | 'intercepted' | 'blocked' | 'failed';
}

interface TestFixtures {
  requestLedger: RequestLedgerEntry[];
}

function isPermittedLocalRequest(url: URL, method: string): boolean {
  if (url.hostname !== '127.0.0.1') return false;
  if (method === 'GET' || method === 'HEAD') return true;
  return method === 'POST' &&
    url.port === '5000' &&
    url.pathname === '/api/dev/ausemio-test-submit';
}

export function markRequestIntercepted(
  ledger: RequestLedgerEntry[],
  request: import('@playwright/test').Request
): void {
  const url = new URL(request.url());
  const method = request.method().toUpperCase();
  for (let index = ledger.length - 1; index >= 0; index -= 1) {
    const entry = ledger[index];
    if (
      entry.origin === url.origin &&
      entry.pathname === url.pathname &&
      entry.method === method &&
      entry.disposition === 'pending'
    ) {
      entry.disposition = 'intercepted';
      return;
    }
  }
}

export const test = base.extend<TestFixtures>({
  requestLedger: async ({ context }, use, testInfo) => {
    const ledger: RequestLedgerEntry[] = [];
    const entriesByRequest = new WeakMap<import('@playwright/test').Request, RequestLedgerEntry>();
    context.on('request', (request) => {
      const url = new URL(request.url());
      const method = request.method().toUpperCase();
      const entry: RequestLedgerEntry = {
        method,
        origin: url.origin,
        pathname: url.pathname,
        permitted: isPermittedLocalRequest(url, method),
        disposition: 'pending',
      };
      ledger.push(entry);
      entriesByRequest.set(request, entry);
    });

    context.on('requestfinished', (request) => {
      const entry = entriesByRequest.get(request);
      if (entry?.disposition === 'pending') entry.disposition = 'forwarded';
    });

    context.on('requestfailed', (request) => {
      const entry = entriesByRequest.get(request);
      if (entry?.disposition === 'pending') entry.disposition = 'failed';
    });

    await context.route('**/*', async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const method = request.method().toUpperCase();
      if (isPermittedLocalRequest(url, method)) {
        const entry = entriesByRequest.get(request);
        if (entry) entry.disposition = 'forwarded';
        await route.continue();
      } else {
        const entry = entriesByRequest.get(request);
        if (entry) entry.disposition = 'blocked';
        await route.abort('internetdisconnected');
      }
    });

    try {
      await use(ledger);
    } finally {
      const filePath = join(testInfo.outputDir, 'request-ledger.json');
      await mkdir(dirname(filePath), { recursive: true });
      await writeFile(filePath, `${JSON.stringify(ledger, null, 2)}\n`, 'utf8');
      await testInfo.attach('synthetic-request-ledger', {
        path: filePath,
        contentType: 'application/json',
      });

      const disallowed = ledger.filter((entry) => !entry.permitted);
      expect(disallowed, 'every browser request must stay within the explicit loopback allowlist').toEqual([]);
      expect(
        ledger.filter((entry) => entry.disposition === 'pending'),
        'every request must have a recorded network or interception outcome'
      ).toEqual([]);
    }
  },
});

export { expect };
