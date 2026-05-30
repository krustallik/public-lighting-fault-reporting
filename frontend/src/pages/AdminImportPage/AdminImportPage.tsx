import { useState } from 'react';
import { Link } from 'react-router-dom';
import { adminApi } from '@/services/adminApi';
import type { ImportPreview } from '@/types/admin';
import styles from '@/styles/adminShared.module.css';

export function AdminImportPage() {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [allowUpdate, setAllowUpdate] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const handlePreview = async () => {
    if (!file) {
      setError('Vyberte súbor');
      return;
    }
    setLoading(true);
    setError(null);
    setSuccess(null);
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
        <Link to="/admin/street-lights" className={styles.buttonSecondary}>
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
                  <th>Riadok</th>
                  <th>Inventárne č.</th>
                  <th>Akcia</th>
                  <th>Správa</th>
                </tr>
              </thead>
              <tbody>
                {preview.results.map((row) => (
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
