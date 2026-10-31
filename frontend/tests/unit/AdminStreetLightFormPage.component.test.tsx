// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { AdminStreetLightFormPage } from '@admin/pages/AdminStreetLightFormPage/AdminStreetLightFormPage';

const { api } = vi.hoisted(() => ({ api: {
  getStreetLight: vi.fn(), createStreetLight: vi.fn(), updateStreetLight: vi.fn(),
} }));
vi.mock('@admin/services/adminApi', () => ({ adminApi: api }));

afterEach(() => { cleanup(); vi.clearAllMocks(); });

const light = {
  id: 19, inventory_number: 'SYN-LP-19', external_id: null,
  latitude: '48.7164', longitude: '21.2611', address: null, district: 'Košice',
  lamp_type: null, status: 'active' as const,
  created_at: '2026-10-01T10:00:00.000Z', updated_at: '2026-10-01T10:00:00.000Z',
};

function LocationProbe() {
  const location = useLocation();
  return <output aria-label="Aktuálna URL">{location.pathname}</output>;
}

function renderForm(path = '/panel-svietidla/street-lights/new') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <LocationProbe />
      <Routes>
        <Route path="/panel-svietidla/street-lights/new" element={<AdminStreetLightFormPage />} />
        <Route path="/panel-svietidla/street-lights/:id/edit" element={<AdminStreetLightFormPage />} />
        <Route path="/panel-svietidla/street-lights/:id" element={<p>Detail svetelného bodu</p>} />
      </Routes>
    </MemoryRouter>
  );
}

async function fillValidForm(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText('Inventárne číslo *'), 'SYN-NEW-1');
  await user.clear(screen.getByLabelText('Zemepisná šírka *'));
  await user.type(screen.getByLabelText('Zemepisná šírka *'), '48.7164');
  await user.clear(screen.getByLabelText('Zemepisná dĺžka *'));
  await user.type(screen.getByLabelText('Zemepisná dĺžka *'), '21.2611');
}

describe('AdminStreetLightFormPage', () => {
  beforeEach(() => {
    api.getStreetLight.mockResolvedValue(light);
    api.createStreetLight.mockResolvedValue({ ...light, id: 20 });
    api.updateStreetLight.mockResolvedValue(light);
  });

  it('blocks an invalid create and shows validation for required inventory and coordinate fields', async () => {
    const user = userEvent.setup();
    renderForm();
    await user.click(screen.getByRole('button', { name: 'Uložiť' }));
    expect(await screen.findByText('Inventárne číslo je povinné')).toBeTruthy();
    expect(screen.getAllByText('Zadajte platnú zemepisnú šírku').length).toBe(1);
    expect(screen.getAllByText('Zadajte platnú zemepisnú dĺžku').length).toBe(1);
    expect(api.createStreetLight).not.toHaveBeenCalled();
  });

  it('creates a validated inventory record and routes to its detail', async () => {
    const user = userEvent.setup();
    renderForm();
    await fillValidForm(user);
    await user.type(screen.getByLabelText('Adresa / ulica'), 'Jarná 12');
    await user.selectOptions(screen.getByLabelText('Technický stav'), 'maintenance');
    await user.click(screen.getByRole('button', { name: 'Uložiť' }));

    await waitFor(() => expect(api.createStreetLight).toHaveBeenCalledWith(expect.objectContaining({
      inventoryNumber: 'SYN-NEW-1', latitude: 48.7164, longitude: 21.2611,
      address: 'Jarná 12', status: 'maintenance',
    })));
    expect(await screen.findByText('Detail svetelného bodu')).toBeTruthy();
    expect(screen.getByLabelText('Aktuálna URL').textContent).toBe('/panel-svietidla/street-lights/20');
  });

  it('loads a nullable inventory record, preserves existing fields, and saves edits', async () => {
    const user = userEvent.setup();
    renderForm('/panel-svietidla/street-lights/19/edit');
    expect((await screen.findByLabelText('Inventárne číslo *') as HTMLInputElement).value).toBe('SYN-LP-19');
    expect((screen.getByLabelText('Externé ID (nepovinné)') as HTMLInputElement).value).toBe('');
    expect((screen.getByLabelText('Adresa / ulica') as HTMLInputElement).value).toBe('');
    await user.clear(screen.getByLabelText('Inventárne číslo *'));
    await user.type(screen.getByLabelText('Inventárne číslo *'), 'SYN-LP-19-EDIT');
    await user.click(screen.getByRole('button', { name: 'Uložiť' }));

    await waitFor(() => expect(api.updateStreetLight).toHaveBeenCalledWith(19, expect.objectContaining({
      inventoryNumber: 'SYN-LP-19-EDIT', latitude: 48.7164, longitude: 21.2611,
    })));
    expect(await screen.findByText('Detail svetelného bodu')).toBeTruthy();
  });

  it.each([
    [new Error('Inventory read failed'), 'Inventory read failed'],
    [{ status: 503 }, 'Načítanie zlyhalo'],
  ])('renders a load failure without exposing an editable partial record', async (failure, message) => {
    api.getStreetLight.mockRejectedValueOnce(failure);
    renderForm('/panel-svietidla/street-lights/19/edit');
    expect(await screen.findByText(message)).toBeTruthy();
    expect(screen.queryByRole('form')).toBeNull();
    expect(api.updateStreetLight).not.toHaveBeenCalled();
  });

  it.each([
    [new Error('Inventory write conflict'), 'Inventory write conflict'],
    [{ status: 503 }, 'Uloženie zlyhalo'],
  ])('keeps the form available and reports a safe write error', async (failure, message) => {
    api.createStreetLight.mockRejectedValueOnce(failure);
    const user = userEvent.setup();
    renderForm();
    await fillValidForm(user);
    await user.click(screen.getByRole('button', { name: 'Uložiť' }));
    expect(await screen.findByText(message)).toBeTruthy();
    expect(screen.getByLabelText('Inventárne číslo *')).toBeTruthy();
    expect(screen.getByLabelText('Aktuálna URL').textContent).toBe('/panel-svietidla/street-lights/new');
  });
});
