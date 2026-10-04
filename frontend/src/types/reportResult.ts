import type { ReportFormLocale } from '@/i18n/reportFormLocale';

export interface ReportResultState {
  success: boolean;
  status?: 'local_test_received';
  errorCode?: string;
  message?: string;
  locale?: ReportFormLocale;
}
