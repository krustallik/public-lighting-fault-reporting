import type { LatLngBoundsExpression } from 'leaflet';

// CRS84 extent from backend/src/data/service-area/kosice-city.manifest.json.
// Leaflet expects [south-west, north-east] in [latitude, longitude] order.
export const KOSICE_MAP_BOUNDS: LatLngBoundsExpression = [
  [48.570038321, 21.1199558104],
  [48.8245116653, 21.3582127667],
];
