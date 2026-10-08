import { expect, test } from './fixtures';

const ADMIN_ORIGIN = 'http://127.0.0.1:5174';
const ADMIN_BASE = `${ADMIN_ORIGIN}/panel-svietidla`;

test('real admin auth protects inventory and executes import history and export against disposable PostGIS', async ({ page }) => {
  await page.goto(`${ADMIN_BASE}/street-lights/1`);
  await expect(page.getByRole('heading', { name: 'Admin prihlásenie' })).toBeVisible();

  const unauthenticatedStatus = await page.evaluate(async () => {
    const response = await fetch('/api/admin/street-lights');
    return response.status;
  });
  expect(unauthenticatedStatus).toBe(401);

  await page.getByLabel('Používateľské meno').fill('p5-e2e-synthetic-admin');
  await page.getByLabel('Heslo').fill('p5-e2e-synthetic-password');
  const loginResponse = page.waitForResponse((response) =>
    response.url() === `${ADMIN_ORIGIN}/api/admin/auth/login` && response.request().method() === 'POST'
  );
  await page.getByRole('button', { name: 'Prihlásiť sa' }).click();
  expect((await loginResponse).status()).toBe(200);

  await expect(page.getByRole('heading', { name: 'Svetelný bod #1' })).toBeVisible();
  await expect(page.getByText('P5-E2E-SEED-1')).toBeVisible();
  const sessionCookies = await page.context().cookies(ADMIN_ORIGIN);
  expect(sessionCookies.filter(({ name }) => ['access_token', 'refresh_token'].includes(name))).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ name: 'access_token', httpOnly: true }),
      expect.objectContaining({ name: 'refresh_token', httpOnly: true }),
    ])
  );
  const meStatus = await page.evaluate(async () => (await fetch('/api/admin/auth/me')).status);
  expect(meStatus).toBe(200);

  await page.getByRole('link', { name: 'Svetelné body' }).click();
  await expect(page.getByText('P5-E2E-SEED-1')).toBeVisible();
  await page.getByRole('link', { name: 'Import', exact: true }).click();
  await page.getByLabel('Súbor').setInputFiles({
    name: 'p5-synthetic.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('inventory_number,latitude,longitude,address,district,lamp_type,status\nP5-E2E-IMPORTED-1,48.72,21.27,Synthetic Import Street,Synthetic district,LED,active\n'),
  });
  await page.getByRole('button', { name: 'Náhľad importu' }).click();
  await expect(page.getByRole('heading', { name: 'Náhľad: p5-synthetic.csv' })).toBeVisible();
  await expect(page.getByText('P5-E2E-IMPORTED-1')).toBeVisible();
  await page.getByRole('button', { name: 'Potvrdiť import' }).click();
  await expect(page.getByText(/Dávka #\d+: completed/)).toBeVisible({ timeout: 20_000 });

  await page.getByRole('link', { name: 'Otvoriť históriu importov' }).click();
  await expect(page.getByRole('heading', { name: 'Technické logy' })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'p5-synthetic.csv' })).toBeVisible();

  await page.getByRole('link', { name: 'Svetelné body' }).click();
  const exportResponse = page.waitForResponse((response) =>
    response.url().includes('/api/admin/street-lights/export?format=csv')
  );
  await page.getByRole('button', { name: 'Export CSV' }).click();
  expect((await exportResponse).status()).toBe(200);

  await page.getByRole('button', { name: 'Odhlásiť sa' }).click();
  await expect(page.getByRole('heading', { name: 'Admin prihlásenie' })).toBeVisible();
  const protectedAfterLogout = await page.evaluate(async () => (await fetch('/api/admin/street-lights')).status);
  expect(protectedAfterLogout).toBe(401);

  await page.goto(`${ADMIN_BASE}/street-lights`);
  await expect(page.getByRole('heading', { name: 'Admin prihlásenie' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Svetelné body' })).toHaveCount(0);
});
