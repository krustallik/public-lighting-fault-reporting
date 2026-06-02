import { useEffect, useState } from 'react';
import { adminApi } from '@/services/adminApi';
import type { IntegrationSettings } from '@/types/admin';
import styles from '@/styles/adminShared.module.css';

export function AdminSettingsPage() {
  const [settings, setSettings] = useState<IntegrationSettings | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    adminApi
      .getIntegrationSettings()
      .then(setSettings)
      .catch((err) => setError(err instanceof Error ? err.message : 'Načítanie zlyhalo'));
  }, []);

  if (error) return <p className={styles.error}>{error}</p>;
  if (!settings) return <p>Načítavam…</p>;

  return (
    <section className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.heading}>Nastavenia integrácie</h1>
      </header>

      <div className={styles.card}>
        <p className={styles.muted}>
          Technická konfigurácia AUSEMIO/DPMK (bez API kľúčov a bez údajov občanov).
        </p>

        <dl className={styles.detailGrid}>
          <dt>Base URL</dt>
          <dd>{settings.baseUrl}</dd>
          <dt>Test mode</dt>
          <dd>{settings.testMode ? 'Áno' : 'Nie'}</dd>
          <dt>Locale (AUSEMIO multipart)</dt>
          <dd>{settings.submitLocales.join(', ')}</dd>
          <dt>API kľúč nastavený</dt>
          <dd>{settings.apiKeyConfigured ? 'Áno' : 'Nie'}</dd>
        </dl>
      </div>

      <div className={styles.card} style={{ marginTop: 'var(--space-md)' }}>
        <h2>Mapovanie polí (multipart/form-data)</h2>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Kľúč v aplikácii</th>
                <th>Externé pole AUSEMIO</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(settings.fieldMapping).map(([key, value]) => (
                <tr key={key}>
                  <td>{key}</td>
                  <td>
                    <code>{value}</code>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
