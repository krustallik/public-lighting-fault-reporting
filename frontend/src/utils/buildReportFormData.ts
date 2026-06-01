import {
  AUSEMIO_DEFAULT_FAULT_TYPE,
  AUSEMIO_DEFAULT_LOCATION_BLOCK,
  AUSEMIO_FIELDS,
  AUSEMIO_SERVICE_VO,
  AUSEMIO_SUBMIT_LOCALE,
} from '@/config/ausemioForm';
import type { ReportFormValues } from '@/schemas/reportSchema';

/**
 * Builds multipart/form-data body with AUSEMIO field names only.
 * Excludes app-internal fields: lightPointId, consent, service slug, etc.
 */
export function buildReportFormData(
  values: ReportFormValues,
  files: File[]
): FormData {
  const formData = new FormData();

  formData.append(AUSEMIO_FIELDS.service, AUSEMIO_SERVICE_VO);
  formData.append(AUSEMIO_FIELDS.location, values.streetOrLocation.trim());
  formData.append(AUSEMIO_FIELDS.detailDescription, values.detailDescription?.trim() ?? '');
  formData.append(
    AUSEMIO_FIELDS.locationBlock,
    values.locationBlock?.trim() || AUSEMIO_DEFAULT_LOCATION_BLOCK
  );
  formData.append(
    AUSEMIO_FIELDS.faultType,
    values.faultType?.trim() || AUSEMIO_DEFAULT_FAULT_TYPE
  );
  formData.append(AUSEMIO_FIELDS.faultTypeCss, '');
  formData.append(AUSEMIO_FIELDS.pedestrianCrossing, '');
  formData.append(AUSEMIO_FIELDS.trafficSignal, '');
  formData.append(AUSEMIO_FIELDS.otherFault, values.otherFaultText?.trim() ?? '');
  formData.append(AUSEMIO_FIELDS.phone, values.phone?.trim() ?? '');

  for (const file of files) {
    formData.append(AUSEMIO_FIELDS.files, file);
  }

  formData.append(AUSEMIO_FIELDS.email, values.email.trim());
  formData.append(AUSEMIO_FIELDS.locale, AUSEMIO_SUBMIT_LOCALE);

  return formData;
}
