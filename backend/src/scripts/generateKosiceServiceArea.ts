import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import GeoJSONReader from 'jsts/org/locationtech/jts/io/GeoJSONReader.js';
import GeoJSONWriter from 'jsts/org/locationtech/jts/io/GeoJSONWriter.js';
import GeometryFactory from 'jsts/org/locationtech/jts/geom/GeometryFactory.js';
import IsValidOp from 'jsts/org/locationtech/jts/operation/valid/IsValidOp.js';
import OverlayOp from 'jsts/org/locationtech/jts/operation/overlay/OverlayOp.js';
import InteriorPointArea from 'jsts/org/locationtech/jts/algorithm/InteriorPointArea.js';

const SOURCE_PATH = fileURLToPath(new URL('../data/service-area/source/kosice-okres-802-805.epsg8353.json', import.meta.url));
const SOURCE_MANIFEST_PATH = fileURLToPath(new URL('../data/service-area/source/kosice-okres-802-805.source.manifest.json', import.meta.url));
const ARTIFACT_PATH = fileURLToPath(new URL('../data/service-area/kosice-city.geojson', import.meta.url));
const MANIFEST_PATH = fileURLToPath(new URL('../data/service-area/kosice-city.manifest.json', import.meta.url));
const TRANSFORMER_PATH = fileURLToPath(new URL('./transformKosiceServiceArea.py', import.meta.url));
const EXPECTED_IDS = [802, 803, 804, 805];
const EXPECTED_SOURCE_CRS = 'EPSG:8353';
const EXPECTED_SOURCE_HASH = 'b1cc7cbc2c38ea6a2eabbf3972c88e57c7e46671bdc98eaed67c4498cb1dd277';
const EXPECTED_DATABASE_HASHES = {
  'linux-x86_64': 'a25d85a2ebfc4584eba65186b7c41743b084ce5d391941cbb41c805947b77109',
  'windows-amd64': '47a7205d83ba6b7774b763f276ab57331f4dade2b2cfbcc0d486677e6543350b',
} as const;
const SOURCE_ATTRIBUTION = 'GKÚ Bratislava (ZBGIS), CC BY 4.0';
const SOURCE_URL = 'https://www.gku.sk/gku/produkty-sluzby/na-stiahnutie/zbgis.html';
const ARCHIVE_URL = 'https://opendata.skgeodesy.sk/static/ZBGIS/usj/ah_gpkg_0_sjtsk03.zip';
const EXPECTED_ARCHIVE_HASH = '807fc19d5419df0b0986c23a03fa883e11cbef43ce8a09169fc3d5e418f4b1b4';
const EXPECTED_GPKG_HASH = 'a4a4b6c1be877426120110c35b8ec3f60c2a4b96a6973f4ce90b2815a355dab3';
const EXPECTED_ARCHIVE_LAST_MODIFIED = '2026-09-02T11:11:03Z';
const OPERATION_PIPELINE = '+proj=pipeline +step +inv +proj=krovak +lat_0=49.5 +lon_0=24.8333333333333 +alpha=30.2881397527778 +k=0.9999 +x_0=0 +y_0=0 +ellps=bessel +step +proj=push +v_3 +step +proj=cart +ellps=bessel +step +proj=helmert +x=485.021 +y=169.465 +z=483.839 +rx=-7.786342 +ry=-4.397554 +rz=-4.102655 +s=0 +convention=coordinate_frame +step +inv +proj=cart +ellps=WGS84 +step +proj=pop +v_3 +step +proj=unitconvert +xy_in=rad +xy_out=deg';

interface SourceManifest {
  publisher: string;
  datasetTitle: string;
  sourceUrl: string;
  archiveUrl: string;
  archiveSha256: string;
  archiveLastModified: string;
  accessDate: string;
  dataStateDate: string;
  extractedGeoPackageFileName: string;
  extractedGeoPackageSha256: string;
  sourceLayer: string;
  geometryColumn: string;
  idField: string;
  selectedIds: number[];
  municipalityCrosswalk: { city: string; municipalityCode: number };
  sourceCrs: string;
  license: { identifier: string; url: string; attribution: string };
  sourceSubsetFile: string;
  sourceSubsetSha256: string;
}

interface SourceFeature {
  type: 'Feature';
  id: number;
  properties: { IDN3: number };
  geometry: {
    type: 'MultiPolygon';
    coordinates: number[][][][];
  };
}

interface SourceCollection {
  type: 'FeatureCollection';
  sourceCrs: string;
  features: SourceFeature[];
}

interface GeometryJson {
  type: 'Polygon' | 'MultiPolygon';
  coordinates: number[][][] | number[][][][];
}

interface TransformResult {
  geometry: GeometryJson;
  toolchain: {
    pyprojVersion: string;
    projVersion: string;
    projDatabaseSha256: string;
    platformKey: keyof typeof EXPECTED_DATABASE_HASHES;
    operationAuthority: string;
    operationCode: number;
    operationName: string;
    accuracyMetres: number;
    pipeline: string;
    axisOrder: string;
    alwaysXY: boolean;
    networkGridAccess: string;
    gridFiles: string[];
    outputDecimalPlaces: number;
  };
}

function sha256(bytes: Buffer | string): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function fail(message: string): never {
  throw new Error(message);
}

function validatePosition(value: unknown, source: string): asserts value is [number, number, number] {
  if (
    !Array.isArray(value) || value.length !== 3 ||
    typeof value[0] !== 'number' || !Number.isFinite(value[0]) ||
    typeof value[1] !== 'number' || !Number.isFinite(value[1]) ||
    typeof value[2] !== 'number' || !Number.isFinite(value[2]) || value[2] !== 0
  ) fail(`Invalid ${source} coordinate structure`);
}

function validateRings(geometry: SourceFeature['geometry']): void {
  for (const polygon of geometry.coordinates) {
    if (!Array.isArray(polygon) || polygon.length === 0) fail('Source polygon has no rings');
    for (const ring of polygon) {
      if (!Array.isArray(ring) || ring.length < 4) fail('Source ring has too few positions');
      for (const position of ring) validatePosition(position, 'source');
      const first = ring[0];
      const last = ring[ring.length - 1];
      if (first[0] !== last[0] || first[1] !== last[1] || first[2] !== last[2]) fail('Source ring is not closed');
      let twiceArea = 0;
      for (let index = 0; index < ring.length - 1; index += 1) {
        const current = ring[index];
        const next = ring[index + 1];
        twiceArea += current[0] * next[1] - next[0] * current[1];
      }
      if (!Number.isFinite(twiceArea) || twiceArea === 0) fail('Source ring has zero area');
    }
  }
}

function validateSourceManifest(sourceBytes: Buffer, manifest: SourceManifest): void {
  if (
    sha256(sourceBytes) !== EXPECTED_SOURCE_HASH ||
    manifest.sourceSubsetSha256 !== EXPECTED_SOURCE_HASH ||
    manifest.publisher !== 'Geodetický a kartografický ústav Bratislava (GKÚ), ZBGIS' ||
    manifest.datasetTitle !== 'Administrative boundaries — basic level, S-JTSK03 GeoPackage' ||
    manifest.sourceUrl !== SOURCE_URL ||
    manifest.archiveUrl !== ARCHIVE_URL ||
    manifest.archiveSha256 !== EXPECTED_ARCHIVE_HASH ||
    manifest.archiveLastModified !== EXPECTED_ARCHIVE_LAST_MODIFIED ||
    manifest.extractedGeoPackageFileName !== 'USJ_hranice_0.gpkg' ||
    manifest.extractedGeoPackageSha256 !== EXPECTED_GPKG_HASH ||
    manifest.sourceCrs !== EXPECTED_SOURCE_CRS ||
    manifest.sourceLayer !== 'okres_0' ||
    manifest.idField !== 'IDN3' ||
    JSON.stringify(manifest.selectedIds) !== JSON.stringify(EXPECTED_IDS) ||
    manifest.municipalityCrosswalk.municipalityCode !== 599981 ||
    manifest.license.url !== 'https://creativecommons.org/licenses/by/4.0/' ||
    manifest.license.identifier !== 'CC-BY-4.0' ||
    manifest.license.attribution !== SOURCE_ATTRIBUTION ||
    manifest.sourceSubsetFile !== 'kosice-okres-802-805.epsg8353.json'
  ) fail('Source provenance manifest or committed source checksum is invalid');
}

function parseSource(sourceBytes: Buffer, manifest: SourceManifest): SourceCollection {
  validateSourceManifest(sourceBytes, manifest);
  let source: SourceCollection;
  try {
    source = JSON.parse(sourceBytes.toString('utf8')) as SourceCollection;
  } catch {
    return fail('Committed source snapshot is not valid JSON');
  }
  if (
    source.type !== 'FeatureCollection' || source.sourceCrs !== EXPECTED_SOURCE_CRS ||
    !Array.isArray(source.features) ||
    JSON.stringify(source.features.map((feature) => feature.id)) !== JSON.stringify(EXPECTED_IDS)
  ) fail('Committed source snapshot has an unexpected schema, CRS, or identifier set');

  for (const feature of source.features) {
    if (
      feature.type !== 'Feature' || feature.id !== feature.properties.IDN3 ||
      feature.geometry?.type !== 'MultiPolygon' || !Array.isArray(feature.geometry.coordinates)
    ) fail('Committed source feature is malformed');
    validateRings(feature.geometry);
  }
  return source;
}

function getPolygonCount(geometry: any): number {
  return geometry.getGeometryType() === 'Polygon' ? 1 : geometry.getNumGeometries();
}

function getHoleCount(geometry: any): number {
  const count = getPolygonCount(geometry);
  let holes = 0;
  for (let index = 0; index < count; index += 1) {
    holes += geometry.getGeometryType() === 'Polygon'
      ? geometry.getNumInteriorRing()
      : geometry.getGeometryN(index).getNumInteriorRing();
  }
  return holes;
}

function getBounds(geometry: any): [number, number, number, number] {
  const envelope = geometry.getEnvelopeInternal();
  return [envelope.getMinX(), envelope.getMinY(), envelope.getMaxX(), envelope.getMaxY()];
}

function createDissolvedGeometry(source: SourceCollection): { geometry: any; projectedArea: number } {
  const reader = new GeoJSONReader(new GeometryFactory());
  let dissolved: any;
  try {
    for (const feature of source.features) {
      const geometry = reader.read(feature.geometry);
      const validation = new IsValidOp(geometry);
      if (geometry.isEmpty() || geometry.getArea() <= 0 || !validation.isValid()) {
        fail('Source feature failed topological validation');
      }
      dissolved = dissolved === undefined ? geometry : OverlayOp.union(dissolved, geometry);
    }
  } catch {
    return fail('JSTS source validation or district dissolve failed');
  }
  if (!dissolved) fail('No source geometries were selected');
  const unionValidation = new IsValidOp(dissolved);
  if (
    dissolved.isEmpty() || dissolved.getArea() <= 0 || !unionValidation.isValid() ||
    !['Polygon', 'MultiPolygon'].includes(dissolved.getGeometryType())
  ) fail('Dissolved boundary failed topological validation');
  return { geometry: dissolved, projectedArea: dissolved.getArea() };
}

function transformGeometry(sourceGeometry: GeometryJson): TransformResult {
  const python = process.env.PYTHON ?? (process.platform === 'win32' ? 'python' : 'python3');
  const result = spawnSync(python, [TRANSFORMER_PATH], {
    input: JSON.stringify(sourceGeometry),
    encoding: 'utf8',
    maxBuffer: 12 * 1024 * 1024,
    env: { ...process.env, PROJ_NETWORK: 'OFF' },
  });
  if (result.error || result.status !== 0 || !result.stdout) {
    fail('Pinned offline EPSG:8368 transformation failed');
  }
  let transformed: TransformResult;
  try {
    transformed = JSON.parse(result.stdout) as TransformResult;
  } catch {
    return fail('Pinned offline EPSG:8368 transformation returned malformed output');
  }
  const toolchain = transformed.toolchain;
  if (
    toolchain.pyprojVersion !== '3.7.2' || toolchain.projVersion !== '9.5.1' ||
    !Object.hasOwn(EXPECTED_DATABASE_HASHES, toolchain.platformKey) ||
    toolchain.operationAuthority !== 'EPSG' || toolchain.operationCode !== 8368 ||
    toolchain.accuracyMetres !== 1 || toolchain.pipeline !== OPERATION_PIPELINE ||
    toolchain.axisOrder !== 'easting,northing -> longitude,latitude' ||
    toolchain.alwaysXY !== true || toolchain.networkGridAccess !== 'disabled' ||
    toolchain.gridFiles.length !== 0 || toolchain.outputDecimalPlaces !== 10 ||
    toolchain.projDatabaseSha256 !== EXPECTED_DATABASE_HASHES[toolchain.platformKey]
  ) fail('Pinned offline EPSG:8368 toolchain evidence did not match');
  return transformed;
}

function validateOutputGeometry(geometryJson: GeometryJson): {
  geometry: any;
  bounds: [number, number, number, number];
  components: number;
  holes: number;
  coordinateCount: number;
} {
  const reader = new GeoJSONReader(new GeometryFactory());
  const geometry = reader.read(geometryJson);
  const validation = new IsValidOp(geometry);
  if (
    geometry.isEmpty() || geometry.getArea() <= 0 || !validation.isValid() ||
    !['Polygon', 'MultiPolygon'].includes(geometry.getGeometryType())
  ) fail('Transformed WGS84 boundary failed topological validation');
  const coordinates = geometry.getCoordinates();
  for (const coordinate of coordinates) {
    if (
      !Number.isFinite(coordinate.x) || !Number.isFinite(coordinate.y) ||
      coordinate.x < -180 || coordinate.x > 180 || coordinate.y < -90 || coordinate.y > 90
    ) fail('Transformed boundary contains coordinates outside CRS84');
  }
  const bounds = getBounds(geometry) as [number, number, number, number];
  if (!(bounds[0] > 21 && bounds[2] < 21.5 && bounds[1] > 48.4 && bounds[3] < 49)) {
    fail('Transformed boundary extent is implausible for the selected source');
  }
  const components = getPolygonCount(geometry);
  const holes = getHoleCount(geometry);
  if (geometry.getGeometryType() !== 'Polygon' || components !== 1 || holes !== 0 || coordinates.length !== 3444) {
    fail('Transformed boundary characteristics differ from the verified source union');
  }
  return { geometry, bounds, components, holes, coordinateCount: coordinates.length };
}

function serialize(value: unknown): Buffer {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function generate(): { artifactBytes: Buffer; manifestBytes: Buffer } {
  const sourceBytes = readFileSync(SOURCE_PATH);
  const sourceManifest = JSON.parse(readFileSync(SOURCE_MANIFEST_PATH, 'utf8')) as SourceManifest;
  const source = parseSource(sourceBytes, sourceManifest);
  const { geometry: dissolved, projectedArea } = createDissolvedGeometry(source);
  const writer = new GeoJSONWriter();
  const sourceUnion = writer.write(dissolved) as GeometryJson;
  const transformed = transformGeometry(sourceUnion);
  const validation = validateOutputGeometry(transformed.geometry);
  const representative = InteriorPointArea.getInteriorPoint(validation.geometry);
  const representativePoint = [Number(representative.x.toFixed(10)), Number(representative.y.toFixed(10))];

  const artifactBytes = serialize(transformed.geometry);
  const manifestBytes = serialize({
    schemaVersion: 1,
    boundary: 'Košice municipality administrative product boundary; not operator asset responsibility',
    source: {
      publisher: sourceManifest.publisher,
      datasetTitle: sourceManifest.datasetTitle,
      sourceUrl: sourceManifest.sourceUrl,
      archiveUrl: sourceManifest.archiveUrl,
      archiveFileName: 'ah_gpkg_0_sjtsk03.zip',
      archiveSha256: sourceManifest.archiveSha256,
      archiveLastModified: sourceManifest.archiveLastModified,
      extractedGeoPackageFileName: sourceManifest.extractedGeoPackageFileName,
      extractedGeoPackageSha256: sourceManifest.extractedGeoPackageSha256,
      accessDate: sourceManifest.accessDate,
      dataStateDate: sourceManifest.dataStateDate,
      sourceLayer: sourceManifest.sourceLayer,
      geometryColumn: sourceManifest.geometryColumn,
      idField: sourceManifest.idField,
      selectedIds: EXPECTED_IDS,
      municipalityCode: sourceManifest.municipalityCrosswalk.municipalityCode,
      sourceCrs: EXPECTED_SOURCE_CRS,
      sourceSubsetSha256: EXPECTED_SOURCE_HASH,
      license: sourceManifest.license,
    },
    union: {
      operation: 'JSTS OverlayOp.union in ascending IDN3 order',
      sourceCrs: EXPECTED_SOURCE_CRS,
      geometryType: 'Polygon',
      componentCount: validation.components,
      holeCount: validation.holes,
      coordinateCount: validation.coordinateCount,
      projectedAreaSquareMetres: projectedArea,
    },
    transformation: {
      pyprojVersion: transformed.toolchain.pyprojVersion,
      projVersion: transformed.toolchain.projVersion,
      projDatabaseSha256ByPlatform: EXPECTED_DATABASE_HASHES,
      operationAuthority: transformed.toolchain.operationAuthority,
      operationCode: transformed.toolchain.operationCode,
      operationName: transformed.toolchain.operationName,
      accuracyMetres: transformed.toolchain.accuracyMetres,
      pipeline: transformed.toolchain.pipeline,
      axisOrder: transformed.toolchain.axisOrder,
      alwaysXY: transformed.toolchain.alwaysXY,
      networkGridAccess: transformed.toolchain.networkGridAccess,
      gridFiles: transformed.toolchain.gridFiles,
      outputDecimalPlaces: transformed.toolchain.outputDecimalPlaces,
    },
    output: {
      crs: 'OGC:CRS84',
      axisOrder: 'longitude,latitude',
      geometryType: 'Polygon',
      extent: validation.bounds,
      representativePoint,
      geojsonSha256: sha256(artifactBytes),
    },
  });
  return { artifactBytes, manifestBytes };
}

function main(): void {
  const args = process.argv.slice(2);
  const check = args.length === 1 && args[0] === '--check';
  if (args.length > 1 || (args.length === 1 && !check)) {
    fail('Usage: generateKosiceServiceArea.ts [--check]');
  }
  const generated = generate();
  if (check) {
    const committedArtifact = readFileSync(ARTIFACT_PATH);
    const committedManifest = readFileSync(MANIFEST_PATH);
    if (!committedArtifact.equals(generated.artifactBytes) || !committedManifest.equals(generated.manifestBytes)) {
      fail('Generated service-area bytes differ from the committed artifacts');
    }
    process.stdout.write('Košice service-area generator check passed.\n');
    return;
  }
  writeFileSync(ARTIFACT_PATH, generated.artifactBytes);
  writeFileSync(MANIFEST_PATH, generated.manifestBytes);
  process.stdout.write('Košice service-area artifacts generated.\n');
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : 'Service-area generation failed';
  console.error(`Service-area generation failed: ${message}`);
  process.exitCode = 1;
}
