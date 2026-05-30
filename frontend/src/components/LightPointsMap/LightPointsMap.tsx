import { useEffect, useState } from 'react';
import { MapContainer, TileLayer, useMap } from 'react-leaflet';
import L from 'leaflet';
import { MAP_TILES } from '@/config/mapTiles';
import { usePrefersColorScheme } from '@/hooks/usePrefersColorScheme';
import { getLightPoints } from '@/services/lightPointsApi';
import type { LightPoint } from '@/types/lightPoint';
import { MarkerClusterLayer } from './MarkerClusterLayer';
import styles from './LightPointsMap.module.css';

const KOSICE_CENTER: [number, number] = [48.7164, 21.2611];
const DEFAULT_ZOOM = 13;

function MapFitBounds({ points }: { points: LightPoint[] }) {
  const map = useMap();

  useEffect(() => {
    if (points.length === 0) return;

    const bounds = L.latLngBounds(
      points.map((point) => [point.latitude, point.longitude] as [number, number])
    );
    const padding = Math.round(
      parseFloat(getComputedStyle(map.getContainer()).fontSize) * 3
    );
    map.fitBounds(bounds, { padding: [padding, padding], maxZoom: 16 });
  }, [map, points]);

  return null;
}

export function LightPointsMap() {
  const colorScheme = usePrefersColorScheme();
  const tiles = MAP_TILES[colorScheme];
  const [points, setPoints] = useState<LightPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    getLightPoints()
      .then((data) => {
        if (!cancelled) setPoints(data);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Načítanie mapy zlyhalo');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className={styles.wrapper} data-theme={colorScheme}>
      {(loading || error) && (
        <p className={loading ? styles.statusOverlay : styles.errorOverlay}>
          {loading ? 'Načítavam svetelné body…' : error}
        </p>
      )}
      {!loading && !error && points.length === 0 && (
        <p className={styles.statusOverlay}>Žiadne svetelné body na zobrazenie.</p>
      )}

      <MapContainer
        center={KOSICE_CENTER}
        zoom={DEFAULT_ZOOM}
        className={styles.map}
        scrollWheelZoom
      >
        <TileLayer
          key={colorScheme}
          attribution={tiles.attribution}
          url={tiles.url}
          subdomains={tiles.subdomains}
        />
        {!loading && !error && points.length > 0 && (
          <>
            <MapFitBounds points={points} />
            <MarkerClusterLayer points={points} />
          </>
        )}
      </MapContainer>
    </div>
  );
}
