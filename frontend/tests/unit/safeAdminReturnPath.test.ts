import { describe, expect, it } from 'vitest';
import { safeAdminReturnPath } from '@admin/utils/safeAdminReturnPath';

describe('safeAdminReturnPath', () => {
  it('preserves a same-origin admin path with query and hash', () => {
    expect(safeAdminReturnPath('/panel-svietidla/street-lights/12?tab=history#latest'))
      .toBe('/panel-svietidla/street-lights/12?tab=history#latest');
  });

  it.each([
    'https://attacker.example/path',
    '//attacker.example/path',
    '/\\attacker.example/path',
    '/%2f%2fattacker.example/path',
    '/%5c%5cattacker.example/path',
    'javascript:alert(1)',
    '/bad%zz',
    '/path\nnext',
  ])('falls back for hostile or malformed target %s', (target) => {
    expect(safeAdminReturnPath(target, '/')).toBe('/');
  });

  it('uses the fallback for non-string and oversized values', () => {
    expect(safeAdminReturnPath(null, '/')).toBe('/');
    expect(safeAdminReturnPath(`/${'x'.repeat(2048)}`, '/')).toBe('/');
  });
});
