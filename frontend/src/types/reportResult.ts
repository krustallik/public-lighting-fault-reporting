import type { SendReportResponse } from '@/types';

/** Passed via React Router state after POST /api/reports/send (not stored in localStorage). */
export interface ReportResultState {
  success: boolean;
  referenceCode?: string;
  message?: string;
  status?: string;
  acceptedAt?: string;
  ausemioPayload?: SendReportResponse['ausemioPayload'];
}
