import { Marker, useMap, useMapEvents } from 'react-leaflet';
import type { LeafletEvent, Marker as LeafletMarker } from 'leaflet';
import { createCustomLocationMarkerIcon } from '@/utils/customLocationMarkerIcon';
import { getMapMarkerSizesPx } from '@/utils/mapMarkerSize';

export interface CustomMapSelection {
  latitude: number;
  longitude: number;
}

interface MapCustomLocationLayerProps {
  selection: CustomMapSelection | null;
  markerAlt: string;
  onMapClick: (latitude: number, longitude: number) => void;
}

function MapClickHandler({
  onMapClick,
}: {
  onMapClick: (latitude: number, longitude: number) => void;
}) {
  useMapEvents({
    click(event) {
      onMapClick(event.latlng.lat, event.latlng.lng);
    },
  });

  return null;
}

export function MapCustomLocationLayer({
  selection,
  markerAlt,
  onMapClick,
}: MapCustomLocationLayerProps) {
  const map = useMap();
  const sizes = getMapMarkerSizesPx(map.getContainer());
  const icon = createCustomLocationMarkerIcon(sizes);
  const labelMarker = (event: LeafletEvent) => {
    (event.target as LeafletMarker).getElement()?.setAttribute('aria-label', markerAlt);
  };

  return (
    <>
      <MapClickHandler onMapClick={onMapClick} />
      {selection != null && (
        <Marker
          position={[selection.latitude, selection.longitude]}
          icon={icon}
          alt={markerAlt}
          title={markerAlt}
          keyboard
          eventHandlers={{ add: labelMarker }}
        />
      )}
    </>
  );
}
