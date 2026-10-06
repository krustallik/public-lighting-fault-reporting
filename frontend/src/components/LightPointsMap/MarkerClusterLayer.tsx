import { useEffect, useState } from 'react';
import { useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet.markercluster';
import type { LightPoint } from '@/types/lightPoint';
import { createLightPointMarkerIcon } from '@/utils/lightPointMarkerIcon';
import { buildLightPointPopupHtml } from '@/utils/lightPointPopup';
import { getMapMarkerSizesPx } from '@/utils/mapMarkerSize';
import type { ReportFormMessages } from '@/i18n/reportFormMessages';

interface MarkerClusterLayerProps {
  points: LightPoint[];
  locale: string;
  labels: {
    inventory: string;
    address: string;
    addressUnavailable: string;
    type: string;
    status: string;
    statusValues: ReportFormMessages['map']['statusValues'];
    choose: string;
  };
  onSelectPoint: (point: LightPoint, trigger: HTMLElement | null) => void;
}

export function MarkerClusterLayer({ points, locale, labels, onSelectPoint }: MarkerClusterLayerProps) {
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
    const popupHandlers: Array<{
      marker: L.Marker;
      open: () => void;
      close: () => void;
      button: HTMLButtonElement | null;
      select: () => void;
    }> = [];

    for (const point of points) {
      const marker = L.marker([point.latitude, point.longitude], { icon: pointIcon });
      const address = point.address?.trim() || labels.addressUnavailable;
      marker.bindPopup(buildLightPointPopupHtml(point, address, labels));
      const handler: {
        marker: L.Marker;
        open: () => void;
        close: () => void;
        button: HTMLButtonElement | null;
        select: () => void;
      } = {
        marker,
        button: null as HTMLButtonElement | null,
        select: () => {},
        open: () => {
          handler.button = marker
            .getPopup()
            ?.getElement()
            ?.querySelector<HTMLButtonElement>(`[data-select-light-point="${point.id}"]`) ?? null;
          handler.button?.addEventListener('click', handler.select);
        },
        close: () => {
          handler.button?.removeEventListener('click', handler.select);
          handler.button = null;
        },
      };
      handler.select = () => onSelectPoint(point, handler.button);
      marker.on('popupopen', handler.open);
      marker.on('popupclose', handler.close);
      popupHandlers.push(handler);
      clusterGroup.addLayer(marker);
    }

    map.addLayer(clusterGroup);

    return () => {
      for (const handler of popupHandlers) {
        handler.close();
        handler.marker.off('popupopen', handler.open);
        handler.marker.off('popupclose', handler.close);
      }
      map.removeLayer(clusterGroup);
      clusterGroup.clearLayers();
    };
  }, [map, onSelectPoint, points, layoutEpoch, labels, locale]);

  return null;
}
