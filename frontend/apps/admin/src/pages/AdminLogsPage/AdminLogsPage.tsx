import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { adminApi } from '@admin/services/adminApi';
import type { AdminActivityLog, ImportBatchLog, ImportBatchRow, InventoryAuditLog } from '@admin/types/admin';
import styles from '@admin/styles/adminShared.module.css';
import { AdminPagination } from '@admin/components/AdminPagination/AdminPagination';
import { formatOperatorDateTime } from '@admin/utils/formatOperatorDateTime';
import { adminPath } from '@admin/config/adminRoutes';
import { normalizePageParam, readPageParam, updateAdminQuery } from '@admin/utils/adminUrlState';

type LogTab = 'activity' | 'inventory' | 'imports';
const tabs: Array<{ key: LogTab; label: string }> = [
  { key: 'activity', label: 'Admin aktivity' }, { key: 'inventory', label: 'Zmeny inventára' }, { key: 'imports', label: 'Importy' },
];
const PAGE_SIZE = 25;
const activityLabels: Record<string, string> = {
  login: 'Prihlásenie', logout: 'Odhlásenie', admin_created: 'Vytvorenie administrátorského účtu',
};
const inventoryActionLabels: Record<string, string> = { create: 'Vytvorenie bodu', update: 'Úprava bodu', delete: 'Odstránenie bodu' };
const importStatusLabels: Record<string, string> = {
  queued: 'Vo fronte', processing: 'Spracúva sa', completed: 'Dokončený', completed_with_errors: 'Dokončený s chybami', failed: 'Zlyhal',
};

function readTab(value: string | null): LogTab { return tabs.some((tab) => tab.key === value) ? value as LogTab : 'activity'; }
function targetLabel(log: AdminActivityLog): string {
  if (log.entity_type === 'light_point' && log.entity_id !== null) return `Svetelný bod #${log.entity_id}`;
  if (log.entity_type === 'admin' && log.entity_id !== null) return `Účet #${log.entity_id}`;
  return '—';
}

export function AdminLogsPage() {
  const [params, setParams] = useSearchParams();
  const tab = readTab(params.get('tab'));
  const pageKey = params.has(`${tab}Page`) ? `${tab}Page` : 'page';
  const tabRefs = useRef<Partial<Record<LogTab, HTMLButtonElement>>>({});
  const page = readPageParam(params, pageKey);
  const [activity, setActivity] = useState<AdminActivityLog[]>([]);
  const [inventory, setInventory] = useState<InventoryAuditLog[]>([]);
  const [imports, setImports] = useState<ImportBatchLog[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [batchRows, setBatchRows] = useState<ImportBatchRow[]>([]);
  const [nextRowCursor, setNextRowCursor] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [accountFormOpen, setAccountFormOpen] = useState(false);
  const [accountUsername, setAccountUsername] = useState('');
  const [accountFullName, setAccountFullName] = useState('');
  const [accountPassword, setAccountPassword] = useState('');
  const [accountPasswordConfirm, setAccountPasswordConfirm] = useState('');
  const [accountSaving, setAccountSaving] = useState(false);
  const [accountError, setAccountError] = useState<string | null>(null);
  const [accountSuccess, setAccountSuccess] = useState<string | null>(null);
  const batchId = Number(params.get('batch')) || null;
  const batchCursor = Number(params.get('batchCursor')) || 0;

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError(null);
    const loadSelected = async () => {
      try {
        if (tab === 'activity') {
          const data = await adminApi.getActivityLogs({ page, limit: PAGE_SIZE });
          if (cancelled) return;
          setActivity(data.items); setTotal(data.total); setTotalPages(Math.ceil(data.total / PAGE_SIZE) || 1);
          normalizePageParam(params, setParams, Math.ceil(data.total / PAGE_SIZE) || 1, pageKey);
        } else if (tab === 'inventory') {
          const data = await adminApi.getInventoryAuditLogs({ page, limit: PAGE_SIZE });
          if (cancelled) return;
          setInventory(data.items); setTotal(data.total); setTotalPages(Math.ceil(data.total / PAGE_SIZE) || 1);
          normalizePageParam(params, setParams, Math.ceil(data.total / PAGE_SIZE) || 1, pageKey);
        } else {
          const data = await adminApi.getImportBatches({ page, limit: PAGE_SIZE });
          if (cancelled) return;
          setImports(data.items); setTotal(data.total); setTotalPages(Math.ceil(data.total / PAGE_SIZE) || 1);
          normalizePageParam(params, setParams, Math.ceil(data.total / PAGE_SIZE) || 1, pageKey);
        }
      } catch (cause) { if (!cancelled) setError(cause instanceof Error ? cause.message : 'Načítanie zlyhalo'); }
      finally { if (!cancelled) setLoading(false); }
    };
    void loadSelected();
    return () => { cancelled = true; };
  }, [tab, page]);

  useEffect(() => {
    let cancelled = false;
    if (!batchId) { setBatchRows([]); setNextRowCursor(null); return; }
    setError(null);
    adminApi.getImportRows(batchId, { limit: 25, cursor: batchCursor })
      .then((result) => { if (!cancelled) { setBatchRows(result.items); setNextRowCursor(result.nextCursor); } })
      .catch((cause) => { if (!cancelled) setError(cause instanceof Error ? cause.message : 'Detail importu sa nepodarilo načítať'); });
    return () => { cancelled = true; };
  }, [batchId, batchCursor]);

  const selectTab = (nextTab: LogTab) => {
    const nextPage = readPageParam(params, `${nextTab}Page`);
    updateAdminQuery(setParams, { tab: nextTab, page: nextPage === 1 ? null : nextPage });
  };
  const choosePage = (nextPage: number) => updateAdminQuery(setParams, {
    tab, page: nextPage === 1 ? null : nextPage, [pageKey]: nextPage === 1 ? null : nextPage,
    [`${tab}Page`]: nextPage === 1 ? null : nextPage,
  });
  const handleTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, currentTab: LogTab) => {
    const currentIndex = tabs.findIndex(({ key }) => key === currentTab);
    let nextIndex: number | null = null;
    if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % tabs.length;
    else if (event.key === 'ArrowLeft') nextIndex = (currentIndex + tabs.length - 1) % tabs.length;
    else if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = tabs.length - 1;
    if (nextIndex === null) return;
    event.preventDefault();
    const nextTab = tabs[nextIndex].key;
    selectTab(nextTab);
    tabRefs.current[nextTab]?.focus();
  };
  const openBatch = (id: number) => updateAdminQuery(setParams, { batch: id, batchCursor: null });
  const summary = useMemo(() => `Záznamy sa zobrazujú v slovenskom miestnom čase.`, []);
  const createAccount = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setAccountError(null); setAccountSuccess(null);
    if (accountPassword !== accountPasswordConfirm) { setAccountError('Heslá sa nezhodujú.'); return; }
    setAccountSaving(true);
    try {
      const account = await adminApi.createAdminAccount({ username: accountUsername, password: accountPassword, ...(accountFullName.trim() ? { fullName: accountFullName } : {}) });
      setAccountSuccess(`Účet ${account.username} bol vytvorený.`);
      setAccountUsername(''); setAccountFullName(''); setAccountPassword(''); setAccountPasswordConfirm('');
      setAccountFormOpen(false);
    } catch (cause) { setAccountError(cause instanceof Error ? cause.message : 'Účet sa nepodarilo vytvoriť.'); }
    finally { setAccountSaving(false); }
  };

  return (
    <section className={`${styles.page} ${styles.widePage}`}>
      <header className={styles.header}><div>
        <h1 className={styles.heading}>Prevádzkové záznamy</h1>
        <p className={styles.muted}>Prihlásenia, zmeny inventára a importy. Kontaktné údaje ani texty verejných hlásení sa tu nezobrazujú.</p>
      </div></header>
      <details className={styles.provisionPanel} open={accountFormOpen} onToggle={(event) => setAccountFormOpen(event.currentTarget.open)}>
        <summary>Pridať administrátorský účet</summary>
        <p className={styles.muted}>Účet vytvorí prihlásený administrátor. Verejnej registrácie nie je. Heslo sa bezpečne hašuje na serveri a v záznamoch sa neukladá.</p>
        <form className={styles.accountForm} onSubmit={(event) => void createAccount(event)}>
          <label>Používateľské meno<input autoComplete="off" required minLength={3} maxLength={80} pattern="[A-Za-z0-9._-]{3,80}" value={accountUsername} onChange={(event) => setAccountUsername(event.target.value)} /></label>
          <label>Meno administrátora (voliteľné)<input autoComplete="name" maxLength={200} value={accountFullName} onChange={(event) => setAccountFullName(event.target.value)} /></label>
          <label>Nové heslo<input type="password" autoComplete="new-password" required minLength={12} maxLength={128} value={accountPassword} onChange={(event) => setAccountPassword(event.target.value)} /></label>
          <label>Zopakujte heslo<input type="password" autoComplete="new-password" required minLength={12} maxLength={128} value={accountPasswordConfirm} onChange={(event) => setAccountPasswordConfirm(event.target.value)} /></label>
          <button type="submit" className={styles.button} disabled={accountSaving}>{accountSaving ? 'Vytváram…' : 'Vytvoriť účet'}</button>
        </form>
      </details>
      {accountError && <p className={styles.error} role="alert">{accountError}</p>}
      {accountSuccess && <p className={styles.success} role="status">{accountSuccess}</p>}
      <div className={styles.logTabs} role="tablist" aria-label="Typ prevádzkových záznamov">
        {tabs.map(({ key, label }) => <button
          key={key}
          ref={(element) => { if (element) tabRefs.current[key] = element; else delete tabRefs.current[key]; }}
          type="button"
          role="tab"
          id={`log-tab-${key}`}
          aria-controls="log-panel"
          aria-selected={tab === key}
          tabIndex={tab === key ? 0 : -1}
          className={tab === key ? styles.logTabActive : styles.logTab}
          onClick={() => selectTab(key)}
          onKeyDown={(event) => handleTabKeyDown(event, key)}
        >{label}</button>)}
      </div>
      <section id="log-panel" role="tabpanel" tabIndex={0} aria-labelledby={`log-tab-${tab}`} className={styles.logPanel}>
        <p className={styles.muted}>{summary}</p>
        {loading && <p role="status">Načítavam záznamy…</p>}
        {error && <p className={styles.error} role="alert">{error}</p>}
        {!loading && !error && tab === 'activity' && <>
          {activity.length === 0 ? <p className={styles.emptyState}>Zatiaľ nie sú zaznamenané žiadne admin aktivity.</p> : <div className={styles.tableWrap}><table className={styles.table}>
            <thead><tr><th>Čas (Slovensko)</th><th>Administrátor</th><th>Akcia</th><th>Objekt zmeny</th></tr></thead>
            <tbody>{activity.map((log) => <tr key={log.id}><td>{formatOperatorDateTime(log.created_at)}</td><td>{log.admin_username ?? 'Neznámy účet'}</td><td>{activityLabels[log.action] ?? log.action}</td><td>{targetLabel(log)}</td></tr>)}</tbody>
          </table></div>}
        </>}
        {!loading && !error && tab === 'inventory' && <>
          {inventory.length === 0 ? <p className={styles.emptyState}>Zatiaľ nie sú zaznamenané zmeny inventára.</p> : <div className={styles.tableWrap}><table className={styles.table}>
            <thead><tr><th>Čas (Slovensko)</th><th>Administrátor</th><th>Akcia</th><th>Objekt zmeny</th></tr></thead>
            <tbody>{inventory.map((log) => <tr key={log.id}><td>{formatOperatorDateTime(log.created_at)}</td><td>{log.admin_username ?? 'Neznámy účet'}</td><td>{inventoryActionLabels[log.action] ?? 'Zmena inventára'}</td><td><Link to={adminPath('street-lights', log.entity_id)}>Bod #{log.entity_id} · {log.inventory_number}</Link></td></tr>)}</tbody>
          </table></div>}
        </>}
        {!loading && !error && tab === 'imports' && <>
          {imports.length === 0 ? <p className={styles.emptyState}>Zatiaľ nie sú zaznamenané žiadne importy.</p> : <div className={styles.tableWrap}><table className={styles.table}>
            <thead><tr><th>Čas (Slovensko)</th><th>Dávka</th><th>Súbor</th><th>Administrátor</th><th>Vytvorené</th><th>Upravené</th><th>Preskočené</th><th>Chyby</th><th>Stav</th><th>Detail</th></tr></thead>
            <tbody>{imports.map((batch) => <tr key={batch.id}><td>{formatOperatorDateTime(batch.created_at)}</td><td>#{batch.id}</td><td>{batch.filename}</td><td>{batch.uploaded_by_username ?? 'Neznámy účet'}</td><td>{batch.created_rows}</td><td>{batch.updated_rows}</td><td>{batch.skipped_rows}</td><td>{batch.failed_rows}</td><td>{importStatusLabels[batch.status] ?? batch.status}</td><td><button type="button" className={styles.linkButton} onClick={() => openBatch(batch.id)}>Zobraziť riadky</button></td></tr>)}</tbody>
          </table></div>}
        </>}
        {!loading && !error && <AdminPagination page={page} totalPages={totalPages} totalRecords={total} disabled={loading} onPageChange={choosePage} />}
      </section>
      {batchId !== null && <section className={styles.logPanel} aria-labelledby="import-batch-detail-heading">
        <header className={styles.header}><h2 id="import-batch-detail-heading">Dávka #{batchId} — výsledky riadkov</h2><button type="button" className={styles.buttonSecondary} onClick={() => updateAdminQuery(setParams, { batch: null, batchCursor: null })}>Zavrieť detail</button></header>
        <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>Riadok</th><th>Inventárne číslo</th><th>Výsledok</th><th>Bezpečný dôvod</th></tr></thead>
          <tbody>{batchRows.map((row) => <tr key={row.source_row_number}><td>{row.source_row_number}</td><td>{row.inventory_number ?? '—'}</td><td>{row.outcome}</td><td>{row.safe_reason ?? row.reason_code ?? '—'}</td></tr>)}</tbody></table></div>
        {nextRowCursor !== null && <button type="button" className={styles.buttonSecondary} onClick={() => updateAdminQuery(setParams, { batchCursor: nextRowCursor })}>Načítať ďalších 25</button>}
      </section>}
    </section>
  );
}
