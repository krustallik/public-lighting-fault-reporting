import { Link, useLocation } from 'react-router-dom';
import type { ReportResultState } from '@/types/reportResult';
import styles from './ResultPage.module.css';

export function ResultPage() {
  const location = useLocation();
  const state = (location.state as ReportResultState | null) ?? null;

  if (!state) {
    return (
      <section className={styles.section}>
        <h2 className={styles.heading}>Výsledok lokálneho testu</h2>
        <p className={styles.fallback}>Nie sú dostupné údaje lokálneho testu.</p>
        <p className={styles.fallbackHint}>
          Vyplňte formulár. Odoslanie je určené iba pre lokálny testovací endpoint.
        </p>
        <div className={styles.actions}>
          <Link to="/map">Späť na mapu</Link>
          <Link to="/report">Formulár hlásenia</Link>
        </div>
      </section>
    );
  }

  const transportUnavailable = state.errorCode === 'LOCAL_TEST_TRANSPORT_UNAVAILABLE';
  const resultClass = state.success ? styles.success : styles.failure;

  return (
    <section className={styles.section}>
      <h2 className={`${styles.heading} ${resultClass}`}>
        {state.success
          ? 'LOCAL TEST / SIMULATED'
          : transportUnavailable
            ? 'Local test submission endpoint unavailable'
            : 'Local test was not completed'}
      </h2>

      {state.success && (
        <>
          <p className={styles.statusBadge} aria-label="Local test status">
            LOCAL TEST
          </p>
          <p className={styles.message}>
            {state.message ?? 'Request received by the local test endpoint only; it was not sent to AUSEMIO.'}
          </p>
          <ul className={styles.metaList}>
            <li className={styles.metaItem}>
              <span className={styles.metaLabel}>Local endpoint result: </span>
              {state.status ?? 'local_test_received'}
            </li>
          </ul>
          <p className={styles.explanation}>
            This request was received only by <code>POST /api/dev/ausemio-test-submit</code>.
            It was not sent to AUSEMIO/DPMK and does not establish external acceptance. The
            transient request and metadata-only response can be inspected in DevTools → Network.
          </p>
        </>
      )}

      {!state.success && (
        <>
          {state.errorCode && <p className={styles.statusBadge}>{state.errorCode}</p>}
          {state.message && <p className={styles.message}>{state.message}</p>}
          <p className={styles.explanation}>
            No alternate report transport was attempted.
          </p>
        </>
      )}

      <div className={styles.actions}>
        <Link to="/map">Späť na mapu</Link>
        <Link to="/report">Nové lokálne testovanie</Link>
      </div>
    </section>
  );
}
