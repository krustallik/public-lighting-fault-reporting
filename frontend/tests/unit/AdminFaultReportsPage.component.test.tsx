// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import type { FaultReportHistoryRow } from '@admin/types/admin';
import { AdminFaultReportsPage } from '@admin/pages/AdminFaultReportsPage/AdminFaultReportsPage';

const { getFaultReportHistory } = vi.hoisted(() => ({ getFaultReportHistory: vi.fn() }));
vi.mock('@admin/services/adminApi', () => ({ adminApi: { getFaultReportHistory } }));

afterEach(() => { cleanup(); vi.clearAllMocks(); });

function report(overrides: Partial<FaultReportHistoryRow> = {}): FaultReportHistoryRow {
  return {
    id: 'report-default', submitted_at: '2026-10-30T16:04:00.000Z', service_code: 2,
    locality: 'Jarná', location_block_code: null, fault_type_code: 'Q1', target_kind: 'manual',
    light_point_id: null, latitude: null, longitude: null, automatic_notes: [], ...overrides,
  };
}

function CurrentUrl() {
  const location = useLocation();
  return <output aria-label="Aktuálna URL">{location.search}</output>;
}

function renderReports(path = '/panel-svietidla/reports') {
  return render(<MemoryRouter initialEntries={[path]}><CurrentUrl /><AdminFaultReportsPage /></MemoryRouter>);
}

describe('AdminFaultReportsPage', () => {
  beforeEach(() => getFaultReportHistory.mockResolvedValue({ items: [], total: 0 }));

  it('formats inventory, manual, coordinate and target-only locations and operator notes', async () => {
    getFaultReportHistory.mockResolvedValueOnce({
      total: 4,
      items: [
        report({ id: 'light', target_kind: 'light-point', light_point_id: 269, location_block_code: 'Q1' }),
        report({ id: 'manual', target_kind: 'manual', locality: 'Sever', fault_type_code: null }),
        report({ id: 'device', target_kind: 'device', latitude: 48.123456, longitude: 21.987654, automatic_notes: ['Len pre tento bod.'] }),
        report({ id: 'custom', target_kind: 'custom', latitude: 48.5, longitude: 21.25 }),
      ],
    });
    renderReports();

    expect(await screen.findByText('Svietidlo #269')).toBeTruthy();
    expect(screen.getByText('Manuálna lokalita')).toBeTruthy();
    expect(screen.getByText('GPS · 48.12346, 21.98765')).toBeTruthy();
    expect(screen.getByText('Vlastný bod · 48.50000, 21.25000')).toBeTruthy();
    expect(screen.getByText('Len pre tento bod.')).toBeTruthy();
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
    expect(screen.queryByText(/resident@example|phone|private description/i)).toBeNull();
    expect(screen.getByText(/Strana 1 z 1/)).toBeTruthy();
  });

  it('normalizes an out-of-range URL page and fetches only the bounded page', async () => {
    getFaultReportHistory.mockResolvedValue({ items: [], total: 26 });
    renderReports('/panel-svietidla/reports?page=9');

    await waitFor(() => expect(getFaultReportHistory).toHaveBeenLastCalledWith({ limit: 25, page: 2 }));
    expect(screen.getByLabelText('Aktuálna URL').textContent).toBe('?page=2');
    expect(screen.getByText(/Strana 2 z 2/)).toBeTruthy();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Prvá strana' }).hasAttribute('disabled')).toBe(false));
  });

  it.each([
    [new Error('History service unavailable'), 'History service unavailable'],
    [{ status: 503 }, 'Hlásenia sa nepodarilo načítať.'],
  ])('shows a bounded API error and retries without reloading the whole page', async (failure, message) => {
    getFaultReportHistory.mockRejectedValueOnce(failure);
    const user = userEvent.setup();
    renderReports();
    expect((await screen.findByRole('alert')).textContent).toContain(message);
    const initialCalls = getFaultReportHistory.mock.calls.length;
    await user.click(screen.getByRole('button', { name: 'Skúsiť znova' }));
    await waitFor(() => expect(getFaultReportHistory.mock.calls.length).toBeGreaterThan(initialCalls));
    expect(getFaultReportHistory).toHaveBeenLastCalledWith({ limit: 25, page: 1 });
    expect(await screen.findByText('Nie sú evidované žiadne hlásenia.')).toBeTruthy();
  });

  it('navigates to the requested page through the accessible pagination controls', async () => {
    getFaultReportHistory.mockImplementation((options: { page?: number } = {}) => Promise.resolve({ items: [], total: 55, page: options.page ?? 1 }));
    const user = userEvent.setup();
    renderReports();
    await screen.findByText(/Strana 1 z 3/);
    await user.click(screen.getByRole('button', { name: 'Ďalšia strana' }));
    await waitFor(() => expect(getFaultReportHistory).toHaveBeenLastCalledWith({ limit: 25, page: 2 }));
    expect(screen.getByLabelText('Aktuálna URL').textContent).toBe('?page=2');
  });
});
