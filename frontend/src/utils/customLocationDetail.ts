import type { ReportFormLocale } from '@/i18n/reportFormLocale';
import { getReportFormMessages } from '@/i18n/reportFormMessages';

/** Appended to detail_decription when the user picked a map point outside the light_points DB. */
export function appendCustomLocationDetailNote(
  description: string,
  latitude: number,
  longitude: number,
  locale: ReportFormLocale
): string {
  const { customLocationNote } = getReportFormMessages(locale);
  const trimmed = description.trim();
  const note = [
    customLocationNote.noPoleInDb,
    customLocationNote.coordinates(latitude, longitude),
  ].join('\n');

  if (!trimmed) {
    return note;
  }

  return `${trimmed}\n\n${note}`;
}
