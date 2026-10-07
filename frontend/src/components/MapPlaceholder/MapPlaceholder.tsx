import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { resolveMapTileConfig } from '@/config/mapTiles';
import styles from './MapPlaceholder.module.css';

const DEFAULT_CENTER: [number, number] = [48.1486, 17.1077];
const DEFAULT_ZOOM = 15;

export function MapPlaceholder() {
  const tiles = resolveMapTileConfig('light');
  return (
    <div className={styles.mapWrapper}>
      <MapContainer
        center={DEFAULT_CENTER}
        zoom={DEFAULT_ZOOM}
        className={styles.map}
        scrollWheelZoom
      >
        {tiles.enabled && <TileLayer attribution={tiles.attribution} url={tiles.url} maxZoom={tiles.maxZoom} />}
        <Marker position={DEFAULT_CENTER}>
          <Popup>Placeholder — svetelné body sa načítajú neskôr</Popup>
        </Marker>
      </MapContainer>
      <p className={styles.hint}>Základná mapa (Leaflet / OpenStreetMap)</p>
    </div>
  );
}
