/** Strip spaces, dashes, parentheses; support 00421… international prefix. */
export function normalizePhoneInput(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    return '';
  }

  let normalized = trimmed.replace(/[\s\-().]/g, '');

  if (normalized.startsWith('00')) {
    normalized = `+${normalized.slice(2)}`;
  }

  return normalized;
}

/**
 * Slovak numbers (optional field):
 * - +421 + 9 digits (e.g. +421951449039)
 * - 421 + 9 digits (12 digits total)
 * - 0 + 9 digits national (e.g. 0951449039)
 */
export function isValidSlovakPhone(raw: string): boolean {
  const phone = normalizePhoneInput(raw);
  if (!phone) {
    return true;
  }

  return (
    /^\+421[2-9]\d{8}$/.test(phone) ||
    /^421[2-9]\d{8}$/.test(phone) ||
    /^0[2-9]\d{8}$/.test(phone)
  );
}

export function formatSlovakPhoneE164(raw: string): string {
  const phone = normalizePhoneInput(raw);
  if (!phone) {
    return '';
  }

  if (/^\+421[2-9]\d{8}$/.test(phone)) {
    return phone;
  }
  if (/^421[2-9]\d{8}$/.test(phone)) {
    return `+${phone}`;
  }
  if (/^0[2-9]\d{8}$/.test(phone)) {
    return `+421${phone.slice(1)}`;
  }

  return phone;
}
