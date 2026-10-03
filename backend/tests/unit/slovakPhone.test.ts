import { describe, expect, it } from 'vitest';
import {
  formatSlovakPhoneE164,
  isValidSlovakPhone,
  normalizePhoneInput,
} from '../../src/utils/slovakPhone.js';

const SYNTHETIC_INVALID_PHONE = '+421000000000';

describe('backend Slovak phone helpers', () => {
  it('normalizes whitespace, punctuation, and the 00 international prefix', () => {
    expect(normalizePhoneInput(' 00421 (000) 000-000 ')).toBe(SYNTHETIC_INVALID_PHONE);
    expect(normalizePhoneInput('   ')).toBe('');
  });

  it('allows an omitted optional value and rejects a synthetic non-routable value', () => {
    expect(isValidSlovakPhone('')).toBe(true);
    expect(isValidSlovakPhone(SYNTHETIC_INVALID_PHONE)).toBe(false);
    expect(isValidSlovakPhone('421000000000')).toBe(false);
  });

  it('preserves the normalized synthetic invalid sentinel and empty input', () => {
    expect(formatSlovakPhoneE164(SYNTHETIC_INVALID_PHONE)).toBe(SYNTHETIC_INVALID_PHONE);
    expect(formatSlovakPhoneE164('')).toBe('');
  });
});
