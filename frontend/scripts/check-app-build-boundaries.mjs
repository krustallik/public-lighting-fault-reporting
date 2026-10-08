import { build } from 'vite';

const originalEnvironment = { ...process.env };

try {
  for (const app of ['public', 'admin']) {
    for (const key of Object.keys(process.env)) {
      if (key.startsWith('VITE_')) delete process.env[key];
    }
    Object.assign(process.env, originalEnvironment);
    process.env.VITE_API_URL = '/api';

    if (app === 'public') {
      process.env.VITE_MAP_TILE_PROVIDER = 'carto';
      process.env.VITE_CARTO_TILES_APPROVED = 'true';
      if (!process.env.VITE_CARTO_PUBLIC_KEY?.trim()) {
        throw new Error('Set VITE_CARTO_PUBLIC_KEY to a synthetic or approved public key before production build.');
      }
    } else {
      delete process.env.VITE_CARTO_PUBLIC_KEY;
      process.env.VITE_MAP_TILE_PROVIDER = 'disabled';
      process.env.VITE_CARTO_TILES_APPROVED = 'false';
      process.env.VITE_ADMIN_BASE_PATH = '/';
      process.env.VITE_ADMIN_ASSET_BASE_PATH = '/';
    }

    await build({ configFile: `apps/${app}/vite.config.ts`, mode: 'production' });
  }
} finally {
  for (const key of Object.keys(process.env)) {
    if (key.startsWith('VITE_')) delete process.env[key];
  }
  Object.assign(process.env, originalEnvironment);
}
