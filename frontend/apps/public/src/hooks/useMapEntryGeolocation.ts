import { useCallback, useEffect, useRef, useState } from 'react';
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

export function useMapEntryGeolocation(): MapEntryGeolocationState & { requestPosition: () => void } {
  const [state, setState] = useState<MapEntryGeolocationState>({
    status: 'requesting',
    position: null,
  });
  const mounted = useRef(false);
  const requestSequence = useRef(0);

  const requestPosition = useCallback(() => {
    const sequence = ++requestSequence.current;
    setState({ status: 'requesting', position: null });

    try {
      const geolocation = navigator.geolocation;
      if (!geolocation?.getCurrentPosition) {
        if (mounted.current) setState({ status: 'unsupported', position: null });
        return;
      }

      geolocation.getCurrentPosition(
        (position) => {
          if (!mounted.current || sequence !== requestSequence.current) return;
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
          if (!mounted.current || sequence !== requestSequence.current) return;
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
      if (mounted.current && sequence === requestSequence.current) {
        setState({ status: 'unavailable', position: null });
      }
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    // Deferring one task lets React StrictMode clean up its development probe before
    // the one-shot browser request is issued.
    const timer = window.setTimeout(requestPosition, 0);

    return () => {
      mounted.current = false;
      requestSequence.current += 1;
      window.clearTimeout(timer);
    };
  }, [requestPosition]);

  return { ...state, requestPosition };
}
