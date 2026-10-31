// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AdminLogsPage } from '@admin/pages/AdminLogsPage/AdminLogsPage';

const { api } = vi.hoisted(() => ({ api: {
  getActivityLogs: vi.fn(), getInventoryAuditLogs: vi.fn(), getImportBatches: vi.fn(),
  getImportRows: vi.fn(), createAdminAccount: vi.fn(),
} }));
vi.mock('@admin/services/adminApi', () => ({ adminApi: api }));

afterEach(() => { cleanup(); vi.clearAllMocks(); });

function renderLogs(path = '/panel-svietidla/logs') {
  return render(<MemoryRouter initialEntries={[path]}><AdminLogsPage /></MemoryRouter>);
}

describe('AdminLogsPage', () => {
beforeEach(() => {
    vi.resetAllMocks();
    api.getActivityLogs.mockResolvedValue({ items: [], total: 0, limit: 25, offset: 0 });
    api.getInventoryAuditLogs.mockResolvedValue({ items: [], total: 0, limit: 25, offset: 0 });
    api.getImportBatches.mockResolvedValue({ items: [], total: 0, limit: 25, offset: 0 });
    api.getImportRows.mockResolvedValue({ items: [], nextCursor: null });
    api.createAdminAccount.mockResolvedValue({ id: 9, username: 'newadmin', fullName: null });
  });

  it('renders activity, inventory, and import logs with safe fallback labels and paged batch details', async () => {
    const user = userEvent.setup();
    api.getActivityLogs.mockResolvedValue({ items: [
      { id: 1, action: 'login', entity_type: 'light_point', entity_id: 12, details: null, created_at: '2026-10-30T10:00:00Z', admin_username: 'op' },
      { id: 2, action: 'future_action', entity_type: 'admin', entity_id: 3, details: null, created_at: '2026-10-30T11:00:00Z', admin_username: null },
      { id: 3, action: 'logout', entity_type: 'unknown', entity_id: null, details: null, created_at: '2026-10-30T12:00:00Z', admin_username: 'op' },
    ], total: 3, limit: 25, offset: 0 });
    renderLogs();

    expect(await screen.findByText('Svetelný bod #12')).toBeTruthy();
    expect(screen.getByText('Prihlásenie')).toBeTruthy();
    expect(screen.getByText('future_action')).toBeTruthy();
    expect(screen.getByText('Účet #3')).toBeTruthy();
    expect(screen.getByText('—')).toBeTruthy();
    api.getInventoryAuditLogs.mockResolvedValueOnce({ items: [{
      id: 7, admin_username: null, entity_id: 51, inventory_number: 'LP-51', action: 'future_change', created_at: '2026-10-30T13:00:00Z',
    }], total: 1, limit: 25, offset: 0 });
    await user.click(screen.getByRole('tab', { name: 'Zmeny inventára' }));
    await waitFor(() => expect(api.getInventoryAuditLogs).toHaveBeenCalled());
    expect(await screen.findByText('Zmena inventára')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Bod #51 · LP-51' }).getAttribute('href')).toContain('street-lights/51');

    api.getImportBatches.mockResolvedValueOnce({ items: [{
      id: 48, filename: 'points.csv', uploaded_by_admin_id: null, uploaded_by_username: null,
      total_rows: 4, created_rows: 1, updated_rows: 0, skipped_rows: 1, failed_rows: 2,
      successful_rows: 1, applied_rows: 1, unchanged_rows: 0, status: 'future_status',
      created_at: '2026-10-30T14:00:00Z', queued_at: '2026-10-30T14:00:00Z', started_at: null, completed_at: null,
    }], total: 1, limit: 25, offset: 0, page: 1, totalPages: 1 });
    api.getImportRows.mockResolvedValueOnce({ items: [
      { source_row_number: 2, inventory_number: null, outcome: 'failed', entity_id: null, reason_code: 'invalid_row', safe_reason: 'Safe explanation' },
      { source_row_number: 3, inventory_number: 'LP-X', outcome: 'failed', entity_id: null, reason_code: 'invalid_geometry', safe_reason: null },
      { source_row_number: 4, inventory_number: null, outcome: 'failed', entity_id: null, reason_code: null, safe_reason: null },
    ], nextCursor: 25 });
    await user.click(screen.getByRole('tab', { name: 'Importy' }));
    expect(await screen.findByText('future_status')).toBeTruthy();
    expect(screen.getByText('Neznámy účet')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Zobraziť riadky' }));
    expect(await screen.findByText('Safe explanation')).toBeTruthy();
    expect(screen.getByText('invalid_geometry')).toBeTruthy();
    const finalRow = screen.getAllByRole('cell').find((cell) => cell.textContent === '4')?.closest('tr');
    expect(finalRow?.textContent).toBe('4—failed—');
    await user.click(screen.getByRole('button', { name: 'Načítať ďalších 25' }));
    await waitFor(() => expect(api.getImportRows).toHaveBeenCalledWith(48, { limit: 25, cursor: 25 }));
  });

  it('moves the selected tab with arrow and Home/End keyboard controls', async () => {
    renderLogs();
    const activityTab = screen.getByRole('tab', { name: 'Admin aktivity' });
    fireEvent.keyDown(activityTab, { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { name: 'Zmeny inventára' }).getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Zmeny inventára' }), { key: 'End' });
    expect(screen.getByRole('tab', { name: 'Importy' }).getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Importy' }), { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { name: 'Admin aktivity' }).getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Admin aktivity' }), { key: 'ArrowLeft' });
    expect(screen.getByRole('tab', { name: 'Importy' }).getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Importy' }), { key: 'Home' });
    expect(screen.getByRole('tab', { name: 'Admin aktivity' }).getAttribute('aria-selected')).toBe('true');
  });

  it('shows empty and request error states, then retries with the generic non-Error message', async () => {
    api.getActivityLogs.mockRejectedValueOnce(new Error('temporary failure'));
    const user = userEvent.setup();
    renderLogs();
    expect(await screen.findByText('temporary failure')).toBeTruthy();
    api.getActivityLogs.mockRejectedValueOnce({ internal: true });
    await user.click(screen.getByRole('button', { name: 'Skúsiť znova' }));
    expect(await screen.findByText('Načítanie zlyhalo')).toBeTruthy();
    api.getActivityLogs.mockResolvedValueOnce({ items: [], total: 0, limit: 25, offset: 0 });
    await user.click(screen.getByRole('button', { name: 'Skúsiť znova' }));
    expect(await screen.findByText('Zatiaľ nie sú zaznamenané žiadne admin aktivity.')).toBeTruthy();
  });

  it('rejects mismatched admin passwords and creates a valid account with optional full name omitted', async () => {
    const user = userEvent.setup();
    renderLogs();
    await user.click(screen.getByText('Pridať administrátorský účet'));
    await user.type(screen.getByLabelText('Používateľské meno'), 'newadmin');
    await user.type(screen.getByLabelText('Nové heslo'), 'a-long-password-123');
    await user.type(screen.getByLabelText('Zopakujte heslo'), 'a-different-password');
    await user.click(screen.getByRole('button', { name: 'Vytvoriť účet' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Heslá sa nezhodujú.');
    expect(api.createAdminAccount).not.toHaveBeenCalled();

    await user.clear(screen.getByLabelText('Zopakujte heslo'));
    await user.type(screen.getByLabelText('Zopakujte heslo'), 'a-long-password-123');
    await user.click(screen.getByRole('button', { name: 'Vytvoriť účet' }));
    expect(await screen.findByText('Účet newadmin bol vytvorený.')).toBeTruthy();
    expect(api.createAdminAccount).toHaveBeenCalledWith({ username: 'newadmin', password: 'a-long-password-123' });
  });

  it('surfaces account creation failures without losing the open form', async () => {
    api.createAdminAccount.mockRejectedValueOnce({ internal: 'do not show' });
    const user = userEvent.setup();
    renderLogs();
    await user.click(screen.getByText('Pridať administrátorský účet'));
    await user.type(screen.getByLabelText('Používateľské meno'), 'newadmin');
    await user.type(screen.getByLabelText('Nové heslo'), 'a-long-password-123');
    await user.type(screen.getByLabelText('Zopakujte heslo'), 'a-long-password-123');
    await user.click(screen.getByRole('button', { name: 'Vytvoriť účet' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Účet sa nepodarilo vytvoriť.');
    expect(screen.getByLabelText('Používateľské meno')).toBeTruthy();
  });
});
