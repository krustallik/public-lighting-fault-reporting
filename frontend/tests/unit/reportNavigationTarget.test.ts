import { describe, expect, it } from 'vitest';
import {
  createReportNavigationState,
  readReportTarget,
  type ReportTarget,
} from '../../src/utils/reportNavigationTarget';

describe('ephemeral report target navigation state', () => {
  it.each<ReportTarget>([
    { kind: 'light-point', lightPointId: 42 },
    { kind: 'custom', latitude: 48.7, longitude: 21.25 },
    { kind: 'device', latitude: 48.7, longitude: 21.25 },
    { kind: 'manual' },
  ])('round-trips the %s target without putting coordinates in a URL', (target) => {
    const state = createReportNavigationState(target);

    expect(readReportTarget(state)).toEqual(target);
    expect(JSON.stringify(state)).not.toContain('lat=');
    expect(JSON.stringify(state)).not.toContain('lng=');
  });

  it.each([
    null,
    undefined,
    {},
    { reportTarget: { kind: 'light-point', lightPointId: 0 } },
    { reportTarget: { kind: 'custom', latitude: Number.NaN, longitude: 21.25 } },
    { reportTarget: { kind: 'device', latitude: 48.7, longitude: 181 } },
    { reportTarget: { kind: 'unexpected', latitude: 48.7, longitude: 21.25 } },
  ])('rejects malformed navigation state %s', (state) => {
    expect(readReportTarget(state)).toBeNull();
  });

  it('does not accept legacy query parameters as target state', () => {
    expect(readReportTarget(null)).toBeNull();
  });
});
