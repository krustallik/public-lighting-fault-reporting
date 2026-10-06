export type MapTileProvider = 'disabled' | 'carto' | 'dev-osm' | 'synthetic';
export type MapTheme = 'light' | 'dark';

const OSM_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>';
const CARTO_ATTRIBUTION = `${OSM_ATTRIBUTION} &copy; <a href="https://carto.com/attribution/">CARTO</a>`;

export interface MapTileConfig {
  provider: MapTileProvider;
  enabled: boolean;
  url: string;
  attribution: string;
  maxZoom: number;
  nativeTheme: boolean;
}

export function resolveMapTileConfig(theme: MapTheme): MapTileConfig {
  const rawProvider = import.meta.env.VITE_MAP_TILE_PROVIDER || 'disabled';
  if (!['disabled', 'carto', 'dev-osm', 'synthetic'].includes(rawProvider)) return disabled();
  const provider = rawProvider as MapTileProvider;
  const production = !import.meta.env.DEV && import.meta.env.MODE !== 'test';
  if (provider === 'disabled') return disabled();
  if (provider === 'dev-osm') {
    if (production) return disabled();
    return {
      provider, enabled: true, url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
      attribution: OSM_ATTRIBUTION, maxZoom: 19, nativeTheme: false,
    };
  }
  if (provider === 'synthetic') {
    if (production) return disabled();
    return {
      provider, enabled: true, url: `https://synthetic.invalid/tiles/${theme}/{z}/{x}/{y}.png`,
      attribution: 'Synthetic local tiles', maxZoom: 20, nativeTheme: true,
    };
  }
  const key = import.meta.env.VITE_CARTO_PUBLIC_KEY?.trim() ?? '';
  if (import.meta.env.VITE_CARTO_TILES_APPROVED !== 'true' || !key) return disabled();
  const style = theme === 'dark' ? 'dark_all' : 'light_all';
  return {
    provider: 'carto',
    enabled: true,
    url: `https://basemaps.cartocdn.com/rastertiles/${style}/{z}/{x}/{y}.png?key=${encodeURIComponent(key)}`,
    attribution: CARTO_ATTRIBUTION,
    maxZoom: 20,
    nativeTheme: true,
  };
}

function disabled(): MapTileConfig {
  return { provider: 'disabled', enabled: false, url: '', attribution: '', maxZoom: 20, nativeTheme: false };
}

export const MAP_TILES = resolveMapTileConfig('light');

export function canDisplayPublicMapTiles(): boolean {
  return resolveMapTileConfig('light').enabled;
}

export function canRecenterMapToDeviceLocation(): boolean {
  return import.meta.env.VITE_ALLOW_DEVICE_MAP_RECENTER === 'true';
}
