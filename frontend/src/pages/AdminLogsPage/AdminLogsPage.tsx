import { useEffect, useState } from 'react';
import { adminApi } from '@/services/adminApi';
import type { AdminActivityLog, ImportBatchLog, IntegrationLog } from '@/types/admin';
import styles from '@/styles/adminShared.module.css';

export function AdminLogsPage() {
  const [activity, setActivity] = useState<AdminActivityLog[]>([]);
  const [imports, setImports] = useState<ImportBatchLog[]>([]);
  const [integration, setIntegration] = useState<IntegrationLog[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      adminApi.getActivityLogs(),
      adminApi.getImportBatches(),
      adminApi.getIntegrationLogs(),
    ])
      .then(([a, i, integ]) => {
        setActivity(a);
        setImports(i);
        setIntegration(integ);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Načítanie zlyhalo'));
  }, []);

  if (error) return <p className={styles.error}>{error}</p>;

  return (
    <section className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.heading}>Technické logy</h1>
      </header>

      <p className={styles.muted}>
        Bez osobných údajov občanov — len importy, admin aktivity a stav integrácie.
      </p>

      <h2>Admin aktivity</h2>
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Čas</th>
              <th>Admin</th>
              <th>Akcia</th>
              <th>Entita</th>
            </tr>
          </thead>
          <tbody>
            {activity.map((log) => (
              <tr key={log.id}>
                <td>{new Date(log.created_at).toLocaleString('sk-SK')}</td>
                <td>{log.admin_username ?? '—'}</td>
                <td>{log.action}</td>
                <td>
                  {log.entity_type ?? '—'}
                  {log.entity_id != null ? ` #${log.entity_id}` : ''}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 style={{ marginTop: 'var(--space-lg)' }}>Import dávky</h2>
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Čas</th>
              <th>Súbor</th>
              <th>Admin</th>
              <th>Vytvorené</th>
              <th>Aktualizované</th>
              <th>Preskočené</th>
              <th>Chyby</th>
            </tr>
          </thead>
          <tbody>
            {imports.map((batch) => (
              <tr key={batch.id}>
                <td>{new Date(batch.created_at).toLocaleString('sk-SK')}</td>
                <td>{batch.filename}</td>
                <td>{batch.uploaded_by_username ?? '—'}</td>
                <td>{batch.created_rows}</td>
                <td>{batch.updated_rows}</td>
                <td>{batch.skipped_rows}</td>
                <td>{batch.failed_rows}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 style={{ marginTop: 'var(--space-lg)' }}>Integrácia</h2>
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Čas</th>
              <th>Typ</th>
              <th>Referencia</th>
              <th>Stav</th>
              <th>Chyba</th>
            </tr>
          </thead>
          <tbody>
            {integration.map((log) => (
              <tr key={log.id}>
                <td>{new Date(log.created_at).toLocaleString('sk-SK')}</td>
                <td>{log.integration_type}</td>
                <td>{log.reference_code ?? '—'}</td>
                <td>{log.status}</td>
                <td>{log.error_message ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
