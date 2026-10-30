import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { adminPath } from '@admin/config/adminRoutes';
import { adminApi } from '@admin/services/adminApi';
import type { AdminDashboardOverview, FaultReportHistoryRow } from '@admin/types/admin';
import styles from '@admin/styles/adminShared.module.css';
import pageStyles from './AdminDashboardPage.module.css';
import { formatOperatorDateTime } from '@admin/utils/formatOperatorDateTime';

function reportLocation(row: FaultReportHistoryRow): string {
  if (row.light_point_id !== null) return `Evidovaný bod #${row.light_point_id}`;
  if (row.latitude !== null && row.longitude !== null) return `${row.latitude.toFixed(5)}, ${row.longitude.toFixed(5)}`;
  return 'Miesto zadané ručne';
}

export function AdminDashboardPage() {
  const [overview, setOverview] = useState<AdminDashboardOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    adminApi.getDashboardOverview()
      .then((data) => { if (!cancelled) setOverview(data); })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : 'Prehľad sa nepodarilo načítať'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  return (
    <section className={`${styles.page} ${pageStyles.dashboard}`}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.heading}>Prehľad verejného osvetlenia</h1>
          <p className={styles.muted}>Lokálne evidované hlásenia a inventárne body.</p>
        </div>
        <div className={styles.actions}>
          <Link to={adminPath('street-lights/new')} className={styles.button}>Nový svetelný bod</Link>
          <Link to={adminPath('street-lights')} className={styles.buttonSecondary}>Svetelné body</Link>
          <Link to={adminPath('import')} className={styles.buttonSecondary}>Import údajov</Link>
          <Link to={adminPath('reports')} className={styles.buttonSecondary}>Hlásenia porúch</Link>
          <Link to={adminPath('statistics')} className={styles.buttonSecondary}>Štatistiky hlásení</Link>
        </div>
      </header>

      {loading && <p role="status">Načítavam prehľad…</p>}
      {error && <div className={styles.error} role="alert"><p>{error}</p><button type="button" className={styles.buttonSecondary} onClick={() => window.location.reload()}>Skúsiť znova</button></div>}
      {!loading && overview && (
        <>
          <div className={pageStyles.metrics} aria-label="Súhrnné údaje">
            <article className={pageStyles.metric}>
              <span className={pageStyles.metricLabel}>Svetelné body v inventári</span>
              <strong>{overview.inventoryTotal.toLocaleString('sk-SK')}</strong>
            </article>
            <article className={pageStyles.metric}>
              <span className={pageStyles.metricLabel}>Hlásenia za 24 hodín</span>
              <strong>{overview.reports24h.toLocaleString('sk-SK')}</strong>
            </article>
            <article className={pageStyles.metric}>
              <span className={pageStyles.metricLabel}>Hlásenia za 7 dní</span>
              <strong>{overview.reports7d.toLocaleString('sk-SK')}</strong>
            </article>
            <article className={pageStyles.metric}>
              <span className={pageStyles.metricLabel}>Hlásenia za 30 dní</span>
              <strong>{overview.reports30d.toLocaleString('sk-SK')}</strong>
            </article>
          </div>

          <section className={pageStyles.activity} aria-labelledby="recent-reports-heading">
            <div className={pageStyles.activityHeader}>
              <div>
                <h2 id="recent-reports-heading">Nedávne hlásenia</h2>
                <p className={styles.muted}>Zobrazuje sa najviac 8 posledných záznamov. Ukladajú sa iba prevádzkové údaje a automatické poznámky.</p>
              </div>
              <Link to={adminPath('reports')} className={styles.linkButton}>Celá história</Link>
            </div>
            {overview.recent.length === 0 ? (
              <div className={pageStyles.empty}>
                <h3>Zatiaľ bez hlásení</h3>
                <p className={styles.muted}>Po zaznamenaní prvého lokálneho hlásenia sa tu zobrazí jeho čas, miesto a kategória.</p>
              </div>
            ) : (
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead><tr><th>Čas (Europe/Bratislava)</th><th>Lokalita</th><th>Miesto</th><th>Typ</th><th>Poznámky pre operátora</th></tr></thead>
                  <tbody>{overview.recent.map((row) => (
                    <tr key={row.id}>
                      <td>{formatOperatorDateTime(row.submitted_at)}</td>
                      <td>{row.locality}</td>
                      <td>{reportLocation(row)}</td>
                      <td>{row.fault_type_code ?? '—'}</td>
                      <td>{row.automatic_notes.length ? row.automatic_notes.join(' ') : '—'}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </section>
  );
}
