import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getLightPoints } from '@/services/lightPointsApi';
import type { LightPoint } from '@/types/lightPoint';
import styles from './AdminLightPointsPage.module.css';

export function AdminLightPointsPage() {
  const [rows, setRows] = useState<LightPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getLightPoints()
      .then(setRows)
      .catch((err) =>
        setError(err instanceof Error ? err.message : 'Načítanie zlyhalo')
      )
      .finally(() => setLoading(false));
  }, []);

  return (
    <section className={styles.section}>
      <header className={styles.header}>
        <h2 className={styles.heading}>Správa svetelných bodov</h2>
        <Link to="/admin/login" className={styles.backLink}>
          Odhlásiť (skeleton)
        </Link>
      </header>

      <p className={styles.note}>
        CRUD operácie pre admina budú doplnené neskôr. Tabuľka zobrazuje verejný
        zoznam ako ukážku.
      </p>

      {loading && <p>Načítavam…</p>}
      {error && <p className={styles.error}>{error}</p>}

      {!loading && !error && (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>ID</th>
                <th>Inventárne číslo</th>
                <th>Adresa</th>
                <th>Typ</th>
                <th>Stav</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>{row.id}</td>
                  <td>{row.inventory_number ?? '—'}</td>
                  <td>{row.address ?? '—'}</td>
                  <td>{row.type ?? '—'}</td>
                  <td>{row.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
