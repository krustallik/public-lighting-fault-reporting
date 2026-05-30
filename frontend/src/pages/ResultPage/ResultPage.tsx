import { Link, useLocation } from 'react-router-dom';
import styles from './ResultPage.module.css';

interface ResultState {
  success?: boolean;
  referenceCode?: string;
  message?: string;
}

export function ResultPage() {
  const location = useLocation();
  const state = (location.state as ResultState) ?? {};
  const success = state.success ?? false;

  return (
    <section className={styles.section}>
      <h2 className={success ? styles.success : styles.failure}>
        {success ? 'Hlásenie bolo prijaté' : 'Hlásenie sa nepodarilo odoslať'}
      </h2>

      {success && state.referenceCode && (
        <p className={styles.detail}>
          Referenčné číslo: <strong>{state.referenceCode}</strong>
        </p>
      )}

      {!success && state.message && (
        <p className={styles.detail}>{state.message}</p>
      )}

      <div className={styles.actions}>
        <Link to="/map">Späť na mapu</Link>
        <Link to="/report">Nové hlásenie</Link>
      </div>
    </section>
  );
}
