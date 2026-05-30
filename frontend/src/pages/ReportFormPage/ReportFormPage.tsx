import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '@/services/api';
import { getLightPoint } from '@/services/lightPointsApi';
import {
  reportFormSchema,
  type ReportFormValues,
} from '@/schemas/reportSchema';
import styles from './ReportFormPage.module.css';

export function ReportFormPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [locationAddress, setLocationAddress] = useState<string | null>(null);

  const lightPointIdFromUrl = Number(searchParams.get('lightPointId'));
  const initialLightPointId =
    Number.isFinite(lightPointIdFromUrl) && lightPointIdFromUrl > 0
      ? lightPointIdFromUrl
      : 1;

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<ReportFormValues>({
    resolver: zodResolver(reportFormSchema),
    defaultValues: {
      lightPointId: initialLightPointId,
      faultType: '',
      description: '',
      reporterName: '',
      reporterEmail: '',
      reporterPhone: '',
    },
  });

  const lightPointId = watch('lightPointId');

  useEffect(() => {
    const id = Number(lightPointId);
    if (!Number.isFinite(id) || id <= 0) {
      setLocationAddress(null);
      return;
    }

    let cancelled = false;

    getLightPoint(id)
      .then((point) => {
        if (!cancelled) {
          setLocationAddress(point.address?.trim() || null);
        }
      })
      .catch(() => {
        if (!cancelled) setLocationAddress(null);
      });

    return () => {
      cancelled = true;
    };
  }, [lightPointId]);

  const onSubmit = async (values: ReportFormValues) => {
    setSubmitError(null);
    try {
      const result = await api.sendReport(values);
      navigate('/result', {
        state: { success: true, referenceCode: result.referenceCode },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Odoslanie zlyhalo';
      setSubmitError(message);
      navigate('/result', { state: { success: false, message } });
    }
  };

  return (
    <section className={styles.section}>
      <h2 className={styles.heading}>Formulár nahlásenia poruchy</h2>

      <form className={styles.form} onSubmit={handleSubmit(onSubmit)} noValidate>
        <div className={styles.field}>
          <label htmlFor="lightPointId">ID svetelného bodu</label>
          <input
            id="lightPointId"
            type="number"
            {...register('lightPointId')}
          />
          {errors.lightPointId && (
            <span className={styles.error}>{errors.lightPointId.message}</span>
          )}
        </div>

        <div className={styles.locationBox} aria-live="polite">
          <span className={styles.locationLabel}>Poloha:</span>
          {locationAddress ? (
            <p className={styles.locationText}>{locationAddress}</p>
          ) : (
            <p className={styles.locationMuted}>
              Adresa pre tento bod nie je k dispozícii.
            </p>
          )}
        </div>

        <div className={styles.field}>
          <label htmlFor="faultType">Typ poruchy</label>
          <select id="faultType" {...register('faultType')}>
            <option value="">— vyberte —</option>
            <option value="not_lit">Nesvieti</option>
            <option value="flickering">Bliká</option>
            <option value="damaged">Poškodené</option>
            <option value="other">Iné</option>
          </select>
          {errors.faultType && (
            <span className={styles.error}>{errors.faultType.message}</span>
          )}
        </div>

        <div className={styles.field}>
          <label htmlFor="description">Popis poruchy</label>
          <textarea id="description" rows={4} {...register('description')} />
          {errors.description && (
            <span className={styles.error}>{errors.description.message}</span>
          )}
        </div>

        <fieldset className={styles.fieldset}>
          <legend>Kontakt (voliteľné)</legend>
          <div className={styles.field}>
            <label htmlFor="reporterName">Meno</label>
            <input id="reporterName" type="text" {...register('reporterName')} />
          </div>
          <div className={styles.field}>
            <label htmlFor="reporterEmail">E-mail</label>
            <input id="reporterEmail" type="email" {...register('reporterEmail')} />
            {errors.reporterEmail && (
              <span className={styles.error}>{errors.reporterEmail.message}</span>
            )}
          </div>
          <div className={styles.field}>
            <label htmlFor="reporterPhone">Telefón</label>
            <input id="reporterPhone" type="tel" {...register('reporterPhone')} />
          </div>
        </fieldset>

        {submitError && <p className={styles.error}>{submitError}</p>}

        <button type="submit" className={styles.button} disabled={isSubmitting}>
          {isSubmitting ? 'Odosiela sa…' : 'Odoslať hlásenie'}
        </button>
      </form>
    </section>
  );
}
