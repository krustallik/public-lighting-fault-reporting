import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolveMapTileConfig } from '../../src/config/mapTiles';

afterEach(() => vi.unstubAllEnvs());

describe('map tile provider gates', () => {
  it('defaults to no layer and never falls back to an external provider', () => {
    vi.stubEnv('VITE_MAP_TILE_PROVIDER', 'disabled');
    expect(resolveMapTileConfig('light')).toMatchObject({ enabled: false, provider: 'disabled', url: '' });
    vi.stubEnv('VITE_MAP_TILE_PROVIDER', 'unknown');
    expect(resolveMapTileConfig('light').enabled).toBe(false);
  });

  it('uses exact CARTO light/dark raster templates, public key placement and attribution only when approved', () => {
    vi.stubEnv('DEV', false);
    vi.stubEnv('MODE', 'production');
    vi.stubEnv('VITE_MAP_TILE_PROVIDER', 'carto');
    vi.stubEnv('VITE_CARTO_TILES_APPROVED', 'false');
    vi.stubEnv('VITE_CARTO_PUBLIC_KEY', 'test-key');
    expect(resolveMapTileConfig('light').enabled).toBe(false);
    vi.stubEnv('VITE_CARTO_TILES_APPROVED', 'true');
    const light = resolveMapTileConfig('light');
    const dark = resolveMapTileConfig('dark');
    expect(light.url).toBe('https://basemaps.cartocdn.com/rastertiles/light_all/{z}/{x}/{y}.png?key=test-key');
    expect(dark.url).toBe('https://basemaps.cartocdn.com/rastertiles/dark_all/{z}/{x}/{y}.png?key=test-key');
    expect(light.attribution).toContain('OpenStreetMap contributors');
    expect(light.attribution).toContain('CARTO');
    expect(light.maxZoom).toBe(20);
  });

  it('omits CARTO for a missing key and rejects development/synthetic providers in production', () => {
    vi.stubEnv('DEV', false);
    vi.stubEnv('MODE', 'production');
    vi.stubEnv('VITE_MAP_TILE_PROVIDER', 'carto');
    vi.stubEnv('VITE_CARTO_TILES_APPROVED', 'true');
    vi.stubEnv('VITE_CARTO_PUBLIC_KEY', '');
    expect(resolveMapTileConfig('light').enabled).toBe(false);
    vi.stubEnv('VITE_MAP_TILE_PROVIDER', 'dev-osm');
    expect(resolveMapTileConfig('light').enabled).toBe(false);
    vi.stubEnv('VITE_MAP_TILE_PROVIDER', 'synthetic');
    expect(resolveMapTileConfig('light').enabled).toBe(false);
  });

  it('allows synthetic tiles in development and reserves CSS dark filtering for dev OSM', async () => {
    vi.stubEnv('DEV', true);
    vi.stubEnv('MODE', 'development');
    vi.stubEnv('VITE_MAP_TILE_PROVIDER', 'synthetic');
    const syntheticLight = resolveMapTileConfig('light');
    const syntheticDark = resolveMapTileConfig('dark');
    expect(syntheticLight).toMatchObject({ enabled: true, provider: 'synthetic' });
    expect(syntheticLight.url).toContain('/tiles/light/');
    expect(syntheticDark.url).toContain('/tiles/dark/');
    expect(syntheticLight.url).not.toBe(syntheticDark.url);
    vi.stubEnv('VITE_MAP_TILE_PROVIDER', 'dev-osm');
    expect(resolveMapTileConfig('dark').url).toContain('tile.openstreetmap.org');
    const styles = readFileSync(new URL('../../src/components/LightPointsMap/LightPointsMap.module.css', import.meta.url), 'utf8');
    expect(styles).toMatch(/data-tile-provider='dev-osm'[^}]*filter:/s);
    expect(styles).not.toMatch(/data-tile-provider='carto'[^}]*filter:/s);
  });
});
