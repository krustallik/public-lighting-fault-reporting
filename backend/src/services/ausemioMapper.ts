import { config } from '../config/index.js';
import {
  AUSEMIO_FIELDS,
  AUSEMIO_SUBMIT_LOCALE,
} from '../config/ausemioMapping.js';
import type { AusemioDebugPayload, AusemioFileMetadata } from '../types/ausemio.js';
import type { NormalizedReportPayload, ReportFileMetadata } from '../types/report.js';

export { AUSEMIO_SUBMIT_LOCALE };

/**
 * Builds flat multipart field names → string values exactly as AUSEMIO expects.
 * Does not perform HTTP; for inspection and future submission only.
 */
export function buildAusemioMultipartFields(
  report: NormalizedReportPayload
): Record<string, string> {
  return {
    [AUSEMIO_FIELDS.service]: '2',
    [AUSEMIO_FIELDS.location]: report.streetOrLocation,
    [AUSEMIO_FIELDS.detailDescription]: report.detailDescription,
    [AUSEMIO_FIELDS.locationBlock]: report.locationBlock,
    [AUSEMIO_FIELDS.faultType]: report.faultType,
    [AUSEMIO_FIELDS.faultTypeCss]: '',
    [AUSEMIO_FIELDS.pedestrianCrossing]: '',
    [AUSEMIO_FIELDS.trafficSignal]: '',
    [AUSEMIO_FIELDS.otherFault]: report.otherFaultText ?? '',
    [AUSEMIO_FIELDS.phone]: report.phone ?? '',
    [AUSEMIO_FIELDS.email]: report.email,
    [AUSEMIO_FIELDS.locale]: AUSEMIO_SUBMIT_LOCALE,
  };
}

export function mapReportFilesToAusemioMetadata(
  files: ReportFileMetadata[]
): AusemioFileMetadata[] {
  return files.map((file) => ({
    fieldName: 'files[]',
    name: file.name,
    size: file.size ?? 0,
    mimeType: file.mimeType ?? 'application/octet-stream',
  }));
}

/**
 * Full test/debug payload showing what would be POSTed to AUSEMIO as multipart/form-data.
 */
export function buildAusemioDebugPayload(report: NormalizedReportPayload): AusemioDebugPayload {
  return {
    testMode: true,
    targetUrl: config.aussemio.baseUrl,
    method: 'POST',
    contentType: 'multipart/form-data',
    fields: buildAusemioMultipartFields(report),
    files: mapReportFilesToAusemioMetadata(report.files),
  };
}
