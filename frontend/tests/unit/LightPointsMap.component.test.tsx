// @vitest-environment jsdom
import type { PropsWithChildren } from 'react';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import type { LightPoint } from '../../src/types/lightPoint';
import type { MapEntryPosition } from '../../src/hooks/useMapEntryGeolocation';

const mocks = vi.hoisted(() => ({
  map: {
    setView: vi.fn(),
    getContainer: vi.fn(() => null),
  },
  getLightPoints: vi.fn(),
  throwMapRender: false,
}));

vi.mock('react-leaflet', () => ({
  MapContainer: ({ children, center, zoom, scrollWheelZoom: _scrollWheelZoom, ...props }: PropsWithChildren<Record<string, unknown>>) => {
    if (mocks.throwMapRender) throw new Error('Synthetic map render failure');
    return (
      <div {...props} data-testid="map-container" data-center={JSON.stringify(center)} data-zoom={zoom} data-scroll-wheel-zoom={String(_scrollWheelZoom)}>
        {children}
      </div>
    );
  },
  TileLayer: () => null,
  useMap: () => mocks.map,
  useMapEvents: () => mocks.map,
  Marker: () => null,
  Circle: () => null,
  Popup: ({ children }: PropsWithChildren) => <>{children}</>,
}));

vi.mock('../../src/hooks/usePrefersColorScheme', () => ({
  usePrefersColorScheme: () => 'light',
}));

vi.mock('../../src/services/lightPointsApi', () => ({
  getLightPoints: mocks.getLightPoints,
}));

vi.mock('../../src/components/LightPointsMap/DeviceLocationLayer', () => ({
  DeviceLocationLayer: ({ position }: { position: MapEntryPosition | null }) => position
    ? <span data-testid="device-location-marker">Device location marker</span>
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
    <ul aria-label="Synthetic map light points">
      {points.map((point) => (
        <li key={point.id}>
          <button type="button" onClick={(event) => onSelectPoint(point, event.currentTarget)}>
            {point.address}
          </button>
        </li>
      ))}
    </ul>
  ),
}));

vi.mock('../../src/components/LightPointsMap/MapCustomLocationLayer', () => ({
  MapCustomLocationLayer: ({ onMapClick }: { onMapClick: (lat: number, lng: number) => void }) => (
    <button type="button" onClick={() => onMapClick(48.7, 21.25)}>Synthetic map click</button>
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
    <MemoryRouter initialEntries={['/map']} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Routes>
        <Route path="/map" element={<LightPointsMap />} />
        <Route path="/report" element={<ReportProbe />} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  mocks.map.setView.mockReset();
  mocks.getLightPoints.mockReset();
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
  if (originalGeolocation) {
    Object.defineProperty(navigator, 'geolocation', originalGeolocation);
  } else {
    Reflect.deleteProperty(navigator, 'geolocation');
  }
});

describe('map-first target flow', () => {
  it('centers once on the entry-time device fix and renders it as a distinct marker', async () => {
    render(<MapTestRouter />);
    await waitFor(() => expect(geoSuccess).toBeDefined());
    await act(async () => geoSuccess?.(position()));

    await waitFor(() => expect(mocks.map.setView).toHaveBeenCalledWith(
      [48.7, 21.25],
      16,
      { animate: false }
    ));
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

    await waitFor(() => expect(screen.getByTestId('device-location-marker')).not.toBeNull());
    expect(mocks.map.setView).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog').textContent).toContain('Vami vybrané miesto na mape.');
  });

  it('does not let a late location callback move the map after manual target entry starts', async () => {
    const user = userEvent.setup();
    render(<MapTestRouter />);
    await waitFor(() => expect(geoSuccess).toBeDefined());
    await user.click(screen.getByLabelText('Zemepisná šírka'));
    await user.type(screen.getByLabelText('Zemepisná šírka'), '48.7');

    await act(async () => geoSuccess?.(position()));

    expect(mocks.map.setView).not.toHaveBeenCalled();
    expect(screen.getByTestId('device-location-marker')).not.toBeNull();
    expect((screen.getByLabelText('Zemepisná šírka') as HTMLInputElement).value).toBe('48.7');
  });

  it('keeps recenter as a camera-only action and does not create a target', async () => {
    const user = userEvent.setup();
    render(<MapTestRouter />);
    await waitFor(() => expect(geoSuccess).toBeDefined());
    await act(async () => geoSuccess?.(position()));
    await screen.findByTestId('device-location-marker');
    mocks.map.setView.mockClear();

    await user.click(screen.getByRole('button', { name: 'Moja poloha — vycentrovať mapu' }));

    expect(mocks.map.setView).toHaveBeenCalledWith([48.7, 21.25], 16, { animate: true });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByLabelText('Report navigation')).toBeNull();
  });

  it('confirms typed coordinates through ephemeral router state without a coordinate URL', async () => {
    const user = userEvent.setup();
    render(<MapTestRouter />);
    await user.type(screen.getByLabelText('Zemepisná šírka'), '48.7');
    await user.type(screen.getByLabelText('Zemepisná dĺžka'), '21.25');
    await user.click(screen.getByRole('button', { name: 'Použiť zadané miesto' }));
    expect(screen.getByRole('dialog').textContent).toContain('48.700000, 21.250000');
    await user.click(screen.getByRole('button', { name: 'Potvrdiť miesto' }));

    const route = JSON.parse(screen.getByLabelText('Report navigation').textContent ?? '{}');
    expect(route.pathname).toBe('/report');
    expect(route.search).toBe('');
    expect(route.state.reportTarget).toEqual({ kind: 'custom', latitude: 48.7, longitude: 21.25 });
  });

  it('preserves typed coordinates after cancelling and confirms only after a second explicit action', async () => {
    const user = userEvent.setup();
    render(<MapTestRouter />);
    const latitude = screen.getByLabelText('Zemepisná šírka') as HTMLInputElement;
    const longitude = screen.getByLabelText('Zemepisná dĺžka') as HTMLInputElement;
    await user.type(latitude, '48.7');
    await user.type(longitude, '21.25');
    await user.click(screen.getByRole('button', { name: 'Použiť zadané miesto' }));
    await user.keyboard('{Escape}');

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(latitude.value).toBe('48.7');
    expect(longitude.value).toBe('21.25');
    expect(document.activeElement?.textContent).toContain('Použiť zadané miesto');
  });

  it('keeps a manual form path when inventory data fails', async () => {
    mocks.getLightPoints.mockRejectedValue(new Error('Synthetic API failure'));
    const user = userEvent.setup();
    render(<MapTestRouter />);

    expect(await screen.findByRole('alert')).not.toBeNull();
    await user.click(screen.getByRole('button', { name: 'Pokračovať bez výberu bodu na mape' }));
    expect(screen.getByRole('dialog').textContent).toContain('Miesto zadáte ručne vo formulári.');
    await user.click(screen.getByRole('button', { name: 'Potvrdiť miesto' }));

    const route = JSON.parse(screen.getByLabelText('Report navigation').textContent ?? '{}');
    expect(route.state.reportTarget).toEqual({ kind: 'manual' });
  });

  it('keeps the non-map continuation when map rendering fails', async () => {
    mocks.throwMapRender = true;
    const reactErrorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    const user = userEvent.setup();
    render(<MapTestRouter />);

    const failureMessage = await screen.findByRole('alert');
    expect(failureMessage.textContent).toContain('Interaktívnu mapu sa nepodarilo zobraziť');
    await user.click(screen.getByRole('button', { name: 'Pokračovať bez výberu bodu na mape' }));
    await user.click(screen.getByRole('button', { name: 'Potvrdiť miesto' }));
    const route = JSON.parse(screen.getByLabelText('Report navigation').textContent ?? '{}');
    expect(route.state.reportTarget).toEqual({ kind: 'manual' });
    reactErrorLog.mockRestore();
  });

  it('selects a known point from the accessible point list and allows cancellation', async () => {
    const user = userEvent.setup();
    render(<MapTestRouter />);
    await user.click(await screen.findByRole('button', { name: /SYNTHETIC-1 · Synthetic Street/ }));
    expect(screen.getByRole('dialog').textContent).toContain('Synthetic Street');
    await user.click(screen.getByRole('button', { name: 'Zrušiť' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('button', { name: /SYNTHETIC-1 · Synthetic Street/ })).not.toBeNull();
  });

  it('explicitly selects device position as a target only through confirmation', async () => {
    const user = userEvent.setup();
    render(<MapTestRouter />);
    await waitFor(() => expect(geoSuccess).toBeDefined());
    await act(async () => geoSuccess?.(position()));
    await screen.findByTestId('device-location-marker');
    await user.click(screen.getByRole('button', { name: 'Vybrať polohu zariadenia ako cieľ hlásenia' }));
    expect(screen.getByRole('dialog').textContent).toContain('až po tomto potvrdení');
    await user.click(screen.getByRole('button', { name: 'Potvrdiť miesto' }));
    const route = JSON.parse(screen.getByLabelText('Report navigation').textContent ?? '{}');
    expect(route.state.reportTarget.kind).toBe('device');
  });
});
