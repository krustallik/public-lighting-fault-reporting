import { Link, useLocation } from 'react-router-dom';
import type { ReportResultState } from '@/types/reportResult';
import {
  buildAusemioPreviewRows,
  formatAusemioFilesPreview,
} from '@/utils/ausemioPayloadPreview';
import styles from './ResultPage.module.css';

const TEST_MODE_MESSAGE =
  'Report accepted in test mode — not sent to real AUSEMIO/DPMK';

function formatAcceptedAt(iso?: string): string {
  if (!iso) {
    return '—';
  }

  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }

  return new Intl.DateTimeFormat('sk-SK', {
    dateStyle: 'medium',
    timeStyle: 'medium',
  }).format(date);
}

export function ResultPage() {
  const location = useLocation();
  const state = (location.state as ReportResultState | null) ?? null;
  const success = state?.success ?? false;
  const hasPayload = Boolean(state?.ausemioPayload);
  const previewRows = state?.ausemioPayload
    ? buildAusemioPreviewRows(state.ausemioPayload)
    : [];

  if (!state) {
    return (
      <section className={styles.section}>
        <h2 className={styles.heading}>Výsledok hlásenia</h2>
        <p className={styles.fallback}>
          Žiadne údaje o odoslaní. Vyplňte formulár a odošlite hlásenie znova.
        </p>
        <div className={styles.actions}>
          <Link to="/map">Späť na mapu</Link>
          <Link to="/report">Formulár hlásenia</Link>
        </div>
      </section>
    );
  }

  return (
    <section className={styles.section}>
      <h2 className={`${styles.heading} ${success ? styles.success : styles.failure}`}>
        {success ? 'Hlásenie bolo prijaté' : 'Hlásenie sa nepodarilo odoslať'}
      </h2>

      {success && (
        <>
          <p className={styles.statusBadge} aria-label="Stav odoslania">
            Test mode
          </p>

          <p className={styles.message}>{state.message ?? TEST_MODE_MESSAGE}</p>

          <ul className={styles.metaList}>
            <li className={styles.metaItem}>
              <span className={styles.metaLabel}>Referenčné číslo: </span>
              <strong>{state.referenceCode ?? '—'}</strong>
            </li>
            <li className={styles.metaItem}>
              <span className={styles.metaLabel}>Dátum a čas: </span>
              <time dateTime={state.acceptedAt}>{formatAcceptedAt(state.acceptedAt)}</time>
            </li>
            <li className={styles.metaItem}>
              <span className={styles.metaLabel}>Stav backendu: </span>
              {state.status ?? 'simulated'}
            </li>
          </ul>

          <p className={styles.explanation}>
            Toto hlásenie bolo spracované len lokálnym backendom v testovacom režime.
            Na server AUSEMIO/DPMK (<code>kosice.ausemio.io/public_issues</code>) nebol odoslaný
            žiadny HTTP request. Osobné údaje sa v prehliadači neukladajú do localStorage.
          </p>
        </>
      )}

      {!success && state.message && <p className={styles.message}>{state.message}</p>}

      {success && hasPayload && state.ausemioPayload && (
        <section className={styles.previewSection} aria-labelledby="ausemio-preview-heading">
          <h3 id="ausemio-preview-heading" className={styles.previewHeading}>
            AUSEMIO payload preview
          </h3>
          <p className={styles.previewHint}>
            Náhľad polí, ktoré backend pripravil pre multipart/form-data. Citlivé údaje sú
            čiastočne maskované{import.meta.env.DEV ? '; detail_decription je v dev režime plný' : ''}.
          </p>

          <table className={styles.previewTable}>
            <thead>
              <tr>
                <th scope="col">Pole</th>
                <th scope="col">Hodnota</th>
              </tr>
            </thead>
            <tbody>
              {previewRows.map((row) => (
                <tr key={row.field}>
                  <th scope="row" className={styles.fieldName}>
                    {row.field}
                  </th>
                  <td className={styles.maskedValue}>
                    {row.value}
                    {row.masked && <span className={styles.maskTag}>masked</span>}
                  </td>
                </tr>
              ))}
              <tr>
                <th scope="row" className={styles.fieldName}>
                  files[]
                </th>
                <td>{formatAusemioFilesPreview(state.ausemioPayload)}</td>
              </tr>
            </tbody>
          </table>

          <p className={styles.targetMeta}>
            Cieľ (len informatívne, bez odoslania): {state.ausemioPayload.method}{' '}
            {state.ausemioPayload.targetUrl} · {state.ausemioPayload.contentType}
          </p>
        </section>
      )}

      <details className={styles.instructions}>
        <summary className={styles.instructionsSummary}>
          Ako overiť testovací režim (bez reálneho AUSEMIO)
        </summary>
        <div className={styles.instructionsBody}>
          <ol>
            <li>Spustite backend a frontend (napr. docker compose alebo npm run dev).</li>
            <li>Otvorte mapu, vyberte svetelný bod a prejdite na formulár hlásenia.</li>
            <li>Vyplňte povinné polia (adresa, e-mail, súhlas) a odošlite formulár.</li>
            <li>Skontrolujte túto stránku `/result`: status Test mode, referenčné číslo a preview.</li>
            <li>
              V admin paneli alebo v DB skontrolujte `integration_logs` — len technické metadáta,
              bez email/telefónu.
            </li>
            <li>
              V DevTools → Network overte, že neexistuje request na{' '}
              <code>kosice.ausemio.io/public_issues</code> (ani iný AUSEMIO endpoint).
            </li>
          </ol>
        </div>
      </details>

      <div className={styles.actions}>
        <Link to="/map">Späť na mapu</Link>
        <Link to="/report">Nové hlásenie</Link>
      </div>
    </section>
  );
}
