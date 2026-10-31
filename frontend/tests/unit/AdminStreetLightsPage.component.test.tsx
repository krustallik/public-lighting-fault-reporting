// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import type { AdminStreetLightRow, StreetLightFilterOptions } from '@admin/types/admin';
import { AdminStreetLightsPage } from '@admin/pages/AdminStreetLightsPage/AdminStreetLightsPage';

const { api } = vi.hoisted(() => ({ api: {
  getStreetLightFilterOptions: vi.fn(), listStreetLights: vi.fn(), exportStreetLights: vi.fn(),
} }));
vi.mock('@admin/services/adminApi', () => ({ adminApi: api }));

afterEach(() => { cleanup(); vi.clearAllMocks(); });

const options: StreetLightFilterOptions = {
  lampTypes: ['LED', 'Sodium'], hasMissingLampType: true, districts: ['Sever'],
  hasMissingDistrict: false, hasMoreLampTypes: true, hasMoreDistricts: false,
  statuses: [{ value: 'active', label: 'Aktívny' }, { value: 'inactive', label: 'Neaktívny' }],
};

function row(overrides: Partial<AdminStreetLightRow> = {}): AdminStreetLightRow {
  return {
    id: 11, inventory_number: 'LP-11', external_id: null, latitude: '48.72', longitude: '21.25',
    address: 'Jarná 1', district: 'Sever', lamp_type: 'LED', status: 'active',
    created_at: '2026-10-01T00:00:00.000Z', updated_at: '2026-10-01T00:00:00.000Z', ...overrides,
  };
}

function CurrentUrl() {
  const location = useLocation();
  return <output aria-label="Aktuálna URL">{location.search}</output>;
}

function renderInventory(path = '/panel-svietidla/svietidla') {
  return render(<MemoryRouter initialEntries={[path]}><CurrentUrl /><AdminStreetLightsPage /></MemoryRouter>);
}

function page(items: AdminStreetLightRow[] = [row()], total = items.length, totalPages = 1) {
  return { items, pagination: { page: 1, limit: 25, total, totalPages } };
}

describe('AdminStreetLightsPage', () => {
  beforeEach(() => {
    api.getStreetLightFilterOptions.mockResolvedValue(options);
    api.listStreetLights.mockResolvedValue(page());
    api.exportStreetLights.mockResolvedValue(undefined);
  });

  it('renders inventory fields, missing-value fallbacks, filter options and detail links', async () => {
    api.listStreetLights.mockResolvedValueOnce(page([row(), row({
      id: 12, inventory_number: 'LP-12', address: null, district: null, lamp_type: null, status: 'inactive',
    })], 2));
    renderInventory();

    expect(await screen.findByRole('heading', { name: 'Svetelné body (2)' })).toBeTruthy();
    expect(screen.getByText('LP-11')).toBeTruthy();
    expect(screen.getByText('Jarná 1')).toBeTruthy();
    expect(screen.getByText('LP-11').closest('tr')?.textContent).toContain('Aktívny');
    expect(screen.getByText('LP-12').closest('tr')?.textContent).toContain('Neaktívny');
    const firstRow = screen.getByText('LP-11').closest('tr');
    expect(firstRow?.querySelector('a[href$="/11"]')?.textContent).toBe('Detail');
    expect(firstRow?.querySelector('a[href$="/11/edit"]')?.textContent).toBe('Upraviť');
    expect(screen.getByRole('option', { name: 'Neuvedený typ' })).toBeTruthy();
    expect(await screen.findByText(/Niektoré typy nie sú v krátkom zozname/)).toBeTruthy();
  });

  it('debounces and normalizes search, resets the page, and sends server sort/filter parameters', async () => {
    api.listStreetLights.mockResolvedValue(page([], 0));
    const user = userEvent.setup();
    renderInventory('/panel-svietidla/svietidla?page=3&status=active');
    await screen.findByText(/Pre zadaný výber/);
    await user.type(screen.getByRole('searchbox', { name: 'Hľadať svetelný bod' }), '  LP-22  ');
    await waitFor(() => expect(screen.getByLabelText('Aktuálna URL').textContent).toContain('search=LP-22'));
    expect(screen.getByLabelText('Aktuálna URL').textContent).not.toContain('page=');
    await waitFor(() => expect(api.listStreetLights).toHaveBeenLastCalledWith(expect.objectContaining({ search: 'LP-22', status: 'active' })));

    await user.selectOptions(screen.getByRole('combobox', { name: 'Typ svietidla' }), '__missing__');
    await waitFor(() => expect(api.listStreetLights).toHaveBeenLastCalledWith(expect.objectContaining({ lampTypeMissing: true })));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Stav' }), 'inactive');
    await waitFor(() => expect(api.listStreetLights).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'inactive' })));
    await user.click(screen.getByRole('button', { name: 'Zoradiť podľa Inventárne č., vzostupne' }));
    await waitFor(() => expect(api.listStreetLights).toHaveBeenLastCalledWith(expect.objectContaining({ sortBy: 'inventory_number', sortOrder: 'asc' })));
  });

  it('normalizes invalid URL sorting and resets active filters', async () => {
    const user = userEvent.setup();
    renderInventory('/panel-svietidla/svietidla?sortBy=not-a-column&sortOrder=sideways&search=LP-3&lampType=LED&lampTypeMissing=true');
    await screen.findByRole('heading', { name: /Svetelné body/ });
    expect(api.listStreetLights).toHaveBeenCalledWith(expect.objectContaining({ sortBy: 'id', sortOrder: 'asc', lampTypeMissing: true }));
    await user.click(screen.getByRole('button', { name: 'Vymazať filtre' }));
    await waitFor(() => expect(screen.getByLabelText('Aktuálna URL').textContent).toBe('?sortBy=not-a-column&sortOrder=sideways'));
    expect((screen.getByRole('button', { name: 'Vymazať filtre' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('clears individual filters and toggles an existing descending sort back to ascending', async () => {
    const user = userEvent.setup();
    renderInventory('/panel-svietidla/svietidla?search=LP-9&status=active&lampType=LED&sortBy=inventory_number&sortOrder=desc&page=2');
    await screen.findByText('LP-11');
    expect(api.listStreetLights).toHaveBeenCalledWith(expect.objectContaining({
      search: 'LP-9', status: 'active', lampType: 'LED', sortBy: 'inventory_number', sortOrder: 'desc', page: 2,
    }));

    await user.selectOptions(screen.getByRole('combobox', { name: 'Typ svietidla' }), '');
    await waitFor(() => expect(api.listStreetLights).toHaveBeenLastCalledWith(expect.objectContaining({ lampType: '' })));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Stav' }), '');
    await waitFor(() => expect(api.listStreetLights).toHaveBeenLastCalledWith(expect.objectContaining({ status: '' })));
    await user.click(screen.getByRole('button', { name: 'Zmeniť zoradenie Inventárne č. na vzostupné' }));
    await waitFor(() => expect(api.listStreetLights).toHaveBeenLastCalledWith(expect.objectContaining({ sortOrder: 'asc' })));
    await user.clear(screen.getByRole('searchbox', { name: 'Hľadať svetelný bod' }));
    await waitFor(() => expect(screen.getByLabelText('Aktuálna URL').textContent).not.toContain('search='));
    await waitFor(() => expect(api.listStreetLights).toHaveBeenLastCalledWith(expect.objectContaining({ search: '', status: '', lampType: '' })));
  });

  it('shows loading, a bounded list error, filter-option failure, and an empty state', async () => {
    let resolveRows!: (value: ReturnType<typeof page>) => void;
    api.listStreetLights.mockImplementationOnce(() => new Promise((resolve) => { resolveRows = resolve; }));
    api.getStreetLightFilterOptions.mockRejectedValueOnce({ detail: 'private' });
    renderInventory();
    expect(screen.getByText('Načítavam svetelné body…')).toBeTruthy();
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.queryByText('private')).toBeNull();
    resolveRows(page([], 0));
    expect(await screen.findByText(/Pre zadaný výber sa nenašli/)).toBeTruthy();

    cleanup();
    api.getStreetLightFilterOptions.mockResolvedValue(options);
    api.listStreetLights.mockRejectedValueOnce(new Error('inventory unavailable'));
    renderInventory();
    expect((await screen.findByRole('alert')).textContent).toContain('inventory unavailable');
  });

  it('exports the current normalized filters and reports export errors without losing the list', async () => {
    const user = userEvent.setup();
    renderInventory('/panel-svietidla/svietidla?search=%20LP-9%20&status=active&lampType=LED');
    await screen.findByText('LP-11');
    await user.click(screen.getByRole('button', { name: 'Export CSV' }));
    await waitFor(() => expect(api.exportStreetLights).toHaveBeenCalledWith('csv', {
      search: 'LP-9', status: 'active', lampType: 'LED', lampTypeMissing: false,
    }));
    api.exportStreetLights.mockRejectedValueOnce(new Error('export unavailable'));
    await user.click(screen.getByRole('button', { name: 'Export JSON' }));
    expect(await screen.findByText('export unavailable')).toBeTruthy();
    expect(screen.getByText('LP-11')).toBeTruthy();
    api.exportStreetLights.mockRejectedValueOnce({ internal: 'private' });
    await user.click(screen.getByRole('button', { name: 'Export CSV' }));
    expect(await screen.findByText('Export zlyhal')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Export GeoJSON' }));
    expect(api.exportStreetLights).toHaveBeenLastCalledWith('geojson', expect.any(Object));
  });
});
