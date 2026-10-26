import type { IncomingMessage, ServerResponse } from 'node:http';
import type { LiveProviderStatus } from './liveProviders.js';

const STATUS_PATH = '/api/dev/local-uat/status';

export interface LiveUatStatusSnapshot {
  database: { postgisVerified: true; migrationsCurrent: true; inventoryRows: number };
  providers: {
    resend: {
      configured: true;
      ownerAccountConfirmation: 'required';
      fromConfigured: true;
      approvedRecipientAllowlist: true;
      maxSendsPerProcess: number;
    };
    geoapify: {
      configured: true;
      maxRequestsPerProcess: number;
    };
    carto: {
      configured: true;
      tileEvidence: 'reported_in_public_browser';
      attribution: 'owner_browser_confirmation_required';
    };
    observations: LiveProviderStatus;
  };
  submission: { status: 'ON_HOLD'; result: 'local metadata history only'; externalRequests: 0 };
}

function allowedLoopback(request: IncomingMessage, host: string | undefined): boolean {
  const address = request.socket.remoteAddress?.toLowerCase();
  if (address !== '127.0.0.1' && address !== '::1' && address !== '::ffff:127.0.0.1') return false;
  if (!host) return false;
  try {
    const parsed = new URL(`http://${host}`);
    return (
      !parsed.username && !parsed.password && parsed.pathname === '/' && !parsed.search && !parsed.hash &&
      (parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost')
    );
  } catch {
    return false;
  }
}

export function createLiveUatStatusHandler(snapshot: () => LiveUatStatusSnapshot) {
  return (request: IncomingMessage, response: ServerResponse): boolean => {
    const requestUrl = new URL(request.url ?? '/', 'http://127.0.0.1:5000');
    if (requestUrl.pathname !== STATUS_PATH) return false;
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    if (!allowedLoopback(request, request.headers.host)) {
      response.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify({ success: false, code: 'LOCAL_UAT_LOOPBACK_ONLY' }));
      return true;
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405, { Allow: 'GET, HEAD', 'Content-Type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify({ success: false, code: 'LOCAL_UAT_METHOD_NOT_ALLOWED' }));
      return true;
    }
    response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    const current = snapshot();
    response.end(request.method === 'HEAD' ? undefined : JSON.stringify({
      mode: 'LIVE_PROVIDER_UAT',
      providers: {
        resend: current.providers.resend,
        geoapify: current.providers.geoapify,
        carto: current.providers.carto,
        observations: {
          email: current.providers.observations.email,
          address: current.providers.observations.address,
        },
      },
      database: current.database,
      submission: current.submission,
    }));
    return true;
  };
}
