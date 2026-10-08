import { expect, test } from './fixtures';

test('public startup stays on map-first flow without bootstrapping admin authentication', async ({ page, requestLedger }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/map$/);
  await expect(page.getByRole('region', { name: 'Mapa Košíc a evidovaných svetelných bodov' })).toBeVisible();
  expect(requestLedger.some((entry) => entry.pathname === '/api/admin/auth/me')).toBe(false);
  expect(requestLedger.some((entry) => entry.origin === 'http://127.0.0.1:5174')).toBe(false);
});
