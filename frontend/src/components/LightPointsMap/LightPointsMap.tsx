import { useEffect, useState } from 'react';
import { MapContainer, TileLayer, useMap } from 'react-leaflet';
import L from 'leaflet';
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
    <div className={styles.wrapper}>
      {loading && <p className={styles.status}>Načítavam svetelné body…</p>}
      {error && <p className={styles.error}>{error}</p>}
      {!loading && !error && points.length === 0 && (
        <p className={styles.status}>Žiadne svetelné body na zobrazenie.</p>
      )}

      <MapContainer
        center={KOSICE_CENTER}
        zoom={DEFAULT_ZOOM}
        className={styles.map}
        scrollWheelZoom
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {!loading && !error && points.length > 0 && (
          <>
            <MapFitBounds points={points} />
            <MarkerClusterLayer points={points} />
          </>
        )}
      </MapContainer>

      {!loading && !error && points.length > 0 && (
        <p className={styles.count}>Zobrazených bodov: {points.length}</p>
      )}
    </div>
  );
}
