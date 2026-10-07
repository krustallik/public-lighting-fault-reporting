import type { QueryResultRow } from 'pg';
import { pool } from '../db/pool.js';
import { kosiceServiceAreaClassifier, type ServiceAreaClassification } from './serviceArea.js';

export type UntrustedReportTarget =
  | { kind: 'light-point'; lightPointId: number; latitude?: number; longitude?: number }
  | { kind: 'custom' | 'device' | 'manual'; latitude: number; longitude: number };

export interface ResolvedReportTarget { kind: UntrustedReportTarget['kind']; latitude: number; longitude: number; lightPointId?: number }
export interface LightPointCoordinateRepository { findCoordinates(id: number): Promise<{ latitude: number; longitude: number } | null> }

export class ReportTargetError extends Error {
  constructor(readonly status: 400 | 404 | 422 | 503, readonly code: string) {
    super(code);
    this.name = 'ReportTargetError';
  }
}

export const postgresLightPointCoordinateRepository: LightPointCoordinateRepository = {
  async findCoordinates(id) {
    const { rows } = await pool.query<QueryResultRow & { latitude: string; longitude: string }>(
      'SELECT ST_Y(geom)::text AS latitude, ST_X(geom)::text AS longitude FROM light_points WHERE id = $1', [id]
    );
    const row = rows[0];
    return row ? { latitude: Number(row.latitude), longitude: Number(row.longitude) } : null;
  },
};

function validateCoordinates(latitude: unknown, longitude: unknown): void {
  if (typeof latitude !== 'number' || typeof longitude !== 'number' ||
    !Number.isFinite(latitude) || !Number.isFinite(longitude) ||
    latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
    throw new ReportTargetError(400, 'invalid_coordinates');
  }
}

export async function resolveAndValidateReportTarget(
  input: unknown,
  repository: LightPointCoordinateRepository = postgresLightPointCoordinateRepository,
  classifyArea: (point: unknown) => ServiceAreaClassification = kosiceServiceAreaClassifier
): Promise<ResolvedReportTarget> {
  if (!input || typeof input !== 'object' || Array.isArray(input) || !('kind' in input)) {
    throw new ReportTargetError(400, 'invalid_coordinates');
  }
  const target = input as Record<string, unknown>;
  let resolved: ResolvedReportTarget;
  if (target.kind === 'light-point') {
    if (typeof target.lightPointId !== 'number' || !Number.isSafeInteger(target.lightPointId) || target.lightPointId <= 0) {
      throw new ReportTargetError(400, 'invalid_coordinates');
    }
    const point = await repository.findCoordinates(target.lightPointId);
    if (!point) throw new ReportTargetError(404, 'light_point_not_found');
    validateCoordinates(point.latitude, point.longitude);
    // Any client-supplied coordinates are intentionally ignored; PostgreSQL is canonical.
    resolved = { kind: 'light-point', lightPointId: target.lightPointId, latitude: point.latitude, longitude: point.longitude };
  } else if (target.kind === 'custom' || target.kind === 'device' || target.kind === 'manual') {
    validateCoordinates(target.latitude, target.longitude);
    resolved = { kind: target.kind, latitude: target.latitude as number, longitude: target.longitude as number };
  } else {
    throw new ReportTargetError(400, 'invalid_coordinates');
  }

  const classification = classifyArea({ latitude: resolved.latitude, longitude: resolved.longitude });
  if (classification === 'unavailable') throw new ReportTargetError(503, 'service_area_unavailable');
  if (classification !== 'inside') throw new ReportTargetError(classification === 'invalid-coordinate' ? 400 : 422,
    classification === 'invalid-coordinate' ? 'invalid_coordinates' : 'outside_service_area');
  return resolved;
}
