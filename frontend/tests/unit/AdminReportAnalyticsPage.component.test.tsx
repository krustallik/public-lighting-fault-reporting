// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import type { ReportAnalyticsPage, ReportAnalyticsSummary, StreetLightFilterOptions } from '@admin/types/admin';
import { AdminReportAnalyticsPage } from '@admin/pages/AdminReportAnalyticsPage/AdminReportAnalyticsPage';

const { api } = vi.hoisted(() => ({ api: {
  getStreetLightFilterOptions: vi.fn(), getReportAnalyticsSummary: vi.fn(), listReportAnalytics: vi.fn(),
} }));
vi.mock('@admin/services/adminApi', () => ({ adminApi: api }));

afterEach(() => { cleanup(); vi.clearAllMocks(); });

const options: StreetLightFilterOptions = {
  lampTypes: [], hasMissingLampType: false, districts: [], hasMissingDistrict: false,
  hasMoreLampTypes: false, hasMoreDistricts: false,
  statuses: [{ value: 'active', label: 'Aktívny' }, { value: 'inactive', label: 'Neaktívny' }],
};
const summary: ReportAnalyticsSummary = {
  period: '7d', periodStart: '2026-10-24T00:00:00.000Z', periodEnd: '2026-10-31T00:00:00.000Z',
  totalLocalReports: 8, assignedToInventoryPoints: 5, customOrManualReports: 2, reportsForDeletedPoints: 1,
};
const result: ReportAnalyticsPage = {
  items: [
    { id: 269, inventory_number: 'LP-269', address: 'Jarná 1', district: 'Sever', status: 'active', report_count: 4, last_report: '2026-10-30T16:04:00.000Z' },
    { id: 270, inventory_number: 'LP-270', address: null, district: null, status: 'inactive', report_count: 0, last_report: null },
  ],
  pagination: { page: 1, limit: 25, total: 2, totalPages: 1 },
};

function CurrentUrl() { const location = useLocation(); return <output aria-label="Aktuálna URL">{location.search}</output>; }
function renderAnalytics(path = '/panel-svietidla/analytics') {
  return render(<MemoryRouter initialEntries={[path]}><CurrentUrl /><AdminReportAnalyticsPage /></MemoryRouter>);
}

describe('AdminReportAnalyticsPage', () => {
  beforeEach(() => {
    api.getStreetLightFilterOptions.mockResolvedValue(options);
    api.getReportAnalyticsSummary.mockResolvedValue(summary);
    api.listReportAnalytics.mockResolvedValue(result);
  });

  it('renders truthful report totals, deleted-point context, localized times and missing values', async () => {
    renderAnalytics();
    await screen.findByRole('link', { name: 'Bod #269' });
    expect(screen.getAllByText('Počet zaznamenaných hlásení')[0].parentElement?.textContent).toContain('8');
    expect(screen.getByText('Priradené k evidovanému bodu').parentElement?.textContent).toContain('5');
    expect(screen.getByText('Vlastné, ručné alebo GPS miesto').parentElement?.textContent).toContain('2');
    expect(screen.getByText('Historické hlásenia odstránených bodov').parentElement?.textContent).toContain('1');
    expect(screen.getByText('LP-269').closest('tr')?.textContent).toContain('Jarná 1');
    expect(screen.getByText('LP-270').closest('tr')?.textContent).toContain('—');
    expect(screen.getByRole('link', { name: 'Bod #269' })).toBeTruthy();
    expect(api.getReportAnalyticsSummary).toHaveBeenCalledWith('7d');
    expect(api.listReportAnalytics).toHaveBeenCalledWith(expect.objectContaining({ period: '7d', order: 'desc' }));
  });

  it('normalizes invalid period and page parameters to a valid request', async () => {
    api.listReportAnalytics.mockResolvedValue({ ...result, pagination: { ...result.pagination, total: 55, totalPages: 3 } });
    renderAnalytics('/panel-svietidla/analytics?period=forever&page=9&order=asc');
    await waitFor(() => expect(api.getReportAnalyticsSummary).toHaveBeenCalledWith('7d'));
    await waitFor(() => expect(screen.getByLabelText('Aktuálna URL').textContent).toContain('period=7d'));
    await waitFor(() => expect(screen.getByLabelText('Aktuálna URL').textContent).toContain('page=3'));
    expect(api.listReportAnalytics).toHaveBeenCalledWith(expect.objectContaining({ period: '7d', page: 9, order: 'asc' }));
  });

  it('updates period, status, sort order and debounced search; reset returns to defaults', async () => {
    const user = userEvent.setup();
    renderAnalytics('/panel-svietidla/analytics?period=30d&search=LP-1&status=inactive&order=desc');
    await screen.findByText('LP-269');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Obdobie štatistík' }), '24h');
    await waitFor(() => expect(api.getReportAnalyticsSummary).toHaveBeenLastCalledWith('24h'));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Filtrovať podľa technického stavu' }), 'active');
    await waitFor(() => expect(api.listReportAnalytics).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'active' })));
    await user.click(screen.getByRole('button', { name: 'Zoradiť podľa Počet zaznamenaných hlásení, aktuálne zostupne' }));
    await waitFor(() => expect(api.listReportAnalytics).toHaveBeenLastCalledWith(expect.objectContaining({ order: 'asc' })));
    await user.clear(screen.getByRole('searchbox', { name: 'Hľadať svetelný bod' }));
    await user.type(screen.getByRole('searchbox', { name: 'Hľadať svetelný bod' }), ' LP-8 ');
    await waitFor(() => expect(api.listReportAnalytics).toHaveBeenLastCalledWith(expect.objectContaining({ search: 'LP-8' })));
    await user.click(screen.getByRole('button', { name: 'Vymazať filtre' }));
    await waitFor(() => expect(screen.getByLabelText('Aktuálna URL').textContent).toBe('?period=7d'));
    expect(api.getReportAnalyticsSummary).toHaveBeenLastCalledWith('7d');
  });

  it('reports partial API failures safely and recovers when filters change', async () => {
    api.getReportAnalyticsSummary.mockRejectedValueOnce(new Error('summary unavailable'));
    renderAnalytics();
    expect((await screen.findByRole('alert')).textContent).toContain('summary unavailable');
    expect(screen.queryByText('private')).toBeNull();

    api.getReportAnalyticsSummary.mockResolvedValue(summary);
    api.listReportAnalytics.mockRejectedValueOnce({ payload: 'private' });
    const user = userEvent.setup();
    await user.selectOptions(screen.getByRole('combobox', { name: 'Obdobie štatistík' }), '30d');
    expect((await screen.findByRole('alert')).textContent).toContain('Štatistiky sa nepodarilo načítať');
    expect(screen.queryByText('private')).toBeNull();
  });

  it('keeps the report list available when filter options fail and renders an empty result honestly', async () => {
    api.getStreetLightFilterOptions.mockRejectedValueOnce({ internal: 'secret error' });
    api.listReportAnalytics.mockResolvedValue({ ...result, items: [], pagination: { ...result.pagination, total: 0, totalPages: 1 } });
    renderAnalytics();
    expect(await screen.findByText('Inventár neobsahuje svetelné body zodpovedajúce týmto filtrom.')).toBeTruthy();
    expect((await screen.findByRole('alert')).textContent).toContain('Možnosti filtrov sa nepodarilo načítať');
    expect(screen.queryByText('secret error')).toBeNull();
  });

  it('handles empty analytics periods without deleted-point or date claims and cancels stale work on unmount', async () => {
    api.getReportAnalyticsSummary.mockResolvedValueOnce({
      ...summary, periodStart: null, periodEnd: null, reportsForDeletedPoints: 0,
    });
    api.listReportAnalytics.mockResolvedValueOnce({
      ...result, items: [], pagination: { ...result.pagination, total: 0, totalPages: 1 },
    });
    const view = renderAnalytics('/panel-svietidla/analytics?order=asc');
    expect(await screen.findByText('Inventár neobsahuje svetelné body zodpovedajúce týmto filtrom.')).toBeTruthy();
    expect(screen.getByText(/Hranice obdobia: — až —/)).toBeTruthy();
    expect(screen.queryByText('Historické hlásenia odstránených bodov')).toBeNull();
    expect(screen.getByRole('columnheader', { name: /Počet zaznamenaných hlásení/ }).getAttribute('aria-sort')).toBe('ascending');
    view.unmount();

    let resolveSummary!: (value: ReportAnalyticsSummary) => void;
    let resolvePage!: (value: ReportAnalyticsPage) => void;
    api.getReportAnalyticsSummary.mockImplementationOnce(() => new Promise((resolve) => { resolveSummary = resolve; }));
    api.listReportAnalytics.mockImplementationOnce(() => new Promise((resolve) => { resolvePage = resolve; }));
    const staleView = renderAnalytics();
    staleView.unmount();
    resolveSummary(summary);
    resolvePage(result);
    await Promise.resolve();
  });
});
