// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach } from 'vitest';
import type { FaultReportHistoryRow } from '@admin/types/admin';
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

  it('renders inventory, custom-coordinate and manual locations without exposing public details', async () => {
    const row = (overrides: Partial<FaultReportHistoryRow>): FaultReportHistoryRow => ({
      id: crypto.randomUUID(), submitted_at: '2026-10-30T16:04:00.000Z', service_code: 2,
      locality: 'Jarná', location_block_code: null, fault_type_code: 'Q1', target_kind: 'manual',
      light_point_id: null, latitude: null, longitude: null, automatic_notes: [], ...overrides,
    });
    getDashboardOverview.mockResolvedValueOnce({
      inventoryTotal: 3, reports24h: 1, reports7d: 2, reports30d: 3,
      recent: [
        row({ id: 'history-light', target_kind: 'light-point', light_point_id: 269 }),
        row({ id: 'history-coordinates', target_kind: 'custom', latitude: 48.123456, longitude: 21.987654, fault_type_code: null }),
        row({ id: 'history-manual', target_kind: 'manual', automatic_notes: ['Predchádzajúce hlásenie: 1.'] }),
      ],
    });

    render(<MemoryRouter><AdminDashboardPage /></MemoryRouter>);

    expect(await screen.findByText('Evidovaný bod #269')).toBeTruthy();
    expect(screen.getByText('48.12346, 21.98765')).toBeTruthy();
    expect(screen.getByText('Miesto zadané ručne')).toBeTruthy();
    expect(screen.getByText('Predchádzajúce hlásenie: 1.')).toBeTruthy();
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
    expect(screen.queryByText(/email|phone|опис/i)).toBeNull();
  });

  it.each([
    [new Error('Dashboard temporarily unavailable'), 'Dashboard temporarily unavailable'],
    [{ status: 503 }, 'Prehľad sa nepodarilo načítať'],
  ])('shows a safe dashboard error for failed API responses', async (failure, message) => {
    getDashboardOverview.mockRejectedValueOnce(failure);
    render(<MemoryRouter><AdminDashboardPage /></MemoryRouter>);
    expect((await screen.findByRole('alert')).textContent).toContain(message);
    expect(screen.queryByLabelText('Súhrnné údaje')).toBeNull();
    expect(screen.getByRole('button', { name: 'Skúsiť znova' })).toBeTruthy();
  });

  it('keeps the loading status until the overview request settles', async () => {
    let resolve!: (value: { inventoryTotal: number; reports24h: number; reports7d: number; reports30d: number; recent: [] }) => void;
    getDashboardOverview.mockReturnValueOnce(new Promise((done) => { resolve = done; }));
    render(<MemoryRouter><AdminDashboardPage /></MemoryRouter>);
    expect(screen.getByRole('status').textContent).toContain('Načítavam prehľad');
    resolve({ inventoryTotal: 0, reports24h: 0, reports7d: 0, reports30d: 0, recent: [] });
    await waitFor(() => expect(screen.queryByRole('status')).toBeNull());
  });
});
