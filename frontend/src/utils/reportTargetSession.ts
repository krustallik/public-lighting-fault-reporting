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
  longitude: number | null
): string | null {
  if (lightPointId != null) return `lightPoint:${lightPointId}`;
  if (latitude != null && longitude != null) return `coords:${latitude}:${longitude}`;
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
