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
  const ausemioPayload = state?.ausemioPayload;
  const previewRows = ausemioPayload ? buildAusemioPreviewRows(ausemioPayload) : [];

  if (!state) {
    return (
      <section className={styles.section}>
        <h2 className={styles.heading}>Výsledok hlásenia</h2>
        <p className={styles.fallback}>No test report data available.</p>
        <p className={styles.fallbackHint}>
          Vyplňte formulár a odošlite hlásenie — údaje sa do prehliadača neukladajú trvalo.
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
            TEST MODE
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
            V DevTools → Network má byť viditeľný jeden <code>POST /api/reports/send</code> s{' '}
            <code>multipart/form-data</code> telom. Na server AUSEMIO/DPMK sa neodoslal žiadny
            HTTP request. Nižšie je náhľad AUSEMIO multipart polí z backend response (
            <code>ausemioPayload.fields</code>). Údaje nie sú uložené v localStorage.
          </p>
        </>
      )}

      {!success && state.message && <p className={styles.message}>{state.message}</p>}

      {success && ausemioPayload && (
        <section className={styles.previewSection} aria-labelledby="ausemio-preview-heading">
          <h3 id="ausemio-preview-heading" className={styles.previewHeading}>
            AUSEMIO payload preview
          </h3>
          <p className={styles.previewHint}>
            Hodnoty z <code>ausemioPayload.fields</code> (nie z interného stavu formulára).
            Citlivé údaje sú maskované
            {import.meta.env.DEV
              ? '; properties[detail_decription] je v dev režime plný'
              : ' aj v production preview'}.
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
                <td className={styles.maskedValue}>
                  {formatAusemioFilesPreview(ausemioPayload)}
                </td>
              </tr>
            </tbody>
          </table>

          <p className={styles.targetMeta}>
            Cieľ (len informatívne, bez odoslania): {ausemioPayload.method}{' '}
            {ausemioPayload.targetUrl} · {ausemioPayload.contentType}
          </p>
        </section>
      )}

      <details className={styles.instructions}>
        <summary className={styles.instructionsSummary}>How to verify</summary>
        <div className={styles.instructionsBody}>
          <ol>
            <li>Open DevTools → Network.</li>
            <li>Submit the report form.</li>
            <li>
              Click <code>POST /api/reports/send</code>.
            </li>
            <li>
              Payload must show <strong>Form Data</strong>, not Request Payload.
            </li>
            <li>
              Form Data must contain <code>properties[…]</code>, <code>files[]</code>,{' '}
              <code>email</code>, <code>locale</code>.
            </li>
            <li>
              There must be no request to{' '}
              <code>https://kosice.ausem.io/public_issues</code>.
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
