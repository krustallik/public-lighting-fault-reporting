import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { SortableColumnHeader } from '@/components/SortableColumnHeader/SortableColumnHeader';
import { adminPath } from '@/config/adminRoutes';
import { adminApi } from '@/services/adminApi';
import type { ImportPreview } from '@/types/admin';
import { sortImportPreviewRows } from '@/utils/sortImportPreviewRows';
import styles from '@/styles/adminShared.module.css';

const PAGE_SIZE = 10;

export function AdminImportPage() {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [allowUpdate, setAllowUpdate] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState('rowIndex');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
  const [page, setPage] = useState(1);

  const sortedResults = useMemo(() => {
    if (!preview) return [];
    return sortImportPreviewRows(preview.results, sortBy, sortOrder);
  }, [preview, sortBy, sortOrder]);

  const totalPages = Math.max(1, Math.ceil(sortedResults.length / PAGE_SIZE));

  const paginatedResults = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return sortedResults.slice(start, start + PAGE_SIZE);
  }, [sortedResults, page]);

  useEffect(() => {
    setPage(1);
  }, [preview, sortBy, sortOrder]);

  useEffect(() => {
    if (page > totalPages) {
      setPage(totalPages);
    }
  }, [page, totalPages]);

  const handleSort = (column: string, order: 'asc' | 'desc') => {
    setSortBy(column);
    setSortOrder(order);
  };

  const handlePreview = async () => {
    if (!file) {
      setError('Vyberte súbor');
      return;
    }
    setLoading(true);
    setError(null);
    setSuccess(null);
    setSortBy('rowIndex');
    setSortOrder('asc');
    setPage(1);
    try {
      const data = await adminApi.importPreview(file);
      setPreview(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Náhľad zlyhal');
    } finally {
      setLoading(false);
    }
  };

  const handleConfirm = async () => {
    if (!preview) return;
    setLoading(true);
    setError(null);
    try {
      const result = await adminApi.importConfirm(preview.previewId, allowUpdate);
      setSuccess(
        `Import dokončený (batch #${result.batchId}): vytvorené ${result.summary.toCreate}, aktualizované ${result.summary.toUpdate}, preskočené ${result.summary.skipped}, chyby ${result.summary.errors}`
      );
      setPreview(null);
      setFile(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import zlyhal');
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.heading}>Import svetelných bodov</h1>
        <Link to={adminPath('street-lights')} className={styles.buttonSecondary}>
          Späť na zoznam
        </Link>
      </header>

      <div className={styles.card}>
        <p className={styles.muted}>
          Podporované formáty: CSV, JSON, GeoJSON. Povinné polia: inventárne číslo, zemepisná
          šírka, dĺžka.
        </p>

        <div className={styles.field}>
          <label htmlFor="file">Súbor</label>
          <input
            id="file"
            type="file"
            accept=".csv,.json,.geojson,application/json,text/csv"
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null);
              setPreview(null);
              setSuccess(null);
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

      {preview && (
        <div className={styles.card} style={{ marginTop: 'var(--space-md)' }}>
          <h2>Náhľad: {preview.filename}</h2>
          <p>
            Riadkov: {preview.totalRows} · Vytvoriť: {preview.summary.toCreate} · Aktualizovať:{' '}
            {preview.summary.toUpdate} · Chyby: {preview.summary.errors}
          </p>

          {preview.summary.toUpdate > 0 && (
            <label style={{ display: 'flex', gap: 'var(--space-sm)', alignItems: 'center' }}>
              <input
                type="checkbox"
                checked={allowUpdate}
                onChange={(e) => setAllowUpdate(e.target.checked)}
              />
              Povoliť aktualizáciu existujúcich záznamov podľa inventárneho čísla
            </label>
          )}

          <div className={styles.tableWrap} style={{ marginTop: 'var(--space-md)' }}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>
                    <SortableColumnHeader
                      label="Riadok"
                      column="rowIndex"
                      sortBy={sortBy}
                      sortOrder={sortOrder}
                      onSort={handleSort}
                    />
                  </th>
                  <th>
                    <SortableColumnHeader
                      label="Inventárne č."
                      column="inventoryNumber"
                      sortBy={sortBy}
                      sortOrder={sortOrder}
                      onSort={handleSort}
                    />
                  </th>
                  <th>
                    <SortableColumnHeader
                      label="Akcia"
                      column="action"
                      sortBy={sortBy}
                      sortOrder={sortOrder}
                      onSort={handleSort}
                    />
                  </th>
                  <th>
                    <SortableColumnHeader
                      label="Správa"
                      column="message"
                      sortBy={sortBy}
                      sortOrder={sortOrder}
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

          {sortedResults.length > PAGE_SIZE && (
            <div className={styles.pagination}>
              <button
                type="button"
                className={styles.buttonSecondary}
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
              >
                Predchádzajúca
              </button>
              <span>
                Strana {page} / {totalPages} · záznamy {(page - 1) * PAGE_SIZE + 1}–
                {Math.min(page * PAGE_SIZE, sortedResults.length)} z {sortedResults.length}
              </span>
              <button
                type="button"
                className={styles.buttonSecondary}
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                Ďalšia
              </button>
            </div>
          )}

          <div className={styles.actions} style={{ marginTop: 'var(--space-md)' }}>
            <button
              type="button"
              className={styles.button}
              disabled={loading || preview.summary.errors === preview.totalRows}
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
