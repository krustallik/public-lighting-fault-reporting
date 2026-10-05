import AxeBuilder from '@axe-core/playwright';
import { expect, markRequestIntercepted, test } from './fixtures';
import type { Page, Response } from '@playwright/test';

const LOCAL_SUBMIT = 'http://127.0.0.1:5000/api/dev/ausemio-test-submit';

async function openCustomLocation(page: Page, viewport?: { width: number; height: number }) {
  if (viewport) await page.setViewportSize(viewport);
  await page.addInitScript(() => {
    window.history.replaceState(
      {
        usr: { reportTarget: { kind: 'custom', latitude: 48.7, longitude: 21.25 } },
        key: 'synthetic-target',
        idx: 0,
      },
      '',
      '/report'
    );
  });
  await page.goto('/report');
  await expect(page.getByRole('heading', { name: 'Formulár nahlásenia poruchy' })).toBeVisible();
  await expect(page.getByLabel('Ulica / Miesto poruchy / Lokalita *')).toBeVisible();
}

async function scanAccessibility(page: Page, state: string) {
  const result = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(result.violations, `axe WCAG violations in ${state}: ${JSON.stringify(result.violations)}`).toEqual([]);
}

async function fillStepOne(page: Page, faultName = 'Svietidlo vôbec nesvieti') {
  await page.getByLabel('Ulica / Miesto poruchy / Lokalita *').selectOption('Jarná');
  await page.getByLabel('Bližší popis / orientačný bod / číslo stožiara').fill('Synthetic locality report details.');
  await page.getByRole('radio', { name: 'Pred blokom' }).check();
  await page.getByRole('radio', { name: faultName }).check();
  await page.getByLabel('Tel. kontakt na Vás *').fill('synthetic-phone-001');
  await page.getByRole('button', { name: 'Ďalej' }).click();
  await expect(page.getByText('Krok 2 z 2')).toBeVisible();
}

async function fillContact(page: Page) {
  await page.getByLabel('E-mail *').fill('synthetic-user@example.test');
  await page.getByRole('checkbox', { name: /Súhlasím/ }).check();
}

async function submitAndReadLocalResponse(page: Page): Promise<Response> {
  const responsePromise = page.waitForResponse((response) =>
    response.url() === LOCAL_SUBMIT && response.request().method() === 'POST'
  );
  await page.getByRole('button', { name: 'Odoslať na lokálny testovací endpoint' }).click();
  return responsePromise;
}

test('service 2 valid Q flow preserves files and reports local simulated receipt on desktop', async ({ page, requestLedger }) => {
  await openCustomLocation(page, { width: 1365, height: 900 });
  await scanAccessibility(page, 'clean step one');
  await fillStepOne(page);
  await scanAccessibility(page, 'step two');
  await fillContact(page);
  await page.getByLabel('Prílohy').setInputFiles([
    { name: 'fixture-one.txt', mimeType: 'text/plain', buffer: Buffer.from('synthetic one') },
    { name: 'fixture-two.bin', mimeType: 'application/octet-stream', buffer: Buffer.from([0, 1, 2]) },
  ]);
  await expect(page.getByText('fixture-one.txt')).toBeVisible();
  await expect(page.getByText('fixture-two.bin')).toBeVisible();

  const response = await submitAndReadLocalResponse(page);
  expect(response.status()).toBe(200);
  const body = await response.json();
  expect(body).toEqual({ success: true, status: 'local_test_received', filesReceived: 2 });

  await expect(page.getByRole('heading', { name: 'LOCAL TEST / SIMULATED' })).toBeVisible();
  await expect(page.getByText(/not sent to AUSEMIO\/DPMK/i)).toBeVisible();
  await expect(page.getByText(/does not establish external acceptance/i)).toBeVisible();
  await expect(page.getByText(/issue reference|external reference/i)).toHaveCount(0);
  await scanAccessibility(page, 'local success result');
  expect(requestLedger.filter((entry) => entry.method === 'POST').map((entry) => entry.pathname)).toEqual([
    '/api/dev/ausemio-test-submit',
  ]);
});

test('custom target address lookup is explicit and applies an editable fake-provider suggestion', async ({ page, requestLedger }) => {
  await page.route('http://127.0.0.1:5000/api/reports/address-suggestion', async (route) => {
    markRequestIntercepted(requestLedger, route.request());
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify({ success: true, data: { address: 'Jarná 12, Košice', locality: 'Jarná' } }),
    });
  });

  await openCustomLocation(page);
  await expect(page.getByRole('button', { name: 'Navrhnúť adresu podľa polohy' })).toBeVisible();
  await expect(page.getByLabel('Ulica / Miesto poruchy / Lokalita *')).toHaveValue('');
  expect(requestLedger.some((entry) => entry.pathname === '/api/reports/address-suggestion')).toBe(false);

  await page.getByRole('button', { name: 'Navrhnúť adresu podľa polohy' }).click();
  await expect(page.getByLabel('Ulica / Miesto poruchy / Lokalita *')).toHaveValue('Jarná');
  const detail = page.getByLabel('Bližší popis / orientačný bod / číslo stožiara');
  await expect(detail).toHaveValue('Jarná 12, Košice');
  await expect(page.getByRole('status')).toContainText('automaticky navrhnutá');
  await detail.fill('User-verified synthetic address');
  await expect(detail).toHaveValue('User-verified synthetic address');
  expect(requestLedger.filter((entry) => entry.method === 'POST').map((entry) => entry.pathname)).toEqual([
    '/api/reports/address-suggestion',
  ]);
});

test('provider-disabled address lookup leaves the manual locality route usable', async ({ page, requestLedger }) => {
  await page.route('http://127.0.0.1:5000/api/reports/address-suggestion', async (route) => {
    markRequestIntercepted(requestLedger, route.request());
    await route.fulfill({
      status: 503,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify({
        success: false,
        code: 'disabled',
        message: 'Address suggestion is unavailable',
      }),
    });
  });

  await openCustomLocation(page);
  await page.getByRole('button', { name: 'Navrhnúť adresu podľa polohy' }).click();
  await expect(page.getByRole('status')).toContainText('zadať ručne');
  await expect(page.getByText('48.700000, 21.250000')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Kopírovať súradnice' })).toBeVisible();
  await fillStepOne(page);
  await expect(page.getByText('Krok 2 z 2')).toBeVisible();
  expect(requestLedger.filter((entry) => entry.method === 'POST').map((entry) => entry.pathname)).toEqual([
    '/api/reports/address-suggestion',
  ]);
});

test('Q99 flow sends its literal code and free text through the local sink only', async ({ page, requestLedger }) => {
  await openCustomLocation(page);
  await page.getByLabel('Ulica / Miesto poruchy / Lokalita *').selectOption('Letná');
  await page.getByRole('radio', { name: 'Za blokom' }).check();
  await page.getByRole('radio', { name: 'Iný druh poruchy' }).check();
  await expect(page.getByRole('textbox', { name: 'Iný druh poruchy' })).toBeVisible();
  await page.getByRole('textbox', { name: 'Iný druh poruchy' }).fill('Synthetic Q99 description.');
  await page.getByRole('radio', { name: 'Svietidlo vôbec nesvieti' }).check();
  await expect(page.getByRole('textbox', { name: 'Iný druh poruchy' })).toHaveCount(0);
  await page.getByRole('radio', { name: 'Iný druh poruchy' }).check();
  const otherFault = page.getByRole('textbox', { name: 'Iný druh poruchy' });
  await expect(otherFault).toBeVisible();
  await expect(otherFault).toHaveValue('');
  await page.getByLabel('Tel. kontakt na Vás *').fill('synthetic-phone-001');
  await page.getByRole('button', { name: 'Ďalej' }).click();
  await fillContact(page);

  const response = await submitAndReadLocalResponse(page);
  expect(response.status()).toBe(200);
  const body = await response.json();
  expect(body).toEqual({ success: true, status: 'local_test_received', filesReceived: 0 });
  await expect(page.getByRole('heading', { name: 'LOCAL TEST / SIMULATED' })).toBeVisible();
  await scanAccessibility(page, 'Q99 local result');
  expect(requestLedger.filter((entry) => entry.method === 'POST').map((entry) => entry.pathname)).toEqual([
    '/api/dev/ausemio-test-submit',
  ]);
});

test('required-field errors are associated, recover after correction, and work at a mobile viewport', async ({ page }) => {
  await openCustomLocation(page, { width: 390, height: 844 });
  await scanAccessibility(page, 'mobile step one');
  const locality = page.getByLabel('Ulica / Miesto poruchy / Lokalita *');
  await locality.focus();
  await page.keyboard.press('Tab');
  await expect(page.getByLabel('Bližší popis / orientačný bod / číslo stožiara')).toBeFocused();
  await page.getByRole('button', { name: 'Ďalej' }).click();
  const phone = page.getByLabel('Tel. kontakt na Vás *');
  await expect(page.getByText('Ulica / miesto poruchy / lokalita je povinná')).toBeVisible();
  await expect(page.getByText('Tel. kontakt je povinný')).toBeVisible();
  await expect(locality).toHaveAttribute('aria-invalid', 'true');
  await expect(locality).toHaveAttribute('aria-describedby', 'locality-error');
  await expect(phone).toHaveAttribute('aria-describedby', 'phone-error');
  await expect(locality).toBeFocused();
  await scanAccessibility(page, 'mobile validation errors');

  await locality.selectOption('Jarná');
  await phone.fill('synthetic-phone-001');
  const firstBlockRadio = page.getByRole('radio', { name: 'Pred blokom' });
  await firstBlockRadio.focus();
  await page.keyboard.press('Space');
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('radio', { name: 'Vedľa bloku' })).toBeChecked();

  const next = page.getByRole('button', { name: 'Ďalej' });
  await next.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByText('Krok 2 z 2')).toBeVisible();
  await page.getByRole('button', { name: 'Späť' }).click();
  await expect(locality).toHaveValue('Jarná');
  await expect(phone).toHaveValue('synthetic-phone-001');
  await expect(page.getByRole('radio', { name: 'Vedľa bloku' })).toBeChecked();
});

test('contact-step footer wraps without horizontal overflow at a narrow mobile viewport', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openCustomLocation(page, { width: 320, height: 720 });
  await fillStepOne(page);
  const footer = page.getByTestId('report-form-footer');
  await expect(footer).toBeVisible();

  const dimensions = await footer.evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
    viewportWidth: document.documentElement.clientWidth,
    documentWidth: document.documentElement.scrollWidth,
  }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
  expect(dimensions.clientWidth).toBeLessThanOrEqual(dimensions.viewportWidth);
  expect(dimensions.documentWidth).toBeLessThanOrEqual(dimensions.viewportWidth);
  expect(await page.getByRole('button', { name: 'Odoslať na lokálny testovací endpoint' })
    .evaluate((button) => getComputedStyle(button).transitionDuration)).toBe('0s');
  await scanAccessibility(page, 'narrow mobile contact step');
});

test('target changes discard stale light-point response data', async ({ page, requestLedger }) => {
  let releaseFirstResponse!: () => void;
  const firstResponseReleased = new Promise<void>((resolve) => { releaseFirstResponse = resolve; });
  let firstResponseWasReturned!: () => void;
  const firstResponseReturned = new Promise<void>((resolve) => { firstResponseWasReturned = resolve; });

  await page.route('http://127.0.0.1:5000/api/light-points/*', async (route) => {
    markRequestIntercepted(requestLedger, route.request());
    const id = new URL(route.request().url()).pathname.split('/').at(-1);
    if (id === '1') {
      await firstResponseReleased;
      firstResponseWasReturned();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: { 'access-control-allow-origin': '*' },
        body: JSON.stringify({ success: true, data: {
          id: 1, external_id: 'SYNTHETIC-1', latitude: 48.7, longitude: 21.25,
          address: 'Jarná', district: 'Synthetic', lamp_type: 'LED', status: 'active',
        } }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify({ success: true, data: {
        id: 2, external_id: 'SYNTHETIC-2', latitude: 48.71, longitude: 21.26,
        address: 'Letná', district: 'Synthetic', lamp_type: 'LED', status: 'active',
      } }),
    });
  });

  const staleResponse = page.waitForResponse((response) => response.url().endsWith('/api/light-points/1'));
  await page.addInitScript(() => {
    window.history.replaceState(
      { usr: { reportTarget: { kind: 'light-point', lightPointId: 1 } }, key: 'target-a', idx: 0 },
      '',
      '/report'
    );
  });
  await page.goto('/report', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => {
    window.history.pushState(
      { usr: { reportTarget: { kind: 'light-point', lightPointId: 2 } }, key: 'target-b', idx: 1 },
      '',
      '/report'
    );
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
  const locality = page.getByLabel('Ulica / Miesto poruchy / Lokalita *');
  await expect(locality).toHaveValue('Letná');
  releaseFirstResponse();
  await firstResponseReturned;
  await staleResponse;
  await expect(locality).toHaveValue('Letná');
  await expect(page.getByLabel('Bližší popis / orientačný bod / číslo stožiara')).toHaveValue('Inventárne číslo: SYNTHETIC-2');
});

test('same-target locale refetch preserves user edits and manual clears', async ({ page, requestLedger }) => {
  let requestCount = 0;
  await page.route('http://127.0.0.1:5000/api/light-points/1', async (route) => {
    markRequestIntercepted(requestLedger, route.request());
    requestCount += 1;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify({ success: true, data: {
        id: 1, external_id: 'SYNTHETIC-SAME', latitude: 48.7, longitude: 21.25,
        address: 'Jarná', district: 'Synthetic', lamp_type: 'LED', status: 'active',
      } }),
    });
  });

  await page.addInitScript(() => {
    window.history.replaceState(
      { usr: { reportTarget: { kind: 'light-point', lightPointId: 1 } }, key: 'same-target', idx: 0 },
      '',
      '/report'
    );
  });
  await page.goto('/report');
  const locality = page.getByLabel('Ulica / Miesto poruchy / Lokalita *');
  const detail = page.getByLabel('Bližší popis / orientačný bod / číslo stožiara');
  await expect(locality).toHaveValue('Jarná');
  await expect(detail).toHaveValue('Inventárne číslo: SYNTHETIC-SAME');

  await locality.selectOption('Letná');
  await detail.fill('Synthetic user-edited details.');
  const englishRefetch = page.waitForResponse((response) =>
    response.url().endsWith('/api/light-points/1') && response.request().method() === 'GET'
  );
  await page.getByRole('button', { name: 'EN' }).click();
  await englishRefetch;
  await expect(locality).toHaveValue('Letná');
  await expect(detail).toHaveValue('Synthetic user-edited details.');

  await locality.selectOption('');
  const slovakRefetch = page.waitForResponse((response) =>
    response.url().endsWith('/api/light-points/1') && response.request().method() === 'GET'
  );
  await page.getByRole('button', { name: 'SK' }).click();
  await slovakRefetch;
  await expect(locality).toHaveValue('');
  await expect(detail).toHaveValue('Synthetic user-edited details.');
  // React StrictMode may issue an additional development-mode initial request.
  expect(requestCount).toBeGreaterThanOrEqual(3);
});

test('local resource-limit response is shown without a fallback transport', async ({ page }) => {
  await openCustomLocation(page);
  await fillStepOne(page);
  await fillContact(page);
  await page.getByLabel('Prílohy').setInputFiles({
    name: 'over-local-cap.txt',
    mimeType: 'text/plain',
    buffer: Buffer.alloc(65, 65),
  });

  const response = await submitAndReadLocalResponse(page);
  expect(response.status()).toBe(413);
  await expect(page.getByRole('heading', { name: 'Local test was not completed' })).toBeVisible();
  await expect(page.getByText('LOCAL_TEST_RESOURCE_LIMIT', { exact: true })).toBeVisible();
  await scanAccessibility(page, 'resource-limit result');
});

test('unavailable local sink is reported and no alternate report path is attempted', async ({ page, requestLedger }) => {
  await openCustomLocation(page);
  await fillStepOne(page);
  await fillContact(page);
  await page.route(LOCAL_SUBMIT, async (route) => {
    markRequestIntercepted(requestLedger, route.request());
    await route.abort('failed');
  });

  const requestPromise = page.waitForRequest((request) =>
    request.url() === LOCAL_SUBMIT && request.method() === 'POST'
  );
  await page.getByRole('button', { name: 'Odoslať na lokálny testovací endpoint' }).click();
  await requestPromise;
  await expect(page.getByRole('heading', { name: 'Local test submission endpoint unavailable' })).toBeVisible();
  await expect(page.getByText('LOCAL_TEST_TRANSPORT_UNAVAILABLE')).toBeVisible();
  await expect(page.getByText('No alternate report transport was attempted.')).toBeVisible();
  await scanAccessibility(page, 'unavailable result');
  expect(requestLedger.filter((entry) => entry.method === 'POST').map((entry) => entry.pathname)).toEqual([
    '/api/dev/ausemio-test-submit',
  ]);
});

test('direct result navigation keeps the current missing-state fallback', async ({ page }) => {
  await page.goto('/result');
  await expect(page.getByRole('heading', { name: 'Výsledok lokálneho testu' })).toBeVisible();
  await expect(page.getByText('Nie sú dostupné údaje lokálneho testu.')).toBeVisible();
  await scanAccessibility(page, 'direct result fallback');
});
