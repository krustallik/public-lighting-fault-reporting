/** Appended server-side to every report (AUSEMIO `properties[detail_decription]`). Not shown in the UI. */
export const INTERACTIVE_MAP_DETAIL_SUFFIX =
  'Odoslané pomocou interaktívnej mapy verejného osvetlenia.';

export function appendInteractiveMapDetailSuffix(description?: string | null): string {
  const trimmed = description?.trim() ?? '';

  if (!trimmed) {
    return INTERACTIVE_MAP_DETAIL_SUFFIX;
  }

  if (trimmed.endsWith(INTERACTIVE_MAP_DETAIL_SUFFIX)) {
    return trimmed;
  }

  return `${trimmed}\n\n${INTERACTIVE_MAP_DETAIL_SUFFIX}`;
}
