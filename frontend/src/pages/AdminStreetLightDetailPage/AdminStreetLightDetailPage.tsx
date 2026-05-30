import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { adminApi } from '@/services/adminApi';
import { mapAdminStreetLight } from '@/types/admin';
import { STATUS_LABELS } from '@/types/lightPoint';
import styles from '@/styles/adminShared.module.css';

export function AdminStreetLightDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [point, setPoint] = useState<ReturnType<typeof mapAdminStreetLight> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!id) return;
    adminApi
      .getStreetLight(Number(id))
      .then((row) => setPoint(mapAdminStreetLight(row)))
      .catch((err) => setError(err instanceof Error ? err.message : 'Načítanie zlyhalo'));
  }, [id]);

  const handleDelete = async () => {
    if (!id || !window.confirm('Naozaj zmazať tento svetelný bod?')) return;
    setDeleting(true);
    try {
      await adminApi.deleteStreetLight(Number(id));
      navigate('/admin/street-lights');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Zmazanie zlyhalo');
      setDeleting(false);
    }
  };

  if (error) return <p className={styles.error}>{error}</p>;
  if (!point) return <p>Načítavam…</p>;

  return (
    <section className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.heading}>Svetelný bod #{point.id}</h1>
        <div className={styles.actions}>
          <Link to={`/admin/street-lights/${point.id}/edit`} className={styles.button}>
            Upraviť
          </Link>
          <button
            type="button"
            className={styles.buttonDanger}
            disabled={deleting}
            onClick={() => void handleDelete()}
          >
            {deleting ? 'Mažem…' : 'Zmazať'}
          </button>
          <Link to="/admin/street-lights" className={styles.buttonSecondary}>
            Späť
          </Link>
        </div>
      </header>

      <dl className={`${styles.card} ${styles.detailGrid}`}>
        <dt>Inventárne číslo</dt>
        <dd>{point.inventoryNumber ?? '—'}</dd>
        <dt>Súradnice</dt>
        <dd>
          {point.latitude}, {point.longitude}
        </dd>
        <dt>Adresa</dt>
        <dd>{point.address ?? '—'}</dd>
        <dt>Okres / lokalita</dt>
        <dd>{point.district ?? '—'}</dd>
        <dt>Typ svietidla</dt>
        <dd>{point.lampType ?? '—'}</dd>
        <dt>Technický stav</dt>
        <dd>{STATUS_LABELS[point.status]}</dd>
        <dt>Vytvorené</dt>
        <dd>{new Date(point.createdAt).toLocaleString('sk-SK')}</dd>
        <dt>Upravené</dt>
        <dd>{new Date(point.updatedAt).toLocaleString('sk-SK')}</dd>
      </dl>
    </section>
  );
}
