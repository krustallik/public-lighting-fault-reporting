// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach } from 'vitest';
import { AdminDashboardPage } from '@admin/pages/AdminDashboardPage/AdminDashboardPage';

const { getDashboardOverview } = vi.hoisted(() => ({ getDashboardOverview: vi.fn() }));
vi.mock('@admin/services/adminApi', () => ({ adminApi: { getDashboardOverview } }));

afterEach(cleanup);

beforeEach(() => getDashboardOverview.mockResolvedValue({ inventoryTotal: 255, reports24h: 2, reports7d: 6, reports30d: 12, recent: [] }));

describe('AdminDashboardPage', () => {
  it('presents actual dashboard metrics and supported destinations', async () => {
    render(<MemoryRouter><AdminDashboardPage /></MemoryRouter>);

    expect(screen.getByRole('heading', { name: 'Prehľad verejného osvetlenia' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Svetelné body' }).getAttribute('href')).toBe('/panel-svietidla/street-lights');
    expect(screen.getByRole('link', { name: 'Import údajov' }).getAttribute('href')).toBe('/panel-svietidla/import');
    expect(screen.getByRole('link', { name: 'Hlásenia porúch' }).getAttribute('href')).toBe('/panel-svietidla/reports');
    await waitFor(() => expect(screen.getByText('255')).toBeTruthy());
    expect(screen.getByText('Zatiaľ bez hlásení')).toBeTruthy();
  });
});
