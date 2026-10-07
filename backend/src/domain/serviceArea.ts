import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import Coordinate from 'jsts/org/locationtech/jts/geom/Coordinate.js';
import GeometryFactory from 'jsts/org/locationtech/jts/geom/GeometryFactory.js';
import IsValidOp from 'jsts/org/locationtech/jts/operation/valid/IsValidOp.js';
import RelateOp from 'jsts/org/locationtech/jts/operation/relate/RelateOp.js';
import GeoJSONReader from 'jsts/org/locationtech/jts/io/GeoJSONReader.js';

export type ServiceAreaClassification = 'inside' | 'outside' | 'invalid-coordinate' | 'unavailable';
export interface ServiceAreaPoint { latitude: number; longitude: number }
export type ServiceAreaGeometry = { type: 'Polygon' | 'MultiPolygon'; coordinates: unknown };
export interface ServiceAreaArtifactManifest {
  schemaVersion: number;
  output: { crs: string; axisOrder: string; geojsonSha256: string; representativePoint?: unknown };
}

const ARTIFACT_PATH = fileURLToPath(new URL('../data/service-area/kosice-city.geojson', import.meta.url));
const MANIFEST_PATH = fileURLToPath(new URL('../data/service-area/kosice-city.manifest.json', import.meta.url));
const geometryFactory = new GeometryFactory();
const geoJsonReader = new GeoJSONReader(geometryFactory);

function isFinitePosition(value: unknown): value is [number, number] {
  return Array.isArray(value) && value.length === 2 &&
    typeof value[0] === 'number' && Number.isFinite(value[0]) && value[0] >= -180 && value[0] <= 180 &&
    typeof value[1] === 'number' && Number.isFinite(value[1]) && value[1] >= -90 && value[1] <= 90;
}

function isRing(value: unknown): value is [number, number][][] {
  if (!Array.isArray(value) || value.length < 4 || !value.every(isFinitePosition)) return false;
  const first = value[0];
  const last = value[value.length - 1];
  return first[0] === last[0] && first[1] === last[1];
}

function isPolygonCoordinates(value: unknown): value is [number, number][][] {
  return Array.isArray(value) && value.length > 0 && value.every(isRing);
}

function isBoundaryJson(value: unknown): value is ServiceAreaGeometry {
  if (!value || typeof value !== 'object' || !('type' in value) || !('coordinates' in value)) return false;
  const geometry = value as ServiceAreaGeometry;
  if (geometry.type === 'Polygon') return isPolygonCoordinates(geometry.coordinates);
  return geometry.type === 'MultiPolygon' && Array.isArray(geometry.coordinates) &&
    geometry.coordinates.length > 0 && geometry.coordinates.every(isPolygonCoordinates);
}

function parseValidBoundary(value: unknown): { json: ServiceAreaGeometry; geometry: any } {
  if (!isBoundaryJson(value)) throw new Error('Service-area geometry schema is invalid');
  const geometry = geoJsonReader.read(value);
  if (geometry.isEmpty() || geometry.getArea() <= 0 || !new IsValidOp(geometry).isValid()) {
    throw new Error('Service-area geometry topology is invalid');
  }
  return { json: value, geometry };
}

export function loadServiceAreaArtifact(
  artifactPath = ARTIFACT_PATH,
  manifestPath = MANIFEST_PATH
): (point: unknown) => ServiceAreaClassification {
  try {
    const artifactBytes = readFileSync(artifactPath);
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as ServiceAreaArtifactManifest;
    if (
      manifest.schemaVersion !== 1 || manifest.output?.crs !== 'OGC:CRS84' ||
      manifest.output.axisOrder !== 'longitude,latitude' ||
      createHash('sha256').update(artifactBytes).digest('hex') !== manifest.output.geojsonSha256
    ) throw new Error('Service-area artifact checksum or manifest is invalid');
    const { geometry } = parseValidBoundary(JSON.parse(artifactBytes.toString('utf8')));
    return createServiceAreaClassifier(geometry);
  } catch {
    return () => 'unavailable';
  }
}

export function createServiceAreaClassifier(boundary: unknown): (point: unknown) => ServiceAreaClassification {
  let geometry: any;
  try {
    geometry = boundary && typeof boundary === 'object' && typeof (boundary as any).getGeometryType === 'function'
      ? boundary
      : parseValidBoundary(boundary).geometry;
  } catch {
    return () => 'unavailable';
  }

  return (value: unknown): ServiceAreaClassification => {
    if (!value || typeof value !== 'object' || !('latitude' in value) || !('longitude' in value)) {
      return 'invalid-coordinate';
    }
    const latitude = (value as ServiceAreaPoint).latitude;
    const longitude = (value as ServiceAreaPoint).longitude;
    if (
      typeof latitude !== 'number' || typeof longitude !== 'number' ||
      !Number.isFinite(latitude) || !Number.isFinite(longitude) ||
      latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180
    ) return 'invalid-coordinate';

    try {
      const point = geometryFactory.createPoint(new Coordinate(longitude, latitude));
      const polygonCount = geometry.getGeometryType() === 'Polygon' ? 1 : geometry.getNumGeometries();
      for (let polygonIndex = 0; polygonIndex < polygonCount; polygonIndex += 1) {
        const polygon = geometry.getGeometryType() === 'Polygon'
          ? geometry
          : geometry.getGeometryN(polygonIndex);
        for (let ringIndex = 0; ringIndex < polygon.getNumInteriorRing(); ringIndex += 1) {
          if (RelateOp.intersects(polygon.getInteriorRingN(ringIndex), point)) return 'outside';
        }
      }
      return RelateOp.covers(geometry, point) ? 'inside' : 'outside';
    } catch {
      return 'unavailable';
    }
  };
}

export const kosiceServiceAreaClassifier = loadServiceAreaArtifact();

function loadRepresentativePoint(): readonly [number, number] | undefined {
  try {
    const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as ServiceAreaArtifactManifest;
    const point = manifest.output?.representativePoint;
    if (Array.isArray(point) && point.length === 2 && point.every((value) => typeof value === 'number' && Number.isFinite(value))) {
      return [point[0], point[1]];
    }
  } catch { /* unavailable manifests fail closed at the address-service boundary */ }
  return undefined;
}

export const KOSICE_REPRESENTATIVE_POINT = loadRepresentativePoint();

export function classifyServiceAreaPoint(point: unknown, boundary: unknown): ServiceAreaClassification {
  return createServiceAreaClassifier(boundary)(point);
}
