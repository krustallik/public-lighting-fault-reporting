import { Circle, Marker } from 'react-leaflet';
import type { LeafletEvent, Marker as LeafletMarker } from 'leaflet';
import { createDeviceLocationMarkerIcon } from '@/utils/deviceLocationMarkerIcon';
import type { MapEntryPosition } from '@/hooks/useMapEntryGeolocation';

interface DeviceLocationLayerProps {
  position: MapEntryPosition | null;
  alt: string;
  onSelect: (trigger?: HTMLElement | null) => void;
}

export function DeviceLocationLayer({ position, alt, onSelect }: DeviceLocationLayerProps) {
  if (!position) return null;
  const labelMarker = (event: LeafletEvent) => {
    (event.target as LeafletMarker).getElement()?.setAttribute('aria-label', alt);
  };

  return (
    <>
      {position.accuracy != null && (
        <Circle
          center={[position.latitude, position.longitude]}
          radius={position.accuracy}
          pathOptions={{ color: '#1458c7', fillColor: '#4f8df3', fillOpacity: 0.14, weight: 2 }}
        />
      )}
      <Marker
        position={[position.latitude, position.longitude]}
        icon={createDeviceLocationMarkerIcon()}
        alt={alt}
        title={alt}
        keyboard
        eventHandlers={{
          add: labelMarker,
          click: (event) => onSelect(event.target.getElement()),
        }}
      />
    </>
  );
}
