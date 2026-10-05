import { isValidReportCoordinates } from './reportLocationParams';

export type ReportTarget =
  | { kind: 'light-point'; lightPointId: number }
  | { kind: 'custom' | 'device'; latitude: number; longitude: number }
  | { kind: 'manual' };

export interface ReportNavigationState {
  reportTarget: ReportTarget;
}

export function createReportNavigationState(target: ReportTarget): ReportNavigationState {
  return { reportTarget: target };
}

export function readReportTarget(state: unknown): ReportTarget | null {
  if (!state || typeof state !== 'object' || !('reportTarget' in state)) {
    return null;
  }

  const target = state.reportTarget;
  if (!target || typeof target !== 'object' || !('kind' in target)) {
    return null;
  }

  if (
    target.kind === 'light-point' &&
    'lightPointId' in target &&
    typeof target.lightPointId === 'number' &&
    Number.isSafeInteger(target.lightPointId) &&
    target.lightPointId > 0
  ) {
    return { kind: 'light-point', lightPointId: target.lightPointId };
  }

  if (
    (target.kind === 'custom' || target.kind === 'device') &&
    'latitude' in target &&
    'longitude' in target &&
    typeof target.latitude === 'number' &&
    typeof target.longitude === 'number' &&
    isValidReportCoordinates(target.latitude, target.longitude)
  ) {
    return {
      kind: target.kind,
      latitude: target.latitude,
      longitude: target.longitude,
    };
  }

  if (target.kind === 'manual') {
    return { kind: 'manual' };
  }

  return null;
}
