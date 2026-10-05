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
  await expect(page.getByText(/Poloha zariadenia je zobrazená samostatne/)).toBeVisible();

  const recenter = page.getByRole('button', { name: 'Moja poloha — vycentrovať mapu' });
  const selectDevice = page.getByRole('button', { name: 'Vybrať polohu zariadenia ako cieľ hlásenia' });
  await expect(recenter).toBeEnabled();
  await expect(selectDevice).toBeEnabled();
  await recenter.click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page).toHaveURL(/\/map$/);

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
  await expect(page.getByText('48.700000, 21.250000')).toHaveCount(0);
  await expect(page).toHaveURL(/\/report$/);
  expect(requestLedger.filter((entry) => entry.method === 'POST')).toEqual([]);
});
