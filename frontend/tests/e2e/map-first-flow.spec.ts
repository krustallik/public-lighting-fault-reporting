import { expect, markRequestIntercepted, test } from './fixtures';
import type { Page, TestInfo } from '@playwright/test';

const API_LIGHT_POINTS = 'http://127.0.0.1:5000/api/light-points';
async function returnPoints(page: Page, points: Array<Record<string, unknown>>, requestLedger: Parameters<typeof markRequestIntercepted>[0]) {
  await page.route(API_LIGHT_POINTS, async (route) => {
    markRequestIntercepted(requestLedger, route.request());
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify({ success: true, data: points }),
    });
  });
}

async function attachVisual(page: Page, testInfo: TestInfo, name: string) {
  await testInfo.attach(name, {
    body: await page.screenshot({ fullPage: true, animations: 'disabled' }),
    contentType: 'image/png',
  });
}

async function assertMapLayout(page: Page, viewportWidth: number) {
  const result = await page.evaluate(() => {
    const region = document.querySelector<HTMLElement>('[role="region"]');
    const wrapper = region?.parentElement;
    const map = document.querySelector<HTMLElement>('.leaflet-container');
    const top = document.querySelector<HTMLElement>('[data-testid="map-controls-top"]');
    const bottom = document.querySelector<HTMLElement>('[data-testid="map-controls-bottom"]');
    const attribution = document.querySelector<HTMLElement>('.leaflet-control-attribution');
    if (!wrapper || !map || !top || !bottom || !attribution) return null;
    const rect = (element: HTMLElement) => {
      const box = element.getBoundingClientRect();
      return { left: box.left, right: box.right, top: box.top, bottom: box.bottom, width: box.width, height: box.height };
    };
    const a = rect(top);
    const b = rect(bottom);
    const c = rect(attribution);
    return {
      wrapper: rect(wrapper),
      map: rect(map),
      top: a,
      bottom: b,
      attribution: c,
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: document.documentElement.clientWidth,
      topBottomOverlap: a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top,
      bottomCoversAttribution: b.left < c.right && b.right > c.left && b.top < c.bottom && b.bottom > c.top,
      bottomCenterOffset: Math.abs((b.left + b.right) / 2 - document.documentElement.clientWidth / 2),
    };
  });

  expect(result).not.toBeNull();
  expect(result!.wrapper.width).toBe(viewportWidth);
  expect(result!.wrapper.height).toBeGreaterThanOrEqual(700);
  expect(result!.map.width).toBe(viewportWidth);
  expect(result!.map.height).toBeGreaterThanOrEqual(700);
  expect(result!.documentWidth).toBeLessThanOrEqual(result!.viewportWidth);
  expect(result!.topBottomOverlap).toBe(false);
  expect(result!.bottomCoversAttribution).toBe(false);
  expect(result!.bottomCenterOffset).toBeLessThanOrEqual(1);
}

async function assertResumeLayout(page: Page, viewportWidth: number) {
  const result = await page.evaluate(() => {
    const resume = document.querySelector<HTMLElement>('[data-testid="resume-target-confirmation"]');
    const attribution = document.querySelector<HTMLElement>('.leaflet-control-attribution');
    if (!resume || !attribution) return null;
    const box = (element: HTMLElement) => {
      const rect = element.getBoundingClientRect();
      return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
    };
    const r = box(resume);
    const a = box(attribution);
    return {
      resume: r,
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: document.documentElement.clientWidth,
      centerOffset: Math.abs((r.left + r.right) / 2 - document.documentElement.clientWidth / 2),
      overlapsAttribution: r.left < a.right && r.right > a.left && r.top < a.bottom && r.bottom > a.top,
    };
  });

  expect(result).not.toBeNull();
  expect(result!.documentWidth).toBeLessThanOrEqual(result!.viewportWidth);
  expect(result!.resume.right).toBeLessThanOrEqual(viewportWidth);
  expect(result!.centerOffset).toBeLessThanOrEqual(1);
  expect(result!.overlapsAttribution).toBe(false);
}

test('fullscreen map is minimal, localized, and renders accessible provider attribution', async ({ page, requestLedger }, testInfo) => {
  await returnPoints(page, [], requestLedger);
  await page.setViewportSize({ width: 1365, height: 900 });
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/map');

  await expect(page.getByRole('region', { name: 'Mapa Košíc a evidovaných svetelných bodov' })).toBeVisible();
  await expect(page.getByText('Vyberte evidovaný svetelný bod alebo kliknite na mapu a označte vlastné miesto.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Slovenčina' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Angličtina' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Vycentrovať mapu na polohu zariadenia' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Pokračovať bez výberu bodu na mape' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Evidované svetelné body|Recorded light points/ })).toHaveCount(0);
  const privacyNotice = page.locator('details');
  await expect(privacyNotice).toHaveCount(1);
  expect(await privacyNotice.evaluate((element) => (element as HTMLDetailsElement).open)).toBe(false);
  await privacyNotice.locator('summary').click();
  await expect(page.getByText(/Pri vstupe prehliadač jednorazovo požiada o polohu/)).toBeVisible();
  expect(await privacyNotice.evaluate((element) => (element as HTMLDetailsElement).open)).toBe(true);
  await privacyNotice.locator('summary').click();
  expect(await privacyNotice.evaluate((element) => (element as HTMLDetailsElement).open)).toBe(false);
  await expect(page.getByLabel('Zemepisná šírka')).toHaveCount(0);
  await expect(page.getByLabel('Zemepisná dĺžka')).toHaveCount(0);
  await expect(page.getByRole('list', { name: /svetelné body/i })).toHaveCount(0);
  await expect(page.locator('.leaflet-control-attribution')).toContainText('OpenStreetMap contributors');
  await expect(page.locator('.leaflet-tile')).not.toHaveCount(0);
  await assertMapLayout(page, 1365);
  await attachVisual(page, testInfo, 'map-desktop-light');

  await page.getByRole('button', { name: /Prepnúť tému mapy/ }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('.leaflet-tile').first()).not.toHaveCSS('filter', 'none');
  await expect(page.locator('.leaflet-control-attribution')).toContainText('OpenStreetMap contributors');
  await expect(page.getByText(/API KEY REQUIRED/i)).toHaveCount(0);
  await attachVisual(page, testInfo, 'map-desktop-dark');
  expect(requestLedger.filter((entry) => !entry.permitted)).toEqual([]);
});

test('mobile map controls fit at 390×844 and 320×700 in both themes without covering attribution', async ({ page, requestLedger }, testInfo) => {
  await returnPoints(page, [], requestLedger);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/map');
  await expect(page.getByRole('region', { name: 'Mapa Košíc a evidovaných svetelných bodov' })).toBeVisible();
  await assertMapLayout(page, 390);
  await attachVisual(page, testInfo, 'map-mobile-390-light');

  await page.getByRole('button', { name: /Prepnúť tému mapy/ }).click();
  await assertMapLayout(page, 390);
  await attachVisual(page, testInfo, 'map-mobile-390-dark');

  await page.setViewportSize({ width: 320, height: 700 });
  await assertMapLayout(page, 320);
  await attachVisual(page, testInfo, 'map-mobile-320-dark');
  await page.getByRole('button', { name: 'Angličtina' }).click();
  await expect(page.getByRole('region', { name: 'Map of Košice and recorded street lights' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Continue without selecting a point on the map' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'English' })).toHaveAttribute('aria-pressed', 'true');
  expect(requestLedger.filter((entry) => !entry.permitted)).toEqual([]);
});

test('known light point requires confirmation, and language/theme switching preserves the report target', async ({ page, requestLedger }) => {
  await returnPoints(page, [{
    id: 31,
    external_id: 'SYNTHETIC-LP-31',
    latitude: 48.7164,
    longitude: 21.2611,
    address: 'Synthetic Street',
    district: 'Synthetic',
    lamp_type: 'LED',
    status: 'active',
  }], requestLedger);
  await page.route(`${API_LIGHT_POINTS}/31`, async (route) => {
    markRequestIntercepted(requestLedger, route.request());
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify({ success: true, data: {
        id: 31,
        external_id: 'SYNTHETIC-LP-31',
        latitude: 48.7164,
        longitude: 21.2611,
        address: 'Synthetic Street',
        district: 'Synthetic',
        lamp_type: 'LED',
        status: 'active',
      } }),
    });
  });
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/map');
  await page.getByRole('button', { name: 'Angličtina' }).click();
  await expect(page.locator('.leaflet-tile').first()).toHaveAttribute('src', /\/tiles\/light\//);
  await page.getByRole('button', { name: /Switch map theme/ }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('.leaflet-tile').first()).toHaveAttribute('src', /\/tiles\/dark\//);
  await expect(page.locator('.light-point-marker')).toBeVisible();
  await page.locator('.light-point-marker').click();
  await expect(page.locator('.lightPointPopup')).toContainText('Synthetic Street');
  await page.locator('.lightPointPopupButton').click();
  const dialog = page.getByRole('dialog', { name: 'Confirm report location' });
  await expect(dialog).toContainText('SYNTHETIC-LP-31');
  await page.getByRole('button', { name: 'Confirm location' }).click();
  await expect(page).toHaveURL(/\/report$/);
  await expect(page.getByRole('heading', { name: 'Public lighting fault report form' })).toBeVisible();
  await expect(page.locator('#detailDescription')).toHaveValue('Inventory number: SYNTHETIC-LP-31');
  expect(requestLedger.filter((entry) => entry.method === 'POST')).toEqual([]);
});

test('known points remain selectable from map markers without a permanent point list', async ({ page, requestLedger }) => {
  await returnPoints(page, [{
    id: 42,
    external_id: 'SYNTHETIC-LP-42',
    latitude: 48.7164,
    longitude: 21.2611,
    address: 'Synthetic Keyboard Street',
    district: 'Synthetic',
    lamp_type: 'LED',
    status: 'active',
  }], requestLedger);
  await page.route(`${API_LIGHT_POINTS}/42`, async (route) => {
    markRequestIntercepted(requestLedger, route.request());
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify({ success: true, data: {
        id: 42,
        external_id: 'SYNTHETIC-LP-42',
        latitude: 48.7164,
        longitude: 21.2611,
        address: 'Synthetic Keyboard Street',
        district: 'Synthetic',
        lamp_type: 'LED',
        status: 'active',
      } }),
    });
  });
  await page.goto('/map');
  await expect(page.getByRole('button', { name: /Evidované svetelné body|Recorded light points/ })).toHaveCount(0);
  const marker = page.locator('.light-point-marker');
  await expect(marker).toBeVisible();
  await expect(marker).toHaveAttribute('aria-label', /SYNTHETIC-LP-42/);
  await marker.focus();
  await page.keyboard.press('Enter');
  const selectPoint = page.getByRole('button', { name: 'Vybrať tento svetelný bod', exact: true });
  await expect(selectPoint).toBeVisible();
  await selectPoint.click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('dialog')).toContainText('Synthetic Keyboard Street');
  await expect(page.getByRole('button', { name: 'Potvrdiť miesto' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(selectPoint).toBeFocused();
  expect(requestLedger.filter((entry) => !entry.permitted)).toEqual([]);
});

test('custom candidate can be hidden for map inspection, resumed, and confirmed at desktop and mobile sizes', async ({ page, requestLedger }) => {
  await returnPoints(page, [], requestLedger);
  for (const viewport of [
    { width: 1365, height: 900 },
    { width: 320, height: 700 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto('/map');
    const map = page.locator('.leaflet-container');
    const bounds = await map.boundingBox();
    expect(bounds).not.toBeNull();
    await page.mouse.click(bounds!.x + bounds!.width * 0.68, bounds!.y + bounds!.height * 0.5);

    const dialog = page.getByRole('dialog', { name: 'Potvrďte miesto hlásenia' });
    await expect(dialog).toBeVisible();
    const dialogHeight = await dialog.evaluate((element) => element.getBoundingClientRect().height);
    expect(dialogHeight).toBeLessThan(viewport.height * 0.5);
    const cancel = page.getByRole('button', { name: 'Zrušiť' });
    const hide = page.getByRole('button', { name: 'Skryť a prezrieť mapu' });
    const confirm = page.getByRole('button', { name: 'Potvrdiť miesto' });
    await expect(cancel).toBeVisible();
    await expect(hide).toBeVisible();
    await expect(confirm).toBeVisible();
    if (viewport.width <= 576) {
      const [dialogBounds, cancelBounds, hideBounds, confirmBounds] = await Promise.all([
        dialog.boundingBox(),
        cancel.boundingBox(),
        hide.boundingBox(),
        confirm.boundingBox(),
      ]);
      expect(dialogBounds).not.toBeNull();
      expect(cancelBounds).not.toBeNull();
      expect(hideBounds).not.toBeNull();
      expect(confirmBounds).not.toBeNull();
      expect(dialogBounds!.y).toBeGreaterThanOrEqual(0);
      expect(dialogBounds!.y + dialogBounds!.height).toBeLessThanOrEqual(viewport.height);
      expect(confirmBounds!.y + confirmBounds!.height)
        .toBeLessThanOrEqual(dialogBounds!.y + dialogBounds!.height);
      expect(Math.abs(cancelBounds!.y - hideBounds!.y)).toBeLessThan(2);
      expect(confirmBounds!.y).toBeGreaterThan(hideBounds!.y);
      expect(confirmBounds!.width).toBeGreaterThan(hideBounds!.width);
      const dialogScroll = await dialog.evaluate((element) => ({
        scrollHeight: element.scrollHeight,
        clientHeight: element.clientHeight,
      }));
      expect(dialogScroll.scrollHeight - dialogScroll.clientHeight).toBeLessThanOrEqual(1);
    }
    await page.getByRole('button', { name: 'Skryť a prezrieť mapu' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.locator('.custom-location-marker')).toBeVisible();
    const resume = page.getByRole('button', { name: 'Pokračovať s vybraným miestom' });
    await expect(resume).toBeVisible();
    await assertResumeLayout(page, viewport.width);

    // The map is usable while the confirmation is hidden; zooming does not replace its candidate.
    await page.getByRole('button', { name: 'Priblížiť mapu' }).click();
    await expect(page.locator('.custom-location-marker')).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);

    if (viewport.width === 320) {
      await page.getByRole('button', { name: 'Angličtina' }).click();
      await expect(page.getByRole('button', { name: 'Continue with selected location' })).toBeVisible();
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await page.getByRole('button', { name: 'Slovak' }).click();
      await expect(page.getByRole('button', { name: 'Pokračovať s vybraným miestom' })).toBeVisible();
    }

    await page.getByRole('button', { name: 'Pokračovať s vybraným miestom' }).click();
    await expect(page.getByRole('dialog', { name: 'Potvrďte miesto hlásenia' })).toContainText('48.');
    await expect(page.getByRole('button', { name: 'Potvrdiť miesto' })).toBeFocused();
    await page.getByRole('button', { name: 'Potvrdiť miesto' }).click();
    await expect(page).toHaveURL(/\/report$/);
    await expect(page.getByRole('heading', { name: 'Formulár nahlásenia poruchy' })).toBeVisible();
  }
});

test('empty map click and device marker are separate explicit report targets', async ({ page, requestLedger }) => {
  await returnPoints(page, [], requestLedger);
  await page.context().grantPermissions(['geolocation'], { origin: 'http://127.0.0.1:5173' });
  await page.context().setGeolocation({ latitude: 48.715, longitude: 21.26, accuracy: 40 });
  await page.goto('/map');
  await expect(page.locator('.device-location-marker')).toBeVisible();
  await page.locator('.device-location-marker').click();
  await expect(page.getByRole('dialog')).toContainText('až po tomto potvrdení');
  await page.getByRole('button', { name: 'Skryť a prezrieť mapu' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.device-location-marker')).toBeVisible();
  await page.getByRole('button', { name: 'Pokračovať s vybraným miestom' }).click();
  await expect(page.getByRole('dialog')).toContainText('až po tomto potvrdení');
  await page.getByRole('button', { name: 'Potvrdiť miesto' }).click();
  await expect(page).toHaveURL(/\/report$/);
  await expect(page.getByText('Výslovne ste vybrali polohu zariadenia ako cieľ hlásenia.')).toBeVisible();

  await page.goto('/map');
  const map = page.locator('.leaflet-container');
  const bounds = await map.boundingBox();
  expect(bounds).not.toBeNull();
  await page.mouse.click(bounds!.x + bounds!.width * 0.78, bounds!.y + bounds!.height * 0.38);
  const customDialog = page.getByRole('dialog', { name: 'Potvrďte miesto hlásenia' });
  await expect(customDialog).toBeVisible();
  await page.getByRole('button', { name: 'Zrušiť' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.custom-location-marker')).toHaveCount(0);
  await page.getByRole('button', { name: 'Pokračovať bez výberu bodu na mape' }).click();
  await expect(page.getByRole('dialog')).toContainText('Lokalitu a bližší popis zadáte vo formulári.');
  await page.getByRole('button', { name: 'Potvrdiť miesto' }).click();
  await expect(page.getByRole('heading', { name: 'Formulár nahlásenia poruchy' })).toBeVisible();
  await expect(page.getByText('Miesto hlásenia zadáte ručne vo formulári.')).toBeVisible();
  expect(requestLedger.filter((entry) => !entry.permitted)).toEqual([]);
});

test('map request and rendering failures retain the non-map route', async ({ page, requestLedger }) => {
  await page.route(API_LIGHT_POINTS, async (route) => {
    markRequestIntercepted(requestLedger, route.request());
    await route.fulfill({ status: 503, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '{"success":false}' });
  });
  await page.goto('/map');
  await expect(page.getByRole('alert')).toContainText('Evidované body sa nepodarilo načítať');
  await page.getByRole('button', { name: 'Pokračovať bez výberu bodu na mape' }).click();
  await page.getByRole('button', { name: 'Potvrdiť miesto' }).click();
  await expect(page.getByRole('heading', { name: 'Formulár nahlásenia poruchy' })).toBeVisible();
  expect(requestLedger.filter((entry) => entry.method === 'POST')).toEqual([]);
});

test('geolocation denial keeps custom map selection and manual form fallback available', async ({ page, requestLedger }) => {
  await returnPoints(page, [], requestLedger);
  await page.context().grantPermissions([], { origin: 'http://127.0.0.1:5173' });
  await page.goto('/map');

  await expect(page.getByText('Poloha nie je povolená.', { exact: true })).toBeVisible();
  const continueWithoutMap = page.getByRole('button', { name: 'Pokračovať bez výberu bodu na mape' });
  await expect(continueWithoutMap).toBeVisible();

  const mapBounds = await page.locator('.leaflet-container').boundingBox();
  expect(mapBounds).not.toBeNull();
  await page.mouse.click(mapBounds!.x + mapBounds!.width * 0.7, mapBounds!.y + mapBounds!.height * 0.4);
  await expect(page.getByRole('dialog', { name: 'Potvrďte miesto hlásenia' })).toBeVisible();
  await page.getByRole('button', { name: 'Zrušiť' }).click();
  await expect(continueWithoutMap).toBeVisible();

  await continueWithoutMap.click();
  await page.getByRole('button', { name: 'Potvrdiť miesto' }).click();
  await expect(page.getByRole('heading', { name: 'Formulár nahlásenia poruchy' })).toBeVisible();
  expect(requestLedger.filter((entry) => entry.method === 'POST')).toEqual([]);
});

test('tile-load failure keeps the manual form fallback available', async ({ page, requestLedger }) => {
  await returnPoints(page, [], requestLedger);
  await page.route((url) => url.hostname === 'synthetic.invalid', async (route) => {
    markRequestIntercepted(requestLedger, route.request());
    await route.abort('failed');
  });
  await page.goto('/map');

  await expect(page.getByRole('alert')).toContainText('Podklad mapy nie je dostupný');
  const continueWithoutMap = page.getByRole('button', { name: 'Pokračovať bez výberu bodu na mape' });
  await expect(continueWithoutMap).toBeVisible();
  await continueWithoutMap.click();
  await page.getByRole('button', { name: 'Potvrdiť miesto' }).click();
  await expect(page.getByRole('heading', { name: 'Formulár nahlásenia poruchy' })).toBeVisible();
  expect(requestLedger.filter((entry) => entry.method === 'POST')).toEqual([]);
});

test('touch selection on the map offers confirmation and cancel without committing a target', async ({ page, requestLedger }) => {
  await returnPoints(page, [], requestLedger);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/map');
  const map = page.locator('.leaflet-container');
  const bounds = await map.boundingBox();
  expect(bounds).not.toBeNull();
  await page.touchscreen.tap(bounds!.x + bounds!.width * 0.8, bounds!.y + bounds!.height * 0.38);
  await expect(page.getByRole('dialog', { name: 'Potvrďte miesto hlásenia' })).toBeVisible();
  await page.getByRole('button', { name: 'Zrušiť' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page).toHaveURL(/\/map$/);
  expect(requestLedger.filter((entry) => entry.method === 'POST')).toEqual([]);
});

test('known point → confirmation → bilingual form → local simulated result stays on the local sink', async ({ page, requestLedger }) => {
  const point = {
    id: 73,
    external_id: 'SYNTHETIC-FULL-FLOW-73',
    latitude: 48.7164,
    longitude: 21.2611,
    address: 'Synthetic Full Flow Street',
    district: 'Synthetic',
    lamp_type: 'LED',
    status: 'active',
  };
  await page.route(API_LIGHT_POINTS, async (route) => {
    markRequestIntercepted(requestLedger, route.request());
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify({ success: true, data: [point] }),
    });
  });
  await page.route(`${API_LIGHT_POINTS}/73`, async (route) => {
    markRequestIntercepted(requestLedger, route.request());
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify({ success: true, data: point }),
    });
  });
  await page.route('http://127.0.0.1:5000/api/dev/ausemio-test-submit', async (route) => {
    markRequestIntercepted(requestLedger, route.request());
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify({ success: true, status: 'local_test_received', filesReceived: 0 }),
    });
  });

  await page.goto('/map');
  await page.getByRole('button', { name: 'Angličtina' }).click();
  await page.locator('.light-point-marker').click();
  await page.locator('.lightPointPopupButton').click();
  await expect(page.getByRole('dialog', { name: 'Confirm report location' })).toBeVisible();
  await page.getByRole('button', { name: 'Confirm location' }).click();

  await expect(page.getByRole('heading', { name: 'Public lighting fault report form' })).toBeVisible();
  await expect(page.getByText('Form submission language: English (en)')).toBeVisible();
  await expect(page.locator('#detailDescription')).toHaveValue('Inventory number: SYNTHETIC-FULL-FLOW-73');
  await page.getByRole('combobox', { name: 'Street / fault location / locality *' }).fill('Jarna');
  await page.getByRole('option', { name: 'Jarná', exact: true }).click();
  await page.getByLabel('Additional description / landmark / pole number').fill('Synthetic full-flow details.');
  await page.getByRole('radio', { name: 'Beside the block' }).check();
  await page.getByRole('radio', { name: 'Damaged pole' }).check();
  await page.getByLabel('Phone number *').fill('+421901234567');
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByLabel('Email *').fill('synthetic-full-flow@example.test');
  await page.getByRole('checkbox', { name: 'I agree to personal data processing for this local test.' }).check();

  const responsePromise = page.waitForResponse((response) =>
    response.url() === 'http://127.0.0.1:5000/api/dev/ausemio-test-submit' && response.request().method() === 'POST'
  );
  await page.getByRole('button', { name: 'Send to local test endpoint' }).click();
  const response = await responsePromise;
  expect(response.status()).toBe(200);
  expect(await response.json()).toEqual({ success: true, status: 'local_test_received', filesReceived: 0 });
  await expect(page.getByRole('heading', { name: 'LOCAL TEST / SIMULATED' })).toBeVisible();
  await expect(page.getByText(
    'The request was received only by the local test endpoint; it was not sent to AUSEMIO.',
    { exact: true }
  )).toBeVisible();
  await expect(page.getByText(/does not establish acceptance by an external system/)).toBeVisible();
  expect(requestLedger.filter((entry) => !entry.permitted)).toEqual([]);
  expect(requestLedger.filter((entry) => entry.method === 'POST').map((entry) => entry.pathname)).toEqual([
    '/api/dev/ausemio-test-submit',
  ]);
});
