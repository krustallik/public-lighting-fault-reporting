import type { SendReportResponse } from '@/types';
import { maskDetailDescription, maskEmail, maskPhone } from '@/utils/maskPii';

/** AUSEMIO multipart field order for debug preview. */
export const AUSEMIO_PREVIEW_FIELD_KEYS = [
  'properties[vyber_sluzby]',
  'properties[ulica_miesto_poruchy_lokalita]',
  'properties[detail_decription]',
  'properties[lokalizacia_blok]',
  'properties[typ_poruchy]',
  'properties[typ_poruchy_css]',
  'properties[porucha_na_prechode_pre_chodcov]',
  'properties[porucha_na_cestnej_svetelnej_signalizacii]',
  'properties[iny_druh_poruchy]',
  'properties[tel_cislo]',
  'email',
  'locale',
] as const;

const EMAIL_FIELD = 'email';
const PHONE_FIELD = 'properties[tel_cislo]';
const DETAIL_FIELD = 'properties[detail_decription]';
const OTHER_FAULT_FIELD = 'properties[iny_druh_poruchy]';

export interface AusemioPreviewRow {
  field: string;
  value: string;
  masked: boolean;
}

function maskFieldValue(field: string, value: string, devMode: boolean): { value: string; masked: boolean } {
  if (!value) {
    return { value: '—', masked: false };
  }

  if (field === EMAIL_FIELD) {
    return { value: maskEmail(value), masked: true };
  }

  if (field === PHONE_FIELD) {
    return { value: maskPhone(value), masked: true };
  }

  if (field === DETAIL_FIELD) {
    if (devMode) {
      return { value, masked: false };
    }
    return { value: maskDetailDescription(value), masked: true };
  }

  if (field === OTHER_FAULT_FIELD && value.trim()) {
    return { value: maskDetailDescription(value), masked: true };
  }

  return { value, masked: false };
}

export function buildAusemioPreviewRows(
  payload: NonNullable<SendReportResponse['ausemioPayload']>,
  devMode = import.meta.env.DEV
): AusemioPreviewRow[] {
  return AUSEMIO_PREVIEW_FIELD_KEYS.map((field) => {
    const raw = payload.fields[field] ?? '';
    const { value, masked } = maskFieldValue(field, raw, devMode);
    return { field, value, masked };
  });
}

export function formatAusemioFilesPreview(
  payload: NonNullable<SendReportResponse['ausemioPayload']>
): string {
  if (payload.files.length === 0) {
    return '— (žiadne súbory)';
  }

  return payload.files
    .map((file) => `${file.name} (${file.mimeType}, ${file.size} B)`)
    .join('; ');
}
