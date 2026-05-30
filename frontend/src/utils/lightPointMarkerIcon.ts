import L from 'leaflet';
import type { MapMarkerSizesPx } from './mapMarkerSize.js';

/** Single light point — same circle style as cluster markers (no pin icon). */
export function createLightPointMarkerIcon(sizes: MapMarkerSizesPx): L.DivIcon {
  const { outer, anchor } = sizes;

  return L.divIcon({
    className: 'light-point-marker',
    html: '<div><span></span></div>',
    iconSize: [outer, outer],
    iconAnchor: [anchor, anchor],
    popupAnchor: [0, -anchor],
  });
}
