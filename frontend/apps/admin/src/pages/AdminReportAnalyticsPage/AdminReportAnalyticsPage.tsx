import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { SortableColumnHeader } from '@admin/components/SortableColumnHeader/SortableColumnHeader';
import { AdminPagination } from '@admin/components/AdminPagination/AdminPagination';
import { adminPath } from '@admin/config/adminRoutes';
import { adminApi } from '@admin/services/adminApi';
import type { ReportAnalyticsPage, ReportAnalyticsPeriod, ReportAnalyticsSummary, StreetLightFilterOptions } from '@admin/types/admin';
import type { LightPointStatus } from '@shared/LightPointStatus';
import { STATUS_LABELS } from '@admin/types/statusLabels';
import styles from '@admin/styles/adminShared.module.css';
import { formatOperatorDateTime } from '@admin/utils/formatOperatorDateTime';
import { normalizePageParam, readPageParam, updateAdminQuery } from '@admin/utils/adminUrlState';

const periodLabels: Record<ReportAnalyticsPeriod, string> = { '24h': '24 hodín', '7d': '7 dní', '30d': '30 dní', '90d': '90 dní' };
const validPeriods = new Set<ReportAnalyticsPeriod>(Object.keys(periodLabels) as ReportAnalyticsPeriod[]);

export function AdminReportAnalyticsPage() {
  const [params, setParams] = useSearchParams();
  const periodRaw = params.get('period') as ReportAnalyticsPeriod | null;
  const period = periodRaw && validPeriods.has(periodRaw) ? periodRaw : '7d';
  const querySearch = params.get('search') ?? '';
  const status = (params.get('status') ?? '') as LightPointStatus | '';
  const order: 'asc' | 'desc' = params.get('order') === 'asc' ? 'asc' : 'desc';
  const page = readPageParam(params);
  const [search, setSearch] = useState(querySearch);
  const [options, setOptions] = useState<StreetLightFilterOptions | null>(null);
  const [summary, setSummary] = useState<ReportAnalyticsSummary | null>(null);
  const [result, setResult] = useState<ReportAnalyticsPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [optionsError, setOptionsError] = useState<string | null>(null);

  useEffect(() => setSearch(querySearch), [querySearch]);
  useEffect(() => {
    if (params.get('period') && !validPeriods.has(params.get('period') as ReportAnalyticsPeriod)) {
      updateAdminQuery(setParams, { period: '7d' }, true);
    }
  }, [params, setParams]);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const next = search.trim().slice(0, 100);
      if (next !== querySearch) updateAdminQuery(setParams, { search: next || null, page: null }, true);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [search, querySearch, setParams]);
  useEffect(() => {
    let cancelled = false;
    adminApi.getStreetLightFilterOptions().then((data) => { if (!cancelled) setOptions(data); })
      .catch((cause) => { if (!cancelled) setOptionsError(cause instanceof Error ? cause.message : 'Možnosti filtrov sa nepodarilo načítať'); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError(null);
    Promise.all([
      adminApi.getReportAnalyticsSummary(period),
      adminApi.listReportAnalytics({ period, page, limit: 25, search: querySearch, status, order }),
    ]).then(([nextSummary, nextResult]) => {
      if (cancelled) return;
      setSummary(nextSummary); setResult(nextResult);
      normalizePageParam(params, setParams, nextResult.pagination.totalPages);
    }).catch((cause) => {
      if (!cancelled) setError(cause instanceof Error ? cause.message : 'Štatistiky sa nepodarilo načítať');
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [period, page, querySearch, status, order]);

  const setFilter = (updates: Record<string, string | null>) => updateAdminQuery(setParams, { ...updates, page: null });
  const handleOrder = (_column: string, next: 'asc' | 'desc') => updateAdminQuery(setParams, { order: next, page: null });
  const resetFilters = () => { setSearch(''); updateAdminQuery(setParams, { period: '7d', search: null, status: null, order: null, page: null }, true); };
  const total = result?.pagination.total ?? 0;

  return (
    <section className={`${styles.page} ${styles.widePage}`}>
      <header className={styles.header}><div>
        <h1 className={styles.heading}>Štatistiky hlásení</h1>
        <p className={styles.muted}>Počet zaznamenaných hlásení v lokálnej histórii. Nejde o potvrdené poruchy, počet ľudí ani mestom prijaté žiadosti.</p>
      </div></header>

      <div className={`${styles.card} ${styles.analyticsControls}`}>
        <div className={styles.filters} aria-label="Filtre štatistík">
          <label><span>Obdobie</span><select aria-label="Obdobie štatistík" value={period} onChange={(event) => setFilter({ period: event.target.value })}>
            {(Object.keys(periodLabels) as ReportAnalyticsPeriod[]).map((value) => <option key={value} value={value}>{periodLabels[value]}</option>)}
          </select></label>
          <label className={styles.filterSearch}><span>Hľadať svetelný bod</span><input type="search" maxLength={100} placeholder="Číslo, adresa, lokalita, typ alebo stav…" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
          <label><span>Technický stav</span><select aria-label="Filtrovať podľa technického stavu" value={status} onChange={(event) => setFilter({ status: event.target.value || null })}>
            <option value="">Všetky stavy</option>{(options?.statuses ?? []).map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select></label>
          <button type="button" className={styles.buttonSecondary} onClick={resetFilters} disabled={!querySearch && !status && period === '7d' && order === 'desc'}>Vymazať filtre</button>
        </div>
        {optionsError && <p className={styles.error} role="alert">{optionsError}</p>}
        {summary && <div className={styles.analyticsSummary}>
          <div><span>Počet zaznamenaných hlásení</span><strong>{summary.totalLocalReports.toLocaleString('sk-SK')}</strong></div>
          <div><span>Priradené k evidovanému bodu</span><strong>{summary.assignedToInventoryPoints.toLocaleString('sk-SK')}</strong></div>
          <div><span>Vlastné, ručné alebo GPS miesto</span><strong>{summary.customOrManualReports.toLocaleString('sk-SK')}</strong></div>
          {summary.reportsForDeletedPoints > 0 && <div><span>Historické hlásenia odstránených bodov</span><strong>{summary.reportsForDeletedPoints.toLocaleString('sk-SK')}</strong></div>}
          <p className={styles.muted}>Hranice obdobia: {summary.periodStart ? formatOperatorDateTime(summary.periodStart) : '—'} až {summary.periodEnd ? formatOperatorDateTime(summary.periodEnd) : '—'}.</p>
        </div>}
      </div>

      <div className={styles.analyticsSectionHeader}>
        <div><h2>Zaznamenané hlásenia podľa svetelného bodu</h2><p className={styles.muted}>Zahrnutý je celý aktuálny inventár; nula znamená, že za vybrané obdobie nie je priradené hlásenie.</p></div>
        <span>{total.toLocaleString('sk-SK')} bodov</span>
      </div>
      {loading && <p role="status">Načítavam štatistiky…</p>}
      {error && <p className={styles.error} role="alert">{error}</p>}
      {!loading && !error && result && <>
        <div className={styles.tableWrap}><table className={styles.table}>
          <thead><tr>
            <th scope="col">Inventárne č.</th><th scope="col">Adresa</th><th scope="col">Okres / lokalita</th>
            <th scope="col" aria-sort={order === 'asc' ? 'ascending' : 'descending'}><SortableColumnHeader label="Počet zaznamenaných hlásení" column="report_count" sortBy="report_count" sortOrder={order} onSort={handleOrder} /></th>
            <th scope="col">Posledné hlásenie</th><th scope="col">Technický stav</th><th scope="col">Detail</th>
          </tr></thead>
          <tbody>{result.items.map((row) => <tr key={row.id}>
            <td>{row.inventory_number}</td><td>{row.address ?? '—'}</td><td>{row.district ?? '—'}</td>
            <td>{row.report_count.toLocaleString('sk-SK')}</td><td>{row.last_report ? formatOperatorDateTime(row.last_report) : '—'}</td>
            <td>{STATUS_LABELS[row.status]}</td><td><Link to={adminPath('street-lights', row.id)}>Bod #{row.id}</Link></td>
          </tr>)}</tbody>
        </table></div>
        {result.items.length === 0 && <p className={styles.emptyState}>Inventár neobsahuje svetelné body zodpovedajúce týmto filtrom.</p>}
        <AdminPagination page={page} totalPages={result.pagination.totalPages} totalRecords={result.pagination.total} disabled={loading} onPageChange={(nextPage) => updateAdminQuery(setParams, { page: nextPage === 1 ? null : nextPage })} />
      </>}
    </section>
  );
}
