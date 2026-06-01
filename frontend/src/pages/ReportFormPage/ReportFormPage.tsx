import { useEffect, useMemo, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '@/services/api';
import { getLightPoint } from '@/services/lightPointsApi';
import {
  AUSEMIO_FAULT_TYPES,
  AUSEMIO_LOCATION_BLOCKS,
  AUSEMIO_SERVICE_VO,
  isOtherFaultType,
  MAX_REPORT_FILES,
} from '@/config/ausemioForm';
import {
  reportFilesSchema,
  reportFormSchema,
  reportFormStep1Schema,
  type ReportFormValues,
} from '@/schemas/reportSchema';
import styles from './ReportFormPage.module.css';

const TOTAL_STEPS = 2;

export function ReportFormPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [step, setStep] = useState(1);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [locationAddress, setLocationAddress] = useState<string | null>(null);
  const [inventoryNumber, setInventoryNumber] = useState<string | null>(null);
  const locationPrefilled = useRef(false);
  const detailPrefilled = useRef(false);

  const lightPointIdFromUrl = Number(searchParams.get('lightPointId'));
  const selectedLightPointId = useMemo(() => {
    if (!Number.isFinite(lightPointIdFromUrl) || lightPointIdFromUrl <= 0) {
      return null;
    }
    return lightPointIdFromUrl;
  }, [lightPointIdFromUrl]);

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    setError,
    clearErrors,
    getValues,
    formState: { errors, isSubmitting },
  } = useForm<ReportFormValues>({
    resolver: zodResolver(reportFormSchema),
    defaultValues: {
      streetOrLocation: '',
      detailDescription: '',
      locationBlock: '',
      faultType: '',
      otherFaultText: '',
      phone: '',
      failureOn: '',
      email: '',
      consent: false,
    },
  });

  const faultType = watch('faultType');
  const consent = watch('consent');

  useEffect(() => {
    if (selectedLightPointId == null) {
      navigate('/map', { replace: true });
    }
  }, [navigate, selectedLightPointId]);

  useEffect(() => {
    locationPrefilled.current = false;
    detailPrefilled.current = false;
    setStep(1);
  }, [selectedLightPointId]);

  useEffect(() => {
    if (selectedLightPointId == null) {
      return;
    }

    let cancelled = false;

    getLightPoint(selectedLightPointId)
      .then((point) => {
        if (cancelled) return;

        const address = point.address?.trim() || null;
        setLocationAddress(address);
        setInventoryNumber(point.inventory_number?.trim() || null);

        if (address && !locationPrefilled.current) {
          setValue('streetOrLocation', address, { shouldValidate: true });
          locationPrefilled.current = true;
        }

        if (point.inventory_number?.trim() && !detailPrefilled.current) {
          setValue(
            'detailDescription',
            `Inventárne číslo: ${point.inventory_number.trim()}`
          );
          detailPrefilled.current = true;
        }
      })
      .catch(() => {
        if (!cancelled) {
          setLocationAddress(null);
          setInventoryNumber(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [selectedLightPointId, setValue]);

  const handleFilesChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setFileError(null);
    const list = event.target.files ? Array.from(event.target.files) : [];
    const parsed = reportFilesSchema.safeParse(list);

    if (!parsed.success) {
      setSelectedFiles([]);
      event.target.value = '';
      setFileError(parsed.error.errors[0]?.message ?? 'Neplatné súbory');
      return;
    }

    setSelectedFiles(parsed.data);
  };

  const applyZodErrors = (issues: { path: PropertyKey[]; message: string }[]) => {
    clearErrors();
    for (const issue of issues) {
      const field = issue.path[0];
      if (typeof field === 'string') {
        setError(field as keyof ReportFormValues, { message: issue.message });
      }
    }
  };

  const goToNextStep = () => {
    setSubmitError(null);
    setFileError(null);

    const filesCheck = reportFilesSchema.safeParse(selectedFiles);
    if (!filesCheck.success) {
      setFileError(filesCheck.error.errors[0]?.message ?? 'Neplatné súbory');
      return;
    }

    const parsed = reportFormStep1Schema.safeParse(getValues());
    if (!parsed.success) {
      applyZodErrors(parsed.error.issues);
      return;
    }

    clearErrors();
    setStep(2);
  };

  const goToPreviousStep = () => {
    setSubmitError(null);
    setStep(1);
  };

  const onSubmit = async (values: ReportFormValues) => {
    if (selectedLightPointId == null || step !== TOTAL_STEPS) {
      return;
    }

    setSubmitError(null);
    setFileError(null);

    const filesCheck = reportFilesSchema.safeParse(selectedFiles);
    if (!filesCheck.success) {
      setFileError(filesCheck.error.errors[0]?.message ?? 'Neplatné súbory');
      setStep(1);
      return;
    }

    const payload = {
      lightPointId: selectedLightPointId,
      service: AUSEMIO_SERVICE_VO,
      streetOrLocation: values.streetOrLocation,
      detailDescription: values.detailDescription || undefined,
      locationBlock: values.locationBlock,
      faultType: values.faultType,
      otherFaultText: values.otherFaultText || undefined,
      phone: values.phone || undefined,
      failureOn: values.failureOn || undefined,
      email: values.email,
      consent: values.consent,
      locale: 'sk',
      files: filesCheck.data.map((file) => ({
        name: file.name,
        size: file.size,
        mimeType: file.type || undefined,
      })),
    };

    try {
      const result = await api.sendReport(payload);
      navigate('/result', {
        state: {
          success: true,
          referenceCode: result.referenceCode,
          message: result.message,
          status: result.status,
          acceptedAt: new Date().toISOString(),
          ausemioPayload: result.ausemioPayload,
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Odoslanie zlyhalo';
      setSubmitError(message);
      navigate('/result', { state: { success: false, message } });
    }
  };

  if (selectedLightPointId == null) {
    return null;
  }

  return (
    <section className={styles.section}>
      <h2 className={styles.heading}>Formulár nahlásenia poruchy</h2>
      <p className={styles.stepIndicator}>
        Krok {step} z {TOTAL_STEPS}
      </p>
      <p className={styles.hint}>
        Testovací režim — údaje sa odosielajú len na lokálny backend, nie priamo do AUSEMIO.
      </p>

      <form className={styles.form} onSubmit={handleSubmit(onSubmit)} noValidate>
        {step === 1 && (
          <>
            <div className={styles.locationBox} aria-live="polite">
              <span className={styles.locationLabel}>Vybraná poloha</span>
              {inventoryNumber && (
                <p className={styles.locationText}>Inventárne číslo: {inventoryNumber}</p>
              )}
              {locationAddress ? (
                <p className={styles.locationText}>{locationAddress}</p>
              ) : (
                <p className={styles.locationMuted}>
                  Adresa z mapy nie je k dispozícii — vyplňte polohu ručne nižšie.
                </p>
              )}
            </div>

            <div className={styles.field}>
              <label htmlFor="streetOrLocation">Ulica / miesto poruchy / lokalita</label>
              <input
                id="streetOrLocation"
                type="text"
                autoComplete="street-address"
                {...register('streetOrLocation')}
              />
              {errors.streetOrLocation && (
                <span className={styles.error}>{errors.streetOrLocation.message}</span>
              )}
            </div>

            <div className={styles.field}>
              <label htmlFor="detailDescription">
                Bližší popis / orientačný bod / číslo stĺpa
              </label>
              <textarea
                id="detailDescription"
                rows={3}
                {...register('detailDescription')}
              />
              {errors.detailDescription && (
                <span className={styles.error}>{errors.detailDescription.message}</span>
              )}
            </div>

            <div className={styles.field}>
              <label htmlFor="locationBlock">Lokalizácia - Blok</label>
              <select id="locationBlock" {...register('locationBlock')}>
                <option value="">— vyberte lokalizáciu —</option>
                {AUSEMIO_LOCATION_BLOCKS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              {errors.locationBlock && (
                <span className={styles.error}>{errors.locationBlock.message}</span>
              )}
            </div>

            <div className={styles.field}>
              <label htmlFor="faultType">Typ poruchy</label>
              <select id="faultType" {...register('faultType')}>
                <option value="">— vyberte typ poruchy —</option>
                {AUSEMIO_FAULT_TYPES.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              {errors.faultType && (
                <span className={styles.error}>{errors.faultType.message}</span>
              )}
            </div>

            {isOtherFaultType(faultType) && (
              <div className={styles.field}>
                <label htmlFor="otherFaultText">Iný druh poruchy</label>
                <textarea id="otherFaultText" rows={3} {...register('otherFaultText')} />
                {errors.otherFaultText && (
                  <span className={styles.error}>{errors.otherFaultText.message}</span>
                )}
              </div>
            )}

            <div className={styles.field}>
              <label htmlFor="failureOn">QR / Failure on (voliteľné)</label>
              <input id="failureOn" type="text" {...register('failureOn')} />
              {errors.failureOn && (
                <span className={styles.error}>{errors.failureOn.message}</span>
              )}
            </div>

            <div className={styles.field}>
              <label htmlFor="files">Prílohy — max. {MAX_REPORT_FILES}</label>
              <input
                id="files"
                type="file"
                multiple
                accept="image/*"
                onChange={handleFilesChange}
              />
              <p className={styles.hint}>
                Súbory sa zatiaľ ukladajú len v prehliadači a pripravujú sa na budúce odoslanie.
              </p>
              {selectedFiles.length > 0 && (
                <ul className={styles.fileList}>
                  {selectedFiles.map((file) => (
                    <li key={`${file.name}-${file.size}-${file.lastModified}`}>
                      {file.name} ({Math.round(file.size / 1024)} KB)
                    </li>
                  ))}
                </ul>
              )}
              {fileError && <span className={styles.error}>{fileError}</span>}
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <fieldset className={styles.fieldset}>
              <legend>Kontakt</legend>

              <div className={styles.field}>
                <label htmlFor="phone">Telefón</label>
                <input id="phone" type="tel" autoComplete="tel" {...register('phone')} />
                {errors.phone && <span className={styles.error}>{errors.phone.message}</span>}
              </div>

              <div className={styles.field}>
                <label htmlFor="email">E-mail</label>
                <input
                  id="email"
                  type="email"
                  autoComplete="email"
                  {...register('email')}
                />
                {errors.email && <span className={styles.error}>{errors.email.message}</span>}
              </div>
            </fieldset>

            <div className={styles.field}>
              <label className={styles.consentLabel}>
                <input type="checkbox" {...register('consent')} />
                <span>
                  Súhlasím so spracovaním osobných údajov za účelom vybavenia hlásenia poruchy
                  verejného osvetlenia.
                </span>
              </label>
              {errors.consent && <span className={styles.error}>{errors.consent.message}</span>}
            </div>
          </>
        )}

        {submitError && <p className={styles.error}>{submitError}</p>}

        <div className={styles.actions}>
          {step === 2 && (
            <button
              type="button"
              className={styles.buttonSecondary}
              onClick={goToPreviousStep}
              disabled={isSubmitting}
            >
              Späť
            </button>
          )}

          {step === 1 && (
            <button type="button" className={styles.button} onClick={goToNextStep}>
              Ďalej
            </button>
          )}

          {step === 2 && (
            <button
              type="submit"
              className={styles.button}
              disabled={isSubmitting || !consent}
            >
              {isSubmitting ? 'Odosiela sa…' : 'Odoslať hlásenie (test)'}
            </button>
          )}
        </div>
      </form>
    </section>
  );
}
