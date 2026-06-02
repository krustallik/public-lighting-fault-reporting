import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { getReportFormMessages, type ReportFormMessages } from '@/i18n/reportFormMessages';
import {
  readStoredReportFormLocale,
  storeReportFormLocale,
  type ReportFormLocale,
} from '@/i18n/reportFormLocale';

interface ReportFormLocaleContextValue {
  locale: ReportFormLocale;
  setLocale: (locale: ReportFormLocale) => void;
  messages: ReportFormMessages;
}

const ReportFormLocaleContext = createContext<ReportFormLocaleContextValue | null>(null);

export function ReportFormLocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<ReportFormLocale>(readStoredReportFormLocale);

  const setLocale = useCallback((next: ReportFormLocale) => {
    setLocaleState(next);
    storeReportFormLocale(next);
  }, []);

  const value = useMemo(
    () => ({
      locale,
      setLocale,
      messages: getReportFormMessages(locale),
    }),
    [locale, setLocale]
  );

  return (
    <ReportFormLocaleContext.Provider value={value}>{children}</ReportFormLocaleContext.Provider>
  );
}

export function useReportFormLocale(): ReportFormLocaleContextValue {
  const context = useContext(ReportFormLocaleContext);
  if (!context) {
    throw new Error('useReportFormLocale must be used within ReportFormLocaleProvider');
  }
  return context;
}
