import { describe, expect, it } from 'vitest';
import { formatInternationalPhone, isValidInternationalPhone } from '@/utils/slovakPhone';

describe('international phone application validation', () => {
  it('accepts an explicit international prefix with 8 to 15 digits', () => {
    expect(isValidInternationalPhone('+421901234567')).toBe(true);
    expect(isValidInternationalPhone('+33123456789')).toBe(true);
    expect(isValidInternationalPhone('+12345678')).toBe(true);
    expect(isValidInternationalPhone('+123456789012345')).toBe(true);
  });

  it.each([
    '0901234567',
    '421901234567',
    '+421 901234567',
    '+421901abc567',
    '+0212345678',
    '+1234567',
    '+1234567890123456',
    'phone',
  ])('rejects %s without rewriting it', (phone) => {
    expect(isValidInternationalPhone(phone)).toBe(false);
    expect(formatInternationalPhone(phone)).toBe(phone);
  });

  it('does not infer a country code or add a plus sign', () => {
    expect(formatInternationalPhone('0901234567')).toBe('0901234567');
    expect(formatInternationalPhone('421901234567')).toBe('421901234567');
  });
});
