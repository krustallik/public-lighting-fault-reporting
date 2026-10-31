import { Component, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { MapContainer, TileLayer, ZoomControl, useMap } from 'react-leaflet';
import type L from 'leaflet';
import { useLocation, useNavigate } from 'react-router-dom';
import { resolveMapTileConfig, canRecenterMapToDeviceLocation } from '@/config/mapTiles';
import { KOSICE_MAP_BOUNDS } from '@/config/kosiceMapBounds';
import { usePrefersColorScheme } from '@/hooks/usePrefersColorScheme';
import { useMapEntryGeolocation } from '@/hooks/useMapEntryGeolocation';
import { useReportFormLocale } from '@/context/ReportFormLocaleContext';
import { ReportFormLocaleSwitch } from '@/components/ReportFormLocaleSwitch/ReportFormLocaleSwitch';
import { getLightPoints } from '@/services/lightPointsApi';
import {
  ReportTargetValidationError,
  validateReportTargetLocation,
} from '@/services/reportTargetValidationApi';
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
import styles from './LightPointsMap.module.css';

const KOSICE_CENTER: [number, number] = [48.7164, 21.2611];
const CITY_ZOOM = 12;
const DEVICE_ZOOM = 16;

interface TargetCandidate {
  target: ReportTarget;
  summary: string;
  returnFocusTo: HTMLElement | null;
}

type SpatialReportTarget = Exclude<ReportTarget, { kind: 'manual' }>;

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
      return <div className={styles.mapFailure} aria-hidden="true" />;
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

  useEffect(() => {
    const keepViewportInsideCity = () => {
      // Reset first so a narrower viewport can lower a min zoom computed for
      // a wider previous viewport (for example, after rotating a phone).
      map.setMinZoom(0);
      map.setMinZoom(map.getBoundsZoom(KOSICE_MAP_BOUNDS, true));
    };

    keepViewportInsideCity();
    map.on('resize', keepViewportInsideCity);
    return () => {
      map.off('resize', keepViewportInsideCity);
    };
  }, [map]);

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
  const recenterAfterLocationRequest = useRef(false);
  const [mapReady, setMapReady] = useState(false);
  const mapRegionRef = useRef<HTMLDivElement | null>(null);
  const resumeConfirmationRef = useRef<HTMLButtonElement | null>(null);
  const [points, setPoints] = useState<LightPoint[]>([]);
  const [dataError, setDataError] = useState(false);
  const [mapRenderFailed, setMapRenderFailed] = useState(false);
  const [tileBatchComplete, setTileBatchComplete] = useState(false);
  const [hasLoadedTileInCurrentBatch, setHasLoadedTileInCurrentBatch] = useState(false);
  const [customSelection, setCustomSelection] = useState<CustomMapSelection | null>(null);
  const [candidate, setCandidate] = useState<TargetCandidate | null>(null);
  const [confirmationHidden, setConfirmationHidden] = useState(false);
  const [locationStatus, setLocationStatus] = useState('');
  const [validatingTarget, setValidatingTarget] = useState(false);
  const [targetSelectionError, setTargetSelectionError] = useState<'outside' | 'unavailable' | null>(null);
  const targetValidationController = useRef<AbortController | null>(null);
  const targetValidationSequence = useRef(0);

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

  useEffect(() => {
    if (geolocation.status === 'denied' || geolocation.status === 'timeout' ||
      geolocation.status === 'unsupported' || geolocation.status === 'unavailable') {
      recenterAfterLocationRequest.current = false;
      return;
    }

    if (geolocation.status !== 'available' || !geolocation.position || !mapReady ||
      !recenterAfterLocationRequest.current || !mapRef.current) return;

    recenterAfterLocationRequest.current = false;
    mapRef.current.setView(
      [geolocation.position.latitude, geolocation.position.longitude],
      DEVICE_ZOOM,
      { animate: false }
    );
    setLocationStatus(messages.map.recenterStatus);
  }, [geolocation.position, geolocation.status, mapReady, messages.map.recenterStatus]);

  const setMapInstance = useCallback((map: L.Map | null) => {
    mapRef.current = map;
    setMapReady(map !== null);
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

  useEffect(() => () => {
    targetValidationController.current?.abort();
  }, []);

  const validateAndOpenCandidate = useCallback(async (
    target: SpatialReportTarget,
    summary: string,
    trigger?: HTMLElement | null
  ) => {
    targetValidationController.current?.abort();
    const controller = new AbortController();
    targetValidationController.current = controller;
    const sequence = ++targetValidationSequence.current;
    setValidatingTarget(true);
    setTargetSelectionError(null);
    setCandidate(null);
    setCustomSelection(null);
    setConfirmationHidden(false);

    try {
      await validateReportTargetLocation(target, controller.signal);
      if (controller.signal.aborted || sequence !== targetValidationSequence.current) return;
      if (target.kind === 'custom') {
        setCustomSelection({ latitude: target.latitude, longitude: target.longitude });
      }
      openCandidate(target, summary, trigger);
      setValidatingTarget(false);
    } catch (error) {
      if (controller.signal.aborted || sequence !== targetValidationSequence.current) return;
      setValidatingTarget(false);
      setTargetSelectionError(
        error instanceof ReportTargetValidationError && error.code === 'outside_service_area'
          ? 'outside'
          : 'unavailable'
      );
    }
  }, [openCandidate]);

  const handleMapClick = useCallback((latitude: number, longitude: number) => {
    void validateAndOpenCandidate(
      { kind: 'custom', latitude, longitude },
      messages.map.targetCustomSummary
    );
  }, [messages.map.targetCustomSummary, validateAndOpenCandidate]);

  const handleSelectPoint = useCallback((point: LightPoint, trigger: HTMLElement | null) => {
    void validateAndOpenCandidate(
      { kind: 'light-point', lightPointId: point.id },
      [point.inventory_number?.trim(), point.address?.trim(), `#${point.id}`]
        .filter(Boolean)
        .join(' · '),
      trigger
    );
  }, [validateAndOpenCandidate]);

  const handleSelectDevice = useCallback((trigger?: HTMLElement | null) => {
    if (!geolocation.position) return;
    void validateAndOpenCandidate(
      {
        kind: 'device',
        latitude: geolocation.position.latitude,
        longitude: geolocation.position.longitude,
      },
      messages.map.targetDeviceSummary,
      trigger
    );
  }, [geolocation.position, messages.map.targetDeviceSummary, validateAndOpenCandidate]);

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
  const locationRetryable = geolocation.status === 'denied' ||
    geolocation.status === 'timeout' ||
    geolocation.status === 'unavailable';
  const handleRecenter = () => {
    if (!recenterAllowed) return;
    if (!geolocation.position) {
      if (locationRetryable) {
        recenterAfterLocationRequest.current = true;
        geolocation.requestPosition();
      }
      return;
    }
    if (!mapRef.current) return;
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

  // A few failed raster tiles are normal on a large map. Show the manual path
  // only when the latest completed visible tile batch rendered no tiles at all.
  const mapUnavailable = mapRenderFailed || !mapTilesEnabled || (tileBatchComplete && !hasLoadedTileInCurrentBatch);
  const continueToManualReport = () => {
    targetValidationController.current?.abort();
    targetValidationSequence.current += 1;
    navigate('/report', { state: createReportNavigationState({ kind: 'manual' }) });
  };

  const continueWithoutMap = (trigger: HTMLElement) => {
    targetValidationController.current?.abort();
    targetValidationSequence.current += 1;
    setValidatingTarget(false);
    setTargetSelectionError(null);
    openCandidate({ kind: 'manual' }, messages.map.targetManualSummary, trigger);
  };

  return (
    <main className={styles.wrapper} data-theme={colorScheme} data-tile-provider={tileConfig.provider}>
      <h1 className={styles.srOnly}>{messages.map.regionLabel}</h1>
      <div
        ref={mapRegionRef}
        className={styles.mapRegion}
        role="region"
        aria-label={messages.map.regionLabel}
        tabIndex={-1}
      >
        <MapRenderBoundary
          onFailure={() => setMapRenderFailed(true)}
        >
          <MapContainer
            center={KOSICE_CENTER}
            zoom={CITY_ZOOM}
            maxZoom={tileConfig.maxZoom}
            maxBounds={KOSICE_MAP_BOUNDS}
            maxBoundsViscosity={1}
            className={styles.map}
            scrollWheelZoom
            zoomControl={false}
          >
            {mapTilesEnabled && (
              <TileLayer
                attribution={tileConfig.attribution}
                url={tileConfig.url}
                maxZoom={tileConfig.maxZoom}
                eventHandlers={{
                  loading: () => {
                    setHasLoadedTileInCurrentBatch(false);
                    setTileBatchComplete(false);
                  },
                  tileload: () => setHasLoadedTileInCurrentBatch(true),
                  load: () => setTileBatchComplete(true),
                }}
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
          className={`${styles.iconButton} ${styles.recenterButton}`}
          type="button"
          aria-label={messages.map.recenterLabel}
          aria-describedby={!recenterAllowed ? 'map-recenter-disabled-hint' : undefined}
          title={!recenterAllowed ? messages.map.recenterBlocked : !geolocation.position && locationRetryable ? messages.map.recenterRetryLabel : messages.map.recenterLabel}
          onClick={handleRecenter}
          disabled={!recenterAllowed || (!geolocation.position && !locationRetryable)}
        >
          <svg aria-hidden="true" viewBox="0 0 24 24" focusable="false">
            <circle cx="12" cy="12" r="7.25" />
            <circle cx="12" cy="12" r="2.25" />
            <path d="M12 1.75v3M12 19.25v3M1.75 12h3M19.25 12h3" />
          </svg>
          <span>{messages.map.recenterShortLabel}</span>
        </button>
      </div>
      {!recenterAllowed && (
        <p id="map-recenter-disabled-hint" className={styles.srOnly}>
          {messages.map.recenterBlocked}
        </p>
      )}

      {!confirmationHidden && !mapUnavailable && (
        <div className={styles.bottomControls} data-testid="map-controls-bottom">
          <p className={styles.mapHint}>{messages.map.hint}</p>
          <button
            type="button"
            className={styles.continueButton}
            onClick={(event) => continueWithoutMap(event.currentTarget)}
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

      {dataError && (
        <p className={styles.warningNotice} role="status" aria-live="polite">
          {messages.map.pointsFailure}
        </p>
      )}
      {validatingTarget && (
        <p className={styles.locationNotice} role="status" aria-live="polite">
          {messages.map.checkingTarget}
        </p>
      )}
      {targetSelectionError && (
        <p className={styles.failureNotice} role="alert">
          {targetSelectionError === 'outside'
            ? messages.map.targetOutsideServiceArea
            : messages.map.targetValidationUnavailable}
        </p>
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

      {mapUnavailable && !candidate && (
        <section className={styles.mapUnavailableNotice} role="alert" aria-labelledby="map-unavailable-title">
          <h2 id="map-unavailable-title">{messages.map.mapUnavailableTitle}</h2>
          <p>{messages.map.mapUnavailableDescription}</p>
          <button type="button" className={styles.continueButton} onClick={continueToManualReport}>
            {messages.map.openManualReport}
          </button>
        </section>
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
    </main>
  );
}
