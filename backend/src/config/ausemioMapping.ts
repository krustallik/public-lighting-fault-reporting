import type { IntegrationLogTechnicalPayload } from '../types/integration.js';

/**
 * Central mapping for DPMK/AUSEMIO multipart/form-data fields.
 * Field names must match the external form exactly.
 */
export const AUSEMIO_FIELDS = {
  service: 'properties[vyber_sluzby]',
  location: 'properties[ulica_miesto_poruchy_lokalita]',
  detailDescription: 'properties[detail_decription]',
  locationBlock: 'properties[lokalizacia_blok]',
  faultType: 'properties[typ_poruchy]',
  faultTypeCss: 'properties[typ_poruchy_css]',
  pedestrianCrossing: 'properties[porucha_na_prechode_pre_chodcov]',
  trafficSignal: 'properties[porucha_na_cestnej_svetelnej_signalizacii]',
  otherFault: 'properties[iny_druh_poruchy]',
  phone: 'properties[tel_cislo]',
  files: 'files[]',
  email: 'email',
  locale: 'locale',
} as const;

/** VO – verejné osvetlenie service code in AUSEMIO (not the slug verejne_osvetlenie). */
export const AUSEMIO_SERVICE_VO = '2';

/** Locale sent to AUSEMIO multipart form (external form expectation). */
export const AUSEMIO_SUBMIT_LOCALE = 'en';

export const AUSEMIO_DEFAULT_LOCATION_BLOCK = 'Q10';
export const AUSEMIO_DEFAULT_FAULT_TYPE = 'Q';

/** Technical metadata only — safe for integration_logs (no PII). */
export function mapReportToTechnicalLog(
  fields: Record<string, string>,
  fileCount: number,
  referenceCode: string,
  timestamp: string,
  lightPointId?: number | null
): IntegrationLogTechnicalPayload {
  return {
    service: fields[AUSEMIO_FIELDS.service] ?? '2',
    faultType: fields[AUSEMIO_FIELDS.faultType] ?? '',
    locationBlock: fields[AUSEMIO_FIELDS.locationBlock] ?? '',
    fileCount,
    locale: fields[AUSEMIO_FIELDS.locale] ?? AUSEMIO_SUBMIT_LOCALE,
    testMode: true,
    referenceCode,
    timestamp,
    simulatedStatus: 201,
    ...(lightPointId != null ? { lightPointId } : {}),
  };
}
