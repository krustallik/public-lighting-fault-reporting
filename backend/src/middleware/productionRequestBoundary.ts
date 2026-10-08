import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { RuntimeConfig } from '../config/index.js';

function hostnameFromOrigin(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const parsed = new URL(value);
    if (parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) return undefined;
    return parsed.host.toLowerCase();
  } catch {
    return undefined;
  }
}

function requestHost(request: Request): string | undefined {
  const raw = request.get('host');
  if (!raw || raw.includes(',') || /[\s/@\\]/.test(raw)) return undefined;
  return raw.toLowerCase();
}

function forbidden(response: Response): void {
  response.setHeader('Cache-Control', 'no-store');
  response.status(403).json({ success: false, code: 'request_origin_rejected', message: 'Request origin is not allowed.' });
}

export function createHostBoundary(config: RuntimeConfig, allowed: 'public' | 'admin' | 'either'): RequestHandler {
  const publicHost = hostnameFromOrigin(config.publicOrigin);
  const adminHost = hostnameFromOrigin(config.adminOrigin);
  const allowedHosts = allowed === 'either'
    ? new Set([publicHost, adminHost].filter((value): value is string => Boolean(value)))
    : new Set([allowed === 'public' ? publicHost : adminHost].filter((value): value is string => Boolean(value)));

  return (request, response, next) => {
    if (config.nodeEnv !== 'production') { next(); return; }
    const host = requestHost(request);
    if (!host || !allowedHosts.has(host)) { forbidden(response); return; }
    next();
  };
}

export interface AdminRequestProvenance {
  origin?: string;
  referer?: string;
  fetchSite?: string;
}

export function hasValidAdminRequestProvenance(
  provenance: AdminRequestProvenance,
  adminOrigin: string
): boolean {
  if (provenance.fetchSite !== undefined && provenance.fetchSite.trim().toLowerCase() !== 'same-origin') {
    return false;
  }
  if (provenance.origin !== undefined) {
    return provenance.origin.trim() === adminOrigin && hostnameFromOrigin(provenance.origin) !== undefined;
  }
  if (provenance.referer === undefined) return false;
  try {
    const referer = new URL(provenance.referer);
    return referer.origin === adminOrigin && referer.protocol === 'https:' && !referer.username && !referer.password;
  } catch {
    return false;
  }
}

export function createAdminCsrfGuard(config: RuntimeConfig): RequestHandler {
  const unsafe = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
  return (request: Request, response: Response, next: NextFunction) => {
    if (config.nodeEnv !== 'production' || !unsafe.has(request.method.toUpperCase())) { next(); return; }
    if (!config.adminOrigin || !hasValidAdminRequestProvenance({
      origin: request.get('origin') ?? undefined,
      referer: request.get('referer') ?? undefined,
      fetchSite: request.get('sec-fetch-site') ?? undefined,
    }, config.adminOrigin)) {
      forbidden(response);
      return;
    }
    next();
  };
}
