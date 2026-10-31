import { readFile } from 'node:fs/promises';
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
  await expect(page.getByRole('heading', { name: 'Prevádzkové záznamy' })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'p5-synthetic.csv' }).first()).toBeVisible();

  await page.getByRole('link', { name: 'Svetelné body' }).click();
  const exportResponse = page.waitForResponse((response) =>
    response.url().includes('/api/admin/street-lights/export?format=csv')
  );
  const exportDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export CSV' }).click();
  expect((await exportResponse).status()).toBe(200);
  const download = await exportDownload;
  expect(download.suggestedFilename()).toMatch(/^street-lights-\d{4}-\d{2}-\d{2}\.csv$/);
  const downloadPath = await download.path();
  expect(downloadPath).not.toBeNull();
  const exportCsv = await readFile(downloadPath!, 'utf8');
  expect(exportCsv.startsWith('id,inventory_number,external_id,longitude,latitude,address,district,lamp_type,status,created_at,updated_at\r\n')).toBe(true);
  expect(exportCsv).toContain('P5-E2E-SEED-1');
  expect(exportCsv).toContain('P5-E2E-IMPORTED-1');

  const logoutResponse = page.waitForResponse((response) =>
    response.url() === ADMIN_ORIGIN + '/api/admin/auth/logout' && response.request().method() === 'POST'
  );
  await page.getByRole('button', { name: 'Odhlásiť sa' }).click();
  await logoutResponse;
  await expect(page.getByRole('heading', { name: 'Admin prihlásenie' })).toBeVisible();
  const verificationPage = await page.context().newPage();
  await verificationPage.goto(ADMIN_BASE + '/login');
  const protectedAfterLogout = await verificationPage.evaluate(async () => (await fetch('/api/admin/street-lights')).status);
  expect(protectedAfterLogout).toBe(401);

  await verificationPage.goto(ADMIN_BASE + '/street-lights');
  await expect(verificationPage.getByRole('heading', { name: 'Admin prihlásenie' })).toBeVisible();
  await expect(verificationPage.getByRole('heading', { name: 'Svetelné body' })).toHaveCount(0);
  await verificationPage.close();
});

test('admin inventory remains responsive with a 50k server-paginated result set', async ({ page }) => {
  const observedListQueries: URL[] = [];
  const makeRows = (pageNumber: number, search: string) => {
    const total = search ? 1 : 50_000;
    const firstId = search ? 25_001 : (pageNumber - 1) * 20 + 1;
    return Array.from({ length: Math.min(20, total) }, (_, index) => {
      const id = firstId + index;
      return {
        id,
        inventory_number: `SYNTHETIC-50K-${String(id).padStart(5, '0')}`,
        external_id: `VO-${String(id).padStart(6, '0')}`,
        latitude: '48.7164',
        longitude: '21.2611',
        address: index % 2 ? 'Štúrova 12, Košice' : 'Hlavná 1, Košice',
        district: index % 2 ? 'Sídlisko Ťahanovce' : 'Staré Mesto',
        lamp_type: 'LED 24 W',
        status: 'active',
        created_at: '2026-10-30T10:00:00.000Z',
        updated_at: '2026-10-30T10:00:00.000Z',
      };
    });
  };

  await page.route('**/api/admin/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/admin/auth/me') {
      await route.fulfill({ json: { success: true, data: { id: 1, username: 'synthetic-admin', fullName: 'Synthetic Admin' } } });
      return;
    }
    if (url.pathname === '/api/admin/street-lights/filter-options') {
      await route.fulfill({ json: { success: true, data: {
        lampTypes: ['LED 24 W'], districts: ['Staré Mesto', 'Sídlisko Ťahanovce'],
        hasMissingDistrict: false, hasMoreLampTypes: false, hasMoreDistricts: false,
        statuses: [{ value: 'active', label: 'Aktívny' }, { value: 'inactive', label: 'Neaktívny' }, { value: 'maintenance', label: 'Údržba' }],
      } } });
      return;
    }
    if (url.pathname === '/api/admin/street-lights') {
      observedListQueries.push(url);
      const pageNumber = Number(url.searchParams.get('page') ?? 1);
      const search = url.searchParams.get('search') ?? '';
      const total = search ? 1 : 50_000;
      await route.fulfill({ json: { success: true, data: {
        items: makeRows(pageNumber, search),
        pagination: { page: pageNumber, limit: 20, total, totalPages: Math.ceil(total / 20) },
      } } });
      return;
    }
    await route.fulfill({ status: 404, json: { success: false, error: 'Unexpected synthetic browser request' } });
  });

  const started = Date.now();
  await page.goto(`${ADMIN_BASE}/street-lights`);
  await expect(page.getByRole('heading', { name: /Svetelné body/ })).toContainText('50');
  await expect(page.locator('tbody tr')).toHaveCount(20);
  expect(Date.now() - started).toBeLessThan(5_000);
  await expect(page.getByLabel('Stránkovanie')).toContainText('Strana 1 z 2500');

  await page.getByRole('button', { name: 'Ďalšia strana' }).click();
  await expect(page.getByLabel('Stránkovanie')).toContainText('Strana 2 z 2500');
  await expect(page.locator('tbody tr').first()).toContainText('SYNTHETIC-50K-00021');

  const searchStarted = Date.now();
  await page.getByRole('searchbox', { name: 'Hľadať svetelný bod' }).fill('SYNTHETIC-50K-25001');
  await expect(page.locator('tbody tr')).toHaveCount(1);
  await expect(page.locator('tbody tr').first()).toContainText('SYNTHETIC-50K-25001');
  expect(Date.now() - searchStarted).toBeLessThan(5_000);
  expect(observedListQueries.some((url) => url.searchParams.get('search') === 'SYNTHETIC-50K-25001')).toBe(true);
  expect(observedListQueries.some((url) => url.searchParams.get('page') === '2')).toBe(true);
});
