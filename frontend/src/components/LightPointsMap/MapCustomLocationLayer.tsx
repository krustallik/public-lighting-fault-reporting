import { useEffect, useRef } from 'react';
import { Marker, Popup, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import { formatCoordinates } from '@/utils/reportLocationParams';
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
  const markerRef = useRef<L.Marker | null>(null);

  useEffect(() => {
    if (!selection) {
      return;
    }

    const marker = markerRef.current;
    if (marker) {
      marker.openPopup();
    }
  }, [selection]);

  const sizes = getMapMarkerSizesPx(map.getContainer());
  const icon = createCustomLocationMarkerIcon(sizes);

  const reportHref =
    selection != null
      ? `/report?lat=${encodeURIComponent(String(selection.latitude))}&lng=${encodeURIComponent(String(selection.longitude))}`
      : '#';

  return (
    <>
      <MapClickHandler onMapClick={onMapClick} />
      {selection != null && (
        <Marker
          position={[selection.latitude, selection.longitude]}
          icon={icon}
          ref={(instance) => {
            markerRef.current = instance;
          }}
        >
          <Popup>
            <div className="lightPointPopup">
              <p className="lightPointPopupRow">
                <span className="lightPointPopupLabel">Súradnice:</span>{' '}
                {formatCoordinates(selection.latitude, selection.longitude)}
              </p>
              <p className="lightPointPopupRow">Adresu zadáte v ďalšom kroku vo formulári.</p>
              <a className="lightPointPopupLink" href={reportHref}>
                Nahlásiť poruchu
              </a>
            </div>
          </Popup>
        </Marker>
      )}
    </>
  );
}
