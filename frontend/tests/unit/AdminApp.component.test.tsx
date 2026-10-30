// @vitest-environment jsdom
import { useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation, useNavigate, type NavigateFunction } from 'react-router-dom';
import { AdminAuthProvider } from '@admin/context/AdminAuthContext';
import AdminApp from '@admin/App';

const { api } = vi.hoisted(() => ({
  api: {
    me: vi.fn(), login: vi.fn(), logout: vi.fn(),
    listStreetLights: vi.fn(), getStreetLight: vi.fn(), createStreetLight: vi.fn(),
    updateStreetLight: vi.fn(), deleteStreetLight: vi.fn(), exportStreetLights: vi.fn(), createAdminAccount: vi.fn(),
    importPreview: vi.fn(), getImportPreviewRows: vi.fn(), importConfirm: vi.fn(),
    getImportStatus: vi.fn(), getImportRows: vi.fn(), getIntegrationSettings: vi.fn(),
    getStreetLightFilterOptions: vi.fn(), getInventoryAuditLogs: vi.fn(),
    getActivityLogs: vi.fn(), getImportBatches: vi.fn(), getIntegrationLogs: vi.fn(), getFaultReportHistory: vi.fn(), getDashboardOverview: vi.fn(),
    getReportAnalyticsSummary: vi.fn(), listReportAnalytics: vi.fn(),
  },
}));

vi.mock('@admin/services/adminApi', () => ({ adminApi: api }));

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

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

function CurrentPath({ onChange }: { onChange: (pathname: string) => void }) {
  const { pathname } = useLocation();
  useEffect(() => onChange(pathname), [onChange, pathname]);
  return null;
}

function CurrentNavigate({ onReady }: { onReady: (navigate: NavigateFunction) => void }) {
  const navigate = useNavigate();
  useEffect(() => onReady(navigate), [navigate, onReady]);
  return null;
}

function CurrentUrl({ onChange }: { onChange: (url: string) => void }) {
  const location = useLocation();
  useEffect(() => onChange(`${location.pathname}${location.search}`), [location.pathname, location.search, onChange]);
  return null;
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.removeItem('plfr-admin-theme');
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
    pagination: { page: 1, limit: 25, totalPages: 1 },
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
  api.getStreetLightFilterOptions.mockResolvedValue({ lampTypes: ['LED'], hasMissingLampType: false, districts: ['Synthetic district'], hasMissingDistrict: true, hasMoreLampTypes: false, hasMoreDistricts: false, statuses: [{ value: 'active', label: 'Aktívny' }] });
  api.getInventoryAuditLogs.mockResolvedValue([]);
  api.getImportPreviewRows.mockResolvedValue({
    previewId: 'synthetic-preview', filename: 'synthetic.csv', totalRows: 1,
    results: [{ rowIndex: 1, inventoryNumber: 'P5-IMPORT-1', action: 'create' }],
    pagination: { page: 1, limit: 25, totalPages: 1 },
    summary: { toCreate: 1, toUpdate: 0, unchanged: 0, skipped: 0, errors: 0 },
  });
  api.getIntegrationSettings.mockResolvedValue({ baseUrl: 'https://example.invalid', testMode: true, submitLocales: ['sk'], apiKeyConfigured: false, fieldMapping: {} });
  api.getActivityLogs.mockResolvedValue({ items: [], total: 0, limit: 25, offset: 0 });
  api.getInventoryAuditLogs.mockResolvedValue({ items: [], total: 0, limit: 25, offset: 0 });
  api.getImportBatches.mockResolvedValue({ items: [], total: 0, limit: 25, offset: 0, page: 1, totalPages: 1 });
  api.getIntegrationLogs.mockResolvedValue([]);
  api.getFaultReportHistory.mockResolvedValue({ items: [], total: 0 });
  api.getDashboardOverview.mockResolvedValue({ inventoryTotal: 1, reports24h: 0, reports7d: 0, reports30d: 0, recent: [] });
  api.getReportAnalyticsSummary.mockResolvedValue({ period: '7d', periodStart: '2026-10-23T00:00:00.000Z', periodEnd: '2026-10-30T00:00:00.000Z', totalLocalReports: 3, assignedToInventoryPoints: 2, customOrManualReports: 1, reportsForDeletedPoints: 0 });
  api.listReportAnalytics.mockResolvedValue({ items: [], pagination: { page: 1, limit: 25, total: 0, totalPages: 1 } });
});

describe('separated admin application', () => {
  it('renders the protected dashboard at the origin root when deployed on a dedicated admin host', async () => {
    vi.stubEnv('VITE_ADMIN_BASE_PATH', '/');
    vi.resetModules();
    const [{ default: RootAdminApp }, { AdminAuthProvider: RootAdminAuthProvider }] = await Promise.all([
      import('@admin/App'),
      import('@admin/context/AdminAuthContext'),
    ]);

    render(
      <MemoryRouter initialEntries={['/']}>
        <RootAdminAuthProvider><RootAdminApp /></RootAdminAuthProvider>
      </MemoryRouter>
    );

    expect(await screen.findByRole('heading', { name: 'Prehľad verejného osvetlenia' })).toBeTruthy();
    expect(screen.getByRole('main')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Prehľad' }).getAttribute('aria-current')).toBe('page');
    expect(within(screen.getByRole('navigation')).getByRole('link', { name: 'Svetelné body' }).getAttribute('aria-current')).toBeNull();
    expect(api.me).toHaveBeenCalledTimes(1);
  });

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

  it('restores an existing session from the login URL to the canonical admin root', async () => {
    const onPathChange = vi.fn();

    render(
      <MemoryRouter initialEntries={['/panel-svietidla/login']}>
        <CurrentPath onChange={onPathChange} />
        <AdminAuthProvider><AdminApp /></AdminAuthProvider>
      </MemoryRouter>
    );

    expect(await screen.findByRole('heading', { name: 'Prehľad verejného osvetlenia' })).toBeTruthy();
    expect(onPathChange).toHaveBeenCalledWith('/panel-svietidla/');
  });

  it('validates and creates an inventory record before opening its real admin detail view', async () => {
    const user = userEvent.setup();
    renderAdmin('/panel-svietidla/street-lights/new');
    expect(await screen.findByRole('heading', { name: 'Nový svetelný bod' })).toBeTruthy();
    expect(within(screen.getByRole('navigation')).getByRole('link', { name: 'Svetelné body' }).getAttribute('aria-current')).toBe('page');
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
    await screen.findByRole('button', { name: 'Náhľad importu' });
    await waitFor(() => expect((screen.getByRole('button', { name: 'Zoradiť podľa Akcia, vzostupne' }) as HTMLButtonElement).disabled).toBe(false));
    await user.click(screen.getByRole('button', { name: 'Zoradiť podľa Akcia, vzostupne' }));
    await waitFor(() => expect(api.getImportPreviewRows).toHaveBeenCalledWith('synthetic-preview', 1, 25, 'action', 'asc'));
    await user.click(screen.getByRole('button', { name: 'Potvrdiť import' }));
    expect(await screen.findByText(/Dávka #81: completed/)).toBeTruthy();
    await user.click(screen.getByRole('link', { name: 'Otvoriť históriu importov' }));
    expect(await screen.findByRole('heading', { name: 'Prevádzkové záznamy' })).toBeTruthy();
    await waitFor(() => expect(api.getImportBatches).toHaveBeenCalled());
    expect(api.importPreview).toHaveBeenCalledWith(expect.any(File));
    expect(api.importConfirm).toHaveBeenCalledWith('synthetic-preview', false);
  });

  it('announces import sort state and ignores out-of-order preview responses', async () => {
    const user = userEvent.setup();
    let navigate: NavigateFunction = () => {};
    const onNavigate = (next: NavigateFunction) => { navigate = next; };
    let resolveOlder!: (value: { previewId: string; filename: string; totalRows: number; results: Array<{ rowIndex: number; inventoryNumber: string; action: string; message: string }>; pagination: { page: number; limit: number; totalPages: number }; summary: { toCreate: number; toUpdate: number; unchanged: number; skipped: number; errors: number } }) => void;
    let resolveLatest!: typeof resolveOlder;
    const olderResponse = new Promise<Parameters<typeof resolveOlder>[0]>((resolve) => { resolveOlder = resolve; });
    const latestResponse = new Promise<Parameters<typeof resolveOlder>[0]>((resolve) => { resolveLatest = resolve; });

    render(
      <MemoryRouter initialEntries={['/panel-svietidla/import']}>
        <CurrentNavigate onReady={onNavigate} />
        <AdminAuthProvider><AdminApp /></AdminAuthProvider>
      </MemoryRouter>
    );
    await screen.findByRole('heading', { name: 'Import svetelných bodov' });
    await user.upload(screen.getByLabelText('Súbor'), new File(['inventory_number,latitude,longitude\nP5-IMPORT-1,48.7,21.2'], 'synthetic.csv', { type: 'text/csv' }));
    await user.click(screen.getByRole('button', { name: 'Náhľad importu' }));
    await screen.findByRole('heading', { name: 'Náhľad: synthetic.csv' });
    await screen.findByRole('button', { name: 'Náhľad importu' });
    await waitFor(() => expect((screen.getByRole('button', { name: 'Zoradiť podľa Akcia, vzostupne' }) as HTMLButtonElement).disabled).toBe(false));

    api.getImportPreviewRows
      .mockImplementationOnce(() => olderResponse)
      .mockImplementationOnce(() => latestResponse);
    await act(async () => navigate('/panel-svietidla/import?preview=synthetic-preview&sortBy=action&sortOrder=asc'));
    await waitFor(() => expect(api.getImportPreviewRows).toHaveBeenCalledTimes(1));
    await act(async () => navigate('/panel-svietidla/import?preview=synthetic-preview&sortBy=message&sortOrder=asc'));
    await waitFor(() => expect(api.getImportPreviewRows).toHaveBeenCalledTimes(2));

    expect(api.getImportPreviewRows).toHaveBeenCalledTimes(2);
    expect(screen.getAllByRole('columnheader').find((header) => header.textContent?.includes('Riadok'))?.getAttribute('aria-sort')).toBe('none');
    expect(screen.getAllByRole('columnheader').find((header) => header.textContent?.includes('Správa'))?.getAttribute('aria-sort')).toBe('ascending');
    expect(screen.getByRole('button', { name: 'Zoradiť podľa Riadok' }).getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByRole('button', { name: 'Zoradiť podľa Akcia' }).hasAttribute('disabled')).toBe(true);

    const response = (message: string) => ({
      previewId: 'synthetic-preview', filename: 'synthetic.csv', totalRows: 1,
      results: [{ rowIndex: 1, inventoryNumber: 'P5-IMPORT-1', action: 'create', message }],
      pagination: { page: 1, limit: 25, totalPages: 1 },
      summary: { toCreate: 1, toUpdate: 0, unchanged: 0, skipped: 0, errors: 0 },
    });

    await act(async () => { resolveLatest(response('latest requested sort')); await latestResponse; });
    expect(await screen.findByText('latest requested sort')).toBeTruthy();
    expect(screen.getAllByRole('columnheader').find((header) => header.textContent?.includes('Správa'))?.getAttribute('aria-sort')).toBe('ascending');
    await act(async () => { resolveOlder(response('stale earlier sort')); await olderResponse; });
    expect(screen.getByText('latest requested sort')).toBeTruthy();
    expect(screen.queryByText('stale earlier sort')).toBeNull();
  });

  it('keeps the displayed import sort state when the requested sort fails', async () => {
    const user = userEvent.setup();
    renderAdmin('/panel-svietidla/import');
    await screen.findByRole('heading', { name: 'Import svetelných bodov' });
    await user.upload(screen.getByLabelText('Súbor'), new File(['inventory_number,latitude,longitude\nP5-IMPORT-1,48.7,21.2'], 'synthetic.csv', { type: 'text/csv' }));
    await user.click(screen.getByRole('button', { name: 'Náhľad importu' }));
    await screen.findByRole('heading', { name: 'Náhľad: synthetic.csv' });
    await screen.findByRole('button', { name: 'Náhľad importu' });
    await waitFor(() => expect((screen.getByRole('button', { name: 'Zoradiť podľa Akcia, vzostupne' }) as HTMLButtonElement).disabled).toBe(false));

    api.getImportPreviewRows.mockRejectedValueOnce(new Error('sort request failed'));
    await user.click(screen.getByRole('button', { name: 'Zoradiť podľa Akcia, vzostupne' }));

    expect(await screen.findByText('sort request failed')).toBeTruthy();
    expect(screen.getByText('P5-IMPORT-1')).toBeTruthy();
    expect(screen.getAllByRole('columnheader').find((header) => header.textContent?.includes('Riadok'))?.getAttribute('aria-sort')).toBe('ascending');
    expect(screen.getAllByRole('columnheader').find((header) => header.textContent?.includes('Akcia'))?.getAttribute('aria-sort')).toBe('none');
  });

  it('triggers export, redirects the legacy settings route, and loads logs through the admin client', async () => {
    const user = userEvent.setup();
    const inventory = renderAdmin('/panel-svietidla/street-lights');
    expect(await screen.findByText('P5-SYNTHETIC-31')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Export CSV' }));
    expect(api.exportStreetLights).toHaveBeenCalledWith('csv', expect.any(Object));
    inventory.unmount();

    const settings = renderAdmin('/panel-svietidla/settings');
    expect(await screen.findByRole('heading', { name: 'Prehľad verejného osvetlenia' })).toBeTruthy();
    expect(api.getIntegrationSettings).not.toHaveBeenCalled();
    settings.unmount();

    renderAdmin('/panel-svietidla/logs');
    expect(await screen.findByRole('heading', { name: 'Prevádzkové záznamy' })).toBeTruthy();
    await waitFor(() => expect(api.getActivityLogs).toHaveBeenCalled());
    expect(api.getInventoryAuditLogs).not.toHaveBeenCalled();
    expect(screen.queryByRole('heading', { name: 'Integrácia' })).toBeNull();
  });

  it('clamps an out-of-range generic page in an import-log deep link and reloads that page', async () => {
    let currentUrl = '';
    const recordUrl = (url: string) => { currentUrl = url; };
    api.getImportBatches.mockResolvedValue({ items: [], total: 51, limit: 25, offset: 0, page: 1, totalPages: 3 });
    render(
      <MemoryRouter initialEntries={['/panel-svietidla/logs?tab=imports&page=99']}>
        <CurrentUrl onChange={recordUrl} />
        <AdminAuthProvider><AdminApp /></AdminAuthProvider>
      </MemoryRouter>
    );

    await waitFor(() => expect(api.getImportBatches).toHaveBeenLastCalledWith({ page: 3, limit: 25 }));
    await waitFor(() => expect(currentUrl).toBe('/panel-svietidla/logs?tab=imports&page=3'));
    expect(screen.getByLabelText('Stránkovanie').textContent).toContain('Strana 3 z 3');
  });

  it('remembers each log tab page independently when switching between tabs', async () => {
    const user = userEvent.setup();
    for (const load of [api.getActivityLogs, api.getInventoryAuditLogs, api.getImportBatches]) {
      load.mockResolvedValue({ items: [], total: 75, limit: 25, offset: 0, page: 1, totalPages: 3 });
    }
    let currentUrl = '';
    const recordUrl = (url: string) => { currentUrl = url; };
    render(
      <MemoryRouter initialEntries={['/panel-svietidla/logs']}>
        <CurrentUrl onChange={recordUrl} />
        <AdminAuthProvider><AdminApp /></AdminAuthProvider>
      </MemoryRouter>
    );

    await screen.findByRole('heading', { name: 'Prevádzkové záznamy' });
    await user.click(screen.getByRole('button', { name: 'Ďalšia strana' }));
    await waitFor(() => expect(api.getActivityLogs).toHaveBeenLastCalledWith({ page: 2, limit: 25 }));
    await waitFor(() => expect(currentUrl).toContain('activityPage=2'));

    await user.click(screen.getByRole('tab', { name: 'Zmeny inventára' }));
    await waitFor(() => expect(api.getInventoryAuditLogs).toHaveBeenLastCalledWith({ page: 1, limit: 25 }));
    await user.click(screen.getByRole('button', { name: 'Ďalšia strana' }));
    await waitFor(() => expect(api.getInventoryAuditLogs).toHaveBeenLastCalledWith({ page: 2, limit: 25 }));
    await waitFor(() => expect(currentUrl).toContain('inventoryPage=2'));

    await user.click(screen.getByRole('tab', { name: 'Admin aktivity' }));
    await waitFor(() => expect(api.getActivityLogs).toHaveBeenLastCalledWith({ page: 2, limit: 25 }));
    expect(currentUrl).toContain('activityPage=2');
    expect(currentUrl).toContain('inventoryPage=2');
  });

  it('supports arrow, Home, and End keyboard navigation across log tabs', async () => {
    const user = userEvent.setup();
    renderAdmin('/panel-svietidla/logs');
    const activity = await screen.findByRole('tab', { name: 'Admin aktivity' });
    activity.focus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Zmeny inventára' }).getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Zmeny inventára' }));
    await user.keyboard('{ArrowRight}');
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Importy' }));
    await user.keyboard('{End}');
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Importy' }));
    await user.keyboard('{Home}');
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Admin aktivity' }));
    expect(screen.getByRole('tab', { name: 'Admin aktivity' }).getAttribute('aria-selected')).toBe('true');
  });

  it('persists an explicit admin theme preference and toggles it accessibly', async () => {
    const user = userEvent.setup();
    renderAdmin('/panel-svietidla/');
    const toggle = await screen.findByRole('button', { name: /Prepnúť na tmavý režim|Prepnúť na svetlý režim/ });
    const expected = toggle.getAttribute('aria-label') === 'Prepnúť na tmavý režim' ? 'dark' : 'light';
    await user.click(toggle);
    await waitFor(() => expect(localStorage.getItem('plfr-admin-theme')).toBe(expected));
    expect(document.documentElement.dataset.theme).toBe(expected);
  });

  it('requests inventory sorting on the server for district and lamp type', async () => {
    const user = userEvent.setup();
    renderAdmin('/panel-svietidla/street-lights');
    await screen.findByText('P5-SYNTHETIC-31');
    expect(screen.getByRole('combobox', { name: 'Stav' })).toBeTruthy();
    expect(screen.getAllByRole('combobox')).toHaveLength(2);
    await user.click(screen.getByRole('button', { name: 'Zoradiť podľa Okres / lokalita, vzostupne' }));
    await waitFor(() => expect(api.listStreetLights).toHaveBeenLastCalledWith(expect.objectContaining({ sortBy: 'district', sortOrder: 'asc', page: 1 })));
    await user.click(screen.getByRole('button', { name: 'Zoradiť podľa Typ, vzostupne' }));
    await waitFor(() => expect(api.listStreetLights).toHaveBeenLastCalledWith(expect.objectContaining({ sortBy: 'lamp_type', sortOrder: 'asc', page: 1 })));
  });

  it('renders one all-inventory analytics table with local-report semantics', async () => {
    renderAdmin('/panel-svietidla/statistics');
    expect(await screen.findByRole('heading', { name: 'Štatistiky hlásení' })).toBeTruthy();
    expect((await screen.findAllByText('Počet zaznamenaných hlásení')).length).toBeGreaterThan(0);
    expect(screen.getByRole('heading', { name: 'Zaznamenané hlásenia podľa svetelného bodu' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: /Najčastejšie|Najmenej|bez hlásenia/ })).toBeNull();
    await waitFor(() => expect(api.listReportAnalytics).toHaveBeenCalledTimes(1));
    expect(api.listReportAnalytics).toHaveBeenCalledWith(expect.objectContaining({ period: '7d', limit: 25, order: 'desc' }));
  });

  it('shows operator metadata and automatic notes without citizen text or contact data', async () => {
    api.getFaultReportHistory.mockResolvedValue({
      items: [{
        id: 'history-1', submitted_at: '2026-10-25T10:00:00.000Z', service_code: 2,
        locality: 'Jarná', location_block_code: 'Q10', fault_type_code: 'Q1',
        target_kind: 'light-point', light_point_id: 31, latitude: 48.7164, longitude: 21.2611,
        automatic_notes: ['2 predchádzajúcich hlásení na evidovanom svietidle #31 za posledné 3 dni.'],
      }],
      total: 1,
    });
    renderAdmin('/panel-svietidla/reports');

    expect(await screen.findByRole('heading', { name: 'Hlásenia porúch' })).toBeTruthy();
    expect(await screen.findByText('2 predchádzajúcich hlásení na evidovanom svietidle #31 za posledné 3 dni.')).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: 'Čas (Europe/Bratislava)' })).toBeTruthy();
    expect(screen.getByText('25. 10. 2026, 11:00:00')).toBeTruthy();
    expect(screen.getByText('Jarná')).toBeTruthy();
    expect(screen.getByText('Svietidlo #31')).toBeTruthy();
    expect(screen.queryByText(/private user description|resident@example\.test|synthetic-phone/i)).toBeNull();
    expect(api.getFaultReportHistory).toHaveBeenCalledWith({ limit: 25, page: 1 });
  });

  it('ignores stale report-history responses after navigating to another page', async () => {
    let navigate: NavigateFunction = () => {};
    const onNavigate = (next: NavigateFunction) => { navigate = next; };
    let resolveFirst!: (value: { items: Array<Record<string, unknown>>; total: number }) => void;
    let resolveSecond!: (value: { items: Array<Record<string, unknown>>; total: number }) => void;
    const firstResponse = new Promise<{ items: Array<Record<string, unknown>>; total: number }>((resolve) => { resolveFirst = resolve; });
    const secondResponse = new Promise<{ items: Array<Record<string, unknown>>; total: number }>((resolve) => { resolveSecond = resolve; });
    api.getFaultReportHistory.mockImplementation(({ page }: { page: number }) => page === 1 ? firstResponse : secondResponse);

    render(
      <MemoryRouter initialEntries={['/panel-svietidla/reports']}>
        <CurrentNavigate onReady={onNavigate} />
        <AdminAuthProvider><AdminApp /></AdminAuthProvider>
      </MemoryRouter>
    );
    await waitFor(() => expect(api.getFaultReportHistory).toHaveBeenCalledWith({ limit: 25, page: 1 }));
    await act(async () => navigate('/panel-svietidla/reports?page=2'));
    await waitFor(() => expect(api.getFaultReportHistory).toHaveBeenCalledWith({ limit: 25, page: 2 }));

    const report = (id: string, locality: string) => ({
      id, submitted_at: '2026-10-25T10:00:00.000Z', service_code: 2, locality,
      location_block_code: null, fault_type_code: 'Q1', target_kind: 'manual',
      light_point_id: null, latitude: null, longitude: null, automatic_notes: [],
    });
    await act(async () => resolveFirst({ items: [report('old', 'Stale page')], total: 0 }));
    expect(screen.getByRole('status').textContent).toContain('Načítavam hlásenia');
    expect(screen.queryByText('Stale page')).toBeNull();

    await act(async () => resolveSecond({ items: [report('current', 'Current page')], total: 51 }));
    expect(await screen.findByText('Current page')).toBeTruthy();
    expect(screen.queryByText('Stale page')).toBeNull();
    expect(screen.getByLabelText('Stránkovanie').textContent).toContain('Strana 2 z 3');
  });
});
