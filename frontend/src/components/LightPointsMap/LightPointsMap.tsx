import { Component, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { MapContainer, TileLayer, ZoomControl, useMap } from 'react-leaflet';
import type L from 'leaflet';
import { useLocation, useNavigate } from 'react-router-dom';
import { resolveMapTileConfig, canRecenterMapToDeviceLocation } from '@/config/mapTiles';
import { usePrefersColorScheme } from '@/hooks/usePrefersColorScheme';
import { useMapEntryGeolocation } from '@/hooks/useMapEntryGeolocation';
import { useReportFormLocale } from '@/context/ReportFormLocaleContext';
import { ReportFormLocaleSwitch } from '@/components/ReportFormLocaleSwitch/ReportFormLocaleSwitch';
import { getLightPoints } from '@/services/lightPointsApi';
import type { LightPoint } from '@/types/lightPoint';
import { isValidLightPointCoords } from '@/types/lightPoint';
import { TargetConfirmationDialog } from '@/components/TargetConfirmationDialog/TargetConfirmationDialog';
import {
  createReportNavigationState,
  type ReportTarget,
} from '@/utils/reportNavigationTarget';
import {
  MapCustomLocationLayer,
  type CustomMapSelection,
} from './MapCustomLocationLayer';
import { DeviceLocationLayer } from './DeviceLocationLayer';
import { MarkerClusterLayer } from './MarkerClusterLayer';
import { FallbackKnownPointChooser } from './FallbackKnownPointChooser';
import styles from './LightPointsMap.module.css';

const KOSICE_CENTER: [number, number] = [48.7164, 21.2611];
const CITY_ZOOM = 12;
const DEVICE_ZOOM = 16;

interface TargetCandidate {
  target: ReportTarget;
  summary: string;
  returnFocusTo: HTMLElement | null;
}

class MapRenderBoundary extends Component<{
  children: ReactNode;
  failureMessage: string;
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
      return <div className={styles.mapFailure} role="alert">{this.props.failureMessage}</div>;
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

function isFocusable(value: unknown): value is HTMLElement {
  return value instanceof HTMLElement && value.isConnected;
}

export function LightPointsMap() {
  const [colorScheme, setColorScheme] = usePrefersColorScheme();
  const { locale, messages } = useReportFormLocale();
  const navigate = useNavigate();
  const location = useLocation();
  const geolocation = useMapEntryGeolocation();
  const mapRef = useRef<L.Map | null>(null);
  const mapRegionRef = useRef<HTMLDivElement | null>(null);
  const resumeConfirmationRef = useRef<HTMLButtonElement | null>(null);
  const [points, setPoints] = useState<LightPoint[]>([]);
  const [dataError, setDataError] = useState(false);
  const [mapRenderFailed, setMapRenderFailed] = useState(false);
  const [tilesUnavailable, setTilesUnavailable] = useState(false);
  const [customSelection, setCustomSelection] = useState<CustomMapSelection | null>(null);
  const [candidate, setCandidate] = useState<TargetCandidate | null>(null);
  const [confirmationHidden, setConfirmationHidden] = useState(false);
  const [locationStatus, setLocationStatus] = useState('');

  const navigationNotice =
    location.state && typeof location.state === 'object' && 'notice' in location.state
      ? location.state.notice
      : null;

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

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (geolocation.status === 'requesting') {
      setLocationStatus(messages.map.locationMessages.requesting);
    } else if (geolocation.status === 'denied' || geolocation.status === 'timeout' || geolocation.status === 'unsupported') {
      setLocationStatus(messages.map.locationMessages[geolocation.status]);
    } else if (geolocation.status === 'available') {
      setLocationStatus('');
    } else {
      setLocationStatus(messages.map.locationMessages.unavailable);
    }
  }, [geolocation.status, messages]);

  const setMapInstance = useCallback((map: L.Map | null) => {
    mapRef.current = map;
  }, []);

  const openCandidate = useCallback((target: ReportTarget, summary: string, trigger?: HTMLElement | null) => {
    if (target.kind !== 'custom') setCustomSelection(null);
    setConfirmationHidden(false);
    setCandidate({
      target,
      summary,
      returnFocusTo: isFocusable(trigger) ? trigger : mapRegionRef.current,
    });
  }, []);

  useEffect(() => {
    if (confirmationHidden) resumeConfirmationRef.current?.focus();
  }, [confirmationHidden]);

  const handleMapClick = useCallback((latitude: number, longitude: number) => {
    setCustomSelection({ latitude, longitude });
    openCandidate({ kind: 'custom', latitude, longitude }, messages.map.targetCustomSummary);
  }, [messages.map.targetCustomSummary, openCandidate]);

  const handleSelectPoint = useCallback((point: LightPoint, trigger: HTMLElement | null) => {
    openCandidate(
      { kind: 'light-point', lightPointId: point.id },
      [point.inventory_number?.trim(), point.address?.trim(), `#${point.id}`]
        .filter(Boolean)
        .join(' · '),
      trigger
    );
  }, [openCandidate]);

  const handleSelectDevice = useCallback((trigger?: HTMLElement | null) => {
    if (!geolocation.position) return;
    openCandidate(
      {
        kind: 'device',
        latitude: geolocation.position.latitude,
        longitude: geolocation.position.longitude,
      },
      messages.map.targetDeviceSummary,
      trigger
    );
  }, [geolocation.position, messages.map.targetDeviceSummary, openCandidate]);

  const handleConfirm = () => {
    if (!candidate) return;
    navigate('/report', { state: createReportNavigationState(candidate.target) });
  };

  const handleCancelCandidate = () => {
    if (candidate?.target.kind === 'custom') setCustomSelection(null);
    setCandidate(null);
    setConfirmationHidden(false);
  };

  const tileConfig = resolveMapTileConfig(colorScheme);
  const mapTilesEnabled = tileConfig.enabled;
  const recenterAllowed = mapTilesEnabled && canRecenterMapToDeviceLocation();
  const locationFailed = geolocation.status === 'denied' ||
    geolocation.status === 'timeout' ||
    geolocation.status === 'unsupported' ||
    geolocation.status === 'unavailable';
  const handleRecenter = () => {
    if (!recenterAllowed || !geolocation.position || !mapRef.current) return;
    mapRef.current.setView(
      [geolocation.position.latitude, geolocation.position.longitude],
      DEVICE_ZOOM,
      { animate: false }
    );
    setLocationStatus(messages.map.recenterStatus);
  };

  const candidateSummary = candidate?.target.kind === 'custom'
    ? messages.map.targetCustomSummary
    : candidate?.target.kind === 'device'
      ? messages.map.targetDeviceSummary
      : candidate?.target.kind === 'manual'
        ? messages.map.targetManualSummary
        : candidate?.summary ?? '';

  const mapUnavailable = mapRenderFailed || tilesUnavailable || !mapTilesEnabled;

  return (
    <div className={styles.wrapper} data-theme={colorScheme} data-tile-provider={tileConfig.provider}>
      <div
        ref={mapRegionRef}
        className={styles.mapRegion}
        role="region"
        aria-label={messages.map.regionLabel}
        tabIndex={-1}
      >
        <MapRenderBoundary
          failureMessage={messages.map.mapFailure}
          onFailure={() => setMapRenderFailed(true)}
        >
          <MapContainer
            center={KOSICE_CENTER}
            zoom={CITY_ZOOM}
            className={styles.map}
            scrollWheelZoom
            zoomControl={false}
          >
            {mapTilesEnabled && (
              <TileLayer
                attribution={tileConfig.attribution}
                url={tileConfig.url}
                maxZoom={tileConfig.maxZoom}
                eventHandlers={{ tileerror: () => setTilesUnavailable(true) }}
              />
            )}
            <ZoomControl
              position="topleft"
              zoomInText="+"
              zoomOutText="−"
              zoomInTitle={messages.map.zoomIn}
              zoomOutTitle={messages.map.zoomOut}
            />
            <MapViewportController onMapReady={setMapInstance} />
            <DeviceLocationLayer
              position={geolocation.position}
              alt={messages.map.deviceMarkerAlt}
              onSelect={handleSelectDevice}
            />
            {points.length > 0 && (
              <MarkerClusterLayer
                points={points}
                locale={locale}
                labels={{
                  inventory: messages.form.inventoryPrefix,
                  address: messages.map.pointAddress,
                  addressUnavailable: messages.map.addressUnavailable,
                  type: messages.map.pointType,
                  status: messages.map.pointStatus,
                  statusValues: messages.map.statusValues,
                  choose: messages.map.choosePoint,
                }}
                onSelectPoint={handleSelectPoint}
              />
            )}
            <MapCustomLocationLayer
              selection={customSelection}
              markerAlt={messages.map.customMarkerAlt}
              onMapClick={handleMapClick}
            />
          </MapContainer>
        </MapRenderBoundary>
      </div>

      <div className={styles.topControls} data-testid="map-controls-top">
        <ReportFormLocaleSwitch compact mapControl />
        <button
          className={styles.iconButton}
          type="button"
          aria-label={`${messages.map.toggleThemeLabel}: ${colorScheme === 'light' ? messages.map.darkThemeLabel : messages.map.lightThemeLabel}`}
          title={`${messages.map.toggleThemeLabel}: ${colorScheme === 'light' ? messages.map.darkThemeLabel : messages.map.lightThemeLabel}`}
          onClick={() => setColorScheme(colorScheme === 'light' ? 'dark' : 'light')}
        >
          <span aria-hidden="true">{colorScheme === 'light' ? '☾' : '☀'}</span>
        </button>
        <button
          className={styles.iconButton}
          type="button"
          aria-label={messages.map.recenterLabel}
          aria-describedby={!recenterAllowed ? 'map-recenter-disabled-hint' : undefined}
          title={!recenterAllowed ? messages.map.recenterBlocked : messages.map.recenterLabel}
          onClick={handleRecenter}
          disabled={!recenterAllowed || !geolocation.position}
        >
          <span aria-hidden="true">◎</span>
        </button>
      </div>
      {!recenterAllowed && (
        <p id="map-recenter-disabled-hint" className={styles.srOnly}>
          {messages.map.recenterBlocked}
        </p>
      )}

      {!confirmationHidden && (
        <div className={styles.bottomControls} data-testid="map-controls-bottom">
          <p className={styles.mapHint}>{messages.map.hint}</p>
          <details className={styles.privacyDisclosure}>
            <summary>{messages.map.dataUseSummary}</summary>
            <p>{messages.map.dataUseNotice}</p>
          </details>
          <button
            type="button"
            className={styles.continueButton}
            onClick={(event) => openCandidate(
              { kind: 'manual' },
              messages.map.targetManualSummary,
              event.currentTarget
            )}
          >
            {messages.map.continueWithoutMap}
          </button>
        </div>
      )}

      {candidate && confirmationHidden && (
        <div className={styles.resumeControls}>
          <p className={styles.srOnly} role="status" aria-live="polite">
            {candidateSummary} {messages.map.selectedLocationHidden}
          </p>
          <button
            ref={resumeConfirmationRef}
            type="button"
            className={styles.resumeButton}
            data-testid="resume-target-confirmation"
            onClick={() => setConfirmationHidden(false)}
          >
            {messages.map.resumeSelectedLocation}
          </button>
        </div>
      )}

      {(dataError || tilesUnavailable) && (
        <p className={styles.failureNotice} role="alert">
          {dataError ? messages.map.pointsFailure : messages.map.tilesFailure}
        </p>
      )}
      {!mapTilesEnabled && !mapRenderFailed && (
        <p className={styles.failureNotice} role="status">{messages.map.tilesNotConfigured}</p>
      )}
      {locationFailed && (
        <p className={styles.locationNotice} role="status">{locationStatus}</p>
      )}
      {!locationFailed && (
        <p className={styles.srOnly} role="status" aria-live="polite" aria-label={messages.map.geolocationStatus}>
          {locationStatus}
        </p>
      )}
      {navigationNotice === 'target-required' && (
        <p className={styles.failureNotice} role="status">{messages.map.targetRequiredNotice}</p>
      )}

      {mapUnavailable && points.length > 0 && (
        <FallbackKnownPointChooser
          points={points}
          locale={locale}
          messages={messages.map}
          onSelect={(point, trigger) => handleSelectPoint(point, trigger)}
        />
      )}

      {candidate && !confirmationHidden && (
        <TargetConfirmationDialog
          target={candidate.target}
          summary={candidateSummary}
          returnFocusTo={candidate.returnFocusTo}
          messages={messages.confirmation}
          onConfirm={handleConfirm}
          onCancel={handleCancelCandidate}
          onHide={() => setConfirmationHidden(true)}
        />
      )}
    </div>
  );
}
