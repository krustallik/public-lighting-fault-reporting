const ADMIN_ORIGIN = 'https://admin.invalid';
const ENCODED_PATH_SEPARATOR = /%(?:2f|5c)/i;
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/;

/** Keep post-login navigation within the current admin origin. */
export function safeAdminReturnPath(value: unknown, fallback = '/'): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 2048) return fallback;
  if (!value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return fallback;
  if (ENCODED_PATH_SEPARATOR.test(value) || CONTROL_CHARACTER.test(value)) return fallback;

  try {
    const decoded = decodeURIComponent(value);
    if (decoded.startsWith('//') || decoded.includes('\\') || CONTROL_CHARACTER.test(decoded)) return fallback;
    const target = new URL(value, ADMIN_ORIGIN);
    if (target.origin !== ADMIN_ORIGIN || target.username || target.password) return fallback;
    return `${target.pathname}${target.search}${target.hash}`;
  } catch {
    return fallback;
  }
}
