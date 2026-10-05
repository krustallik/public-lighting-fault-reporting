import { describe, expect, it } from 'vitest';
import { classifyServiceAreaPoint } from '../../src/domain/serviceArea.js';

const square = {
  type: 'Polygon' as const,
  coordinates: [[
    [21, 48],
    [22, 48],
    [22, 49],
    [21, 49],
    [21, 48],
  ]],
};

describe('service-area validation seam', () => {
  it('classifies synthetic points inside, on the edge, and outside without choosing a real boundary', () => {
    expect(classifyServiceAreaPoint({ latitude: 48.5, longitude: 21.5 }, square)).toBe('inside');
    expect(classifyServiceAreaPoint({ latitude: 48.5, longitude: 21 }, square)).toBe('boundary');
    expect(classifyServiceAreaPoint({ latitude: 47.9, longitude: 21.5 }, square)).toBe('outside');
  });

  it('rejects malformed coordinates and malformed polygon fixtures', () => {
    expect(classifyServiceAreaPoint({ latitude: Number.NaN, longitude: 21.5 }, square)).toBe('invalid-coordinate');
    expect(classifyServiceAreaPoint({ latitude: '48.5', longitude: 21.5 }, square)).toBe('invalid-coordinate');
    expect(classifyServiceAreaPoint(null, square)).toBe('invalid-coordinate');
    expect(classifyServiceAreaPoint({ latitude: 48.5, longitude: 21.5 }, {
      type: 'Polygon',
      coordinates: [[[21, 48], [22, 48], [22, 49]]],
    })).toBe('invalid-boundary');
  });

  it('reports an unconfigured boundary instead of inventing a Košice polygon', () => {
    expect(classifyServiceAreaPoint({ latitude: 48.7, longitude: 21.25 }, null)).toBe('unconfigured');
  });

  it('treats holes as outside the service area while exposing their edge distinctly', () => {
    const polygonWithHole = {
      type: 'Polygon' as const,
      coordinates: [
        square.coordinates[0],
        [[21.4, 48.4], [21.6, 48.4], [21.6, 48.6], [21.4, 48.6], [21.4, 48.4]],
      ],
    };

    expect(classifyServiceAreaPoint({ latitude: 48.5, longitude: 21.5 }, polygonWithHole)).toBe('outside');
    expect(classifyServiceAreaPoint({ latitude: 48.5, longitude: 21.4 }, polygonWithHole)).toBe('boundary');
  });
});
