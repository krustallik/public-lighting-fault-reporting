// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { AdminSettingsPage } from '@admin/pages/AdminSettingsPage/AdminSettingsPage';

const { getIntegrationSettings } = vi.hoisted(() => ({ getIntegrationSettings: vi.fn() }));
vi.mock('@admin/services/adminApi', () => ({ adminApi: { getIntegrationSettings } }));

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('AdminSettingsPage', () => {
  it('shows loading then the server-provided integration settings and field mapping', async () => {
    getIntegrationSettings.mockResolvedValue({
      baseUrl: 'https://example.invalid', testMode: true, submitLocales: ['sk', 'en'],
      apiKeyConfigured: false, fieldMapping: { subject: 'reported_object', description: 'additional_info' },
    });
    render(<AdminSettingsPage />);

    expect(screen.getByText('Načítavam…')).toBeTruthy();
    await screen.findByRole('heading', { name: 'Nastavenia integrácie' });
    expect(screen.getByText('https://example.invalid')).toBeTruthy();
    expect(screen.getAllByText('Áno')).toHaveLength(1);
    expect(screen.getAllByText('Nie')).toHaveLength(1);
    expect(screen.getByText('sk, en')).toBeTruthy();
    expect(screen.getByText('additional_info').closest('tr')?.textContent).toContain('description');
  });

  it('renders false settings instead of treating them as absent', async () => {
    getIntegrationSettings.mockResolvedValue({
      baseUrl: '', testMode: false, submitLocales: [], apiKeyConfigured: false, fieldMapping: {},
    });
    render(<AdminSettingsPage />);

    await waitFor(() => expect(screen.getAllByText('Nie')).toHaveLength(2));
    expect(screen.getByRole('heading', { name: 'Mapovanie polí (multipart/form-data)' })).toBeTruthy();
  });

  it.each([
    [new Error('settings unavailable'), 'settings unavailable'],
    [{ reason: 'unknown' }, 'Načítanie zlyhalo'],
  ])('shows a safe error when settings cannot be loaded', async (error, message) => {
    getIntegrationSettings.mockRejectedValue(error);
    render(<AdminSettingsPage />);
    await waitFor(() => expect(screen.getByText(message)).toBeTruthy());
    expect(screen.queryByRole('heading', { name: 'Nastavenia integrácie' })).toBeNull();
  });
});
