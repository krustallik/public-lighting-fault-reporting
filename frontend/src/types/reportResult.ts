import type { SendReportResponse } from '@/types';
import type { ReportFormLocale } from '@/i18n/reportFormLocale';

/** Passed via React Router state after POST /api/reports/send (not stored in localStorage). */
export interface ReportResultState {
  success: boolean;
  referenceCode?: string;
  message?: string;
  status?: string;
  acceptedAt?: string;
  locale?: ReportFormLocale;
  ausemioPayload?: SendReportResponse['ausemioPayload'];
}
