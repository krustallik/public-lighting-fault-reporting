/** Responsive marker dimensions — CSS uses rem/clamp; Leaflet needs px from layout. */

export interface MapMarkerSizesPx {
  outer: number;
  inner: number;
  anchor: number;
  cluster: {
    small: number;
    medium: number;
    large: number;
  };
}

function measureCssLength(value: string, context: HTMLElement): number {
  const probe = document.createElement('div');
  probe.style.position = 'absolute';
  probe.style.visibility = 'hidden';
  probe.style.pointerEvents = 'none';
  probe.style.width = value;
  context.appendChild(probe);
  const pixels = probe.offsetWidth;
  context.removeChild(probe);
  return pixels;
}

/** Read computed marker sizes from map container CSS variables. */
export function getMapMarkerSizesPx(mapContainer: HTMLElement): MapMarkerSizesPx {
  const styles = getComputedStyle(mapContainer);

  const outer = measureCssLength(
    styles.getPropertyValue('--map-marker-outer').trim() || '1.75rem',
    mapContainer
  );
  const inner = measureCssLength(
    styles.getPropertyValue('--map-marker-inner').trim() || '1.3125rem',
    mapContainer
  );
  const clusterMedium = measureCssLength(
    styles.getPropertyValue('--map-cluster-medium-outer').trim() || '2.1875rem',
    mapContainer
  );
  const clusterLarge = measureCssLength(
    styles.getPropertyValue('--map-cluster-large-outer').trim() || '2.625rem',
    mapContainer
  );

  return {
    outer,
    inner,
    anchor: outer / 2,
    cluster: {
      small: outer,
      medium: clusterMedium,
      large: clusterLarge,
    },
  };
}
