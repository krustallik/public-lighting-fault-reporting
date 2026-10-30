import { describe, expect, it } from 'vitest';
import { formatOperatorDateTime } from '@admin/utils/formatOperatorDateTime';

describe('formatOperatorDateTime', () => {
  it('always formats timestamps in Slovak local time during standard time', () => {
    expect(formatOperatorDateTime('2026-10-30T17:03:31.000Z')).toBe('30. 10. 2026, 18:03:31');
  });

  it('applies the daylight-saving offset and handles invalid values', () => {
    expect(formatOperatorDateTime(new Date('2026-07-15T17:03:31.000Z'))).toBe('15. 7. 2026, 19:03:31');
    expect(formatOperatorDateTime('not-a-date')).toBe('—');
  });
});
