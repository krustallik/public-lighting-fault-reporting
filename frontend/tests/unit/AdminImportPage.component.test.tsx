// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AdminImportPage } from '@admin/pages/AdminImportPage/AdminImportPage';

const { api } = vi.hoisted(() => ({ api: {
  importPreview: vi.fn(), importConfirm: vi.fn(), getImportStatus: vi.fn(),
  getImportRows: vi.fn(), getImportPreviewRows: vi.fn(),
} }));
vi.mock('@admin/services/adminApi', () => ({ adminApi: api }));

afterEach(() => { cleanup(); vi.clearAllMocks(); });

const preview = {
  previewId: 'preview-1', filename: 'points.csv', totalRows: 2,
  results: [
    { rowIndex: 1, inventoryNumber: 'LP-1', action: 'create' as const, message: 'Nový bod' },
    { rowIndex: 2, inventoryNumber: '', action: 'error' as const, message: null },
  ],
  pagination: { page: 1, limit: 25, totalPages: 1 },
  summary: { toCreate: 1, toUpdate: 0, unchanged: 0, skipped: 0, errors: 1 },
};

function renderImport(path = '/panel-svietidla/import') {
  return render(<MemoryRouter initialEntries={[path]}><AdminImportPage /></MemoryRouter>);
}

describe('AdminImportPage', () => {
  beforeEach(() => {
    api.importPreview.mockResolvedValue(preview);
    api.importConfirm.mockResolvedValue({ batchId: 48, status: 'queued', totalRows: 2 });
    api.getImportStatus.mockResolvedValue({
      id: 48, filename: 'points.csv', uploaded_by_admin_id: 2, uploaded_by_username: 'operator',
      total_rows: 2, created_rows: 1, updated_rows: 0, skipped_rows: 0, failed_rows: 1,
      successful_rows: 1, applied_rows: 1, unchanged_rows: 0, status: 'completed_with_errors',
      created_at: '2026-10-31T10:00:00.000Z', queued_at: '2026-10-31T10:00:00.000Z',
      started_at: '2026-10-31T10:00:01.000Z', completed_at: '2026-10-31T10:00:02.000Z',
    });
    api.getImportRows.mockResolvedValue({ items: [{
      source_row_number: 3, inventory_number: 'LP-BAD', outcome: 'failed', entity_id: null,
      reason_code: 'invalid_coordinates', safe_reason: 'Coordinates are outside the service area',
    }], nextCursor: null });
    api.getImportPreviewRows.mockResolvedValue(preview);
  });

  it('previews, explicitly enables updates, confirms the batch, and displays bounded failure details', async () => {
    const user = userEvent.setup();
    renderImport();
    const previewButton = screen.getByRole('button', { name: 'Náhľad importu' });
    expect(previewButton.hasAttribute('disabled')).toBe(true);
    await user.upload(screen.getByLabelText('Súbor'), new File(['inventory_number,latitude,longitude'], 'points.csv', { type: 'text/csv' }));
    expect(screen.getByRole('button', { name: 'Náhľad importu' }).hasAttribute('disabled')).toBe(false);
    await user.click(screen.getByRole('button', { name: 'Náhľad importu' }));

    expect(await screen.findByRole('heading', { name: 'Náhľad: points.csv' })).toBeTruthy();
    expect(screen.getByText('LP-1')).toBeTruthy();
    expect(screen.getByText('LP-1').closest('tr')?.textContent).toContain('create');
    expect(screen.getAllByRole('row')[2].textContent).toContain('error');
    expect(api.importPreview).toHaveBeenCalledWith(expect.any(File));
    const update = screen.getByRole('checkbox');
    expect((update as HTMLInputElement).checked).toBe(false);
    await user.click(update);
    await user.click(screen.getByRole('button', { name: 'Potvrdiť import' }));

    expect(api.importConfirm).toHaveBeenCalledWith('preview-1', true);
    expect(await screen.findByText(/Import bol zaradený do frontu ako dávka #48/)).toBeTruthy();
    expect(await screen.findByRole('heading', { name: 'Dávka #48: completed_with_errors' })).toBeTruthy();
    expect(await screen.findByText('Coordinates are outside the service area')).toBeTruthy();
    expect(api.getImportStatus).toHaveBeenCalledWith(48);
    expect(api.getImportRows).toHaveBeenCalledWith(48, { outcome: 'failed', limit: 50 });
  });

  it.each([
    [new Error('preview service failed'), 'preview service failed'],
    [{ reason: 'malformed' }, 'Náhľad zlyhal'],
  ])('shows a preview error without displaying stale preview data', async (failure, message) => {
    api.importPreview.mockRejectedValue(failure);
    const user = userEvent.setup();
    renderImport();
    await user.upload(screen.getByLabelText('Súbor'), new File(['bad'], 'bad.csv', { type: 'text/csv' }));
    await user.click(screen.getByRole('button', { name: 'Náhľad importu' }));

    expect(await screen.findByText(message)).toBeTruthy();
    expect(screen.queryByRole('heading', { name: /Náhľad:/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Náhľad importu' }).hasAttribute('disabled')).toBe(false);
  });

  it('restores preview from URL, sorts by a column, and keeps last good data on a refresh error', async () => {
    const user = userEvent.setup();
    renderImport('/panel-svietidla/import?preview=preview-1');
    expect(await screen.findByRole('heading', { name: 'Náhľad: points.csv' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Zoradiť podľa Inventárne č., vzostupne' }));
    await waitFor(() => expect(api.getImportPreviewRows).toHaveBeenCalledWith('preview-1', 1, 25, 'inventoryNumber', 'asc'));

    api.getImportPreviewRows.mockRejectedValueOnce(new Error('preview_expired'));
    await user.click(screen.getByRole('button', { name: 'Zmeniť zoradenie Inventárne č. na zostupné' }));
    expect(await screen.findByText('preview_expired')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Náhľad: points.csv' })).toBeTruthy();
  });

  it('clears an expired preview link that cannot be restored', async () => {
    api.getImportPreviewRows.mockRejectedValueOnce(new Error('preview_expired'));
    renderImport('/panel-svietidla/import?preview=preview-expired');

    expect(await screen.findByText('preview_expired')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: /Náhľad:/ })).toBeNull();
  });

  it('loads import status from the batch URL and safely renders an unavailable status', async () => {
    api.getImportStatus.mockRejectedValueOnce({ internal: 'not rendered' });
    renderImport('/panel-svietidla/import?batch=48');

    await waitFor(() => expect(screen.getByText('Stav importu sa nepodarilo načítať')).toBeTruthy());
    expect(screen.queryByText(/not rendered/)).toBeNull();
  });
});
