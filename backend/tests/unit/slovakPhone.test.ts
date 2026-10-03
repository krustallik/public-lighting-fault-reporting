import { describe, expect, it } from 'vitest';
import {
  formatSlovakPhoneE164,
  isValidSlovakPhone,
  normalizePhoneInput,
} from '../../src/utils/slovakPhone.js';

describe('backend Slovak phone helpers', () => {
  it('normalizes whitespace, punctuation, and the 00 international prefix', () => {
    expect(normalizePhoneInput(' 00421 (951) 449-039 ')).toBe('+421951449039');
    expect(normalizePhoneInput('   ')).toBe('');
  });

  it('accepts the existing optional, international, and national forms', () => {
    expect(isValidSlovakPhone('')).toBe(true);
    expect(isValidSlovakPhone('+421951449039')).toBe(true);
    expect(isValidSlovakPhone('421951449039')).toBe(true);
    expect(isValidSlovakPhone('0951449039')).toBe(true);
    expect(isValidSlovakPhone('+421051449039')).toBe(false);
  });

  it('formats valid international and national forms as E.164', () => {
    expect(formatSlovakPhoneE164('421951449039')).toBe('+421951449039');
    expect(formatSlovakPhoneE164('0951449039')).toBe('+421951449039');
    expect(formatSlovakPhoneE164('')).toBe('');
  });
});
