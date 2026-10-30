import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { SortableColumnHeader } from '@admin/components/SortableColumnHeader/SortableColumnHeader';
import { adminPath } from '@admin/config/adminRoutes';
import { adminApi } from '@admin/services/adminApi';
import { mapAdminStreetLight } from '@admin/types/admin';
import type { LightPointStatus } from '@shared/LightPointStatus';
import { STATUS_LABELS } from '@admin/types/statusLabels';
import styles from '@admin/styles/adminShared.module.css';
import { AdminPagination } from '@admin/components/AdminPagination/AdminPagination';

type StreetLightSortBy = 'id' | 'inventory_number' | 'address' | 'district' | 'lamp_type' | 'status';

export function AdminStreetLightsPage() {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<LightPointStatus | ''>('');
  const [district, setDistrict] = useState('');
  const [page, setPage] = useState(1);
  const [sortBy, setSortBy] = useState<StreetLightSortBy>('id');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
  const [rows, setRows] = useState<ReturnType<typeof mapAdminStreetLight>[]>([]);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  const handleSort = (column: string, order: 'asc' | 'desc') => {
    setSortBy(column as StreetLightSortBy);
    setSortOrder(order);
    setPage(1);
  };

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
          <Link to={adminPath('street-lights/new')} className={styles.button}>
            Nový bod
          </Link>
          <Link to={adminPath('import')} className={styles.buttonSecondary}>
            Import
          </Link>
        </div>
      </header>

      <div className={styles.filters}>
        <input
          type="search"
          aria-label="Hľadať podľa ID, inventárneho čísla, externého ID, adresy, lokality alebo typu svietidla"
          placeholder="ID, inventárne číslo, externé ID, adresa, lokalita alebo typ…"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
        />
        <select
          aria-label="Filtrovať podľa technického stavu"
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
          aria-label="Filtrovať podľa lokality"
          placeholder="Okres / lokalita"
          value={district}
          onChange={(e) => {
            setDistrict(e.target.value);
            setPage(1);
          }}
        />
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
                  <th aria-sort={sortBy === 'id' ? (sortOrder === 'asc' ? 'ascending' : 'descending') : 'none'}>
                    <SortableColumnHeader
                      label="ID"
                      column="id"
                      sortBy={sortBy}
                      sortOrder={sortOrder}
                      onSort={handleSort}
                    />
                  </th>
                  <th aria-sort={sortBy === 'inventory_number' ? (sortOrder === 'asc' ? 'ascending' : 'descending') : 'none'}>
                    <SortableColumnHeader
                      label="Inventárne č."
                      column="inventory_number"
                      sortBy={sortBy}
                      sortOrder={sortOrder}
                      onSort={handleSort}
                    />
                  </th>
                  <th aria-sort={sortBy === 'address' ? (sortOrder === 'asc' ? 'ascending' : 'descending') : 'none'}>
                    <SortableColumnHeader
                      label="Adresa"
                      column="address"
                      sortBy={sortBy}
                      sortOrder={sortOrder}
                      onSort={handleSort}
                    />
                  </th>
                  <th aria-sort={sortBy === 'district' ? (sortOrder === 'asc' ? 'ascending' : 'descending') : 'none'}><SortableColumnHeader label="Okres" column="district" sortBy={sortBy} sortOrder={sortOrder} onSort={handleSort} /></th>
                  <th aria-sort={sortBy === 'lamp_type' ? (sortOrder === 'asc' ? 'ascending' : 'descending') : 'none'}><SortableColumnHeader label="Typ" column="lamp_type" sortBy={sortBy} sortOrder={sortOrder} onSort={handleSort} /></th>
                  <th aria-sort={sortBy === 'status' ? (sortOrder === 'asc' ? 'ascending' : 'descending') : 'none'}>
                    <SortableColumnHeader
                      label="Stav"
                      column="status"
                      sortBy={sortBy}
                      sortOrder={sortOrder}
                      onSort={handleSort}
                    />
                  </th>
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
                      <Link to={adminPath('street-lights', row.id)}>Detail</Link>
                      {' · '}
                      <Link to={adminPath('street-lights', row.id, 'edit')}>Upraviť</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {rows.length === 0 ? <p className={styles.muted}>Pre zadaný výber sa nenašli žiadne svetelné body.</p> : null}
          <AdminPagination page={page} totalPages={totalPages} totalRecords={total} disabled={loading} onPageChange={setPage} />
        </>
      )}
    </section>
  );
}
