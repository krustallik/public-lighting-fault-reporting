import { useEffect, useMemo, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ReportFormLocaleSwitch } from '@/components/ReportFormLocaleSwitch/ReportFormLocaleSwitch';
import { isOtherFaultType, MAX_REPORT_FILES } from '@/config/ausemioForm';
import {
  REPORT_FAULT_TYPE_CODES,
  REPORT_LOCATION_BLOCK_CODES,
} from '@/config/reportFormOptions';
import {
  ReportFormLocaleProvider,
  useReportFormLocale,
} from '@/context/ReportFormLocaleContext';
import { api } from '@/services/api';
import { getLightPoint } from '@/services/lightPointsApi';
import { buildReportFormData } from '@/utils/buildReportFormData';
import { appendCustomLocationDetailNote } from '@/utils/customLocationDetail';
import {
  formatCoordinates,
  isValidReportCoordinates,
  parseCoordSearchParam,
} from '@/utils/reportLocationParams';
import {
  createReportFilesSchema,
  createReportFormSchema,
  createReportFormStep1Schema,
  type ReportFormValues,
} from '@/schemas/reportSchema';
import styles from './ReportFormPage.module.css';

const TOTAL_STEPS = 2;

export function ReportFormPage() {
  return (
    <ReportFormLocaleProvider>
      <ReportFormPageContent />
    </ReportFormLocaleProvider>
  );
}

function ReportFormPageContent() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { locale, messages } = useReportFormLocale();
  const [step, setStep] = useState(1);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [dbAddress, setDbAddress] = useState<string | null>(null);
  const [locationLoading, setLocationLoading] = useState(true);
  const detailPrefilled = useRef(false);

  const reportFormSchema = useMemo(() => createReportFormSchema(messages), [messages]);
  const reportFormStep1Schema = useMemo(
    () => createReportFormStep1Schema(messages),
    [messages]
  );
  const reportFilesSchema = useMemo(() => createReportFilesSchema(messages), [messages]);
  const resolver = useMemo(() => zodResolver(reportFormSchema), [reportFormSchema]);

  const lightPointIdFromUrl = Number(searchParams.get('lightPointId'));
  const selectedLightPointId = useMemo(() => {
    if (!Number.isFinite(lightPointIdFromUrl) || lightPointIdFromUrl <= 0) {
      return null;
    }
    return lightPointIdFromUrl;
  }, [lightPointIdFromUrl]);

  const customLatitude = parseCoordSearchParam(searchParams.get('lat'));
  const customLongitude = parseCoordSearchParam(searchParams.get('lng'));
  const isCustomLocation = useMemo(
    () =>
      selectedLightPointId == null &&
      isValidReportCoordinates(customLatitude, customLongitude),
    [selectedLightPointId, customLatitude, customLongitude]
  );

  const hasValidReportTarget = selectedLightPointId != null || isCustomLocation;

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
    resolver,
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
  const showStreetField = isCustomLocation || (!locationLoading && !dbAddress);

  useEffect(() => {
    clearErrors();
  }, [locale, clearErrors]);

  useEffect(() => {
    if (!hasValidReportTarget) {
      navigate('/map', { replace: true });
    }
  }, [hasValidReportTarget, navigate]);

  useEffect(() => {
    detailPrefilled.current = false;
    setDbAddress(null);
    setLocationLoading(!isCustomLocation);
    setStep(1);
  }, [selectedLightPointId, customLatitude, customLongitude, isCustomLocation]);

  useEffect(() => {
    if (isCustomLocation) {
      setLocationLoading(false);
    }
  }, [isCustomLocation]);

  useEffect(() => {
    if (selectedLightPointId == null) {
      return;
    }

    let cancelled = false;

    setLocationLoading(true);

    getLightPoint(selectedLightPointId)
      .then((point) => {
        if (cancelled) return;

        const address = point.address?.trim() ?? '';
        setDbAddress(address || null);

        if (address) {
          setValue('streetOrLocation', address, { shouldValidate: true });
        }

        if (point.inventory_number?.trim() && !detailPrefilled.current) {
          setValue(
            'detailDescription',
            `${messages.form.inventoryPrefix}: ${point.inventory_number.trim()}`
          );
          detailPrefilled.current = true;
        }
      })
      .catch(() => {
        if (!cancelled) {
          setDbAddress(null);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLocationLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [selectedLightPointId, setValue, messages.form.inventoryPrefix]);

  const handleFilesChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setFileError(null);
    const list = event.target.files ? Array.from(event.target.files) : [];
    const parsed = reportFilesSchema.safeParse(list);

    if (!parsed.success) {
      setSelectedFiles([]);
      event.target.value = '';
      setFileError(parsed.error.errors[0]?.message ?? messages.validation.invalidFile);
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
    if (locationLoading) {
      return;
    }

    setSubmitError(null);
    setFileError(null);

    const filesCheck = reportFilesSchema.safeParse(selectedFiles);
    if (!filesCheck.success) {
      setFileError(filesCheck.error.errors[0]?.message ?? messages.validation.invalidFile);
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
    if (!hasValidReportTarget || step !== TOTAL_STEPS) {
      return;
    }

    setSubmitError(null);
    setFileError(null);

    const filesCheck = reportFilesSchema.safeParse(selectedFiles);
    if (!filesCheck.success) {
      setFileError(filesCheck.error.errors[0]?.message ?? messages.validation.invalidFile);
      setStep(1);
      return;
    }

    const location = values.streetOrLocation.trim() || dbAddress?.trim() || '';
    let detailDescription = values.detailDescription?.trim() ?? '';

    if (isCustomLocation && customLatitude != null && customLongitude != null) {
      detailDescription = appendCustomLocationDetailNote(
        detailDescription,
        customLatitude,
        customLongitude,
        locale
      );
    }

    const formData = buildReportFormData(
      {
        ...values,
        streetOrLocation: location,
        detailDescription,
      },
      filesCheck.data,
      locale
    );

    try {
      const result = await api.sendReport(
        formData,
        selectedLightPointId != null
          ? { lightPointId: selectedLightPointId }
          : undefined
      );
      navigate('/result', {
        state: {
          success: true,
          referenceCode: result.referenceCode,
          message: result.message,
          status: result.status,
          acceptedAt: new Date().toISOString(),
          ausemioPayload: result.ausemioPayload,
          locale,
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : messages.form.submitFailed;
      setSubmitError(message);
      navigate('/result', { state: { success: false, message, locale } });
    }
  };

  if (!hasValidReportTarget) {
    return null;
  }

  const coordinatesLabel =
    isCustomLocation && customLatitude != null && customLongitude != null
      ? formatCoordinates(customLatitude, customLongitude)
      : null;

  const { form: t } = messages;

  return (
    <section className={styles.section}>
      <ReportFormLocaleSwitch />

      <h2 className={styles.heading}>{t.title}</h2>
      {isCustomLocation && <p className={styles.contextBanner}>{t.customLocationBanner}</p>}
      <p className={styles.stepIndicator}>{t.step(step, TOTAL_STEPS)}</p>
      <p className={styles.hint}>{t.testModeHint}</p>
      <p className={styles.localeHint}>
        {locale === 'sk'
          ? 'Odoslaný jazyk (pole locale): slovenčina (sk)'
          : 'Submit language (locale field): English (en)'}
      </p>

      <form className={styles.form} onSubmit={handleSubmit(onSubmit)} noValidate>
        {step === 1 && (
          <>
            {isCustomLocation && coordinatesLabel && (
              <div className={styles.field}>
                <span className={styles.readOnlyLabel}>{t.selectedCoordinates}</span>
                <p className={styles.readOnlyValue}>{coordinatesLabel}</p>
              </div>
            )}

            {showStreetField && (
              <div className={styles.field}>
                <label htmlFor="streetOrLocation">
                  {t.streetLabel}
                  {isCustomLocation && ' *'}
                </label>
                {isCustomLocation && <p className={styles.hint}>{t.streetCustomHint}</p>}
                <input
                  id="streetOrLocation"
                  type="text"
                  autoComplete="street-address"
                  disabled={locationLoading}
                  {...register('streetOrLocation')}
                />
                {errors.streetOrLocation && (
                  <span className={styles.error}>{errors.streetOrLocation.message}</span>
                )}
              </div>
            )}

            <div className={styles.field}>
              <label htmlFor="detailDescription">{t.detailLabel}</label>
              {isCustomLocation && <p className={styles.hint}>{t.detailCustomHint}</p>}
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
              <label htmlFor="locationBlock">{t.locationBlockLabel}</label>
              <select id="locationBlock" {...register('locationBlock')}>
                <option value="">{t.locationBlockPlaceholder}</option>
                {REPORT_LOCATION_BLOCK_CODES.map((code) => (
                  <option key={code} value={code}>
                    {messages.locationBlocks[code]}
                  </option>
                ))}
              </select>
              {errors.locationBlock && (
                <span className={styles.error}>{errors.locationBlock.message}</span>
              )}
            </div>

            <div className={styles.field}>
              <label htmlFor="faultType">{t.faultTypeLabel}</label>
              <select id="faultType" {...register('faultType')}>
                <option value="">{t.faultTypePlaceholder}</option>
                {REPORT_FAULT_TYPE_CODES.map((code) => (
                  <option key={code} value={code}>
                    {messages.faultTypes[code]}
                  </option>
                ))}
              </select>
              {errors.faultType && (
                <span className={styles.error}>{errors.faultType.message}</span>
              )}
            </div>

            {(isCustomLocation || isOtherFaultType(faultType ?? '')) && (
              <div className={styles.field}>
                <label htmlFor="otherFaultText">{t.otherFaultLabel}</label>
                <textarea id="otherFaultText" rows={3} {...register('otherFaultText')} />
                {errors.otherFaultText && (
                  <span className={styles.error}>{errors.otherFaultText.message}</span>
                )}
              </div>
            )}

            <div className={styles.field}>
              <label htmlFor="failureOn">{t.failureOnLabel}</label>
              <input id="failureOn" type="text" {...register('failureOn')} />
              {errors.failureOn && (
                <span className={styles.error}>{errors.failureOn.message}</span>
              )}
            </div>

            <div className={styles.field}>
              <label htmlFor="files">{t.attachmentsLabel(MAX_REPORT_FILES)}</label>
              <input
                id="files"
                type="file"
                multiple
                accept="image/*"
                onChange={handleFilesChange}
              />
              <p className={styles.hint}>{t.attachmentsHint}</p>
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
              <legend>{t.contactLegend}</legend>

              <div className={styles.field}>
                <label htmlFor="phone">{t.phoneLabel}</label>
                <p className={styles.hint}>
                  {locale === 'sk'
                    ? 'Voliteľné. Formát: +421951449039, 421951449039 alebo 0951449039.'
                    : 'Optional. Format: +421951449039, 421951449039, or 0951449039.'}
                </p>
                <input
                  id="phone"
                  type="tel"
                  autoComplete="tel"
                  inputMode="tel"
                  placeholder={locale === 'sk' ? '+421951449039' : '+421951449039'}
                  {...register('phone')}
                />
                {errors.phone && <span className={styles.error}>{errors.phone.message}</span>}
              </div>

              <div className={styles.field}>
                <label htmlFor="email">{t.emailLabel}</label>
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
                <span>{t.consentText}</span>
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
              {t.back}
            </button>
          )}

          {step === 1 && (
            <button
              type="button"
              className={styles.button}
              onClick={goToNextStep}
              disabled={locationLoading}
            >
              {locationLoading ? t.nextLoading : t.next}
            </button>
          )}

          {step === 2 && (
            <button
              type="submit"
              className={styles.button}
              disabled={isSubmitting || !consent}
            >
              {isSubmitting ? t.submitting : t.submit}
            </button>
          )}
        </div>
      </form>
    </section>
  );
}
