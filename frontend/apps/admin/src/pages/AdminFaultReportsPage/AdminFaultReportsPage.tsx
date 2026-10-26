import { useCallback, useEffect, useState } from 'react';
import { adminApi } from '@admin/services/adminApi';
import type { FaultReportHistoryRow } from '@admin/types/admin';
import styles from '@admin/styles/adminShared.module.css';

const PAGE_SIZE = 25;

function targetLabel(row: FaultReportHistoryRow): string {
  if (row.target_kind === 'light-point') return `Svietidlo #${row.light_point_id}`;
  if (row.target_kind === 'manual') return 'Manuálna lokalita';
  if (row.latitude === null || row.longitude === null) return row.target_kind;
  return `${row.target_kind === 'device' ? 'GPS' : 'Vlastný bod'} · ${row.latitude.toFixed(5)}, ${row.longitude.toFixed(5)}`;
}

export function AdminFaultReportsPage() {
  const [items, setItems] = useState<FaultReportHistoryRow[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await adminApi.getFaultReportHistory({ limit: PAGE_SIZE, offset });
      setItems(result.items);
      setTotal(result.total);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Hlásenia sa nepodarilo načítať.');
    } finally {
      setBusy(false);
    }
  }, [offset]);

  useEffect(() => { void load(); }, [load]);

  return (
    <section className={styles.page}>
      <header className={styles.header}><h1 className={styles.heading}>Hlásenia porúch</h1></header>
      <p className={styles.muted}>
        História obsahuje iba čas, typ a miesto poruchy. Kontaktné údaje a pôvodný opis sa neukladajú.
      </p>
      {error && <p className={styles.error} role="alert">{error}</p>}
      {busy && <p role="status">Načítavam hlásenia…</p>}
      {!busy && !error && items.length === 0 && <p>Nie sú evidované žiadne hlásenia.</p>}
      {!busy && !error && items.length > 0 && (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead><tr><th>Čas (UTC)</th><th>Lokalita</th><th>Miesto</th><th>Blok</th><th>Typ</th><th>Poznámka pre operátora</th></tr></thead>
            <tbody>{items.map((row) => (
              <tr key={row.id}>
                <td>{new Date(row.submitted_at).toLocaleString('sk-SK', { timeZone: 'UTC' })}</td>
                <td>{row.locality}</td>
                <td>{targetLabel(row)}</td>
                <td>{row.location_block_code ?? '—'}</td>
                <td>{row.fault_type_code ?? '—'}</td>
                <td>{row.automatic_notes.length ? row.automatic_notes.join(' ') : '—'}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
      <div className={styles.pagination}>
        <button type="button" className={styles.buttonSecondary} disabled={busy || offset === 0}
          onClick={() => setOffset((value) => Math.max(0, value - PAGE_SIZE))}>Predchádzajúca</button>
        <span>{items.length ? `${offset + 1}–${offset + items.length}` : '0'} z {total}</span>
        <button type="button" className={styles.buttonSecondary} disabled={busy || offset + items.length >= total}
          onClick={() => setOffset((value) => value + PAGE_SIZE)}>Ďalšia</button>
        {error && <button type="button" className={styles.buttonSecondary} onClick={() => void load()}>Skúsiť znova</button>}
      </div>
    </section>
  );
}
