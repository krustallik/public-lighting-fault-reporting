import type { ReportFormValues } from '@/schemas/reportSchema';

export const INITIAL_REPORT_FORM_VALUES: ReportFormValues = {
  locality: '',
  detailDescription: '',
  locationBlock: '',
  faultType: '',
  otherFaultText: '',
  phone: '',
  email: '',
  consent: false,
};

export function getReportTargetIdentity(
  lightPointId: number | null,
  latitude: number | null,
  longitude: number | null,
  coordinateKind: 'custom' | 'device' | 'manual' = 'custom'
): string | null {
  if (lightPointId != null) return `lightPoint:${lightPointId}`;
  if (latitude != null && longitude != null) {
    const identityKind = coordinateKind === 'custom' ? 'coords' : coordinateKind;
    return `${identityKind}:${latitude}:${longitude}`;
  }
  if (coordinateKind === 'manual') return 'manual';
  return null;
}

export function transitionReportTarget(
  previousIdentity: string | null,
  nextIdentity: string | null,
  autofillTracker: { reset(): void },
  resetForm: (values: ReportFormValues) => void
): boolean {
  if (previousIdentity === nextIdentity) return false;

  autofillTracker.reset();
  resetForm({ ...INITIAL_REPORT_FORM_VALUES });
  return true;
}

export function shouldClearOtherFaultOnTypeChange(previous: string | undefined, next: string): boolean {
  return previous === 'Q99' && next !== 'Q99';
}
