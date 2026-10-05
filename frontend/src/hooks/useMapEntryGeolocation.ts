import { useEffect, useState } from 'react';
import { isValidReportCoordinates } from '@/utils/reportLocationParams';

export interface MapEntryPosition {
  latitude: number;
  longitude: number;
  accuracy: number | null;
}

export type MapEntryGeolocationStatus =
  | 'requesting'
  | 'available'
  | 'denied'
  | 'timeout'
  | 'unavailable'
  | 'unsupported';

export interface MapEntryGeolocationState {
  status: MapEntryGeolocationStatus;
  position: MapEntryPosition | null;
}

const REQUEST_OPTIONS: PositionOptions = {
  enableHighAccuracy: true,
  maximumAge: 0,
  timeout: 10_000,
};

export function useMapEntryGeolocation(): MapEntryGeolocationState {
  const [state, setState] = useState<MapEntryGeolocationState>({
    status: 'requesting',
    position: null,
  });

  useEffect(() => {
    let active = true;
    // Deferring one task lets React StrictMode clean up its development probe before
    // the one-shot browser request is issued.
    const timer = window.setTimeout(() => {
      if (!active) return;

      try {
        const geolocation = navigator.geolocation;
        if (!geolocation?.getCurrentPosition) {
          setState({ status: 'unsupported', position: null });
          return;
        }

        geolocation.getCurrentPosition(
          (position) => {
            if (!active) return;
            const { latitude, longitude, accuracy } = position.coords;
            if (!isValidReportCoordinates(latitude, longitude)) {
              setState({ status: 'unavailable', position: null });
              return;
            }

            setState({
              status: 'available',
              position: {
                latitude,
                longitude,
                accuracy: Number.isFinite(accuracy) && accuracy >= 0 ? accuracy : null,
              },
            });
          },
          (error) => {
            if (!active) return;
            const status = error.code === 1
              ? 'denied'
              : error.code === 3
                ? 'timeout'
                : 'unavailable';
            setState({ status, position: null });
          },
          REQUEST_OPTIONS
        );
      } catch {
        if (active) setState({ status: 'unavailable', position: null });
      }
    }, 0);

    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, []);

  return state;
}
