import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { adminApi } from '@/services/adminApi';
import { mapAdminStreetLight } from '@/types/admin';
import type { LightPointStatus } from '@/types/lightPoint';
import { STATUS_LABELS } from '@/types/lightPoint';
import styles from '@/styles/adminShared.module.css';

export function AdminStreetLightsPage() {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<LightPointStatus | ''>('');
  const [district, setDistrict] = useState('');
  const [page, setPage] = useState(1);
  const [sortBy, setSortBy] = useState<'id' | 'external_id' | 'address' | 'status'>('id');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
  const [rows, setRows] = useState<ReturnType<typeof mapAdminStreetLight>[]>([]);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await adminApi.listStreetLights({
        page,
        limit: 20,
        search,
        status,
        district,
        sortBy,
        sortOrder,
      });
      setRows(data.items.map(mapAdminStreetLight));
      setTotalPages(data.pagination.totalPages);
      setTotal(data.pagination.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Načítanie zlyhalo');
    } finally {
      setLoading(false);
    }
  }, [page, search, status, district, sortBy, sortOrder]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleExport = async (format: 'csv' | 'json' | 'geojson') => {
    setExportError(null);
    try {
      await adminApi.exportStreetLights(format, { search, status, district });
    } catch (err) {
      setExportError(err instanceof Error ? err.message : 'Export zlyhal');
    }
  };

  return (
    <section className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.heading}>Svetelné body ({total})</h1>
        <div className={styles.actions}>
          <Link to="/admin/street-lights/new" className={styles.button}>
            Nový bod
          </Link>
          <Link to="/admin/import" className={styles.buttonSecondary}>
            Import
          </Link>
        </div>
      </header>

      <div className={styles.filters}>
        <input
          type="search"
          placeholder="Hľadať (inventárne č., adresa, lokalita…)"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
        />
        <select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value as LightPointStatus | '');
            setPage(1);
          }}
        >
          <option value="">Všetky stavy</option>
          <option value="active">Aktívny</option>
          <option value="inactive">Neaktívny</option>
          <option value="maintenance">Údržba</option>
        </select>
        <input
          type="text"
          placeholder="Okres / blok"
          value={district}
          onChange={(e) => {
            setDistrict(e.target.value);
            setPage(1);
          }}
        />
        <select
          value={`${sortBy}-${sortOrder}`}
          onChange={(e) => {
            const [by, order] = e.target.value.split('-') as [typeof sortBy, typeof sortOrder];
            setSortBy(by);
            setSortOrder(order);
          }}
        >
          <option value="id-asc">ID ↑</option>
          <option value="id-desc">ID ↓</option>
          <option value="external_id-asc">Inventárne č. ↑</option>
          <option value="address-asc">Adresa ↑</option>
          <option value="status-asc">Stav ↑</option>
        </select>
        <button type="button" className={styles.buttonSecondary} onClick={() => void handleExport('csv')}>
          Export CSV
        </button>
        <button type="button" className={styles.buttonSecondary} onClick={() => void handleExport('json')}>
          Export JSON
        </button>
        <button type="button" className={styles.buttonSecondary} onClick={() => void handleExport('geojson')}>
          Export GeoJSON
        </button>
      </div>

      {exportError && <p className={styles.error}>{exportError}</p>}
      {loading && <p>Načítavam…</p>}
      {error && <p className={styles.error}>{error}</p>}

      {!loading && !error && (
        <>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Inventárne č.</th>
                  <th>Adresa</th>
                  <th>Okres</th>
                  <th>Typ</th>
                  <th>Stav</th>
                  <th>Akcie</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td>{row.id}</td>
                    <td>{row.inventoryNumber ?? '—'}</td>
                    <td>{row.address ?? '—'}</td>
                    <td>{row.district ?? '—'}</td>
                    <td>{row.lampType ?? '—'}</td>
                    <td>{STATUS_LABELS[row.status]}</td>
                    <td>
                      <Link to={`/admin/street-lights/${row.id}`}>Detail</Link>
                      {' · '}
                      <Link to={`/admin/street-lights/${row.id}/edit`}>Upraviť</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

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
              Strana {page} / {totalPages}
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
        </>
      )}
    </section>
  );
}
