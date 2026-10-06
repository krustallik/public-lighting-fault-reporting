const OSM_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>';

export const MAP_TILES = {
  url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  attribution: OSM_ATTRIBUTION,
};

/**
 * The public OSM layer is used for human-driven development only by default.
 * A production build needs an explicit owner-approved provider/config decision.
 */
export function canDisplayPublicMapTiles(): boolean {
  return import.meta.env.DEV || import.meta.env.VITE_PUBLIC_MAP_TILES_APPROVED === 'true';
}

export function canRecenterMapToDeviceLocation(): boolean {
  return import.meta.env.VITE_ALLOW_DEVICE_MAP_RECENTER === 'true';
}
