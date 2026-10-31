// @vitest-environment jsdom
import type { PropsWithChildren } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import type { LightPoint } from '@/types/lightPoint';
import type { MapEntryPosition } from '@/hooks/useMapEntryGeolocation';
import { ReportFormLocaleProvider } from '@/context/ReportFormLocaleContext';

const mocks = vi.hoisted(() => ({
  map: {
    setView: vi.fn(),
    getContainer: vi.fn(() => null),
    getBoundsZoom: vi.fn(() => 14),
    setMinZoom: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
  },
  getLightPoints: vi.fn(),
  validateReportTargetLocation: vi.fn(),
  setColorScheme: vi.fn(),
  throwMapRender: false,
}));

vi.mock('react-leaflet', () => ({
  MapContainer: ({ children, center, zoom, maxZoom, maxBounds, maxBoundsViscosity, scrollWheelZoom: _scrollWheelZoom, zoomControl: _zoomControl, ...props }: PropsWithChildren<Record<string, unknown>>) => {
    if (mocks.throwMapRender) throw new Error('Synthetic map render failure');
    return (
      <div {...props} data-testid="map-container" data-center={JSON.stringify(center)} data-zoom={zoom} data-max-zoom={maxZoom} data-max-bounds={JSON.stringify(maxBounds)} data-max-bounds-viscosity={maxBoundsViscosity} data-scroll-wheel-zoom={String(_scrollWheelZoom)}>
        {children}
      </div>
    );
  },
  TileLayer: ({ eventHandlers }: { eventHandlers?: { loading?: () => void; tileload?: () => void; tileerror?: () => void; load?: () => void } }) => (
    <>
      <button data-testid="tiles-start" onClick={() => eventHandlers?.loading?.()} />
      <button data-testid="tile-load" onClick={() => eventHandlers?.tileload?.()} />
      <button data-testid="tile-error" onClick={() => eventHandlers?.tileerror?.()} />
      <button data-testid="tiles-complete" onClick={() => eventHandlers?.load?.()} />
    </>
  ),
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

vi.mock('@/hooks/usePrefersColorScheme', () => ({
  usePrefersColorScheme: () => ['light', mocks.setColorScheme],
}));

vi.mock('@/services/lightPointsApi', () => ({
  getLightPoints: mocks.getLightPoints,
}));

vi.mock('@/services/reportTargetValidationApi', () => ({
  validateReportTargetLocation: mocks.validateReportTargetLocation,
  ReportTargetValidationError: class ReportTargetValidationError extends Error {
    constructor(readonly code: string) {
      super('Report location could not be validated');
    }
  },
}));

vi.mock('@/components/LightPointsMap/DeviceLocationLayer', () => ({
  DeviceLocationLayer: ({ position, alt, onSelect }: {
    position: MapEntryPosition | null;
    alt: string;
    onSelect: (trigger?: HTMLElement | null) => void;
  }) => position
    ? <button type="button" aria-label={alt} data-testid="device-location-marker" onClick={(event) => onSelect(event.currentTarget)}>Device marker</button>
    : null,
}));

vi.mock('@/components/LightPointsMap/MarkerClusterLayer', () => ({
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

vi.mock('@/components/LightPointsMap/MapCustomLocationLayer', () => ({
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

import { LightPointsMap } from '@/components/LightPointsMap/LightPointsMap';
import { KOSICE_MAP_BOUNDS } from '@/config/kosiceMapBounds';
import { ReportTargetValidationError } from '@/services/reportTargetValidationApi';

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
      <MemoryRouter initialEntries={['/map']}>
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
  localStorage.clear();
  vi.stubEnv('VITE_MAP_TILE_PROVIDER', 'synthetic');
  vi.stubEnv('VITE_ALLOW_DEVICE_MAP_RECENTER', 'true');
  mocks.map.setView.mockReset();
  mocks.map.getBoundsZoom.mockReset();
  mocks.map.getBoundsZoom.mockReturnValue(14);
  mocks.map.setMinZoom.mockReset();
  mocks.map.on.mockReset();
  mocks.map.off.mockReset();
  mocks.getLightPoints.mockReset();
  mocks.validateReportTargetLocation.mockReset();
  mocks.validateReportTargetLocation.mockResolvedValue(undefined);
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
  vi.unstubAllEnvs();
  sessionStorage.clear();
  localStorage.clear();
  if (originalGeolocation) {
    Object.defineProperty(navigator, 'geolocation', originalGeolocation);
  } else {
    Reflect.deleteProperty(navigator, 'geolocation');
  }
});

describe('map-first target flow', () => {
  it('caps interactive map zoom at the raster provider tile maximum', async () => {
    vi.stubEnv('VITE_MAP_TILE_PROVIDER', 'carto');
    vi.stubEnv('VITE_CARTO_TILES_APPROVED', 'true');
    vi.stubEnv('VITE_CARTO_PUBLIC_KEY', 'synthetic-public-key');
    render(<MapTestRouter />);

    // The configured CARTO key was observed to return no tiles at z19; keeping
    // the map and tile layer capped at z18 prevents the gray close-zoom state.
    expect(screen.getByTestId('map-container').getAttribute('data-max-zoom')).toBe('18');
  });

  it('constrains panning and zoom-out to the Košice boundary extent for the current viewport', async () => {
    render(<MapTestRouter />);

    const mapContainer = screen.getByTestId('map-container');
    expect(JSON.parse(mapContainer.getAttribute('data-max-bounds') ?? 'null')).toEqual(KOSICE_MAP_BOUNDS);
    expect(mapContainer.getAttribute('data-max-bounds-viscosity')).toBe('1');
    await waitFor(() => expect(mocks.map.getBoundsZoom).toHaveBeenCalledWith(KOSICE_MAP_BOUNDS, true));
    expect(mocks.map.setMinZoom).toHaveBeenNthCalledWith(1, 0);
    expect(mocks.map.setMinZoom).toHaveBeenNthCalledWith(2, 14);
    expect(mocks.map.on).toHaveBeenCalledWith('resize', expect.any(Function));

    const resizeListener = mocks.map.on.mock.calls.find(([eventName]) => eventName === 'resize')?.[1] as (() => void) | undefined;
    expect(resizeListener).toBeTypeOf('function');
    mocks.map.getBoundsZoom.mockReturnValue(12);
    act(() => resizeListener?.());
    expect(mocks.map.setMinZoom).toHaveBeenNthCalledWith(3, 0);
    expect(mocks.map.setMinZoom).toHaveBeenNthCalledWith(4, 12);
  });

  it('does not expose CARTO tile counters and keeps the map usable when some tiles fail', async () => {
    vi.stubEnv('VITE_LIVE_PROVIDER_UAT', 'true');
    vi.stubEnv('VITE_MAP_TILE_PROVIDER', 'carto');
    vi.stubEnv('VITE_CARTO_TILES_APPROVED', 'true');
    vi.stubEnv('VITE_CARTO_PUBLIC_KEY', 'synthetic-public-key');
    render(<MapTestRouter />);

    expect(screen.queryByText(/CARTO: od otvorenia mapy načítaných/)).toBeNull();
    expect(screen.queryByTestId('live-tile-status')).toBeNull();
    fireEvent.click(screen.getByTestId('tiles-start'));
    fireEvent.click(screen.getByTestId('tile-load'));
    fireEvent.click(screen.getByTestId('tile-error'));
    fireEvent.click(screen.getByTestId('tiles-complete'));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByTestId('map-controls-bottom')).not.toBeNull();
    expect(screen.queryByText(/OpenStreetMap a CARTO|OpenStreetMap and CARTO/)).toBeNull();
  });

  it('offers the manual report when a later zoom batch has no successful tiles', async () => {
    render(<MapTestRouter />);

    fireEvent.click(screen.getByTestId('tiles-start'));
    fireEvent.click(screen.getByTestId('tile-load'));
    fireEvent.click(screen.getByTestId('tiles-complete'));
    expect(screen.queryByRole('heading', { name: 'Mapa momentálne nie je dostupná' })).toBeNull();

    fireEvent.click(screen.getByTestId('tiles-start'));
    fireEvent.click(screen.getByTestId('tiles-complete'));

    expect(await screen.findByRole('heading', { name: 'Mapa momentálne nie je dostupná' })).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'Pokračovať bez výberu bodu na mape' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Otvoriť formulár a zadať miesto ručne' })).not.toBeNull();
  });

  it('keeps CARTO diagnostics out of the explicit local UAT production build', () => {
    vi.stubEnv('DEV', false);
    vi.stubEnv('VITE_LIVE_PROVIDER_UAT', 'true');
    vi.stubEnv('VITE_MAP_TILE_PROVIDER', 'carto');
    vi.stubEnv('VITE_CARTO_TILES_APPROVED', 'true');
    vi.stubEnv('VITE_CARTO_PUBLIC_KEY', 'synthetic-public-key');
    render(<MapTestRouter />);

    expect(screen.queryByTestId('live-tile-status')).toBeNull();
    expect(screen.queryByText(/CARTO: od otvorenia mapy načítaných/)).toBeNull();
  });

  it('keeps a fullscreen map-first layout with no permanent recorded-point list', async () => {
    render(<MapTestRouter />);
    await screen.findByRole('button', { name: 'Synthetic map marker Synthetic Street' });

    expect(screen.getByRole('region', { name: 'Mapa Košíc a evidovaných svetelných bodov' })).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Slovenčina' })).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Angličtina' })).not.toBeNull();
    const recenter = screen.getByRole('button', { name: /Vycentrovať mapu/ });
    expect(recenter.textContent).toContain('Moja poloha');
    expect(recenter.className).toContain('recenterButton');
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

  it('keeps recenter disabled when config is false and uses neutral availability wording', async () => {
    vi.stubEnv('VITE_MAP_TILE_PROVIDER', 'synthetic');
    vi.stubEnv('VITE_ALLOW_DEVICE_MAP_RECENTER', 'false');
    const user = userEvent.setup();
    render(<MapTestRouter />);
    await waitFor(() => expect(geoSuccess).toBeDefined());
    await act(async () => geoSuccess?.(position()));
    await screen.findByTestId('device-location-marker');
    mocks.map.setView.mockClear();

    const recenter = screen.getByRole('button', { name: 'Vycentrovať mapu na polohu zariadenia' }) as HTMLButtonElement;
    expect(recenter.disabled).toBe(true);
    expect(recenter.title).toBe('Vycentrovanie podľa polohy zariadenia momentálne nie je dostupné.');
    await user.click(recenter);
    expect(mocks.map.setView).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByLabelText('Report navigation')).toBeNull();
  });

  it('re-centers the viewport only and preserves an existing custom-location candidate', async () => {
    vi.stubEnv('VITE_MAP_TILE_PROVIDER', 'synthetic');
    vi.stubEnv('VITE_ALLOW_DEVICE_MAP_RECENTER', 'true');
    const user = userEvent.setup();
    render(<MapTestRouter />);
    await user.click(screen.getByRole('button', { name: 'Synthetic map click' }));
    expect(screen.getByRole('dialog').textContent).toContain('48.700000, 21.250000');
    await waitFor(() => expect(geoSuccess).toBeDefined());
    await act(async () => geoSuccess?.(position(48.7164, 21.2611)));

    const recenter = screen.getByRole('button', { name: 'Vycentrovať mapu na polohu zariadenia' }) as HTMLButtonElement;
    expect(recenter.disabled).toBe(false);
    await user.click(recenter);

    expect(mocks.map.setView).toHaveBeenCalledWith([48.7164, 21.2611], expect.any(Number), { animate: false });
    expect(screen.getByRole('dialog').textContent).toContain('48.700000, 21.250000');
    expect(screen.getByRole('region', { name: 'Mapa Košíc a evidovaných svetelných bodov' })).not.toBeNull();
  });

  it('retries device geolocation from the map control after an initial timeout', async () => {
    let retrySuccess: PositionCallback | undefined;
    let calls = 0;
    setGeolocation((success, error) => {
      calls += 1;
      if (calls === 1) {
        error?.({ code: 3, message: 'Synthetic timeout' } as GeolocationPositionError);
      } else {
        retrySuccess = success;
      }
    });
    const user = userEvent.setup();
    render(<MapTestRouter />);

    const recenter = screen.getByRole('button', { name: 'Vycentrovať mapu na polohu zariadenia' }) as HTMLButtonElement;
    await waitFor(() => expect(calls).toBe(1));
    await waitFor(() => expect(recenter.disabled).toBe(false));
    expect(recenter.title).toBe('Znova získať polohu zariadenia a vycentrovať mapu');

    await user.click(recenter);
    await waitFor(() => expect(calls).toBe(2));
    await act(async () => retrySuccess?.(position(48.72, 21.27)));

    expect(screen.getByTestId('device-location-marker')).not.toBeNull();
    expect(mocks.map.setView).toHaveBeenCalledOnce();
    expect(mocks.map.setView).toHaveBeenCalledWith([48.72, 21.27], expect.any(Number), { animate: false });
    expect(screen.getByRole('status').textContent).toContain('Mapa bola vycentrovaná.');
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

  it('blocks an outside map point before showing confirmation and does not navigate', async () => {
    mocks.validateReportTargetLocation.mockRejectedValueOnce(new ReportTargetValidationError('outside_service_area'));
    const user = userEvent.setup();
    render(<MapTestRouter />);

    await user.click(screen.getByRole('button', { name: 'Synthetic map click' }));

    expect((await screen.findByRole('alert')).textContent).toContain('Toto miesto je mimo územia Košíc. Vyberte miesto v meste.');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByTestId('custom-location-marker')).toBeNull();
    expect(screen.queryByLabelText('Report navigation')).toBeNull();
  });

  it('waits for server validation before showing an inventory-point confirmation', async () => {
    let resolveValidation!: () => void;
    mocks.validateReportTargetLocation.mockReturnValueOnce(new Promise<void>((resolve) => {
      resolveValidation = resolve;
    }));
    const user = userEvent.setup();
    render(<MapTestRouter />);

    await user.click(await screen.findByRole('button', { name: 'Synthetic map marker Synthetic Street' }));

    expect(mocks.validateReportTargetLocation).toHaveBeenCalledWith(
      { kind: 'light-point', lightPointId: 1 },
      expect.any(AbortSignal)
    );
    expect(screen.getByText('Overuje sa, či sa vybrané miesto nachádza v Košiciach…')).not.toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByTestId('custom-location-marker')).toBeNull();

    await act(async () => resolveValidation());
    expect(await screen.findByRole('dialog')).not.toBeNull();
    expect(screen.queryByText('Overuje sa, či sa vybrané miesto nachádza v Košiciach…')).toBeNull();
  });

  it('rejects an outside inventory point but preserves the inventory marker', async () => {
    mocks.validateReportTargetLocation.mockRejectedValueOnce(new ReportTargetValidationError('outside_service_area'));
    const user = userEvent.setup();
    render(<MapTestRouter />);

    const marker = await screen.findByRole('button', { name: 'Synthetic map marker Synthetic Street' });
    await user.click(marker);

    expect((await screen.findByRole('alert')).textContent)
      .toContain('Toto miesto je mimo územia Košíc. Vyberte miesto v meste.');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByTestId('custom-location-marker')).toBeNull();
    expect(screen.queryByLabelText('Report navigation')).toBeNull();
    expect(screen.getByRole('button', { name: 'Synthetic map marker Synthetic Street' })).not.toBeNull();
    expect(mocks.validateReportTargetLocation).toHaveBeenCalledWith(
      { kind: 'light-point', lightPointId: 1 },
      expect.any(AbortSignal)
    );
  });

  it('rejects an outside device location and recovers after a later in-city map selection', async () => {
    mocks.validateReportTargetLocation
      .mockRejectedValueOnce(new ReportTargetValidationError('outside_service_area'))
      .mockResolvedValueOnce(undefined);
    const user = userEvent.setup();
    render(<MapTestRouter />);
    await waitFor(() => expect(geoSuccess).toBeDefined());
    await act(async () => geoSuccess?.(position(48.7164, 22)));

    await user.click(await screen.findByTestId('device-location-marker'));
    expect((await screen.findByRole('alert')).textContent)
      .toContain('Toto miesto je mimo územia Košíc. Vyberte miesto v meste.');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByTestId('device-location-marker')).not.toBeNull();
    expect(screen.queryByLabelText('Report navigation')).toBeNull();
    expect(mocks.validateReportTargetLocation).toHaveBeenNthCalledWith(
      1,
      { kind: 'device', latitude: 48.7164, longitude: 22 },
      expect.any(AbortSignal)
    );

    await user.click(screen.getByRole('button', { name: 'Synthetic map click' }));
    expect(await screen.findByRole('dialog')).not.toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByTestId('custom-location-marker')).not.toBeNull();
    expect(mocks.validateReportTargetLocation).toHaveBeenNthCalledWith(
      2,
      { kind: 'custom', latitude: 48.7, longitude: 21.25 },
      expect.any(AbortSignal)
    );
  });

  it('shows a recoverable unavailable message on network failure and ignores a stale validation result', async () => {
    let resolveStaleValidation!: () => void;
    mocks.validateReportTargetLocation
      .mockRejectedValueOnce(new TypeError('Synthetic network failure'))
      .mockImplementationOnce(() => new Promise<void>((resolve) => {
        resolveStaleValidation = resolve;
      }))
      .mockResolvedValueOnce(undefined);
    const user = userEvent.setup();
    render(<MapTestRouter />);

    await user.click(screen.getByRole('button', { name: 'Synthetic map click' }));
    expect((await screen.findByRole('alert')).textContent)
      .toContain('Miesto sa teraz nepodarilo overiť. Skúste výber znova.');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByTestId('custom-location-marker')).toBeNull();

    await user.click(await screen.findByRole('button', { name: 'Synthetic map marker Synthetic Street' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Synthetic map click' }));
    expect(await screen.findByRole('dialog')).not.toBeNull();
    expect(screen.getByRole('dialog').textContent).toContain('48.700000, 21.250000');

    await act(async () => resolveStaleValidation());
    expect(screen.getByRole('dialog').textContent).toContain('48.700000, 21.250000');
    expect(screen.getByTestId('custom-location-marker')).not.toBeNull();
    expect(mocks.validateReportTargetLocation).toHaveBeenCalledTimes(3);
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

  it('hides confirmation on an outside click while preserving the selected map marker', async () => {
    const user = userEvent.setup();
    render(<MapTestRouter />);
    await user.click(screen.getByRole('button', { name: 'Synthetic map click' }));

    const backdrop = screen.getByRole('dialog').parentElement as HTMLElement;
    fireEvent.click(backdrop);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByTestId('custom-location-marker')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Pokračovať s vybraným miestom' })).not.toBeNull();
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

  it('offers the manual report directly when map rendering fails', async () => {
    mocks.throwMapRender = true;
    const reactErrorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    const user = userEvent.setup();
    render(<MapTestRouter />);

    expect(await screen.findByRole('heading', { name: 'Mapa momentálne nie je dostupná' })).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'Pokračovať bez výberu bodu na mape' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Otvoriť formulár a zadať miesto ručne' }));
    const route = JSON.parse(screen.getByLabelText('Report navigation').textContent ?? '{}');
    expect(route.state.reportTarget).toEqual({ kind: 'manual' });
    reactErrorLog.mockRestore();
  });

  it('offers a manual form when map tiles are disabled or the initial tile batch all fails', async () => {
    vi.stubEnv('VITE_MAP_TILE_PROVIDER', 'disabled');
    const user = userEvent.setup();
    render(<MapTestRouter />);
    expect(await screen.findByRole('heading', { name: 'Mapa momentálne nie je dostupná' })).not.toBeNull();
    await user.click(screen.getByRole('button', { name: 'Otvoriť formulár a zadať miesto ručne' }));
    expect(JSON.parse(screen.getByLabelText('Report navigation').textContent ?? '{}').state.reportTarget)
      .toEqual({ kind: 'manual' });

    cleanup();
    vi.stubEnv('VITE_MAP_TILE_PROVIDER', 'synthetic');
    render(<MapTestRouter />);
    fireEvent.click(screen.getByTestId('tile-error'));
    fireEvent.click(screen.getByTestId('tiles-complete'));
    expect(await screen.findByRole('heading', { name: 'Mapa momentálne nie je dostupná' })).not.toBeNull();
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
