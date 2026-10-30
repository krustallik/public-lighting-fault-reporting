import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { SortableColumnHeader } from '@admin/components/SortableColumnHeader/SortableColumnHeader';
import { adminPath } from '@admin/config/adminRoutes';
import { adminApi } from '@admin/services/adminApi';
import { mapAdminStreetLight } from '@admin/types/admin';
import type { StreetLightFilterOptions } from '@admin/types/admin';
import type { LightPointStatus } from '@shared/LightPointStatus';
import { STATUS_LABELS } from '@admin/types/statusLabels';
import styles from '@admin/styles/adminShared.module.css';
import { AdminPagination } from '@admin/components/AdminPagination/AdminPagination';
import { normalizePageParam, readPageParam, updateAdminQuery } from '@admin/utils/adminUrlState';

type StreetLightSortBy = 'id' | 'inventory_number' | 'address' | 'district' | 'lamp_type' | 'status';
const MISSING = '__missing__';
const validSortColumns = new Set<StreetLightSortBy>(['id', 'inventory_number', 'address', 'district', 'lamp_type', 'status']);

export function AdminStreetLightsPage() {
  const [params, setParams] = useSearchParams();
  const querySearch = params.get('search') ?? '';
  const page = readPageParam(params);
  const status = (params.get('status') ?? '') as LightPointStatus | '';
  const lampType = params.get('lampType') ?? '';
  const lampTypeMissing = params.get('lampTypeMissing') === 'true';
  const rawSort = params.get('sortBy') as StreetLightSortBy | null;
  const sortBy: StreetLightSortBy = rawSort && validSortColumns.has(rawSort) ? rawSort : 'id';
  const sortOrder = params.get('sortOrder') === 'desc' ? 'desc' : 'asc';
  const [search, setSearch] = useState(querySearch);
  const [rows, setRows] = useState<ReturnType<typeof mapAdminStreetLight>[]>([]);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [options, setOptions] = useState<StreetLightFilterOptions | null>(null);
  const [loading, setLoading] = useState(true);
  const [optionsError, setOptionsError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  useEffect(() => setSearch(querySearch), [querySearch]);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const next = search.trim().slice(0, 100);
      if (next !== querySearch) updateAdminQuery(setParams, { search: next || null, page: null }, true);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [search, querySearch, setParams]);

  useEffect(() => {
    let cancelled = false;
    adminApi.getStreetLightFilterOptions()
      .then((data) => { if (!cancelled) setOptions(data); })
      .catch((err) => { if (!cancelled) setOptionsError(err instanceof Error ? err.message : 'Možnosti filtrov sa nepodarilo načítať'); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(null);
    adminApi.listStreetLights({ page, limit: 25, search: querySearch, status,
      ...(lampTypeMissing ? { lampTypeMissing: true } : { lampType }), sortBy, sortOrder, signal: controller.signal,
    }).then((data) => {
      setRows(data.items.map(mapAdminStreetLight)); setTotalPages(data.pagination.totalPages); setTotal(data.pagination.total);
      normalizePageParam(params, setParams, data.pagination.totalPages);
    }).catch((err) => {
      if (!controller.signal.aborted) setError(err instanceof Error ? err.message : 'Načítanie zlyhalo');
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [page, querySearch, status, lampType, lampTypeMissing, sortBy, sortOrder]);

  const handleSort = (column: string, order: 'asc' | 'desc') => updateAdminQuery(setParams, { sortBy: column, sortOrder: order, page: null });
  const setFilter = (updates: Record<string, string | null>) => updateAdminQuery(setParams, { ...updates, page: null });

  const handleExport = async (format: 'csv' | 'json' | 'geojson') => {
    setExportError(null);
    try {
      await adminApi.exportStreetLights(format, { search: search.trim(), status, lampType: lampTypeMissing ? undefined : lampType, lampTypeMissing });
    } catch (err) { setExportError(err instanceof Error ? err.message : 'Export zlyhal'); }
  };

  const resetFilters = () => { setSearch(''); updateAdminQuery(setParams, { search: null, status: null, lampType: null, lampTypeMissing: null, page: null }, true); };

  return (
    <section className={`${styles.page} ${styles.widePage}`}>
      <header className={styles.header}><div>
        <h1 className={styles.heading}>Svetelné body ({total.toLocaleString('sk-SK')})</h1>
        <p className={styles.muted}>Vyhľadávanie prehľadáva číslo, adresu, lokalitu, typ aj stav. Zobrazená je načítaná stránka z celého inventára.</p>
      </div></header>

      <div className={styles.filters} aria-label="Vyhľadávanie a filtre svetelných bodov">
        <label className={styles.filterSearch}>
          <span className={styles.srOnly}>Hľadať podľa ID, čísla, adresy, lokality, typu alebo stavu</span>
          <input type="search" aria-label="Hľadať svetelný bod" placeholder="Číslo, adresa, lokalita, typ alebo stav…" value={search} maxLength={100} onChange={(event) => setSearch(event.target.value)} />
        </label>
        <label><span className={styles.srOnly}>Typ svietidla</span>
          <select aria-label="Typ svietidla" value={lampTypeMissing ? MISSING : lampType} onChange={(event) => setFilter(event.target.value === MISSING ? { lampType: null, lampTypeMissing: 'true' } : { lampType: event.target.value || null, lampTypeMissing: null })}>
            <option value="">Typ svietidla: všetky</option>
            {options?.lampTypes.map((value) => <option key={value} value={value}>{value}</option>)}
            {options?.hasMissingLampType && <option value={MISSING}>Neuvedený typ</option>}
          </select>
        </label>
        <label><span className={styles.srOnly}>Stav</span>
          <select aria-label="Stav" value={status} onChange={(event) => setFilter({ status: event.target.value || null })}>
            <option value="">Stav: všetky</option>
            {(options?.statuses ?? []).map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
        </label>
        <div className={styles.filterActions}>
          <button type="button" className={styles.buttonSecondary} onClick={resetFilters} disabled={!search && !status && !lampType && !lampTypeMissing}>Vymazať filtre</button>
          <button type="button" className={styles.buttonSecondary} onClick={() => void handleExport('csv')}>Export CSV</button>
          <button type="button" className={styles.buttonSecondary} onClick={() => void handleExport('json')}>Export JSON</button>
          <button type="button" className={styles.buttonSecondary} onClick={() => void handleExport('geojson')}>Export GeoJSON</button>
        </div>
      </div>
      {optionsError && <p className={styles.error} role="alert">{optionsError}</p>}
      {options?.hasMoreLampTypes && <p className={styles.muted}>Niektoré typy nie sú v krátkom zozname; nájdete ich univerzálnym vyhľadávaním.</p>}
      {exportError && <p className={styles.error} role="alert">{exportError}</p>}
      {loading && <p role="status">Načítavam svetelné body…</p>}
      {error && <p className={styles.error} role="alert">{error}</p>}
      {!loading && !error && <>
        <div className={styles.tableWrap}><table className={styles.table}>
          <thead><tr>{(['id', 'inventory_number', 'address', 'district', 'lamp_type', 'status'] as const).map((column) => {
            const labels = { id: 'ID', inventory_number: 'Inventárne č.', address: 'Adresa', district: 'Okres / lokalita', lamp_type: 'Typ', status: 'Stav' };
            return <th key={column} aria-sort={sortBy === column ? (sortOrder === 'asc' ? 'ascending' : 'descending') : 'none'}><SortableColumnHeader label={labels[column]} column={column} sortBy={sortBy} sortOrder={sortOrder} onSort={handleSort} /></th>;
          })}<th scope="col">Akcie</th></tr></thead>
          <tbody>{rows.map((row) => <tr key={row.id}>
            <td>{row.id}</td><td>{row.inventoryNumber}</td><td>{row.address ?? '—'}</td><td>{row.district ?? '—'}</td><td>{row.lampType ?? '—'}</td><td>{STATUS_LABELS[row.status]}</td>
            <td><Link to={adminPath('street-lights', row.id)}>Detail</Link>{' · '}<Link to={adminPath('street-lights', row.id, 'edit')}>Upraviť</Link></td>
          </tr>)}</tbody>
        </table></div>
        {rows.length === 0 && <p className={styles.emptyState}>Pre zadaný výber sa nenašli žiadne svetelné body. Skúste upraviť alebo vymazať filtre.</p>}
        <AdminPagination page={page} totalPages={totalPages} totalRecords={total} disabled={loading} onPageChange={(nextPage) => updateAdminQuery(setParams, { page: nextPage === 1 ? null : nextPage })} />
      </>}
    </section>
  );
}
