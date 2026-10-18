import type { Plugin } from 'vite';

const TILE_PATH = /^\/__local_uat\/tiles\/(light|dark)\/\d+\/\d+\/\d+\.svg$/;

function syntheticTile(theme: 'light' | 'dark'): string {
  const background = theme === 'dark' ? '#222a32' : '#e8e5dc';
  const road = theme === 'dark' ? '#58636d' : '#ffffff';
  const block = theme === 'dark' ? '#313b44' : '#d8dfcf';
  const label = theme === 'dark' ? '#f0f3f5' : '#263238';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256"><rect width="256" height="256" fill="${background}"/><path d="M16 18h72v46H16zM168 18h72v46h-72zM16 166h72v68H16zM168 166h72v68h-72z" fill="${block}"/><path d="M-24 142 280 78M101 -18l56 292M-20 96h296M128 -24v304" fill="none" stroke="${road}" stroke-width="14"/><path d="M-24 142 280 78M101 -18l56 292" fill="none" stroke="${theme === 'dark' ? '#77838d' : '#c7c2b5'}" stroke-width="2"/><text x="128" y="248" text-anchor="middle" font-family="sans-serif" font-size="8" fill="${label}">SYNTHETIC LOCAL MAP</text></svg>`;
}

/** Serves clearly labelled, generated tiles only in the loopback local-UAT dev server. */
export function createLocalUatSyntheticTilesPlugin(enabled: boolean): Plugin {
  return {
    name: 'local-uat-synthetic-tiles',
    configureServer(server) {
      if (!enabled) return;
      server.middlewares.use((request, response, next) => {
        const pathname = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
        if (!pathname.startsWith('/__local_uat/tiles/')) { next(); return; }
        const match = pathname.match(TILE_PATH);
        if (!match) {
          response.statusCode = 404;
          response.end();
          return;
        }
        if (request.method !== 'GET' && request.method !== 'HEAD') {
          response.statusCode = 405;
          response.setHeader('Allow', 'GET, HEAD');
          response.end();
          return;
        }
        const body = syntheticTile(match[1] as 'light' | 'dark');
        response.statusCode = 200;
        response.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
        response.setHeader('Cache-Control', 'no-store');
        response.setHeader('X-Content-Type-Options', 'nosniff');
        response.end(request.method === 'HEAD' ? undefined : body);
      });
    },
  };
}
