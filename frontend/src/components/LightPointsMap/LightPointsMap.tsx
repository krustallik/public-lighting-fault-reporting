import { Component, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { MapContainer, TileLayer, useMap } from 'react-leaflet';
import type L from 'leaflet';
import { useLocation, useNavigate } from 'react-router-dom';
import { MAP_TILES } from '@/config/mapTiles';
import { usePrefersColorScheme } from '@/hooks/usePrefersColorScheme';
import { useMapEntryGeolocation } from '@/hooks/useMapEntryGeolocation';
import { getLightPoints } from '@/services/lightPointsApi';
import type { LightPoint } from '@/types/lightPoint';
import { isValidLightPointCoords } from '@/types/lightPoint';
import { TargetConfirmationDialog } from '@/components/TargetConfirmationDialog/TargetConfirmationDialog';
import {
  createReportNavigationState,
  type ReportTarget,
} from '@/utils/reportNavigationTarget';
import { formatCoordinates, isValidReportCoordinates } from '@/utils/reportLocationParams';
import {
  MapCustomLocationLayer,
  type CustomMapSelection,
} from './MapCustomLocationLayer';
import { DeviceLocationLayer } from './DeviceLocationLayer';
import { MarkerClusterLayer } from './MarkerClusterLayer';
import styles from './LightPointsMap.module.css';

const KOSICE_CENTER: [number, number] = [48.7164, 21.2611];
const CITY_ZOOM = 12;

interface TargetCandidate {
  target: ReportTarget;
  summary: string;
  returnFocusTo: HTMLElement | null;
}

class MapRenderBoundary extends Component<{
  children: ReactNode;
  onFailure: () => void;
}, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch() {
    this.props.onFailure();
  }

  render() {
    if (this.state.failed) {
      return (
        <div className={styles.mapFailure} role="alert">
          Interaktívnu mapu sa nepodarilo zobraziť. Pokračujte výberom evidovaného bodu alebo ručným zadaním miesta.
        </div>
      );
    }
    return this.props.children;
  }
}

function MapViewportController({ onMapReady }: { onMapReady: (map: L.Map | null) => void }) {
  const map = useMap();

  useEffect(() => {
    onMapReady(map);
    return () => onMapReady(null);
  }, [map, onMapReady]);

  return null;
}

function locationStatusMessage(status: string): string {
  switch (status) {
    case 'requesting':
      return 'Skúšame získať polohu zariadenia. Ak sa to nepodarí, môžete pokračovať výberom na mape alebo ručne.';
    case 'available':
      return 'Poloha zariadenia je dostupná. Mapa zostáva na predvolenom výreze; polohu môžete výslovne vybrať ako cieľ a potvrdiť.';
    case 'denied':
      return 'Prehliadač nepovolil prístup k polohe. Môžete pokračovať výberom na mape alebo ručne.';
    case 'timeout':
      return 'Získanie polohy trvalo príliš dlho. Môžete pokračovať výberom na mape alebo ručne.';
    case 'unsupported':
      return 'Tento prehliadač nepodporuje polohu zariadenia. Môžete pokračovať výberom na mape alebo ručne.';
    default:
      return 'Poloha zariadenia nie je dostupná. Môžete pokračovať výberom na mape alebo ručne.';
  }
}

function parseCoordinate(value: string): number | null {
  const normalized = value.trim().replace(',', '.');
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function isFocusable(value: unknown): value is HTMLElement {
  return value instanceof HTMLElement && value.isConnected;
}

export function LightPointsMap() {
  const colorScheme = usePrefersColorScheme();
  const tiles = MAP_TILES[colorScheme];
  const navigate = useNavigate();
  const location = useLocation();
  const geolocation = useMapEntryGeolocation();
  const mapContainerRef = useRef<HTMLElement | null>(null);
  const [points, setPoints] = useState<LightPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [dataError, setDataError] = useState(false);
  const [mapRenderFailed, setMapRenderFailed] = useState(false);
  const [tilesUnavailable, setTilesUnavailable] = useState(false);
  const [customSelection, setCustomSelection] = useState<CustomMapSelection | null>(null);
  const [candidate, setCandidate] = useState<TargetCandidate | null>(null);
  const [latitudeInput, setLatitudeInput] = useState('');
  const [longitudeInput, setLongitudeInput] = useState('');
  const [coordinateError, setCoordinateError] = useState<string | null>(null);

  const navigationNotice =
    location.state && typeof location.state === 'object' && 'notice' in location.state
      ? location.state.notice
      : null;

  const setMapInstance = useCallback((map: L.Map | null) => {
    mapContainerRef.current = map?.getContainer() ?? null;
  }, []);

  useEffect(() => {
    let active = true;
    getLightPoints()
      .then((data) => {
        if (active) setPoints(data.filter(isValidLightPointCoords));
      })
      .catch(() => {
        if (active) {
          setPoints([]);
          setDataError(true);
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  const openCandidate = useCallback((target: ReportTarget, summary: string, trigger?: HTMLElement | null) => {
    const fallbackFocus = mapContainerRef.current;
    setCandidate({
      target,
      summary,
      returnFocusTo: isFocusable(trigger) ? trigger : fallbackFocus,
    });
  }, []);

  const handleMapClick = useCallback((latitude: number, longitude: number) => {
    setCustomSelection({ latitude, longitude });
    openCandidate(
      { kind: 'custom', latitude, longitude },
      'Vami vybrané miesto na mape.'
    );
  }, [openCandidate]);

  const handleSelectPoint = useCallback((point: LightPoint, trigger: HTMLElement | null) => {
    openCandidate(
      { kind: 'light-point', lightPointId: point.id },
      [point.inventory_number?.trim(), point.address?.trim(), `Svetelný bod ${point.id}`]
        .filter(Boolean)
        .join(' · '),
      trigger
    );
  }, [openCandidate]);

  const handleCoordinateSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const latitude = parseCoordinate(latitudeInput);
    const longitude = parseCoordinate(longitudeInput);
    if (latitude === null || longitude === null || !isValidReportCoordinates(latitude, longitude)) {
      setCoordinateError('Zadajte platnú zemepisnú šírku a dĺžku.');
      return;
    }

    setCoordinateError(null);
    setCustomSelection({ latitude, longitude });
    const submitButton = event.currentTarget.querySelector<HTMLButtonElement>('button[type="submit"]');
    openCandidate(
      { kind: 'custom', latitude, longitude },
      'Vami ručne zadané miesto.',
      submitButton
    );
  };

  const handleConfirm = () => {
    if (!candidate) return;
    navigate('/report', {
      state: createReportNavigationState(candidate.target),
    });
  };

  const handleTileError = useCallback(() => setTilesUnavailable(true), []);
  const handleMapRenderFailure = useCallback(() => setMapRenderFailed(true), []);
  const mapControlsUsable = !loading && !dataError && !tilesUnavailable && !mapRenderFailed;

  return (
    <div className={styles.wrapper} data-theme={colorScheme}>
      <div className={styles.mapRegion} role="region" aria-label="Mapa Košíc a evidovaných svetelných bodov">
        <MapRenderBoundary onFailure={handleMapRenderFailure}>
          <MapContainer
            center={KOSICE_CENTER}
            zoom={CITY_ZOOM}
            className={styles.map}
            scrollWheelZoom
          >
            <TileLayer
              key={colorScheme}
              attribution={tiles.attribution}
              url={tiles.url}
              subdomains={tiles.subdomains}
              eventHandlers={{ tileerror: handleTileError }}
            />
            {/* O6/O9 remain unresolved. Do not center tiles on precise device-derived coordinates until the tile-provider decision is approved. */}
            <MapViewportController onMapReady={setMapInstance} />
            <DeviceLocationLayer position={geolocation.position} />
            {points.length > 0 && (
              <MarkerClusterLayer points={points} onSelectPoint={handleSelectPoint} />
            )}
            <MapCustomLocationLayer
              selection={customSelection}
              onMapClick={handleMapClick}
            />
          </MapContainer>
        </MapRenderBoundary>
      </div>

      <aside className={styles.mapControls} aria-label="Výber miesta hlásenia">
        <h1 className={styles.title}>Označte miesto poruchy</h1>
        <p className={styles.locationStatus} role="status" aria-live="polite">
          {locationStatusMessage(geolocation.status)}
        </p>
        {navigationNotice === 'target-required' && (
          <p className={styles.notice} role="status">
            Výber miesta sa po obnovení stránky stratil. Vyberte miesto znova.
          </p>
        )}
        {dataError && (
          <p className={styles.error} role="alert">
            Evidované svetelné body sa nepodarilo načítať. Môžete zadať miesto ručne alebo pokračovať bez bodu na mape.
          </p>
        )}
        {tilesUnavailable && (
          <p className={styles.error} role="alert">
            Podklad mapy sa nepodarilo zobraziť. Použite zoznam bodov, zadajte súradnice alebo pokračujte vo formulári.
          </p>
        )}
        {loading && <p className={styles.loading} role="status">Načítavam evidované svetelné body…</p>}

        <div className={styles.actionGroup}>
          <button
            type="button"
            className={styles.actionButton}
            onClick={(event) => {
              if (!geolocation.position) return;
              openCandidate(
                {
                  kind: 'device',
                  latitude: geolocation.position.latitude,
                  longitude: geolocation.position.longitude,
                },
                'Poloha vášho zariadenia.',
                event.currentTarget
              );
            }}
            disabled={!geolocation.position}
          >
            Vybrať polohu zariadenia ako cieľ hlásenia
          </button>
          <button
            type="button"
            className={styles.actionButton}
            onClick={(event) => openCandidate(
              { kind: 'manual' },
              'Miesto zadáte ručne vo formulári.',
              event.currentTarget
            )}
          >
            Pokračovať bez výberu bodu na mape
          </button>
        </div>

        {customSelection && !candidate && (
          <button
            type="button"
            className={styles.actionButton}
            onClick={(event) => openCandidate(
              { kind: 'custom', ...customSelection },
              'Vami vybrané miesto na mape.',
              event.currentTarget
            )}
          >
            Potvrdiť vybrané miesto {formatCoordinates(customSelection.latitude, customSelection.longitude)}
          </button>
        )}

        <form className={styles.coordinateForm} onSubmit={handleCoordinateSubmit} noValidate>
          <h2 className={styles.subheading}>Zadať súradnice ručne</h2>
          <label htmlFor="manual-latitude">Zemepisná šírka</label>
          <input
            id="manual-latitude"
            name="latitude"
            type="text"
            inputMode="decimal"
            autoComplete="off"
            value={latitudeInput}
            onChange={(event) => setLatitudeInput(event.currentTarget.value)}
            aria-invalid={Boolean(coordinateError)}
            aria-describedby={coordinateError ? 'coordinate-error' : undefined}
          />
          <label htmlFor="manual-longitude">Zemepisná dĺžka</label>
          <input
            id="manual-longitude"
            name="longitude"
            type="text"
            inputMode="decimal"
            autoComplete="off"
            value={longitudeInput}
            onChange={(event) => setLongitudeInput(event.currentTarget.value)}
            aria-invalid={Boolean(coordinateError)}
            aria-describedby={coordinateError ? 'coordinate-error' : undefined}
          />
          {coordinateError && <p id="coordinate-error" className={styles.error} role="alert">{coordinateError}</p>}
          <button type="submit" className={styles.actionButton}>Použiť zadané miesto</button>
        </form>

        <details className={styles.pointChooser}>
          <summary>Evidované svetelné body {loading ? '(načítavajú sa)' : `(${points.length})`}</summary>
          {!loading && points.length === 0 && (
            <p>{dataError ? 'Zoznam nie je dostupný.' : 'Nie sú dostupné žiadne evidované body.'}</p>
          )}
          {points.length > 0 && (
            <ul>
              {points.map((point) => (
                <li key={point.id}>
                  <button
                    type="button"
                    className={styles.pointButton}
                    onClick={(event) => handleSelectPoint(point, event.currentTarget)}
                  >
                    {point.inventory_number?.trim() || `Svetelný bod ${point.id}`}
                    {point.address?.trim() ? ` · ${point.address.trim()}` : ''}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </details>
        <p className={styles.mapHealth}>
          {mapControlsUsable
            ? 'Ťuknite na mapu pre vlastný bod; body možno vybrať aj zo zoznamu.'
            : 'Výber bodu mimo mapy zostáva dostupný.'}
        </p>
      </aside>

      {candidate && (
        <TargetConfirmationDialog
          target={candidate.target}
          summary={candidate.summary}
          returnFocusTo={candidate.returnFocusTo}
          onConfirm={handleConfirm}
          onCancel={() => setCandidate(null)}
        />
      )}
    </div>
  );
}
