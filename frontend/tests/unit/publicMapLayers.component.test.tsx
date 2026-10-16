// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LightPoint } from '@/types/lightPoint';

const mocks = vi.hoisted(() => {
  const map = {
    getContainer: vi.fn(() => null as unknown as HTMLElement),
    addLayer: vi.fn(),
    removeLayer: vi.fn(),
  };
  const state: {
    map: typeof map;
    markerEvents: Array<Map<string, (...args: any[]) => void>>;
    markerElements: HTMLElement[];
    popupElements: HTMLElement[];
    markerProps: Array<Record<string, any>>;
    circleProps: Array<Record<string, any>>;
    mapEventHandlers: Record<string, (event: any) => void> | null;
    groups: Array<Record<string, any>>;
    observers: Array<{ callback: ResizeObserverCallback; observe: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> }>;
  } = {
    map,
    markerEvents: [], markerElements: [], popupElements: [], markerProps: [], circleProps: [],
    mapEventHandlers: null, groups: [], observers: [],
  };
  const leaflet = {
    Icon: { Default: { prototype: { _getIconUrl: 'old-url' }, mergeOptions: vi.fn() } },
    divIcon: vi.fn((options: unknown) => ({ options })),
    point: vi.fn((x: number, y: number) => ({ x, y })),
    marker: vi.fn(() => {
      const events = new Map<string, (...args: any[]) => void>();
      const element = document.createElement('div');
      const popup = document.createElement('div');
      state.markerEvents.push(events);
      state.markerElements.push(element);
      state.popupElements.push(popup);
      const marker = {
        on: vi.fn((name: string, callback: (...args: any[]) => void) => { events.set(name, callback); return marker; }),
        off: vi.fn((name: string) => { events.delete(name); return marker; }),
        bindPopup: vi.fn((html: string) => { popup.innerHTML = html; return marker; }),
        getElement: vi.fn(() => element),
        getPopup: vi.fn(() => ({ getElement: () => popup })),
      };
      return marker;
    }),
    markerClusterGroup: vi.fn((options: unknown) => {
      const group = { options, addLayer: vi.fn(), clearLayers: vi.fn() };
      state.groups.push(group);
      return group;
    }),
  };
  return { state, leaflet };
});

vi.mock('leaflet', () => ({ default: mocks.leaflet }));
vi.mock('leaflet.markercluster', () => ({}));
vi.mock('react-leaflet', () => ({
  useMap: () => mocks.state.map,
  useMapEvents: (handlers: Record<string, (event: any) => void>) => { mocks.state.mapEventHandlers = handlers; return mocks.state.map; },
  Marker: (props: Record<string, any>) => { mocks.state.markerProps.push(props); return null; },
  Circle: (props: Record<string, any>) => { mocks.state.circleProps.push(props); return null; },
}));
vi.mock('@/utils/mapMarkerSize', () => ({
  getMapMarkerSizesPx: vi.fn(() => ({ outer: 32, inner: 20, anchor: 16, cluster: { small: 32, medium: 40, large: 48 } })),
}));

import { MarkerClusterLayer } from '@/components/LightPointsMap/MarkerClusterLayer';
import { DeviceLocationLayer } from '@/components/LightPointsMap/DeviceLocationLayer';
import { MapCustomLocationLayer } from '@/components/LightPointsMap/MapCustomLocationLayer';
import { createCustomLocationMarkerIcon } from '@/utils/customLocationMarkerIcon';
import { createDeviceLocationMarkerIcon } from '@/utils/deviceLocationMarkerIcon';
import { createLightPointMarkerIcon } from '@/utils/lightPointMarkerIcon';
import '@/utils/leafletIcon';

const labels = {
  inventory: 'Inventory', address: 'Address', addressUnavailable: 'Address unavailable',
  type: 'Type', status: 'Status', statusValues: { active: 'Active', inactive: 'Inactive', maintenance: 'Repair' }, choose: 'Choose',
};

const point: LightPoint = {
  id: 9, inventory_number: 'INV-9', latitude: 48.7, longitude: 21.2,
  address: 'Synthetic street', type: 'LED', status: 'active',
};

let mapContainer: HTMLDivElement;
let listeners: Map<string, EventListener>;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.state.markerEvents.length = 0;
  mocks.state.markerElements.length = 0;
  mocks.state.popupElements.length = 0;
  mocks.state.markerProps.length = 0;
  mocks.state.circleProps.length = 0;
  mocks.state.groups.length = 0;
  mocks.state.observers.length = 0;
  mocks.state.mapEventHandlers = null;
  mapContainer = document.createElement('div');
  mocks.state.map.getContainer.mockReturnValue(mapContainer);
  listeners = new Map();
  vi.spyOn(window, 'addEventListener').mockImplementation((type, listener) => { if (typeof listener === 'function') listeners.set(type, listener as EventListener); });
  vi.spyOn(window, 'removeEventListener').mockImplementation((type) => { listeners.delete(type); });
  vi.stubGlobal('ResizeObserver', class {
    constructor(readonly callback: ResizeObserverCallback) { mocks.state.observers.push(this); }
    observe = vi.fn();
    disconnect = vi.fn();
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('public Leaflet layers', () => {
  it('creates correctly sized accessible icons and fixes Leaflet bundled defaults', () => {
    expect(createLightPointMarkerIcon({ outer: 32, inner: 18, anchor: 16, cluster: { small: 32, medium: 40, large: 48 } }).options).toMatchObject({
      className: 'light-point-marker', iconSize: [32, 32], iconAnchor: [16, 16], popupAnchor: [0, -16],
    });
    expect(createCustomLocationMarkerIcon({ outer: 28, inner: 18, anchor: 14, cluster: { small: 28, medium: 36, large: 44 } }).options).toMatchObject({
      className: 'custom-location-marker', iconSize: [28, 28], iconAnchor: [14, 14],
    });
    expect(createDeviceLocationMarkerIcon().options).toMatchObject({ className: 'device-location-marker', iconSize: { x: 28, y: 28 }, iconAnchor: { x: 14, y: 14 } });
    expect(mocks.leaflet.Icon.Default.prototype).not.toHaveProperty('_getIconUrl');
  });

  it('creates clustered inventory markers, responds to popup selection, and removes listeners and layers', () => {
    const selected = vi.fn();
    const onSelectPoint = (item: LightPoint, trigger: HTMLElement | null) => selected(item, trigger);
    const view = render(<MarkerClusterLayer points={[point]} locale="en" labels={labels} onSelectPoint={onSelectPoint} />);
    const group = mocks.state.groups[0];
    const options = group.options as { iconCreateFunction: (cluster: { getChildCount: () => number }) => { options: Record<string, unknown> } };

    expect(group.addLayer).toHaveBeenCalledOnce();
    expect(mocks.state.map.addLayer).toHaveBeenCalledWith(group);
    expect(options.iconCreateFunction({ getChildCount: () => 5 }).options.className).toContain('marker-cluster-small');
    expect(options.iconCreateFunction({ getChildCount: () => 20 }).options.className).toContain('marker-cluster-medium');
    expect(options.iconCreateFunction({ getChildCount: () => 70 }).options.className).toContain('marker-cluster-large');

    const handlers = mocks.state.markerEvents[0];
    handlers.get('add')?.();
    expect(mocks.state.markerElements[0].getAttribute('role')).toBe('button');
    expect(mocks.state.markerElements[0].getAttribute('aria-label')).toContain('INV-9');
    handlers.get('popupopen')?.();
    const choose = mocks.state.popupElements[0].querySelector<HTMLButtonElement>('[data-select-light-point="9"]');
    expect(choose).toBeTruthy();
    choose?.click();
    expect(selected).toHaveBeenCalledWith(point, choose);
    handlers.get('popupclose')?.();
    choose?.click();
    expect(selected).toHaveBeenCalledOnce();

    act(() => mocks.state.observers[0].callback([], mocks.state.observers[0] as unknown as ResizeObserver));
    expect(mocks.state.groups).toHaveLength(2);
    expect(mocks.state.map.removeLayer).toHaveBeenCalledWith(group);

    view.unmount();
    expect(handlers.has('add')).toBe(false);
    expect(handlers.has('popupopen')).toBe(false);
    expect(handlers.has('popupclose')).toBe(false);
    expect(mocks.state.map.removeLayer).toHaveBeenCalledWith(group);
    expect(group.clearLayers).toHaveBeenCalledOnce();
    expect(mocks.state.observers[0].disconnect).toHaveBeenCalledOnce();
    expect(listeners.has('orientationchange')).toBe(false);
  });

  it('tracks custom-map clicks and renders only the selected coordinate marker', () => {
    const onMapClick = vi.fn();
    const view = render(<MapCustomLocationLayer selection={null} markerAlt="Select location" onMapClick={onMapClick} />);
    expect(mocks.state.markerProps).toHaveLength(0);
    act(() => mocks.state.mapEventHandlers?.click({ latlng: { lat: 48.71, lng: 21.23 } }));
    expect(onMapClick).toHaveBeenCalledWith(48.71, 21.23);

    view.rerender(<MapCustomLocationLayer selection={{ latitude: 48.71, longitude: 21.23 }} markerAlt="Selected location" onMapClick={onMapClick} />);
    expect(mocks.state.markerProps.at(-1)).toMatchObject({ position: [48.71, 21.23], alt: 'Selected location', keyboard: true });
  });

  it('adds the optional accuracy circle and forwards marker activation to the selection callback', () => {
    const onSelect = vi.fn();
    const position = { latitude: 48.72, longitude: 21.24, accuracy: 17 };
    const view = render(<DeviceLocationLayer position={position} alt="Current position" onSelect={onSelect} />);

    expect(mocks.state.circleProps[0]).toMatchObject({ center: [48.72, 21.24], radius: 17 });
    const marker = mocks.state.markerProps[0];
    expect(marker).toMatchObject({ position: [48.72, 21.24], alt: 'Current position', keyboard: true });
    const trigger = document.createElement('div');
    marker.eventHandlers.click({ target: { getElement: () => trigger } });
    expect(onSelect).toHaveBeenCalledWith(trigger);

    view.rerender(<DeviceLocationLayer position={{ latitude: 48.72, longitude: 21.24, accuracy: null }} alt="Current position" onSelect={onSelect} />);
    expect(mocks.state.circleProps).toHaveLength(1);
    expect(mocks.state.markerProps).toHaveLength(2);
    view.rerender(<DeviceLocationLayer position={null} alt="Current position" onSelect={onSelect} />);
  });
});
