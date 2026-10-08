import {
  AUSEMIO_FAULT_TYPE_OTHER,
  AUSEMIO_FIELDS,
  AUSEMIO_SERVICE_VO,
} from '@/config/ausemioForm';
import type { ReportFormLocale } from '@/i18n/reportFormLocale';
import type { ReportFormValues } from '@/schemas/reportSchema';
import { formatInternationalPhone } from '@/utils/slovakPhone';

/** Builds the local service-2 VO multipart payload with no invented optional values. */
export function buildReportFormData(
  values: ReportFormValues,
  files: File[],
  locale: ReportFormLocale
): FormData {
  const formData = new FormData();
  const locality = values.locality.trim();
  const detailDescription = values.detailDescription?.trim() ?? '';
  const locationBlock = values.locationBlock?.trim() ?? '';
  const faultType = values.faultType?.trim() ?? '';
  const otherFaultText = values.otherFaultText?.trim() ?? '';

  formData.append(AUSEMIO_FIELDS.service, AUSEMIO_SERVICE_VO);
  formData.append(AUSEMIO_FIELDS.location, locality);
  if (detailDescription) {
    formData.append(AUSEMIO_FIELDS.detailDescription, detailDescription);
  }
  if (locationBlock) {
    formData.append(AUSEMIO_FIELDS.locationBlock, locationBlock);
  }
  if (faultType) {
    formData.append(AUSEMIO_FIELDS.faultType, faultType);
  }
  if (faultType === AUSEMIO_FAULT_TYPE_OTHER && otherFaultText) {
    formData.append(AUSEMIO_FIELDS.otherFault, otherFaultText);
  }
  formData.append(AUSEMIO_FIELDS.phone, formatInternationalPhone(values.phone));

  for (const file of files) {
    formData.append(AUSEMIO_FIELDS.files, file);
  }

  formData.append(AUSEMIO_FIELDS.email, values.email.trim());
  formData.append(AUSEMIO_FIELDS.locale, locale);
  return formData;
}
