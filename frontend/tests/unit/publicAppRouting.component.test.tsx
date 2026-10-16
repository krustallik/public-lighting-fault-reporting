// @vitest-environment jsdom
import type { PropsWithChildren } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

const mocks = vi.hoisted(() => ({ tileEnabled: false }));

vi.mock('@/pages/MapPage/MapPage', () => ({ MapPage: () => <div data-testid="map-page" /> }));
vi.mock('@/pages/ReportFormPage/ReportFormPage', () => ({ ReportFormPage: () => <div data-testid="report-page" /> }));
vi.mock('@/pages/ResultPage/ResultPage', () => ({ ResultPage: () => <div data-testid="result-page" /> }));
vi.mock('@/config/mapTiles', () => ({ resolveMapTileConfig: () => mocks.tileEnabled
  ? { enabled: true, attribution: 'Synthetic tiles', url: 'https://tiles.example.invalid/{z}/{x}/{y}', maxZoom: 19 }
  : { enabled: false, attribution: '', url: '', maxZoom: 0 } }));
vi.mock('react-leaflet', () => ({
  MapContainer: ({ children, center, zoom, ...props }: PropsWithChildren<Record<string, any>>) => (
    <section data-testid="placeholder-map" data-center={JSON.stringify(center)} data-zoom={String(zoom)} {...props}>{children}</section>
  ),
  TileLayer: (props: Record<string, unknown>) => <div data-testid="tile-layer" data-url={props.url} />,
  Marker: ({ children, position }: PropsWithChildren<{ position: number[] }>) => <div data-testid="placeholder-marker" data-position={JSON.stringify(position)}>{children}</div>,
  Popup: ({ children }: PropsWithChildren) => <span>{children}</span>,
}));

import PublicApp from '@/App';
import { Layout } from '@/components/Layout/Layout';
import { MapPlaceholder } from '@/components/MapPlaceholder/MapPlaceholder';

afterEach(() => { cleanup(); mocks.tileEnabled = false; });

describe('public app routing and map fallback', () => {
  it.each([
    ['/', 'map-page'],
    ['/map', 'map-page'],
    ['/report', 'report-page'],
    ['/result', 'result-page'],
  ])('routes %s to the expected public page', (path, pageTestId) => {
    render(<MemoryRouter initialEntries={[path]}><PublicApp /></MemoryRouter>);
    expect(screen.getByTestId(pageTestId)).toBeTruthy();
  });

  it('keeps form and result pages inside the shared main layout', () => {
    render(<MemoryRouter><Layout /></MemoryRouter>);
    expect(document.querySelector('main')).toBeTruthy();
  });

  it('uses the safe default center and conditionally adds the configured tile layer', () => {
    const view = render(<MapPlaceholder />);
    expect(screen.getByTestId('placeholder-map').getAttribute('data-center')).toBe('[48.1486,17.1077]');
    expect(screen.getByTestId('placeholder-map').getAttribute('data-zoom')).toBe('15');
    expect(screen.queryByTestId('tile-layer')).toBeNull();
    expect(screen.getByTestId('placeholder-marker').getAttribute('data-position')).toBe('[48.1486,17.1077]');

    mocks.tileEnabled = true;
    view.rerender(<MapPlaceholder />);
    expect(screen.getByTestId('tile-layer').getAttribute('data-url')).toBe('https://tiles.example.invalid/{z}/{x}/{y}');
  });
});
