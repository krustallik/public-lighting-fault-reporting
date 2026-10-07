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

/** Appends an explicitly approximate address as generated detail without touching the form field. */
export function appendAutomaticAddressDetail(description: string, address: string): string {
  const trimmedAddress = address.replace(/[\r\n\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!trimmedAddress) return description.trim();

  const generatedDetail = [
    `Automaticky určená adresa podľa zvolených súradníc*: ${trimmedAddress}`,
    '* Automaticky určená adresa môže byť nepresná.',
  ].join('\n');
  const trimmedDescription = description.trim();

  return trimmedDescription
    ? `${trimmedDescription}\n\n${generatedDetail}`
    : generatedDetail;
}
