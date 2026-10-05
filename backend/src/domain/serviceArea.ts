export type ServiceAreaClassification =
  | 'unconfigured'
  | 'invalid-coordinate'
  | 'invalid-boundary'
  | 'inside'
  | 'boundary'
  | 'outside';

export interface ServiceAreaPoint {
  latitude: number;
  longitude: number;
}

type Position = readonly [longitude: number, latitude: number];

export interface ServiceAreaPolygon {
  type: 'Polygon';
  coordinates: readonly (readonly Position[])[];
}

export interface ServiceAreaMultiPolygon {
  type: 'MultiPolygon';
  coordinates: readonly (readonly (readonly Position[])[])[];
}

export type ServiceAreaBoundary = ServiceAreaPolygon | ServiceAreaMultiPolygon;

const EDGE_EPSILON = 1e-10;

function isPosition(value: unknown): value is Position {
  return Array.isArray(value) &&
    value.length >= 2 &&
    typeof value[0] === 'number' &&
    Number.isFinite(value[0]) &&
    value[0] >= -180 &&
    value[0] <= 180 &&
    typeof value[1] === 'number' &&
    Number.isFinite(value[1]) &&
    value[1] >= -90 &&
    value[1] <= 90;
}

function isRing(value: unknown): value is readonly Position[] {
  if (!Array.isArray(value) || value.length < 4 || !value.every(isPosition)) {
    return false;
  }

  const first = value[0];
  const last = value[value.length - 1];
  return first[0] === last[0] && first[1] === last[1];
}

function isPolygon(value: unknown): value is readonly (readonly Position[])[] {
  return Array.isArray(value) && value.length > 0 && value.every(isRing);
}

function isServiceAreaBoundary(value: unknown): value is ServiceAreaBoundary {
  if (!value || typeof value !== 'object' || !('type' in value) || !('coordinates' in value)) {
    return false;
  }

  if (value.type === 'Polygon') {
    return isPolygon(value.coordinates);
  }

  return value.type === 'MultiPolygon' &&
    Array.isArray(value.coordinates) &&
    value.coordinates.length > 0 &&
    value.coordinates.every(isPolygon);
}

function classifyRing(point: Position, ring: readonly Position[]): 'inside' | 'boundary' | 'outside' {
  const [x, y] = point;
  let inside = false;

  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index, index += 1) {
    const [x1, y1] = ring[previous];
    const [x2, y2] = ring[index];
    const cross = (x - x1) * (y2 - y1) - (y - y1) * (x2 - x1);
    const withinSegment =
      x >= Math.min(x1, x2) - EDGE_EPSILON &&
      x <= Math.max(x1, x2) + EDGE_EPSILON &&
      y >= Math.min(y1, y2) - EDGE_EPSILON &&
      y <= Math.max(y1, y2) + EDGE_EPSILON;

    if (Math.abs(cross) <= EDGE_EPSILON && withinSegment) {
      return 'boundary';
    }

    const crossesRay = (y1 > y) !== (y2 > y);
    if (crossesRay && x < ((x2 - x1) * (y - y1)) / (y2 - y1) + x1) {
      inside = !inside;
    }
  }

  return inside ? 'inside' : 'outside';
}

function classifyPolygon(point: Position, polygon: readonly (readonly Position[])[]): ServiceAreaClassification {
  const outer = classifyRing(point, polygon[0]);
  if (outer === 'outside') return 'outside';
  if (outer === 'boundary') return 'boundary';

  for (const hole of polygon.slice(1)) {
    const holeResult = classifyRing(point, hole);
    if (holeResult === 'boundary') return 'boundary';
    if (holeResult === 'inside') return 'outside';
  }

  return 'inside';
}

/**
 * Classifies a coordinate against an injected GeoJSON-like service boundary.
 * It deliberately has no configured Košice boundary or edge-inclusion policy.
 */
export function classifyServiceAreaPoint(
  point: unknown,
  boundary: unknown
): ServiceAreaClassification {
  if (
    !point ||
    typeof point !== 'object' ||
    !('latitude' in point) ||
    !('longitude' in point) ||
    typeof point.latitude !== 'number' ||
    typeof point.longitude !== 'number'
  ) {
    return 'invalid-coordinate';
  }

  const { latitude, longitude } = point as ServiceAreaPoint;
  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    latitude < -90 ||
    latitude > 90 ||
    longitude < -180 ||
    longitude > 180
  ) {
    return 'invalid-coordinate';
  }

  if (boundary == null) return 'unconfigured';
  if (!isServiceAreaBoundary(boundary)) return 'invalid-boundary';

  const coordinate: Position = [longitude, latitude];
  const polygons = boundary.type === 'Polygon'
    ? [boundary.coordinates]
    : boundary.coordinates;
  const results = polygons.map((polygon) => classifyPolygon(coordinate, polygon));

  if (results.includes('inside')) return 'inside';
  if (results.includes('boundary')) return 'boundary';
  return 'outside';
}
