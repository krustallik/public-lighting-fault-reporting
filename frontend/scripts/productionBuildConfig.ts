export type FrontendApplication = 'public' | 'admin';

export function assertProductionBuildConfig(
  application: FrontendApplication,
  env: Record<string, string | undefined>
): void {
  if (env.VITE_API_URL !== '/api') {
    throw new Error('Production frontend builds must use the same-origin VITE_API_URL=/api.');
  }
  const clientSecrets = Object.entries(env).filter(([key, value]) =>
    key.startsWith('VITE_') && key !== 'VITE_CARTO_PUBLIC_KEY' &&
    /(?:API_KEY|SECRET|PASSWORD|TOKEN|PRIVATE_KEY)$/i.test(key) && Boolean(value)
  );
  if (clientSecrets.length > 0) {
    throw new Error('Server credentials must never be supplied to a Vite build.');
  }
  if (application === 'admin' && env.VITE_ADMIN_BASE_PATH !== '/') {
    throw new Error('The production admin application must use the root path on its separate origin.');
  }
  if (application === 'public') {
    if (env.VITE_MAP_TILE_PROVIDER !== 'carto') {
      throw new Error('The production public build requires the approved CARTO tile provider.');
    }
    if (env.VITE_CARTO_TILES_APPROVED !== 'true' || !env.VITE_CARTO_PUBLIC_KEY?.trim()) {
      throw new Error('The production public build requires approved CARTO configuration and a client key.');
    }
  } else if (
    env.VITE_CARTO_PUBLIC_KEY || env.VITE_CARTO_TILES_APPROVED === 'true' || env.VITE_MAP_TILE_PROVIDER === 'carto'
  ) {
    throw new Error('The admin production build must not receive public CARTO configuration.');
  }
}
