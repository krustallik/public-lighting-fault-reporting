import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { SortableColumnHeader } from '@admin/components/SortableColumnHeader/SortableColumnHeader';
import { adminPath } from '@admin/config/adminRoutes';
import { adminApi } from '@admin/services/adminApi';
import type { ImportPreview } from '@admin/types/admin';
import type { ImportBatchLog, ImportBatchRow } from '@admin/types/admin';
import styles from '@admin/styles/adminShared.module.css';
import { AdminPagination } from '@admin/components/AdminPagination/AdminPagination';
import { readPageParam, updateAdminQuery } from '@admin/utils/adminUrlState';

const PAGE_SIZE = 25;

export function AdminImportPage() {
  const [params, setParams] = useSearchParams();
  const page = readPageParam(params);
  const sortBy = params.get('sortBy') ?? 'rowIndex';
  const sortOrder = params.get('sortOrder') === 'desc' ? 'desc' : 'asc';
  const previewId = params.get('preview');
  const batchId = Number(params.get('batch')) || null;
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [allowUpdate, setAllowUpdate] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [batch, setBatch] = useState<ImportBatchLog | null>(null);
  const [failedRows, setFailedRows] = useState<ImportBatchRow[]>([]);
  const previewRequestSequence = useRef(0);
  const loadedPreviewKey = useRef('');

  const totalPages = preview?.pagination.totalPages ?? 1;
  const paginatedResults = preview?.results ?? [];

  useEffect(() => {
    if (batchId === null) { setBatch(null); setFailedRows([]); return; }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        const current = await adminApi.getImportStatus(batchId);
        if (cancelled) return;
        setBatch(current);
        if (current.status === 'queued' || current.status === 'processing') {
          timer = setTimeout(() => void poll(), 900);
        } else if (current.failed_rows > 0) {
          const failures = await adminApi.getImportRows(batchId, { outcome: 'failed', limit: 50 });
          if (!cancelled) setFailedRows(failures.items);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Stav importu sa nepodarilo načítať');
      }
    };
    void poll();
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [batchId]);

  const handleSort = (column: string, order: 'asc' | 'desc') => {
    updateAdminQuery(setParams, { sortBy: column, sortOrder: order, page: null });
  };

  useEffect(() => {
    if (!previewId) {
      loadedPreviewKey.current = '';
      setPreview(null);
      return;
    }
    const requestedKey = `${previewId}:${page}:${sortBy}:${sortOrder}`;
    if (loadedPreviewKey.current === requestedKey) return;
    let cancelled = false;
    const requestId = ++previewRequestSequence.current;
    setLoading(true); setError(null);
    adminApi.getImportPreviewRows(previewId, page, PAGE_SIZE, sortBy as 'rowIndex' | 'inventoryNumber' | 'action' | 'message', sortOrder)
      .then((data) => { if (!cancelled && requestId === previewRequestSequence.current) {
        setPreview(data); setAllowUpdate(false); loadedPreviewKey.current = `${previewId}:${data.pagination.page}:${sortBy}:${sortOrder}`;
        if (data.pagination.page !== page) updateAdminQuery(setParams, { page: data.pagination.page === 1 ? null : data.pagination.page }, true);
      } })
      .catch((cause) => {
        if (!cancelled && requestId === previewRequestSequence.current) {
          setError(cause instanceof Error ? cause.message : 'Náhľad vypršal alebo sa nepodarilo načítať');
          const [loadedPreviewId, loadedPage, loadedSortBy, loadedSortOrder] = loadedPreviewKey.current.split(':');
          if (loadedPreviewId && loadedPage && loadedSortBy && loadedSortOrder) {
            updateAdminQuery(setParams, {
              preview: loadedPreviewId,
              page: loadedPage === '1' ? null : loadedPage,
              sortBy: loadedSortBy === 'rowIndex' ? null : loadedSortBy,
              sortOrder: loadedSortOrder === 'asc' ? null : loadedSortOrder,
            }, true);
          } else {
            loadedPreviewKey.current = '';
            setPreview(null);
            updateAdminQuery(setParams, { preview: null, page: null }, true);
          }
        }
      })
      .finally(() => { if (!cancelled && requestId === previewRequestSequence.current) setLoading(false); });
    return () => { cancelled = true; };
  }, [previewId, page, sortBy, sortOrder, setParams]);

  const handlePreview = async () => {
    if (!file) {
      setError('Vyberte súbor');
      return;
    }
    const requestId = ++previewRequestSequence.current;
    setLoading(true);
    setError(null);
    setSuccess(null);
    updateAdminQuery(setParams, { preview: null, page: null, sortBy: null, sortOrder: null, batch: null }, true);
    try {
      const data = await adminApi.importPreview(file);
      if (requestId !== previewRequestSequence.current) return;
      setPreview(data);
      setAllowUpdate(false);
      loadedPreviewKey.current = `${data.previewId}:1:rowIndex:asc`;
      updateAdminQuery(setParams, { preview: data.previewId, page: null, sortBy: null, sortOrder: null, batch: null });
    } catch (err) {
      if (requestId === previewRequestSequence.current) setError(err instanceof Error ? err.message : 'Náhľad zlyhal');
    } finally {
      if (requestId === previewRequestSequence.current) setLoading(false);
    }
  };

  const handleConfirm = async () => {
    if (!preview) return;
    previewRequestSequence.current += 1;
    setLoading(true);
    setError(null);
    try {
      const result = await adminApi.importConfirm(preview.previewId, allowUpdate);
      setBatch(null);
      setFailedRows([]);
      setSuccess(`Import bol zaradený do frontu ako dávka #${result.batchId}. Stav a výsledok môžeš sledovať nižšie alebo neskôr v histórii.`);
      setPreview(null);
      setFile(null);
      setAllowUpdate(false);
      updateAdminQuery(setParams, { preview: null, page: null, sortBy: null, sortOrder: null, batch: result.batchId });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import zlyhal');
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className={`${styles.page} ${styles.widePage}`}>
      <header className={styles.header}>
        <h1 className={styles.heading}>Import svetelných bodov</h1>
        <Link to={adminPath('street-lights/new')} className={styles.button}>
          Nový svetelný bod
        </Link>
      </header>

      <div className={styles.card}>
        <p className={styles.muted}>
          Podporované formáty: CSV, JSON, GeoJSON. Povinné polia: inventárne číslo, zemepisná
          šírka, dĺžka. Import nemení externé ID, pokiaľ ho súbor výslovne neobsahuje.
        </p>

        <div className={styles.field}>
          <label htmlFor="file">Súbor</label>
          <input
            id="file"
            type="file"
            disabled={loading}
            accept=".csv,.json,.geojson,application/json,text/csv"
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null);
              setPreview(null);
              setSuccess(null);
              loadedPreviewKey.current = '';
              updateAdminQuery(setParams, { preview: null, page: null, sortBy: null, sortOrder: null }, true);
            }}
          />
        </div>

        <div className={styles.actions}>
          <button
            type="button"
            className={styles.button}
            disabled={!file || loading}
            onClick={() => void handlePreview()}
          >
            {loading ? 'Spracovávam…' : 'Náhľad importu'}
          </button>
        </div>
      </div>

      {error && <p className={styles.error}>{error}</p>}
      {success && <p className={styles.success}>{success}</p>}

      {batch && (
        <div className={styles.card} aria-live="polite" style={{ marginTop: 'var(--space-md)' }}>
          <h2>Dávka #{batch.id}: {batch.status}</h2>
          <p>
            Celkom {batch.total_rows} · úspešné {batch.successful_rows} · vytvorené {batch.created_rows} ·
            aktualizované {batch.updated_rows} · nezmenené {batch.unchanged_rows} · preskočené {batch.skipped_rows} ·
            zlyhané {batch.failed_rows}
          </p>
          {failedRows.length > 0 && (
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead><tr><th>Zdrojový riadok</th><th>Inventárne číslo</th><th>Dôvod</th></tr></thead>
                <tbody>{failedRows.map((row) => <tr key={row.source_row_number}>
                  <td>{row.source_row_number}</td><td>{row.inventory_number ?? '—'}</td><td>{row.safe_reason ?? row.reason_code ?? 'Riadok sa nepodarilo spracovať'}</td>
                </tr>)}</tbody>
              </table>
              {batch.failed_rows > failedRows.length && <p className={styles.muted}>Zobrazuje sa prvých {failedRows.length} chýb. Úplné výsledky sú stránkované v histórii importov.</p>}
            </div>
          )}
          <Link to={`${adminPath('logs')}?tab=imports`}>Otvoriť históriu importov</Link>
        </div>
      )}

      {preview && (
        <div className={styles.card} style={{ marginTop: 'var(--space-md)' }}>
          <h2>Náhľad: {preview.filename}</h2>
          <p>
            Riadkov: {preview.totalRows} · Vytvoriť: {preview.summary.toCreate} · Existujúce:{' '}
            {preview.summary.toUpdate} · Preskočené duplicity: {preview.summary.skipped} · Chyby: {preview.summary.errors}
          </p>

          {(
            <label style={{ display: 'flex', gap: 'var(--space-sm)', alignItems: 'center' }}>
              <input
                type="checkbox"
                checked={allowUpdate}
                onChange={(e) => setAllowUpdate(e.target.checked)}
              />
              Aktualizovať existujúce svetelné body s rovnakým inventárnym číslom
            </label>
          )}
          <p className={styles.muted}>
            Predvolene je aktualizácia vypnutá: existujúce záznamy sa preskočia bez zmeny. Ak ju zapneš,
            nahradia sa len polia zastúpené v súbore; prázdne alebo explicitne null voliteľné polia vymažú
            existujúcu hodnotu, chýbajúce stĺpce/polia ju zachovajú. Identické riadky sa označia ako nezmenené.
          </p>

          <div className={styles.tableWrap} style={{ marginTop: 'var(--space-md)' }}>
            <table className={`${styles.table} ${styles.importPreviewTable}`}>
              <thead>
                <tr>
                  <th aria-sort={sortBy === 'rowIndex' ? (sortOrder === 'asc' ? 'ascending' : 'descending') : 'none'}>
                    <SortableColumnHeader
                      label="Riadok"
                      column="rowIndex"
                      sortBy={sortBy}
                      sortOrder={sortOrder}
                      disabled={loading}
                      onSort={handleSort}
                    />
                  </th>
                  <th aria-sort={sortBy === 'inventoryNumber' ? (sortOrder === 'asc' ? 'ascending' : 'descending') : 'none'}>
                    <SortableColumnHeader
                      label="Inventárne č."
                      column="inventoryNumber"
                      sortBy={sortBy}
                      sortOrder={sortOrder}
                      disabled={loading}
                      onSort={handleSort}
                    />
                  </th>
                  <th aria-sort={sortBy === 'action' ? (sortOrder === 'asc' ? 'ascending' : 'descending') : 'none'}>
                    <SortableColumnHeader
                      label="Akcia"
                      column="action"
                      sortBy={sortBy}
                      sortOrder={sortOrder}
                      disabled={loading}
                      onSort={handleSort}
                    />
                  </th>
                  <th aria-sort={sortBy === 'message' ? (sortOrder === 'asc' ? 'ascending' : 'descending') : 'none'}>
                    <SortableColumnHeader
                      label="Správa"
                      column="message"
                      sortBy={sortBy}
                      sortOrder={sortOrder}
                      disabled={loading}
                      onSort={handleSort}
                    />
                  </th>
                </tr>
              </thead>
              <tbody>
                {paginatedResults.map((row) => (
                  <tr key={row.rowIndex}>
                    <td>{row.rowIndex}</td>
                    <td>{row.inventoryNumber || '—'}</td>
                    <td>{row.action}</td>
                    <td>{row.message ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {paginatedResults.length === 0 && <p className={styles.muted}>Náhľad neobsahuje žiadne riadky.</p>}
          <AdminPagination page={page} totalPages={totalPages} totalRecords={preview.totalRows} disabled={loading} onPageChange={(nextPage) => updateAdminQuery(setParams, { page: nextPage === 1 ? null : nextPage })} />

          <div className={styles.actions} style={{ marginTop: 'var(--space-md)' }}>
            <button
              type="button"
              className={styles.button}
              disabled={loading}
              onClick={() => void handleConfirm()}
            >
              Potvrdiť import
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
