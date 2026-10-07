import { describe, expect, it, vi } from 'vitest';
import { resolveAndValidateReportTarget } from '../../src/domain/reportTarget.js';

describe('server-authoritative report target resolution', () => {
  it('uses the PostgreSQL point and ignores conflicting client coordinates', async () => {
    const repository = { findCoordinates: vi.fn(async () => ({ latitude: 48.7, longitude: 21.25 })) };
    const classifier = vi.fn(() => 'inside' as const);
    const resolved = await resolveAndValidateReportTarget({
      kind: 'light-point', lightPointId: 42, latitude: 0, longitude: 0,
    }, repository, classifier);
    expect(resolved).toEqual({ kind: 'light-point', lightPointId: 42, latitude: 48.7, longitude: 21.25 });
    expect(classifier).toHaveBeenCalledWith({ latitude: 48.7, longitude: 21.25 });
  });

  it('returns stable errors for unknown points, invalid coordinates, outside targets and unavailable boundary', async () => {
    await expect(resolveAndValidateReportTarget({ kind: 'light-point', lightPointId: 5 }, { findCoordinates: async () => null }, () => 'inside'))
      .rejects.toMatchObject({ status: 404, code: 'light_point_not_found' });
    await expect(resolveAndValidateReportTarget({ kind: 'light-point', lightPointId: 6, latitude: 48.7, longitude: 21.25 }, { findCoordinates: async () => ({ latitude: 49, longitude: 22 }) }, () => 'outside'))
      .rejects.toMatchObject({ status: 422, code: 'outside_service_area' });
    await expect(resolveAndValidateReportTarget({ kind: 'custom', latitude: 91, longitude: 0 }, undefined, () => 'inside'))
      .rejects.toMatchObject({ status: 400, code: 'invalid_coordinates' });
    await expect(resolveAndValidateReportTarget({ kind: 'manual', latitude: 48.7, longitude: 21.25 }, undefined, () => 'outside'))
      .rejects.toMatchObject({ status: 422, code: 'outside_service_area' });
    await expect(resolveAndValidateReportTarget({ kind: 'device', latitude: 48.7, longitude: 21.25 }, undefined, () => 'unavailable'))
      .rejects.toMatchObject({ status: 503, code: 'service_area_unavailable' });
  });
});
