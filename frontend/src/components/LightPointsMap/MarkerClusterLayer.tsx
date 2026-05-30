import { useEffect, useState } from 'react';
import { useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet.markercluster';
import type { LightPoint } from '@/types/lightPoint';
import { createLightPointMarkerIcon } from '@/utils/lightPointMarkerIcon';
import { buildLightPointPopupHtml } from '@/utils/lightPointPopup';
import { getMapMarkerSizesPx } from '@/utils/mapMarkerSize';

interface MarkerClusterLayerProps {
  points: LightPoint[];
}

export function MarkerClusterLayer({ points }: MarkerClusterLayerProps) {
  const map = useMap();
  const [layoutEpoch, setLayoutEpoch] = useState(0);

  useEffect(() => {
    const container = map.getContainer();
    const observer = new ResizeObserver(() => setLayoutEpoch((n) => n + 1));
    observer.observe(container);
    const onOrientationChange = () => setLayoutEpoch((n) => n + 1);
    window.addEventListener('orientationchange', onOrientationChange);

    return () => {
      observer.disconnect();
      window.removeEventListener('orientationchange', onOrientationChange);
    };
  }, [map]);

  useEffect(() => {
    const mapContainer = map.getContainer();
    const sizes = getMapMarkerSizesPx(mapContainer);
    const pointIcon = createLightPointMarkerIcon(sizes);

    const clusterGroup = L.markerClusterGroup({
      showCoverageOnHover: false,
      zoomToBoundsOnClick: true,
      spiderfyOnMaxZoom: true,
      maxClusterRadius: 50,
      disableClusteringAtZoom: 18,
      iconCreateFunction: (cluster) => {
        const count = cluster.getChildCount();
        const sizeClass =
          count < 10
            ? 'marker-cluster-small'
            : count < 50
              ? 'marker-cluster-medium'
              : 'marker-cluster-large';
        const iconPx =
          sizeClass === 'marker-cluster-small'
            ? sizes.cluster.small
            : sizeClass === 'marker-cluster-medium'
              ? sizes.cluster.medium
              : sizes.cluster.large;

        return L.divIcon({
          html: `<div><span>${count}</span></div>`,
          className: `marker-cluster ${sizeClass}`,
          iconSize: L.point(iconPx, iconPx),
        });
      },
    });

    for (const point of points) {
      const marker = L.marker([point.latitude, point.longitude], { icon: pointIcon });
      const address = point.address?.trim() || 'Adresa nie je k dispozícii';
      marker.bindPopup(buildLightPointPopupHtml(point, address));
      clusterGroup.addLayer(marker);
    }

    map.addLayer(clusterGroup);

    return () => {
      map.removeLayer(clusterGroup);
      clusterGroup.clearLayers();
    };
  }, [map, points, layoutEpoch]);

  return null;
}
