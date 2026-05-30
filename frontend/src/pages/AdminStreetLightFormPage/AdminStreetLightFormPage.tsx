import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { adminPath } from '@/config/adminRoutes';
import { adminApi } from '@/services/adminApi';
import { streetLightSchema, type StreetLightFormValues } from '@/schemas/streetLightSchema';
import styles from '@/styles/adminShared.module.css';

export function AdminStreetLightFormPage() {
  const { id } = useParams();
  const isEdit = Boolean(id);
  const navigate = useNavigate();
  const [loadError, setLoadError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
    setError,
  } = useForm<StreetLightFormValues>({
    resolver: zodResolver(streetLightSchema),
    defaultValues: {
      inventoryNumber: '',
      latitude: 0,
      longitude: 0,
      address: '',
      district: '',
      lampType: '',
      status: 'active',
    },
  });

  useEffect(() => {
    if (!id) return;
    adminApi
      .getStreetLight(Number(id))
      .then((row) => {
        reset({
          inventoryNumber: row.external_id ?? '',
          latitude: Number(row.latitude),
          longitude: Number(row.longitude),
          address: row.address ?? '',
          district: row.district ?? '',
          lampType: row.lamp_type ?? '',
          status: row.status,
        });
      })
      .catch((err) =>
        setLoadError(err instanceof Error ? err.message : 'Načítanie zlyhalo')
      );
  }, [id, reset]);

  const onSubmit = async (values: StreetLightFormValues) => {
    try {
      if (isEdit && id) {
        await adminApi.updateStreetLight(Number(id), values);
        navigate(adminPath('street-lights', id));
      } else {
        const created = await adminApi.createStreetLight(values);
        navigate(adminPath('street-lights', created.id));
      }
    } catch (err) {
      setError('root', {
        message: err instanceof Error ? err.message : 'Uloženie zlyhalo',
      });
    }
  };

  if (loadError) {
    return <p className={styles.error}>{loadError}</p>;
  }

  return (
    <section className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.heading}>
          {isEdit ? 'Upraviť svetelný bod' : 'Nový svetelný bod'}
        </h1>
        <Link to={adminPath('street-lights')} className={styles.buttonSecondary}>
          Späť na zoznam
        </Link>
      </header>

      <form className={`${styles.card} ${styles.form}`} onSubmit={handleSubmit(onSubmit)} noValidate>
        <div className={styles.field}>
          <label htmlFor="inventoryNumber">Inventárne číslo *</label>
          <input id="inventoryNumber" {...register('inventoryNumber')} />
          {errors.inventoryNumber && (
            <span className={styles.error}>{errors.inventoryNumber.message}</span>
          )}
        </div>

        <div className={styles.field}>
          <label htmlFor="latitude">Zemepisná šírka *</label>
          <input id="latitude" type="number" step="any" {...register('latitude')} />
          {errors.latitude && <span className={styles.error}>{errors.latitude.message}</span>}
        </div>

        <div className={styles.field}>
          <label htmlFor="longitude">Zemepisná dĺžka *</label>
          <input id="longitude" type="number" step="any" {...register('longitude')} />
          {errors.longitude && <span className={styles.error}>{errors.longitude.message}</span>}
        </div>

        <div className={styles.field}>
          <label htmlFor="address">Adresa / ulica</label>
          <input id="address" {...register('address')} />
        </div>

        <div className={styles.field}>
          <label htmlFor="district">Okres / lokalita</label>
          <input id="district" {...register('district')} />
        </div>

        <div className={styles.field}>
          <label htmlFor="lampType">Typ svietidla</label>
          <input id="lampType" {...register('lampType')} />
        </div>

        <div className={styles.field}>
          <label htmlFor="status">Technický stav</label>
          <select id="status" {...register('status')}>
            <option value="active">Aktívny</option>
            <option value="inactive">Neaktívny</option>
            <option value="maintenance">Údržba</option>
          </select>
        </div>

        {errors.root && <p className={styles.error}>{errors.root.message}</p>}

        <button type="submit" className={styles.button} disabled={isSubmitting}>
          {isSubmitting ? 'Ukladám…' : 'Uložiť'}
        </button>
      </form>
    </section>
  );
}
