import type { NormalizedReportPayload } from '../types/report.js';
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

/** Technical metadata only — safe for integration_logs (no PII). */
export function mapReportToTechnicalLog(
  report: NormalizedReportPayload,
  referenceCode: string,
  timestamp: string
): IntegrationLogTechnicalPayload {
  return {
    lightPointId: report.lightPointId ?? null,
    faultType: report.faultType,
    service: report.service,
    locationBlock: report.locationBlock,
    fileCount: report.files.length,
    ausemioLocale: AUSEMIO_SUBMIT_LOCALE,
    testMode: true,
    referenceCode,
    timestamp,
  };
}
