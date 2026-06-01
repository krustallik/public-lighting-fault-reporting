/** Appended to every report detail description (AUSEMIO detail_decription). */
export const STUDENT_APP_DETAIL_SUFFIX =
  'Odoslané pomocou študentského programu';

export function appendStudentAppDetailSuffix(description?: string | null): string {
  const trimmed = description?.trim() ?? '';

  if (!trimmed) {
    return STUDENT_APP_DETAIL_SUFFIX;
  }

  if (trimmed.endsWith(STUDENT_APP_DETAIL_SUFFIX)) {
    return trimmed;
  }

  return `${trimmed}\n\n${STUDENT_APP_DETAIL_SUFFIX}`;
}
