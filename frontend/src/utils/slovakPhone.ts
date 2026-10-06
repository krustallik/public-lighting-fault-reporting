/** Application range: explicit +, a non-zero first digit, and 8–15 digits. */
export function isValidInternationalPhone(raw: string): boolean {
  return /^\+[1-9]\d{7,14}$/.test(raw.trim());
}

/** The entered number is already explicit; never infer or rewrite a country code. */
export function formatInternationalPhone(raw: string): string {
  return raw.trim();
}
