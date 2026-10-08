export const REPORT_FORM_LOCALES = ['sk', 'en'] as const;

export type ReportFormLocale = (typeof REPORT_FORM_LOCALES)[number];

export const REPORT_FORM_LOCALE_STORAGE_KEY = 'public-report-form-locale';

export function isReportFormLocale(value: string): value is ReportFormLocale {
  return (REPORT_FORM_LOCALES as readonly string[]).includes(value);
}

export function readStoredReportFormLocale(): ReportFormLocale {
  if (typeof sessionStorage === 'undefined') {
    return 'sk';
  }

  const stored = sessionStorage.getItem(REPORT_FORM_LOCALE_STORAGE_KEY);
  return stored && isReportFormLocale(stored) ? stored : 'sk';
}

export function storeReportFormLocale(locale: ReportFormLocale): void {
  sessionStorage.setItem(REPORT_FORM_LOCALE_STORAGE_KEY, locale);
}
