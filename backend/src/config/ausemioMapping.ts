import type { ReportPayload } from '../types/report.js';

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

/** VO – verejné osvetlenie (public lighting only; CSS not in scope). */
export const AUSEMIO_SERVICE_VO = 'verejne_osvetlenie';

export interface AusemioFormFields {
  [AUSEMIO_FIELDS.service]: string;
  [AUSEMIO_FIELDS.location]: string;
  [AUSEMIO_FIELDS.detailDescription]: string;
  [AUSEMIO_FIELDS.locationBlock]: string;
  [AUSEMIO_FIELDS.faultType]: string;
  [AUSEMIO_FIELDS.faultTypeCss]: string;
  [AUSEMIO_FIELDS.pedestrianCrossing]: string;
  [AUSEMIO_FIELDS.trafficSignal]: string;
  [AUSEMIO_FIELDS.otherFault]: string;
  [AUSEMIO_FIELDS.phone]: string;
  [AUSEMIO_FIELDS.email]: string;
  [AUSEMIO_FIELDS.locale]: string;
}

export function mapReportToAusemioForm(
  report: ReportPayload,
  options: { address?: string | null; locale?: string }
): AusemioFormFields {
  return {
    [AUSEMIO_FIELDS.service]: AUSEMIO_SERVICE_VO,
    [AUSEMIO_FIELDS.location]: options.address ?? '',
    [AUSEMIO_FIELDS.detailDescription]: report.description ?? '',
    [AUSEMIO_FIELDS.locationBlock]: report.lightPointId != null ? String(report.lightPointId) : '',
    [AUSEMIO_FIELDS.faultType]: report.faultType ?? '',
    [AUSEMIO_FIELDS.faultTypeCss]: '',
    [AUSEMIO_FIELDS.pedestrianCrossing]: '',
    [AUSEMIO_FIELDS.trafficSignal]: '',
    [AUSEMIO_FIELDS.otherFault]: report.customFaultText ?? '',
    [AUSEMIO_FIELDS.phone]: report.reporterPhone ?? '',
    [AUSEMIO_FIELDS.email]: report.reporterEmail ?? '',
    [AUSEMIO_FIELDS.locale]: report.locale ?? options.locale ?? 'sk',
  };
}

/** Technical metadata only — safe for integration_logs (no PII). */
export function mapReportToTechnicalLog(report: ReportPayload) {
  return {
    lightPointId: report.lightPointId ?? null,
    faultType: report.faultType ?? null,
  };
}
