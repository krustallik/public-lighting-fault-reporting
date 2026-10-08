const DEFAULT_ADMIN_BASE_PATH = '/panel-svietidla';

function normalizeAdminBasePath(raw: string | undefined): string {
  const trimmed = raw?.trim() || DEFAULT_ADMIN_BASE_PATH;
  const withLeadingSlash = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  const normalized = withLeadingSlash.replace(/\/+$/, '');

  return normalized || '/';
}

/** Frontend base path for admin UI (configurable via VITE_ADMIN_BASE_PATH). */
export const ADMIN_BASE_PATH = normalizeAdminBasePath(import.meta.env.VITE_ADMIN_BASE_PATH);

/** React Router path segment without leading slash. */
export const ADMIN_ROUTE_SEGMENT = ADMIN_BASE_PATH === '/' ? '' : ADMIN_BASE_PATH.replace(/^\//, '');

export const LEGACY_ADMIN_PATH = '/admin';

export function adminPath(...segments: (string | number)[]): string {
  const suffix = segments
    .filter((segment) => segment !== '' && segment !== undefined && segment !== null)
    .map(String)
    .join('/');

  const base = ADMIN_BASE_PATH === '/' ? '' : ADMIN_BASE_PATH;
  return suffix ? `${base}/${suffix}` : base || '/';
}

export function isLegacyAdminPath(pathname: string): boolean {
  return pathname === LEGACY_ADMIN_PATH || pathname.startsWith(`${LEGACY_ADMIN_PATH}/`);
}
