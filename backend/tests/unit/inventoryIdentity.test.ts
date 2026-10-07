import { describe, expect, it } from 'vitest';
import { canonicalizeInventoryNumber, isCanonicalInventoryNumber } from '../../src/domain/inventoryIdentity.js';

describe('P3 inventory identity canonicalization', () => {
  const edgePoints = [
    '\u0009', '\u000a', '\u000b', '\u000c', '\u000d', '\u0020', '\u00a0', '\u1680',
    ...Array.from({ length: 11 }, (_, index) => String.fromCodePoint(0x2000 + index)),
    '\u2028', '\u2029', '\u202f', '\u205f', '\u3000', '\ufeff',
  ];

  it('strips every and only approved edge code point', () => {
    for (const point of edgePoints) {
      expect(canonicalizeInventoryNumber(`${point}ABC${point}`)).toBe('ABC');
    }
    expect(canonicalizeInventoryNumber('\u0085ABC\u0085')).toBe('\u0085ABC\u0085');
  });

  it('normalizes NFC but preserves case, leading zeroes, and internal whitespace', () => {
    expect(canonicalizeInventoryNumber('Cafe\u0301')).toBe('Café');
    expect(canonicalizeInventoryNumber('A\t B')).toBe('A\t B');
    expect(canonicalizeInventoryNumber(' 00123 ')).toBe('00123');
    expect(canonicalizeInventoryNumber('ABC')).not.toBe(canonicalizeInventoryNumber('abc'));
    expect(canonicalizeInventoryNumber('00123')).not.toBe(canonicalizeInventoryNumber('123'));
  });

  it('identifies already canonical, non-empty values', () => {
    expect(isCanonicalInventoryNumber('Café')).toBe(true);
    expect(isCanonicalInventoryNumber('')).toBe(false);
    expect(isCanonicalInventoryNumber(' ABC ')).toBe(false);
    expect(isCanonicalInventoryNumber('Cafe\u0301')).toBe(false);
  });
});
