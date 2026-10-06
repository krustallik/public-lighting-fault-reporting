import { Link, useLocation } from 'react-router-dom';
import type { ReportResultState } from '@/types/reportResult';
import { useReportFormLocale } from '@/context/ReportFormLocaleContext';
import styles from './ResultPage.module.css';

export function ResultPage() {
  const location = useLocation();
  const state = (location.state as ReportResultState | null) ?? null;
  const { messages } = useReportFormLocale();
  const t = messages.result;

  if (!state) {
    return (
      <section className={styles.section}>
        <h2 className={styles.heading}>{t.fallbackTitle}</h2>
        <p className={styles.fallback}>{t.fallbackEmpty}</p>
        <p className={styles.fallbackHint}>{t.fallbackHint}</p>
        <div className={styles.actions}><Link to="/map">{t.backToMap}</Link></div>
      </section>
    );
  }

  const transportUnavailable = state.errorCode === 'LOCAL_TEST_TRANSPORT_UNAVAILABLE';
  const resultClass = state.success ? styles.success : styles.failure;

  return (
    <section className={styles.section}>
      <h2 className={`${styles.heading} ${resultClass}`}>
        {state.success ? t.successTitle : transportUnavailable ? t.failureTransport : t.failureGeneric}
      </h2>

      {state.success && (
        <>
          <p className={styles.statusBadge} aria-label={t.statusAccessibleLabel}>{t.localTestBadge}</p>
          <p className={styles.message}>{t.successMessage}</p>
          <ul className={styles.metaList}>
            <li className={styles.metaItem}>
              <span className={styles.metaLabel}>{t.endpointResult}</span>{t.statusLocalTestReceived}
            </li>
          </ul>
          <p className={styles.explanation}>{t.explanation}</p>
        </>
      )}

      {!state.success && (
        <>
          <p className={styles.explanation}>{t.failureExplanation}</p>
        </>
      )}

      <div className={styles.actions}>
        <Link to="/map">{t.backToMap}</Link>
        <Link to="/map">{t.newTest}</Link>
      </div>
    </section>
  );
}
