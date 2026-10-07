// @vitest-environment jsdom
import type { PropsWithChildren } from 'react';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import type { LightPoint } from '../../src/types/lightPoint';
import type { MapEntryPosition } from '../../src/hooks/useMapEntryGeolocation';
import { ReportFormLocaleProvider } from '../../src/context/ReportFormLocaleContext';

const mocks = vi.hoisted(() => ({
  map: {
    setView: vi.fn(),
    getContainer: vi.fn(() => null),
  },
  getLightPoints: vi.fn(),
  setColorScheme: vi.fn(),
  throwMapRender: false,
}));

vi.mock('react-leaflet', () => ({
  MapContainer: ({ children, center, zoom, scrollWheelZoom: _scrollWheelZoom, zoomControl: _zoomControl, ...props }: PropsWithChildren<Record<string, unknown>>) => {
    if (mocks.throwMapRender) throw new Error('Synthetic map render failure');
    return (
      <div {...props} data-testid="map-container" data-center={JSON.stringify(center)} data-zoom={zoom} data-scroll-wheel-zoom={String(_scrollWheelZoom)}>
        {children}
      </div>
    );
  },
  TileLayer: () => null,
  ZoomControl: ({ zoomInTitle, zoomOutTitle }: { zoomInTitle?: string; zoomOutTitle?: string }) => (
    <div data-testid="zoom-control">
      <button type="button" aria-label={zoomInTitle}>+</button>
      <button type="button" aria-label={zoomOutTitle}>−</button>
    </div>
  ),
  useMap: () => mocks.map,
  useMapEvents: () => mocks.map,
  Marker: () => null,
  Circle: () => null,
  Popup: ({ children }: PropsWithChildren) => <>{children}</>,
}));

vi.mock('../../src/hooks/usePrefersColorScheme', () => ({
  usePrefersColorScheme: () => ['light', mocks.setColorScheme],
}));

vi.mock('../../src/services/lightPointsApi', () => ({
  getLightPoints: mocks.getLightPoints,
}));

vi.mock('../../src/components/LightPointsMap/DeviceLocationLayer', () => ({
  DeviceLocationLayer: ({ position, alt, onSelect }: {
    position: MapEntryPosition | null;
    alt: string;
    onSelect: (trigger?: HTMLElement | null) => void;
  }) => position
    ? <button type="button" aria-label={alt} data-testid="device-location-marker" onClick={(event) => onSelect(event.currentTarget)}>Device marker</button>
    : null,
}));

vi.mock('../../src/components/LightPointsMap/MarkerClusterLayer', () => ({
  MarkerClusterLayer: ({
    points,
    onSelectPoint,
  }: {
    points: LightPoint[];
    onSelectPoint: (point: LightPoint, trigger: HTMLElement) => void;
  }) => (
    <>
      {points.map((point) => (
        <button key={point.id} type="button" aria-label={`Synthetic map marker ${point.address}`} onClick={(event) => onSelectPoint(point, event.currentTarget)}>
          {point.inventory_number}
        </button>
      ))}
    </>
  ),
}));

vi.mock('../../src/components/LightPointsMap/MapCustomLocationLayer', () => ({
  MapCustomLocationLayer: ({
    onMapClick,
    selection,
  }: {
    onMapClick: (lat: number, lng: number) => void;
    selection: { latitude: number; longitude: number } | null;
  }) => (
    <>
      <button type="button" onClick={() => onMapClick(48.7, 21.25)}>Synthetic map click</button>
      {selection && <div data-testid="custom-location-marker" />}
    </>
  ),
}));

import { LightPointsMap } from '../../src/components/LightPointsMap/LightPointsMap';

const originalGeolocation = Object.getOwnPropertyDescriptor(navigator, 'geolocation');
let geoSuccess: PositionCallback | undefined;

function setGeolocation(implementation: Geolocation['getCurrentPosition'] | undefined) {
  Object.defineProperty(navigator, 'geolocation', {
    configurable: true,
    value: implementation ? { getCurrentPosition: implementation } : undefined,
  });
}

function syntheticPoint(): LightPoint {
  return {
    id: 1,
    inventory_number: 'SYNTHETIC-1',
    latitude: 48.71,
    longitude: 21.26,
    address: 'Synthetic Street',
    type: 'LED',
    status: 'active',
  };
}

function position(latitude = 48.7, longitude = 21.25): GeolocationPosition {
  return {
    coords: {
      latitude,
      longitude,
      accuracy: 15,
      altitude: null,
      altitudeAccuracy: null,
      heading: null,
      speed: null,
      toJSON: () => ({}),
    },
    timestamp: 1_791_200_000_000,
    toJSON: () => ({}),
  };
}

function ReportProbe() {
  const location = useLocation();
  return (
    <output aria-label="Report navigation">
      {JSON.stringify({ pathname: location.pathname, search: location.search, state: location.state })}
    </output>
  );
}

function MapTestRouter() {
  return (
    <ReportFormLocaleProvider>
      <MemoryRouter initialEntries={['/map']} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Routes>
          <Route path="/map" element={<LightPointsMap />} />
          <Route path="/report" element={<ReportProbe />} />
        </Routes>
      </MemoryRouter>
    </ReportFormLocaleProvider>
  );
}

beforeEach(() => {
  sessionStorage.clear();
  mocks.map.setView.mockReset();
  mocks.getLightPoints.mockReset();
  mocks.setColorScheme.mockReset();
  mocks.throwMapRender = false;
  mocks.getLightPoints.mockResolvedValue([syntheticPoint()]);
  geoSuccess = undefined;
  setGeolocation((success) => {
    geoSuccess = success;
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  sessionStorage.clear();
  if (originalGeolocation) {
    Object.defineProperty(navigator, 'geolocation', originalGeolocation);
  } else {
    Reflect.deleteProperty(navigator, 'geolocation');
  }
});

describe('map-first target flow', () => {
  it('keeps a fullscreen map-first layout with no permanent recorded-point list', async () => {
    render(<MapTestRouter />);
    await screen.findByRole('button', { name: 'Synthetic map marker Synthetic Street' });

    expect(screen.getByRole('region', { name: 'Mapa Košíc a evidovaných svetelných bodov' })).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Slovenčina' })).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Angličtina' })).not.toBeNull();
    expect(screen.getByRole('button', { name: /Vycentrovať mapu/ })).not.toBeNull();
    expect(screen.getByText('Vyberte evidovaný svetelný bod alebo kliknite na mapu a označte vlastné miesto.')).not.toBeNull();
    expect(screen.queryByText(/Ako sa používa poloha a text|How location and text are used/)).toBeNull();
    expect(document.querySelector('details')).toBeNull();
    expect(screen.queryByLabelText(/Zemepisná šírka|Zemepisná dĺžka/)).toBeNull();
    expect(screen.queryByRole('button', { name: /Evidované svetelné body/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Recorded light points/ })).toBeNull();
    expect(screen.queryByText('Evidované svetelné body (1)')).toBeNull();
    expect(screen.queryByText('Recorded light points (1)')).toBeNull();
    expect(screen.queryByRole('list', { name: /svetelné body/i })).toBeNull();
  });

  it('keeps the Košice view stable while making the entry-time device fix available for explicit selection', async () => {
    render(<MapTestRouter />);
    await waitFor(() => expect(geoSuccess).toBeDefined());
    await act(async () => geoSuccess?.(position()));

    expect(mocks.map.setView).not.toHaveBeenCalled();
    expect(screen.getByTestId('device-location-marker')).not.toBeNull();
    expect(screen.getByTestId('map-container').getAttribute('data-center')).toBe('[48.7164,21.2611]');
  });

  it('does not let a late geolocation result recenter over a newer custom map selection', async () => {
    const user = userEvent.setup();
    render(<MapTestRouter />);
    await waitFor(() => expect(geoSuccess).toBeDefined());
    await user.click(screen.getByRole('button', { name: 'Synthetic map click' }));
    expect(screen.getByRole('dialog').textContent).toContain('48.700000, 21.250000');

    await act(async () => geoSuccess?.(position()));

    expect(screen.getByTestId('device-location-marker')).not.toBeNull();
    expect(mocks.map.setView).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog').textContent).toContain('Vami vybrané miesto na mape.');
  });

  it('offers a recenter control but keeps it disabled until the privacy/provider gate is approved', async () => {
    const user = userEvent.setup();
    render(<MapTestRouter />);
    await waitFor(() => expect(geoSuccess).toBeDefined());
    await act(async () => geoSuccess?.(position()));
    await screen.findByTestId('device-location-marker');
    mocks.map.setView.mockClear();

    const recenter = screen.getByRole('button', { name: 'Vycentrovať mapu na polohu zariadenia' }) as HTMLButtonElement;
    expect(recenter.disabled).toBe(true);
    expect(recenter.title).toContain('vypnuté do schválenia');
    await user.click(recenter);
    expect(mocks.map.setView).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByLabelText('Report navigation')).toBeNull();
  });

  it('confirms a custom map click before navigating to the report form', async () => {
    const user = userEvent.setup();
    render(<MapTestRouter />);
    await user.click(screen.getByRole('button', { name: 'Synthetic map click' }));
    expect(screen.getByRole('dialog').textContent).toContain('48.700000, 21.250000');
    await user.click(screen.getByRole('button', { name: 'Potvrdiť miesto' }));

    const route = JSON.parse(screen.getByLabelText('Report navigation').textContent ?? '{}');
    expect(route.pathname).toBe('/report');
    expect(route.search).toBe('');
    expect(route.state.reportTarget).toEqual({ kind: 'custom', latitude: 48.7, longitude: 21.25 });
  });

  it('hides and resumes a custom-location confirmation without losing the candidate across a language switch', async () => {
    const user = userEvent.setup();
    render(<MapTestRouter />);
    await user.click(screen.getByRole('button', { name: 'Synthetic map click' }));

    expect(screen.getByRole('dialog').textContent).toContain('48.700000, 21.250000');
    await user.click(screen.getByRole('button', { name: 'Skryť a prezrieť mapu' }));

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByTestId('custom-location-marker')).not.toBeNull();
    expect(screen.getByText(/Vybrané miesto zostáva označené/)).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Pokračovať s vybraným miestom' })).not.toBeNull();

    await user.click(screen.getByRole('button', { name: 'Angličtina' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByTestId('custom-location-marker')).not.toBeNull();
    const resume = screen.getByRole('button', { name: 'Continue with selected location' });
    resume.focus();
    expect(document.activeElement).toBe(resume);
    await user.keyboard('{Enter}');

    expect(screen.getByRole('dialog', { name: 'Confirm report location' }).textContent).toContain('Location selected on the map.');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Confirm location' }));
    await user.click(screen.getByRole('button', { name: 'Confirm location' }));
    const route = JSON.parse(screen.getByLabelText('Report navigation').textContent ?? '{}');
    expect(route.state.reportTarget).toEqual({ kind: 'custom', latitude: 48.7, longitude: 21.25 });
  });

  it('cancelling a custom target clears its temporary candidate marker and stays on the map', async () => {
    const user = userEvent.setup();
    render(<MapTestRouter />);
    await user.click(screen.getByRole('button', { name: 'Synthetic map click' }));
    expect(screen.getByTestId('custom-location-marker')).not.toBeNull();
    await user.click(screen.getByRole('button', { name: 'Zrušiť' }));

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByTestId('custom-location-marker')).toBeNull();
    expect(screen.queryByLabelText('Report navigation')).toBeNull();
  });

  it('cancels the manual fallback and restores focus without changing the report target', async () => {
    const user = userEvent.setup();
    render(<MapTestRouter />);
    const continueButton = screen.getByRole('button', { name: 'Pokračovať bez výberu bodu na mape' });
    continueButton.focus();
    await user.click(continueButton);
    expect(screen.getByRole('dialog').textContent).toContain('Miesto zadáte ručne vo formulári.');
    await user.keyboard('{Escape}');

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(continueButton);
    expect(screen.queryByLabelText('Report navigation')).toBeNull();
  });

  it('keeps a manual report path when inventory data fails', async () => {
    mocks.getLightPoints.mockRejectedValue(new Error('Synthetic API failure'));
    const user = userEvent.setup();
    render(<MapTestRouter />);

    const warning = await screen.findByText('Evidované svetelné body sú momentálne nedostupné. Miesto môžete označiť priamo na mape.');
    expect(warning.getAttribute('role')).toBe('status');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText(/Vybrať evidovaný svetelný bod/)).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Synthetic map click' }));
    expect(screen.getByRole('dialog').textContent).toContain('48.700000, 21.250000');
    await user.click(screen.getByRole('button', { name: 'Zrušiť' }));
    await user.click(screen.getByRole('button', { name: 'Pokračovať bez výberu bodu na mape' }));
    await user.click(screen.getByRole('button', { name: 'Potvrdiť miesto' }));

    const route = JSON.parse(screen.getByLabelText('Report navigation').textContent ?? '{}');
    expect(route.state.reportTarget).toEqual({ kind: 'manual' });
  });

  it('keeps the non-map continuation when map rendering fails', async () => {
    mocks.throwMapRender = true;
    const reactErrorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    const user = userEvent.setup();
    render(<MapTestRouter />);

    expect((await screen.findAllByRole('alert')).some((alert) =>
      alert.textContent?.includes('Mapu sa nepodarilo zobraziť')
    )).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Pokračovať bez výberu bodu na mape' }));
    await user.click(screen.getByRole('button', { name: 'Potvrdiť miesto' }));
    const route = JSON.parse(screen.getByLabelText('Report navigation').textContent ?? '{}');
    expect(route.state.reportTarget).toEqual({ kind: 'manual' });
    reactErrorLog.mockRestore();
  });

  it('selects a known marker through confirmation and permits cancellation', async () => {
    const user = userEvent.setup();
    render(<MapTestRouter />);
    await user.click(await screen.findByRole('button', { name: 'Synthetic map marker Synthetic Street' }));
    expect(screen.getByRole('dialog').textContent).toContain('Synthetic Street');
    await user.click(screen.getByRole('button', { name: 'Zrušiť' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('button', { name: 'Synthetic map marker Synthetic Street' })).not.toBeNull();
  });

  it('selects the device position as a target only after explicit confirmation', async () => {
    const user = userEvent.setup();
    render(<MapTestRouter />);
    await waitFor(() => expect(geoSuccess).toBeDefined());
    await act(async () => geoSuccess?.(position()));
    const marker = await screen.findByRole('button', { name: /Poloha zariadenia — vybrať ako cieľ/ });
    await user.click(marker);
    expect(screen.getByRole('dialog').textContent).toContain('až po tomto potvrdení');
    await user.click(screen.getByRole('button', { name: 'Potvrdiť miesto' }));
    const route = JSON.parse(screen.getByLabelText('Report navigation').textContent ?? '{}');
    expect(route.state.reportTarget.kind).toBe('device');
  });

  it('allows hiding and resuming device-target confirmation without navigation', async () => {
    const user = userEvent.setup();
    render(<MapTestRouter />);
    await waitFor(() => expect(geoSuccess).toBeDefined());
    await act(async () => geoSuccess?.(position()));
    await user.click(await screen.findByTestId('device-location-marker'));
    await user.click(screen.getByRole('button', { name: 'Skryť a prezrieť mapu' }));

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByTestId('device-location-marker')).not.toBeNull();
    await user.click(screen.getByRole('button', { name: 'Pokračovať s vybraným miestom' }));
    expect(screen.getByRole('dialog')).not.toBeNull();
    await user.click(screen.getByRole('button', { name: 'Zrušiť' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByLabelText('Report navigation')).toBeNull();
  });

  it('switches shared locale and map theme without recentering or changing route state', async () => {
    const user = userEvent.setup();
    render(<MapTestRouter />);
    const map = screen.getByRole('region');
    const initialCenter = screen.getByTestId('map-container').getAttribute('data-center');

    await user.click(screen.getByRole('button', { name: 'Angličtina' }));
    expect(map.getAttribute('aria-label')).toBe('Map of Košice and recorded street lights');
    expect(screen.getByRole('button', { name: 'Continue without selecting a point on the map' })).not.toBeNull();
    await user.click(screen.getByRole('button', { name: /Switch map theme/ }));

    expect(mocks.setColorScheme).toHaveBeenCalledWith('dark');
    expect(mocks.map.setView).not.toHaveBeenCalled();
    expect(screen.getByTestId('map-container').getAttribute('data-center')).toBe(initialCenter);
    expect(screen.queryByLabelText('Report navigation')).toBeNull();
  });
});
