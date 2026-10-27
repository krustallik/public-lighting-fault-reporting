// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { KOSICE_MAP_BOUNDS } from '@/config/kosiceMapBounds';

describe('public Košice map extent', () => {
  it('matches the committed service-area manifest extent', () => {
    const manifest = JSON.parse(readFileSync(
      resolve(process.cwd(), '../backend/src/data/service-area/kosice-city.manifest.json'),
      'utf8'
    )) as { output: { extent: [number, number, number, number] } };
    const [west, south, east, north] = manifest.output.extent;

    expect(KOSICE_MAP_BOUNDS).toEqual([
      [south, west],
      [north, east],
    ]);
  });
});
