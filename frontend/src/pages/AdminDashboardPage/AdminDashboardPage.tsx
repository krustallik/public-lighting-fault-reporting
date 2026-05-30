import { Link } from 'react-router-dom';
import { adminPath } from '@/config/adminRoutes';
import styles from '@/styles/adminShared.module.css';

export function AdminDashboardPage() {
  return (
    <section className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.heading}>Admin prehľad</h1>
      </header>

      <div className={styles.card}>
        <p>Správa svetelných bodov, import/export a technická integrácia s AUSEMIO/DPMK.</p>
        <p className={styles.muted}>
          Systém neukladá osobné údaje občanov ani lokálny workflow hlásení porúch.
        </p>
        <div className={styles.actions} style={{ marginTop: 'var(--space-md)' }}>
          <Link to={adminPath('street-lights')} className={styles.button}>
            Svetelné body
          </Link>
          <Link to={adminPath('import')} className={styles.buttonSecondary}>
            Import dát
          </Link>
          <Link to={adminPath('settings')} className={styles.buttonSecondary}>
            Nastavenia integrácie
          </Link>
          <Link to={adminPath('logs')} className={styles.buttonSecondary}>
            Technické logy
          </Link>
        </div>
      </div>
    </section>
  );
}
