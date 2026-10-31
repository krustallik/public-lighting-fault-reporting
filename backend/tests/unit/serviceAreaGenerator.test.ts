import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { runServiceAreaGenerator, validatePosition, validateRings } from '../../src/scripts/generateKosiceServiceArea.js';

const python = process.env.PYTHON ?? (process.platform === 'win32' ? 'python' : 'python3');
const hasPinnedGeoToolchain = spawnSync(python, ['-c', 'import pyproj; assert pyproj.__version__ == "3.7.2"'], {
  encoding: 'utf8', windowsHide: true,
}).status === 0;

describe('Košice boundary generator input validation', () => {
  it('accepts finite 3D source positions with the expected zero elevation', () => {
    expect(() => validatePosition([21.2, 48.7, 0], 'source')).not.toThrow();
  });

  it.each([
    ['not an array', null],
    ['wrong coordinate count', [21.2, 48.7]],
    ['non-finite longitude', [Number.NaN, 48.7, 0]],
    ['non-finite latitude', [21.2, Number.POSITIVE_INFINITY, 0]],
    ['non-finite elevation', [21.2, 48.7, Number.NaN]],
    ['non-zero elevation', [21.2, 48.7, 1]],
  ])('rejects %s before source geometry processing', (_label, value) => {
    expect(() => validatePosition(value, 'source')).toThrow('Invalid source coordinate structure');
  });

  it.each([
    ['no rings', []],
    ['a ring with too few positions', [[[0, 0, 0], [1, 0, 0], [0, 0, 0]]]],
    ['an open ring', [[[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]]]],
    ['a zero-area ring', [[[0, 0, 0], [1, 0, 0], [2, 0, 0], [0, 0, 0]]]],
  ])('rejects source polygons with %s', (_label, rings) => {
    expect(() => validateRings({ type: 'MultiPolygon', coordinates: [rings] } as Parameters<typeof validateRings>[0]))
      .toThrow();
  });

  it.skipIf(!hasPinnedGeoToolchain)('checks the committed offline boundary artifacts without rewriting them', () => {
    expect(() => runServiceAreaGenerator(['--check'])).not.toThrow();
  });

  it.each([
    ['unknown option', ['--write-anywhere']],
    ['extra option', ['--check', '--write-anywhere']],
  ])('rejects %s before reading or writing boundary artifacts', (_label, args) => {
    expect(() => runServiceAreaGenerator(args)).toThrow('Usage: generateKosiceServiceArea.ts [--check]');
  });
});
