import { Marker, useMap, useMapEvents } from 'react-leaflet';
import { createCustomLocationMarkerIcon } from '@/utils/customLocationMarkerIcon';
import { getMapMarkerSizesPx } from '@/utils/mapMarkerSize';

export interface CustomMapSelection {
  latitude: number;
  longitude: number;
}

interface MapCustomLocationLayerProps {
  selection: CustomMapSelection | null;
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
  onMapClick,
}: MapCustomLocationLayerProps) {
  const map = useMap();
  const sizes = getMapMarkerSizesPx(map.getContainer());
  const icon = createCustomLocationMarkerIcon(sizes);

  return (
    <>
      <MapClickHandler onMapClick={onMapClick} />
      {selection != null && (
        <Marker
          position={[selection.latitude, selection.longitude]}
          icon={icon}
          alt="Vybrané miesto na mape"
        />
      )}
    </>
  );
}
