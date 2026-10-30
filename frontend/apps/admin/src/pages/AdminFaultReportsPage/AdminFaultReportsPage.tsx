import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { adminApi } from '@admin/services/adminApi';
import type { FaultReportHistoryRow } from '@admin/types/admin';
import styles from '@admin/styles/adminShared.module.css';
import { AdminPagination } from '@admin/components/AdminPagination/AdminPagination';
import { formatOperatorDateTime } from '@admin/utils/formatOperatorDateTime';
import { normalizePageParam, readPageParam, updateAdminQuery } from '@admin/utils/adminUrlState';

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
  const [params, setParams] = useSearchParams();
  const page = readPageParam(params);
  const [totalPages, setTotalPages] = useState(1);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadVersion, setReloadVersion] = useState(0);

  useEffect(() => {
    let current = true;
    setBusy(true);
    setError(null);
    void adminApi.getFaultReportHistory({ limit: PAGE_SIZE, page }).then((result) => {
      if (!current) return;
      setItems(result.items);
      setTotal(result.total);
      const pages = Math.ceil(result.total / PAGE_SIZE) || 1;
      setTotalPages(pages);
      normalizePageParam(params, setParams, pages);
    }).catch((cause: unknown) => {
      if (!current) return;
      setError(cause instanceof Error ? cause.message : 'Hlásenia sa nepodarilo načítať.');
    }).finally(() => {
      if (current) setBusy(false);
    });
    return () => { current = false; };
  }, [page, params, reloadVersion, setParams]);

  return (
    <section className={styles.page}>
      <header className={styles.header}><h1 className={styles.heading}>Hlásenia porúch</h1></header>
      <p className={styles.muted}>
        História obsahuje prevádzkové údaje a automatické poznámky pre operátora. Kontaktné údaje a pôvodný opis sa neukladajú.
      </p>
      {error && <p className={styles.error} role="alert">{error}</p>}
      {busy && <p role="status">Načítavam hlásenia…</p>}
      {!busy && !error && items.length === 0 && <p>Nie sú evidované žiadne hlásenia.</p>}
      {!busy && !error && items.length > 0 && (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead><tr><th>Čas (Europe/Bratislava)</th><th>Lokalita</th><th>Miesto</th><th>Blok</th><th>Typ</th><th>Poznámka pre operátora</th></tr></thead>
            <tbody>{items.map((row) => (
              <tr key={row.id}>
                <td>{formatOperatorDateTime(row.submitted_at)}</td>
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
      <AdminPagination
        page={page}
        totalPages={totalPages}
        totalRecords={total}
        disabled={busy}
        onPageChange={(nextPage) => updateAdminQuery(setParams, { page: nextPage === 1 ? null : nextPage })}
      />
      {error && <button type="button" className={styles.buttonSecondary} onClick={() => setReloadVersion((value) => value + 1)}>Skúsiť znova</button>}
    </section>
  );
}
