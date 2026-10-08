import { describe, expect, it } from 'vitest';
import { assertProductionBuildConfig } from '../../scripts/productionBuildConfig';

const publicBuild = {
  VITE_API_URL: '/api',
  VITE_MAP_TILE_PROVIDER: 'carto',
  VITE_CARTO_TILES_APPROVED: 'true',
  VITE_CARTO_PUBLIC_KEY: 'synthetic-public-test-key',
};

describe('production frontend build configuration', () => {
  it('requires approved CARTO configuration for the public application', () => {
    expect(() => assertProductionBuildConfig('public', publicBuild)).not.toThrow();
    expect(() => assertProductionBuildConfig('public', { ...publicBuild, VITE_CARTO_TILES_APPROVED: 'false' }))
      .toThrow(/CARTO configuration/);
    expect(() => assertProductionBuildConfig('public', { ...publicBuild, VITE_MAP_TILE_PROVIDER: 'dev-osm' }))
      .toThrow(/CARTO tile provider/);
  });

  it('requires same-origin API and root deployment for admin', () => {
    expect(() => assertProductionBuildConfig('admin', { VITE_API_URL: '/api', VITE_ADMIN_BASE_PATH: '/' }))
      .not.toThrow();
    expect(() => assertProductionBuildConfig('admin', { VITE_API_URL: 'http://localhost:5000/api', VITE_ADMIN_BASE_PATH: '/' }))
      .toThrow(/same-origin/);
    expect(() => assertProductionBuildConfig('admin', { VITE_API_URL: '/api', VITE_ADMIN_BASE_PATH: '/panel-svietidla' }))
      .toThrow(/root path/);
  });

  it('rejects server-only values in either browser build', () => {
    expect(() => assertProductionBuildConfig('admin', {
      VITE_API_URL: '/api', VITE_ADMIN_BASE_PATH: '/', VITE_GEOAPIFY_API_KEY: 'must-not-be-bundled',
    })).toThrow(/Server credentials/);
  });

  it('keeps CARTO configuration exclusively in the public build', () => {
    expect(() => assertProductionBuildConfig('admin', {
      VITE_API_URL: '/api',
      VITE_ADMIN_BASE_PATH: '/',
      VITE_CARTO_PUBLIC_KEY: 'synthetic-public-test-key',
    })).toThrow(/must not receive public CARTO/);
  });

  it('rejects AUSEMIO credentials from browser builds', () => {
    expect(() => assertProductionBuildConfig('public', {
      ...publicBuild,
      VITE_AUSEMIO_API_KEY: 'synthetic-forbidden',
    })).toThrow(/Server credentials/);
  });
});
