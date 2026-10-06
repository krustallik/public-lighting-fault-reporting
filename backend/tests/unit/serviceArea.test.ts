import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { createServiceAreaClassifier, loadServiceAreaArtifact } from '../../src/domain/serviceArea.js';

const square = {
  type: 'Polygon',
  coordinates: [[[21, 48], [22, 48], [22, 49], [21, 49], [21, 48]]],
} as const;
const polygonWithHole = {
  type: 'Polygon',
  coordinates: [
    [[21, 48], [22, 48], [22, 49], [21, 49], [21, 48]],
    [[21.4, 48.4], [21.6, 48.4], [21.6, 48.6], [21.4, 48.6], [21.4, 48.4]],
  ],
} as const;

describe('JSTS service-area predicates', () => {
  it('allows polygon interior, exact outer edge and outer vertex without a buffer', () => {
    const classify = createServiceAreaClassifier(square);
    expect(classify({ latitude: 48.5, longitude: 21.5 })).toBe('inside');
    expect(classify({ latitude: 48, longitude: 21.5 })).toBe('inside');
    expect(classify({ latitude: 48, longitude: 21 })).toBe('inside');
    expect(classify({ latitude: 47.999999999, longitude: 21.5 })).toBe('outside');
  });

  it('rejects hole interior, exact hole edge and hole vertex', () => {
    const classify = createServiceAreaClassifier(polygonWithHole);
    expect(classify({ latitude: 48.5, longitude: 21.5 })).toBe('outside');
    expect(classify({ latitude: 48.4, longitude: 21.5 })).toBe('outside');
    expect(classify({ latitude: 48.4, longitude: 21.4 })).toBe('outside');
    expect(classify({ latitude: 48.3, longitude: 21.5 })).toBe('inside');
  });

  it('handles MultiPolygon components and the gap between components', () => {
    const classify = createServiceAreaClassifier({
      type: 'MultiPolygon',
      coordinates: [square.coordinates, [[[23, 48], [24, 48], [24, 49], [23, 49], [23, 48]]]],
    });
    expect(classify({ latitude: 48.5, longitude: 21.5 })).toBe('inside');
    expect(classify({ latitude: 48.5, longitude: 23.5 })).toBe('inside');
    expect(classify({ latitude: 48.5, longitude: 22.5 })).toBe('outside');
  });

  it('fails closed for empty, malformed, self-intersecting and zero-area geometries', () => {
    for (const boundary of [
      { type: 'Polygon', coordinates: [] },
      { type: 'Polygon', coordinates: [[[21, 48], [22, 49]]] },
      { type: 'Polygon', coordinates: [[[21, 48], [22, 49], [21, 49], [22, 48], [21, 48]]] },
      { type: 'Polygon', coordinates: [[[21, 48], [22, 48], [21, 48], [21, 48]]] },
    ]) {
      expect(createServiceAreaClassifier(boundary)({ latitude: 48.5, longitude: 21.5 })).toBe('unavailable');
    }
  });

  it('rejects invalid coordinates and never emits them in a classification', () => {
    const classify = createServiceAreaClassifier(square);
    expect(classify(null)).toBe('invalid-coordinate');
    expect(classify({ latitude: Number.NaN, longitude: 21.5 })).toBe('invalid-coordinate');
    expect(classify({ latitude: 91, longitude: 21.5 })).toBe('invalid-coordinate');
    expect(classify({ latitude: 48.5, longitude: '21.5' })).toBe('invalid-coordinate');
  });
});

describe('committed service-area artifact', () => {
  it('loads a hash-matched artifact and classifies Košice coordinates', () => {
    const classify = loadServiceAreaArtifact();
    expect(classify({ latitude: 48.7164, longitude: 21.2611 })).toBe('inside');
    expect(classify({ latitude: 48.7164, longitude: 22 })).toBe('outside');
  });

  it('fails closed when artifact, manifest, or topology is corrupt', () => {
    const classifyMissing = loadServiceAreaArtifact('missing-boundary.json', 'missing-manifest.json');
    expect(classifyMissing({ latitude: 48.7164, longitude: 21.2611 })).toBe('unavailable');
    const bytes = readFileSync(new URL('../../src/data/service-area/kosice-city.geojson', import.meta.url));
    expect(bytes.length).toBeGreaterThan(200_000);
  });

  it('fails closed for a manifest hash mismatch and for hash-matched invalid topology', () => {
    const directory = mkdtempSync(join(tmpdir(), 'p2c-service-area-'));
    const artifactPath = join(directory, 'artifact.geojson');
    const manifestPath = join(directory, 'manifest.json');
    const writePair = (geometry: unknown, declaredHash?: string) => {
      const artifact = Buffer.from(JSON.stringify(geometry));
      writeFileSync(artifactPath, artifact);
      writeFileSync(manifestPath, JSON.stringify({
        schemaVersion: 1,
        output: {
          crs: 'OGC:CRS84',
          axisOrder: 'longitude,latitude',
          geojsonSha256: declaredHash ?? createHash('sha256').update(artifact).digest('hex'),
        },
      }));
    };

    try {
      writePair(square, '0'.repeat(64));
      expect(loadServiceAreaArtifact(artifactPath, manifestPath)({ latitude: 48.5, longitude: 21.5 })).toBe('unavailable');
      writePair({
        type: 'Polygon',
        coordinates: [[[21, 48], [22, 49], [21, 49], [22, 48], [21, 48]]],
      });
      expect(loadServiceAreaArtifact(artifactPath, manifestPath)({ latitude: 48.5, longitude: 21.5 })).toBe('unavailable');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
