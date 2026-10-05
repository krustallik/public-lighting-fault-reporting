import { expect, markRequestIntercepted, test } from './fixtures';

const API_LIGHT_POINTS = 'http://127.0.0.1:5000/api/light-points';

test('map entry shows device location without selecting it; explicit selection requires confirmation', async ({ page, requestLedger }) => {
  await page.context().grantPermissions(['geolocation'], { origin: 'http://127.0.0.1:5173' });
  await page.context().setGeolocation({ latitude: 48.715, longitude: 21.26, accuracy: 40 });
  await page.route(API_LIGHT_POINTS, async (route) => {
    markRequestIntercepted(requestLedger, route.request());
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify({ success: true, data: [] }),
    });
  });

  await page.goto('/map');
  await expect(page.getByRole('heading', { name: 'Označte miesto poruchy' })).toBeVisible();
  await expect(page.getByText(/Poloha zariadenia je dostupná/)).toBeVisible();

  const selectDevice = page.getByRole('button', { name: 'Vybrať polohu zariadenia ako cieľ hlásenia' });
  await expect(page.getByRole('button', { name: 'Moja poloha — vycentrovať mapu' })).toHaveCount(0);
  await expect(selectDevice).toBeEnabled();

  await selectDevice.click();
  const dialog = page.getByRole('dialog', { name: 'Potvrďte miesto hlásenia' });
  await expect(dialog).toContainText('48.715000, 21.260000');
  await expect(dialog).toContainText('až po tomto potvrdení');
  await page.getByRole('button', { name: 'Zrušiť' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page).toHaveURL(/\/map$/);

  await selectDevice.click();
  await page.getByRole('button', { name: 'Potvrdiť miesto' }).click();
  await expect(page.getByRole('heading', { name: 'Formulár nahlásenia poruchy' })).toBeVisible();
  await expect(page.getByText('Výslovne ste vybrali polohu zariadenia ako cieľ hlásenia.')).toBeVisible();
  await expect(page).toHaveURL(/\/report$/);
  expect(requestLedger.filter((entry) => entry.method === 'POST')).toEqual([]);
});

test('confirmed synthetic device target completes through the local simulated sink only', async ({ page, requestLedger }) => {
  await page.context().grantPermissions(['geolocation'], { origin: 'http://127.0.0.1:5173' });
  await page.context().setGeolocation({ latitude: 48.715, longitude: 21.26, accuracy: 40 });
  await page.route(API_LIGHT_POINTS, async (route) => {
    markRequestIntercepted(requestLedger, route.request());
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify({ success: true, data: [] }),
    });
  });

  await page.goto('/map');
  await page.getByRole('button', { name: 'Vybrať polohu zariadenia ako cieľ hlásenia' }).click();
  await page.getByRole('button', { name: 'Potvrdiť miesto' }).click();
  await expect(page.getByRole('heading', { name: 'Formulár nahlásenia poruchy' })).toBeVisible();
  await page.getByLabel('Ulica / Miesto poruchy / Lokalita *').selectOption('Jarná');
  await page.getByRole('radio', { name: 'Pred blokom' }).check();
  await page.getByRole('radio', { name: 'Svietidlo vôbec nesvieti' }).check();
  await page.getByLabel('Tel. kontakt na Vás *').fill('synthetic-device-contact');
  await page.getByRole('button', { name: 'Ďalej' }).click();
  await page.getByLabel('E-mail *').fill('synthetic-device@example.test');
  await page.getByRole('checkbox', { name: /Súhlasím/ }).check();

  const responsePromise = page.waitForResponse((response) =>
    response.url().includes('/api/dev/ausemio-test-submit') && response.request().method() === 'POST'
  );
  await page.getByRole('button', { name: 'Odoslať na lokálny testovací endpoint' }).click();
  const response = await responsePromise;
  expect(response.status()).toBe(200);
  expect(await response.json()).toEqual({
    success: true,
    status: 'local_test_received',
    filesReceived: 0,
  });
  await expect(page.getByRole('heading', { name: 'LOCAL TEST / SIMULATED' })).toBeVisible();
  expect(requestLedger.filter((entry) => entry.method === 'POST').map((entry) => entry.pathname)).toEqual([
    '/api/dev/ausemio-test-submit',
  ]);
});

test('map data failure still allows a manually selected coordinate target', async ({ page, requestLedger }) => {
  await page.route(API_LIGHT_POINTS, async (route) => {
    markRequestIntercepted(requestLedger, route.request());
    await route.fulfill({
      status: 503,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify({ success: false, message: 'Synthetic unavailable response' }),
    });
  });

  await page.goto('/map');
  await expect(page.getByRole('alert')).toContainText('Evidované svetelné body sa nepodarilo načítať');
  await page.getByLabel('Zemepisná šírka').fill('48,700000');
  await page.getByLabel('Zemepisná dĺžka').fill('21,250000');
  await page.getByRole('button', { name: 'Použiť zadané miesto' }).click();
  await expect(page.getByRole('dialog')).toContainText('48.700000, 21.250000');
  await page.getByRole('button', { name: 'Potvrdiť miesto' }).click();

  await expect(page.getByRole('heading', { name: 'Formulár nahlásenia poruchy' })).toBeVisible();
  await expect(page.getByText('48.700000, 21.250000', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Kopírovať súradnice' })).toBeVisible();
  await expect(page).toHaveURL(/\/report$/);
  expect(requestLedger.filter((entry) => entry.method === 'POST')).toEqual([]);
});
