export function maskEmail(email: string): string {
  const trimmed = email.trim();
  const at = trimmed.indexOf('@');
  if (at <= 0) {
    return '***';
  }

  const local = trimmed.slice(0, at);
  const domain = trimmed.slice(at + 1);
  const visible = local.slice(0, Math.min(2, local.length));
  return `${visible}***@${domain}`;
}

export function maskPhone(phone: string): string {
  const trimmed = phone.trim();
  if (!trimmed) {
    return '';
  }

  const digits = trimmed.replace(/\D/g, '');
  if (digits.length <= 4) {
    return '***';
  }

  const prefix = trimmed.slice(0, Math.min(4, trimmed.length));
  const suffix = digits.slice(-3);
  return `${prefix} *** ${suffix}`;
}

export function maskDetailDescription(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) {
    return '';
  }
  if (trimmed.length <= 8) {
    return '***';
  }
  return `${trimmed.slice(0, 4)}…${trimmed.slice(-2)} (${trimmed.length} znakov)`;
}
