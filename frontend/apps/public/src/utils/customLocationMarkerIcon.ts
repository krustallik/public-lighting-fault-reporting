import L from 'leaflet';
import type { MapMarkerSizesPx } from './mapMarkerSize';

/** Pin for a user-selected map location (not a DB light point). */
export function createCustomLocationMarkerIcon(sizes: MapMarkerSizesPx): L.DivIcon {
  const { outer, anchor } = sizes;

  return L.divIcon({
    className: 'custom-location-marker',
    html: '<div><span></span></div>',
    iconSize: [outer, outer],
    iconAnchor: [anchor, anchor],
    popupAnchor: [0, -anchor],
  });
}
