// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AdminAuthProvider } from '@admin/context/AdminAuthContext';
import AdminApp from '@admin/App';

const { api } = vi.hoisted(() => ({
  api: {
    me: vi.fn(), login: vi.fn(), logout: vi.fn(),
    listStreetLights: vi.fn(), getStreetLight: vi.fn(), createStreetLight: vi.fn(),
    updateStreetLight: vi.fn(), deleteStreetLight: vi.fn(), exportStreetLights: vi.fn(),
    importPreview: vi.fn(), getImportPreviewRows: vi.fn(), importConfirm: vi.fn(),
    getImportStatus: vi.fn(), getImportRows: vi.fn(), getIntegrationSettings: vi.fn(),
    getActivityLogs: vi.fn(), getImportBatches: vi.fn(), getIntegrationLogs: vi.fn(),
  },
}));

vi.mock('@admin/services/adminApi', () => ({ adminApi: api }));

afterEach(cleanup);

const admin = { id: 7, username: 'synthetic-admin', fullName: 'Synthetic Admin' };
const lightPointRow = {
  id: 31,
  inventory_number: 'P5-SYNTHETIC-31',
  external_id: null,
  latitude: '48.7164',
  longitude: '21.2611',
  address: 'Synthetic street',
  district: 'Synthetic district',
  lamp_type: 'LED',
  status: 'active' as const,
  created_at: '2026-10-01T10:00:00.000Z',
  updated_at: '2026-10-01T10:00:00.000Z',
};

function renderAdmin(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AdminAuthProvider><AdminApp /></AdminAuthProvider>
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  api.me.mockResolvedValue(admin);
  api.login.mockResolvedValue(admin);
  api.logout.mockResolvedValue({ message: 'ok' });
  api.listStreetLights.mockResolvedValue({ items: [lightPointRow], pagination: { page: 1, limit: 20, total: 1, totalPages: 1 } });
  api.getStreetLight.mockResolvedValue(lightPointRow);
  api.createStreetLight.mockResolvedValue(lightPointRow);
  api.updateStreetLight.mockResolvedValue(lightPointRow);
  api.deleteStreetLight.mockResolvedValue({ message: 'ok' });
  api.exportStreetLights.mockResolvedValue(undefined);
  api.importPreview.mockResolvedValue({
    previewId: 'synthetic-preview', filename: 'synthetic.csv', totalRows: 1,
    results: [{ rowIndex: 1, inventoryNumber: 'P5-IMPORT-1', action: 'create' }],
    pagination: { page: 1, limit: 50, totalPages: 1 },
    summary: { toCreate: 1, toUpdate: 0, unchanged: 0, skipped: 0, errors: 0 },
  });
  api.importConfirm.mockResolvedValue({ batchId: 81, status: 'queued', totalRows: 1 });
  api.getImportStatus.mockResolvedValue({
    id: 81, filename: 'synthetic.csv', uploaded_by_admin_id: 7, uploaded_by_username: 'synthetic-admin',
    total_rows: 1, created_rows: 1, updated_rows: 0, skipped_rows: 0, failed_rows: 0,
    successful_rows: 1, applied_rows: 1, unchanged_rows: 0, status: 'completed',
    created_at: '2026-10-01T10:00:00.000Z', queued_at: '2026-10-01T10:00:00.000Z',
    started_at: '2026-10-01T10:00:01.000Z', completed_at: '2026-10-01T10:00:02.000Z',
  });
  api.getImportRows.mockResolvedValue({ items: [], nextCursor: null });
  api.getIntegrationSettings.mockResolvedValue({ baseUrl: 'https://example.invalid', testMode: true, submitLocales: ['sk'], apiKeyConfigured: false, fieldMapping: {} });
  api.getActivityLogs.mockResolvedValue([]);
  api.getImportBatches.mockResolvedValue({ items: [], total: 0, limit: 10, offset: 0 });
  api.getIntegrationLogs.mockResolvedValue([]);
});

describe('separated admin application', () => {
  it('bootstraps /me, redirects protected deep links to login, and returns after login', async () => {
    const user = userEvent.setup();
    api.me.mockResolvedValueOnce(null);
    renderAdmin('/panel-svietidla/street-lights');

    expect(await screen.findByRole('heading', { name: 'Admin prihlásenie' })).toBeTruthy();
    expect(api.me).toHaveBeenCalledTimes(1);
    await user.type(screen.getByLabelText('Používateľské meno'), 'synthetic-admin');
    await user.type(screen.getByLabelText('Heslo'), 'synthetic-password');
    await user.click(screen.getByRole('button', { name: 'Prihlásiť sa' }));

    expect(await screen.findByRole('heading', { name: 'Svetelné body (1)' })).toBeTruthy();
    expect(api.login).toHaveBeenCalledWith('synthetic-admin', 'synthetic-password');
    expect(await screen.findByText('P5-SYNTHETIC-31')).toBeTruthy();
  });

  it('validates and creates an inventory record before opening its real admin detail view', async () => {
    const user = userEvent.setup();
    renderAdmin('/panel-svietidla/street-lights/new');
    expect(await screen.findByRole('heading', { name: 'Nový svetelný bod' })).toBeTruthy();
    await user.type(screen.getByLabelText('Inventárne číslo *'), 'P5-NEW-1');
    await user.clear(screen.getByLabelText('Zemepisná šírka *'));
    await user.type(screen.getByLabelText('Zemepisná šírka *'), '48.71');
    await user.clear(screen.getByLabelText('Zemepisná dĺžka *'));
    await user.type(screen.getByLabelText('Zemepisná dĺžka *'), '21.25');
    await user.click(screen.getByRole('button', { name: 'Uložiť' }));

    expect(await screen.findByRole('heading', { name: 'Svetelný bod #31' })).toBeTruthy();
    expect(api.createStreetLight).toHaveBeenCalledWith(expect.objectContaining({
      inventoryNumber: 'P5-NEW-1', latitude: 48.71, longitude: 21.25,
    }));
    expect(api.getStreetLight).toHaveBeenCalledWith(31);
  });

  it('previews an import, confirms it, tracks status, and opens import history', async () => {
    const user = userEvent.setup();
    renderAdmin('/panel-svietidla/import');
    expect(await screen.findByRole('heading', { name: 'Import svetelných bodov' })).toBeTruthy();
    await user.upload(screen.getByLabelText('Súbor'), new File(['inventory_number,latitude,longitude\nP5-IMPORT-1,48.7,21.2'], 'synthetic.csv', { type: 'text/csv' }));
    await user.click(screen.getByRole('button', { name: 'Náhľad importu' }));
    expect(await screen.findByRole('heading', { name: 'Náhľad: synthetic.csv' })).toBeTruthy();
    expect(screen.getByText('P5-IMPORT-1')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Potvrdiť import' }));
    expect(await screen.findByText(/Dávka #81: completed/)).toBeTruthy();
    await user.click(screen.getByRole('link', { name: 'Otvoriť históriu importov' }));
    expect(await screen.findByRole('heading', { name: 'Technické logy' })).toBeTruthy();
    await waitFor(() => expect(api.getImportBatches).toHaveBeenCalled());
    expect(api.importPreview).toHaveBeenCalledWith(expect.any(File));
    expect(api.importConfirm).toHaveBeenCalledWith('synthetic-preview', false);
  });

  it('triggers export and loads settings and log pages through the admin client', async () => {
    const user = userEvent.setup();
    const inventory = renderAdmin('/panel-svietidla/street-lights');
    expect(await screen.findByText('P5-SYNTHETIC-31')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Export CSV' }));
    expect(api.exportStreetLights).toHaveBeenCalledWith('csv', expect.any(Object));
    inventory.unmount();

    const settings = renderAdmin('/panel-svietidla/settings');
    expect(await screen.findByText('https://example.invalid')).toBeTruthy();
    expect(api.getIntegrationSettings).toHaveBeenCalledTimes(1);
    settings.unmount();

    renderAdmin('/panel-svietidla/logs');
    expect(await screen.findByRole('heading', { name: 'Technické logy' })).toBeTruthy();
    await waitFor(() => {
      expect(api.getActivityLogs).toHaveBeenCalled();
      expect(api.getIntegrationLogs).toHaveBeenCalled();
    });
  });
});
