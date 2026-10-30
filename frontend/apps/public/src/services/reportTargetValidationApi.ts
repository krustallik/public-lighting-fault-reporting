const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';

export type ReportTargetValidationTarget =
  | { kind: 'light-point'; lightPointId: number }
  | { kind: 'custom' | 'device'; latitude: number; longitude: number };

export class ReportTargetValidationError extends Error {
  constructor(readonly code: string) {
    super('Report location could not be validated');
    this.name = 'ReportTargetValidationError';
  }
}

export async function validateReportTargetLocation(
  target: ReportTargetValidationTarget,
  signal?: AbortSignal
): Promise<void> {
  const body = target.kind === 'light-point'
    ? { targetKind: target.kind, lightPointId: target.lightPointId }
    : {
      targetKind: target.kind,
      latitude: target.latitude,
      longitude: target.longitude,
    };
  const response = await fetch(`${API_BASE}/reports/target-validation`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });

  let result: unknown;
  try {
    result = await response.json();
  } catch {
    throw new ReportTargetValidationError('invalid_response');
  }

  if (!result || typeof result !== 'object') {
    throw new ReportTargetValidationError('invalid_response');
  }
  const record = result as { success?: unknown; code?: unknown; data?: { valid?: unknown } };
  if (!response.ok || record.success !== true) {
    throw new ReportTargetValidationError(typeof record.code === 'string' ? record.code : 'unknown_error');
  }
  if (record.data?.valid !== true) throw new ReportTargetValidationError('invalid_response');
}
