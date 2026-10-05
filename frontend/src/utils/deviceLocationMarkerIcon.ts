import L from 'leaflet';

export function createDeviceLocationMarkerIcon(): L.DivIcon {
  return L.divIcon({
    html: '<span aria-hidden="true"></span>',
    className: 'device-location-marker',
    iconSize: L.point(28, 28),
    iconAnchor: L.point(14, 14),
  });
}
