import AxeBuilder from '@axe-core/playwright';
import { expect, markRequestIntercepted, test } from './fixtures';
import type { Page, Response } from '@playwright/test';

const LOCAL_SUBMIT = 'http://127.0.0.1:5000/api/dev/ausemio-test-submit';
const ADDRESS_SUGGESTION = 'http://127.0.0.1:5000/api/reports/address-suggestion';
const LOCALITY_LABEL = /^(Ulica \/ Miesto poruchy \/ Lokalita|Street \/ fault location \/ locality) \*$/;

async function selectCanonicalLocality(page: Page, value: string) {
  const input = page.getByRole('combobox', { name: LOCALITY_LABEL });
  await input.fill(value);
  await page.getByRole('option', { name: value, exact: true }).click();
}

async function openCustomLocation(page: Page, viewport?: { width: number; height: number }) {
  if (viewport) await page.setViewportSize(viewport);
  await page.addInitScript(() => {
    window.history.replaceState(
      {
        usr: { reportTarget: { kind: 'custom', latitude: 48.7164, longitude: 21.2611 } },
        key: 'synthetic-target',
        idx: 0,
      },
      '',
      '/report'
    );
  });
  await page.goto('/report');
  await expect(page.getByRole('heading', { name: 'Formulár nahlásenia poruchy' })).toBeVisible();
  await expect(page.getByRole('combobox', { name: LOCALITY_LABEL })).toBeVisible();
}

async function scanAccessibility(page: Page, state: string) {
  const result = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(result.violations, `axe WCAG violations in ${state}: ${JSON.stringify(result.violations)}`).toEqual([]);
}

async function fillStepOne(page: Page, faultName = 'Svietidlo vôbec nesvieti') {
  await selectCanonicalLocality(page, 'Jarná');
  await page.getByLabel('Bližší popis / orientačný bod / číslo stožiara').fill('Synthetic locality report details.');
  await page.getByRole('radio', { name: 'Pred blokom' }).check();
  await page.getByRole('radio', { name: faultName }).check();
  await page.getByLabel('Tel. kontakt na Vás *').fill('+421901234567');
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
  await expect(page.getByText(/Nebola odoslaná do AUSEMIO\/DPMK/i)).toBeVisible();
  await expect(page.getByText(/nepotvrdzuje prijatie externým systémom/i)).toBeVisible();
  await expect(page.getByText(/issue reference|external reference/i)).toHaveCount(0);
  await scanAccessibility(page, 'local success result');
  expect(requestLedger.filter((entry) => entry.method === 'POST').map((entry) => entry.pathname)).toEqual([
    '/api/reports/address-suggestion',
    '/api/dev/ausemio-test-submit',
  ]);
});

test('custom target submit performs one fake reverse lookup and appends approximate address to local detail only', async ({ page, requestLedger }) => {
  await openCustomLocation(page);
  const locationBlock = page.getByTestId('location-assistance');
  await expect(locationBlock).toContainText('48.716400, 21.261100');
  await expect(locationBlock).toContainText('pri odoslaní automaticky doplní orientačná adresa');
  await expect(locationBlock).toContainText('* Automaticky určená adresa môže byť nepresná.');
  await expect(locationBlock.getByRole('button', { name: 'Kopírovať súradnice' })).toBeVisible();
  await expect(page.getByRole('combobox', { name: LOCALITY_LABEL })).toHaveValue('');
  expect(requestLedger.some((entry) => entry.pathname === '/api/reports/address-suggestion')).toBe(false);
  await locationBlock.getByRole('button', { name: 'Kopírovať súradnice' }).click();

  await selectCanonicalLocality(page, 'Hlavná');
  const detail = page.getByLabel('Bližší popis / orientačný bod / číslo stožiara');
  await detail.fill('User-entered landmark');
  await expect(detail).toHaveValue('User-entered landmark');
  expect(requestLedger.filter((entry) => entry.method === 'POST')).toEqual([]);
  await page.getByRole('radio', { name: 'Pred blokom' }).check();
  await page.getByRole('radio', { name: 'Svietidlo vôbec nesvieti' }).check();
  await page.getByLabel('Tel. kontakt na Vás *').fill('+421901234567');
  await page.getByRole('button', { name: 'Ďalej' }).click();
  await fillContact(page);

  let localPayload = '';
  await page.route(LOCAL_SUBMIT, async (route) => {
    markRequestIntercepted(requestLedger, route.request());
    localPayload = route.request().postData() ?? '';
    await route.continue();
  });
  const reverseResponse = page.waitForResponse((response) =>
    response.url() === ADDRESS_SUGGESTION && response.request().method() === 'POST'
  );
  const localResponse = await submitAndReadLocalResponse(page);
  expect(localResponse.status()).toBe(200);
  expect((await reverseResponse).status()).toBe(200);
  await expect(page.getByRole('heading', { name: 'LOCAL TEST / SIMULATED' })).toBeVisible();
  expect(localPayload).toContain('name="properties[ulica_miesto_poruchy_lokalita]"');
  expect(localPayload).toContain('\r\n\r\nHlavná\r\n');
  expect(localPayload).toContain('User-entered landmark');
  expect(localPayload).toContain('Automaticky určená adresa podľa zvolených súradníc*: Jarná 12, Košice');
  expect(localPayload).toContain('* Automaticky určená adresa môže byť nepresná.');
  expect(localPayload.match(/Automaticky určená adresa podľa zvolených súradníc\*/g)).toHaveLength(1);
  expect(requestLedger.filter((entry) => entry.method === 'POST').map((entry) => entry.pathname)).toEqual([
    '/api/reports/address-suggestion',
    '/api/dev/ausemio-test-submit',
  ]);
  await scanAccessibility(page, 'address-enriched local success result');
});

test('detailDescription remains ordinary text without autocomplete requests or suggestion UI', async ({ page, requestLedger }) => {
  await openCustomLocation(page);
  const detail = page.getByLabel('Bližší popis / orientačný bod / číslo stožiara');
  for (const value of ['x', 'abc', 'videl som poruchu pri stožiari 12']) {
    await detail.fill(value);
    await expect(detail).toHaveValue(value);
  }
  await expect(page.getByRole('listbox')).toHaveCount(0);
  await expect(page.getByRole('status')).toHaveCount(0);
  await expect(page.getByRole('combobox', { name: LOCALITY_LABEL })).toHaveValue('');
  await expect(page.getByTestId('location-assistance')).toContainText('48.716400, 21.261100');
  await expect(page).toHaveURL(/\/report$/);
  expect(requestLedger.some((entry) => entry.pathname === '/api/reports/address-autocomplete')).toBe(false);
  expect(requestLedger.filter((entry) => entry.method === 'POST')).toEqual([]);
});

test('provider enrichment failure is non-blocking and reports only a safe warning after local success', async ({ page, requestLedger }) => {
  await page.route(ADDRESS_SUGGESTION, async (route) => {
    markRequestIntercepted(requestLedger, route.request());
    await route.fulfill({
      status: 429,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify({
        success: false,
        code: 'daily_budget_exceeded',
        message: 'Synthetic provider quota details must stay hidden',
        targetValidated: true,
      }),
    });
  });
  await openCustomLocation(page);
  await expect(page.getByRole('button', { name: 'Navrhnúť adresu pre vybrané súradnice' })).toHaveCount(0);
  const detail = page.getByLabel('Bližší popis / orientačný bod / číslo stožiara');
  await detail.fill('videl som poruchu pri stožiari');
  await expect(detail).toHaveValue('videl som poruchu pri stožiari');
  expect(requestLedger.some((entry) => entry.pathname === '/api/reports/address-suggestion')).toBe(false);
  await fillStepOne(page);
  await expect(page.getByText('Krok 2 z 2')).toBeVisible();
  await fillContact(page);
  const response = await submitAndReadLocalResponse(page);
  expect(response.status()).toBe(200);
  await expect(page.getByRole('heading', { name: 'LOCAL TEST / SIMULATED' })).toBeVisible();
  await expect(page.getByRole('status')).toContainText('Služba na automatické určenie adresy je momentálne nedostupná');
  await expect(page.getByText(/daily_budget_exceeded|quota|provider|Geoapify|Synthetic provider quota/i)).toHaveCount(0);
  expect(requestLedger.filter((entry) => entry.method === 'POST').map((entry) => entry.pathname)).toEqual([
    '/api/reports/address-suggestion',
    '/api/dev/ausemio-test-submit',
  ]);
  await scanAccessibility(page, 'address-enrichment unavailable local result');
});

test('Q99 flow sends its literal code and free text through the local sink only', async ({ page, requestLedger }) => {
  await openCustomLocation(page);
  await selectCanonicalLocality(page, 'Letná');
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
  await page.getByLabel('Tel. kontakt na Vás *').fill('+421901234567');
  await page.getByRole('button', { name: 'Ďalej' }).click();
  await fillContact(page);

  const response = await submitAndReadLocalResponse(page);
  expect(response.status()).toBe(200);
  const body = await response.json();
  expect(body).toEqual({ success: true, status: 'local_test_received', filesReceived: 0 });
  await expect(page.getByRole('heading', { name: 'LOCAL TEST / SIMULATED' })).toBeVisible();
  await scanAccessibility(page, 'Q99 local result');
  expect(requestLedger.filter((entry) => entry.method === 'POST').map((entry) => entry.pathname)).toEqual([
    '/api/reports/address-suggestion',
    '/api/dev/ausemio-test-submit',
  ]);
});

test('required-field errors are associated, recover after correction, and work at a mobile viewport', async ({ page }) => {
  await openCustomLocation(page, { width: 390, height: 844 });
  await scanAccessibility(page, 'mobile step one');
  const locality = page.getByRole('combobox', { name: LOCALITY_LABEL });
  const copyCoordinates = page.getByRole('button', { name: 'Kopírovať súradnice' });
  await copyCoordinates.focus();
  await expect(copyCoordinates).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(locality).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('listbox')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByLabel('Bližší popis / orientačný bod / číslo stožiara')).toBeFocused();
  await page.getByRole('button', { name: 'Ďalej' }).click();
  const phone = page.getByLabel('Tel. kontakt na Vás *');
  await expect(page.locator('#locality-error')).toContainText('Napíšte názov a vyberte ho z návrhov ako platnú lokalitu.');
  await expect(page.locator('#phone-error')).toContainText('medzinárodnom formáte');
  await expect(locality).toHaveAttribute('aria-invalid', 'true');
  await expect(locality).toHaveAttribute('aria-describedby', /locality-hint.*locality-error/);
  await expect(phone).toHaveAttribute('aria-describedby', /phone-error.*phone-hint/);
  await expect(locality).toBeFocused();
  await scanAccessibility(page, 'mobile validation errors');

  const locationMetrics = await page.getByTestId('location-assistance').evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
    buttonHeight: element.querySelector('button')?.getBoundingClientRect().height ?? 0,
    documentWidth: document.documentElement.scrollWidth,
    viewportWidth: document.documentElement.clientWidth,
  }));
  expect(locationMetrics.scrollWidth).toBeLessThanOrEqual(locationMetrics.clientWidth);
  expect(locationMetrics.buttonHeight).toBeGreaterThanOrEqual(44);
  expect(locationMetrics.documentWidth).toBeLessThanOrEqual(locationMetrics.viewportWidth);

  await selectCanonicalLocality(page, 'Jarná');
  await phone.fill('+421901234567');
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
  await expect(phone).toHaveValue('+421901234567');
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
          id: 1, inventory_number: 'SYNTHETIC-1', external_id: null, latitude: 48.7, longitude: 21.25,
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
        id: 2, inventory_number: 'SYNTHETIC-2', external_id: null, latitude: 48.71, longitude: 21.26,
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
  const locality = page.getByRole('combobox', { name: LOCALITY_LABEL });
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
        id: 1, inventory_number: 'SYNTHETIC-SAME', external_id: null, latitude: 48.7, longitude: 21.25,
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
  const locality = page.getByRole('combobox', { name: LOCALITY_LABEL });
  const detail = page.locator('#detailDescription');
  await expect(locality).toHaveValue('Jarná');
  await expect(detail).toHaveValue('Inventárne číslo: SYNTHETIC-SAME');

  await selectCanonicalLocality(page, 'Letná');
  await detail.fill('Synthetic user-edited details.');
  const englishRefetch = page.waitForResponse((response) =>
    response.url().endsWith('/api/light-points/1') && response.request().method() === 'GET'
  );
  await page.getByRole('button', { name: 'Angličtina' }).click();
  await englishRefetch;
  await expect(locality).toHaveValue('Letná');
  await expect(detail).toHaveValue('Synthetic user-edited details.');

  await locality.fill('');
  await page.keyboard.press('Escape');
  const slovakRefetch = page.waitForResponse((response) =>
    response.url().endsWith('/api/light-points/1') && response.request().method() === 'GET'
  );
  await page.getByRole('button', { name: 'Slovak' }).click();
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
  await expect(page.getByRole('heading', { name: 'Lokálny test nebol dokončený' })).toBeVisible();
  await expect(page.getByText('LOCAL_TEST_RESOURCE_LIMIT', { exact: true })).toHaveCount(0);
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
  await expect(page.getByRole('heading', { name: 'Lokálny testovací endpoint nie je dostupný' })).toBeVisible();
  await expect(page.getByText('LOCAL_TEST_TRANSPORT_UNAVAILABLE')).toHaveCount(0);
  await expect(page.getByText('Nepoužil sa žiadny náhradný spôsob odoslania.')).toBeVisible();
  await scanAccessibility(page, 'unavailable result');
  expect(requestLedger.filter((entry) => entry.method === 'POST').map((entry) => entry.pathname)).toEqual([
    '/api/reports/address-suggestion',
    '/api/dev/ausemio-test-submit',
  ]);
});

test('direct result navigation keeps the current missing-state fallback', async ({ page }) => {
  await page.goto('/result');
  await expect(page.getByRole('heading', { name: 'Výsledok lokálneho testu' })).toBeVisible();
  await expect(page.getByText('Nie sú dostupné údaje lokálneho testu.')).toBeVisible();
  await scanAccessibility(page, 'direct result fallback');
});

test('locality combobox rejects unmatched text and international phone rules are strict and localized', async ({ page, requestLedger }) => {
  await openCustomLocation(page, { width: 390, height: 844 });
  const locality = page.getByRole('combobox', { name: LOCALITY_LABEL });
  await locality.fill('Jarna');
  await expect(page.getByRole('option', { name: 'Jarná', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Ďalej' }).click();
  await expect(page.locator('#locality-error')).toContainText('Napíšte názov a vyberte ho z návrhov ako platnú lokalitu.');

  await locality.fill('Unknown street');
  await expect(page.getByText('Nenašli sa zhody. Vyberte kanonickú lokalitu z návrhov.')).toBeVisible();
  expect(requestLedger.some((entry) => entry.pathname === '/api/reports/address-suggestion')).toBe(false);
  expect(requestLedger.filter((entry) => !entry.permitted)).toEqual([]);
  const phone = page.getByLabel('Tel. kontakt na Vás *');
  await phone.fill('0901234567');
  await page.getByRole('button', { name: 'Ďalej' }).click();
  await expect(page.locator('#phone-error')).toContainText('medzinárodnom formáte');
  await expect(page.getByText('Krok 1 z 2')).toBeVisible();

  await selectCanonicalLocality(page, 'Jarná');
  for (const invalid of ['421901234567', '+421 901 234 567', '+4219012345678901', '+021234567']) {
    await phone.fill(invalid);
    await page.getByRole('button', { name: 'Ďalej' }).click();
    await expect(page.locator('#phone-error')).toContainText('medzinárodnom formáte');
    await expect(phone).toHaveValue(invalid);
  }
  await phone.fill('+421951449039');
  await expect(page.locator('#phone-error')).toHaveCount(0);
  await page.getByRole('button', { name: 'Ďalej' }).click();
  await expect(page.getByText('Krok 2 z 2')).toBeVisible();
  await page.getByRole('button', { name: 'Späť' }).click();
  await phone.fill('0901234567');
  await page.getByRole('button', { name: 'Ďalej' }).click();
  await expect(page.locator('#phone-error')).toContainText('medzinárodnom formáte');
  await expect(page.getByText('Krok 1 z 2')).toBeVisible();
});

test('English locale translates all public form labels, options, validation and preserves chosen data', async ({ page }) => {
  await openCustomLocation(page);
  const locality = page.getByRole('combobox', { name: LOCALITY_LABEL });
  await selectCanonicalLocality(page, 'Jarná');
  await page.getByRole('button', { name: 'Angličtina' }).click();

  await expect(page.getByRole('heading', { name: 'Public lighting fault report form' })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Street / fault location / locality *' })).toHaveValue('Jarná');
  await expect(page.getByLabel('Additional description / landmark / pole number')).toBeVisible();
  await expect(page.getByRole('group', { name: 'Location relative to block' })).toBeVisible();
  await expect(page.getByRole('radio', { name: 'In front of the block' })).toBeVisible();
  await expect(page.getByRole('group', { name: 'Fault type' })).toBeVisible();
  await expect(page.getByRole('radio', { name: 'Street light does not turn on' })).toBeVisible();
  await expect(page.getByLabel('Phone number *')).toBeVisible();
  await expect(page.getByText(/country code is never added automatically/)).toBeVisible();

  await page.getByLabel('Phone number *').fill('0901234567');
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByText(/international number such as \+421901234567/)).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Public lighting fault report form' })).toBeVisible();
  await expect(locality).toHaveValue('Jarná');
});
