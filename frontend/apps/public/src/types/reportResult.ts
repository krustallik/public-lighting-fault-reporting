import type { ReportFormLocale } from '@/i18n/reportFormLocale';

export interface ReportResultState {
  success: boolean;
  status?: 'local_test_received' | 'locally_recorded';
  errorCode?: string;
  message?: string;
  addressEnrichmentStatus?: 'unavailable' | 'not-found';
  attachmentCleanup?: 'retryable' | 'manual';
  locale?: ReportFormLocale;
}
