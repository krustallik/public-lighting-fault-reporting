import { useCallback, useEffect, useState } from 'react';
import { adminApi } from '@/services/adminApi';
import type { AdminActivityLog, ImportBatchLog, ImportBatchRow, IntegrationLog } from '@/types/admin';
import styles from '@/styles/adminShared.module.css';

export function AdminLogsPage() {
  const [activity, setActivity] = useState<AdminActivityLog[]>([]);
  const [imports, setImports] = useState<ImportBatchLog[]>([]);
  const [importTotal, setImportTotal] = useState(0);
  const [importOffset, setImportOffset] = useState(0);
  const [selectedBatch, setSelectedBatch] = useState<number | null>(null);
  const [batchRows, setBatchRows] = useState<ImportBatchRow[]>([]);
  const [nextRowCursor, setNextRowCursor] = useState<number | null>(null);
  const [integration, setIntegration] = useState<IntegrationLog[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    Promise.all([
      adminApi.getActivityLogs(),
      adminApi.getImportBatches({ limit: 10, offset: importOffset }),
      adminApi.getIntegrationLogs(),
    ])
      .then(([a, i, integ]) => {
        setActivity(a);
        setImports(i.items);
        setImportTotal(i.total);
        setIntegration(integ);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Načítanie zlyhalo'));
  }, [importOffset]);

  useEffect(() => { load(); }, [load]);

  const showBatch = async (id: number, cursor = 0) => {
    try {
      setSelectedBatch(id);
      const result = await adminApi.getImportRows(id, { limit: 50, cursor });
      setBatchRows(result.items);
      setNextRowCursor(result.nextCursor);
    } catch (err) { setError(err instanceof Error ? err.message : 'Detail importu sa nepodarilo načítať'); }
  };

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
              <th>Nezmenené</th>
              <th>Preskočené</th>
              <th>Chyby</th>
              <th>Stav / detail</th>
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
                <td>{batch.unchanged_rows}</td>
                <td>{batch.skipped_rows}</td>
                <td>{batch.failed_rows}</td>
                <td>{batch.status} · <button type="button" className={styles.buttonSecondary} onClick={() => void showBatch(batch.id)}>Detail</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className={styles.pagination}>
        <button type="button" className={styles.buttonSecondary} disabled={importOffset === 0} onClick={() => setImportOffset((value) => Math.max(0, value - 10))}>Predchádzajúca dávka</button>
        <span>{imports.length ? importOffset + 1 : 0}–{importOffset + imports.length} z {importTotal}</span>
        <button type="button" className={styles.buttonSecondary} disabled={importOffset + imports.length >= importTotal} onClick={() => setImportOffset((value) => value + 10)}>Ďalšia dávka</button>
      </div>
      {selectedBatch !== null && (
        <section aria-live="polite">
          <h3>Dávka #{selectedBatch} — výsledky riadків</h3>
          <div className={styles.tableWrap}><table className={styles.table}>
            <thead><tr><th>Riadok</th><th>Inventárne číslo</th><th>Výsledok</th><th>Bezpečný dôvod</th></tr></thead>
            <tbody>{batchRows.map((row) => <tr key={row.source_row_number}>
              <td>{row.source_row_number}</td><td>{row.inventory_number ?? '—'}</td><td>{row.outcome}</td><td>{row.safe_reason ?? row.reason_code ?? '—'}</td>
            </tr>)}</tbody>
          </table></div>
          {nextRowCursor !== null && <button type="button" className={styles.buttonSecondary} onClick={() => void showBatch(selectedBatch, nextRowCursor)}>Načítať ďalších 50</button>}
        </section>
      )}

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
