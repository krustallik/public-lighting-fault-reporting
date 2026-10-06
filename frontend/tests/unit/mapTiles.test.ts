import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MAP_TILES, canDisplayPublicMapTiles } from '../../src/config/mapTiles';
import { getReportFormMessages } from '../../src/i18n/reportFormMessages';

const mapStyles = readFileSync(
  new URL('../../src/components/LightPointsMap/LightPointsMap.module.css', import.meta.url),
  'utf8'
);

afterEach(() => vi.unstubAllEnvs());

describe('public map tile direction', () => {
  it('uses the official canonical OSM raster URL and visible OpenStreetMap attribution', () => {
    expect(MAP_TILES.url).toBe('https://tile.openstreetmap.org/{z}/{x}/{y}.png');
    expect(MAP_TILES.attribution).toContain('OpenStreetMap contributors');
    expect(MAP_TILES.url).not.toContain('{s}.');
    expect(MAP_TILES.url).not.toContain('cartocdn');
  });

  it('uses the public OSM layer by default in development and requires explicit approval in production', () => {
    vi.stubEnv('DEV', true);
    vi.stubEnv('VITE_PUBLIC_MAP_TILES_APPROVED', '');
    expect(canDisplayPublicMapTiles()).toBe(true);

    vi.stubEnv('DEV', false);
    expect(canDisplayPublicMapTiles()).toBe(false);
    vi.stubEnv('VITE_PUBLIC_MAP_TILES_APPROVED', 'true');
    expect(canDisplayPublicMapTiles()).toBe(true);
  });

  it('applies the dark appearance only to raster tiles and keeps attribution style rules separate', () => {
    expect(mapStyles).toMatch(/\.wrapper\[data-theme='dark'\] \.map :global\(\.leaflet-tile\)\s*\{[^}]*filter:/s);
    expect(mapStyles).toContain(".wrapper[data-theme='dark'] :global(.leaflet-control-attribution)");
    expect(mapStyles).not.toMatch(/\.wrapper\[data-theme='dark'\].*\.leaflet-marker-icon\s*\{[^}]*filter:/s);
    expect(mapStyles).not.toMatch(/\.wrapper\[data-theme='dark'\].*\.leaflet-control\s*\{[^}]*filter:/s);
  });

  it('provides localized labels for the map-only deployment fallback', () => {
    expect(getReportFormMessages('sk').map.tilesNotConfigured).toMatch(/nasadenie/i);
    expect(getReportFormMessages('en').map.tilesNotConfigured).toMatch(/deployment/i);
  });
});
