import { useEffect, useMemo, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ReportFormLocaleSwitch } from '@/components/ReportFormLocaleSwitch/ReportFormLocaleSwitch';
import { LocalityCombobox } from '@/components/LocalityCombobox/LocalityCombobox';
import { AUSEMIO_VO_LOCALITIES } from '@/config/data/ausemioVoLocalities.generated';
import { AUSEMIO_INFO_URL, KOSICE_PRIVACY_POLICY_URL } from '@/config/externalLinks';
import {
  REPORT_FAULT_TYPE_CODES,
  REPORT_LOCATION_BLOCK_CODES,
} from '@/config/reportFormOptions';
import {
  useReportFormLocale,
} from '@/context/ReportFormLocaleContext';
import { api } from '@/services/api';
import { suggestReportAddress } from '@/services/geocodingApi';
import { getLightPoint } from '@/services/lightPointsApi';
import { buildReportFormData } from '@/utils/buildReportFormData';
import { appendCustomLocationDetailNote } from '@/utils/customLocationDetail';
import {
  buildInventoryDetailLine,
} from '@/utils/inventoryDetailLine';
import {
  readReportTarget,
} from '@/utils/reportNavigationTarget';
import {
  createReportFilesSchema,
  createReportFormSchema,
  createReportFormStep1Schema,
  shouldShowOtherFault,
  type ReportFormValues,
} from '@/schemas/reportSchema';
import { AutofillPrecedenceTracker, findExactUniqueLocality } from '@/utils/autofillPrecedence';
import {
  INITIAL_REPORT_FORM_VALUES,
  getReportTargetIdentity,
  shouldClearOtherFaultOnTypeChange,
  transitionReportTarget,
} from '@/utils/reportTargetSession';
import styles from './ReportFormPage.module.css';

const TOTAL_STEPS = 2;

export function ReportFormPage() {
  return <ReportFormPageContent />;
}

function ReportFormPageContent() {
  const navigate = useNavigate();
  const routeLocation = useLocation();
  const { locale, messages } = useReportFormLocale();
  const [step, setStep] = useState(1);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [fileInputKey, setFileInputKey] = useState(0);
  const [locationLoading, setLocationLoading] = useState(true);
  const [addressSuggestionStatus, setAddressSuggestionStatus] = useState('');
  const [addressSuggestionLoading, setAddressSuggestionLoading] = useState(false);
  const [coordinateCopyStatus, setCoordinateCopyStatus] = useState('');
  const addressSuggestionController = useRef<AbortController | null>(null);
  const addressSuggestionSequence = useRef(0);
  const pendingFocusField = useRef<string | null>(null);
  const localSubmissionStarted = useRef(false);
  const autofillSources = useRef<
    AutofillPrecedenceTracker<'locality' | 'detailDescription'> | null
  >(null);
  if (!autofillSources.current) {
    autofillSources.current = new AutofillPrecedenceTracker();
  }

  const reportFormSchema = useMemo(() => createReportFormSchema(messages), [messages]);
  const reportFormStep1Schema = useMemo(
    () => createReportFormStep1Schema(messages),
    [messages]
  );
  const reportFilesSchema = useMemo(() => createReportFilesSchema(messages), [messages]);
  const resolver = useMemo(() => zodResolver(reportFormSchema), [reportFormSchema]);

  const reportTarget = useMemo(
    () => readReportTarget(routeLocation.state),
    [routeLocation.state]
  );
  const selectedLightPointId = reportTarget?.kind === 'light-point'
    ? reportTarget.lightPointId
    : null;
  const coordinateTarget = reportTarget?.kind === 'custom' || reportTarget?.kind === 'device'
    ? reportTarget
    : null;
  const isCustomLocation = coordinateTarget != null;
  const isDeviceLocation = reportTarget?.kind === 'device';
  const customLatitude = coordinateTarget?.latitude ?? null;
  const customLongitude = coordinateTarget?.longitude ?? null;

  const hasValidReportTarget = reportTarget != null;
  const reportTargetIdentity = getReportTargetIdentity(
    selectedLightPointId,
    isCustomLocation ? customLatitude : null,
    isCustomLocation ? customLongitude : null,
    reportTarget?.kind === 'device'
      ? 'device'
      : reportTarget?.kind === 'manual'
        ? 'manual'
        : 'custom'
  );
  const activeReportTargetIdentity = useRef(reportTargetIdentity);
  // Make the latest committed-target candidate visible to async response guards immediately.
  activeReportTargetIdentity.current = reportTargetIdentity;
  const previousReportTargetIdentity = useRef(reportTargetIdentity);

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    setError,
    clearErrors,
    getValues,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<ReportFormValues>({
    resolver,
    defaultValues: { ...INITIAL_REPORT_FORM_VALUES },
    shouldFocusError: true,
  });

  const hasValidationErrors = Object.keys(errors).length > 0 || Boolean(fileError);
  const faultType = watch('faultType');
  const consent = watch('consent');
  const localityValue = watch('locality') ?? '';
  const sourceTracker = autofillSources.current;

  useEffect(() => {
    const field = pendingFocusField.current;
    if (!field) return;
    const control = document.getElementById(field) ??
      document.querySelector<HTMLElement>(`[name="${field}"]`);
    if (control instanceof HTMLElement) control.focus();
    pendingFocusField.current = null;
  }, [errors, fileError, step]);

  useEffect(() => () => {
    addressSuggestionSequence.current += 1;
    addressSuggestionController.current?.abort();
  }, []);

  useEffect(() => {
    clearErrors();
  }, [locale, clearErrors]);

  useEffect(() => {
    const previousIdentity = previousReportTargetIdentity.current;
    previousReportTargetIdentity.current = reportTargetIdentity;

    const changed = transitionReportTarget(
      previousIdentity,
      reportTargetIdentity,
      sourceTracker,
      reset
    );
    if (!changed) return;

    addressSuggestionSequence.current += 1;
    addressSuggestionController.current?.abort();
    addressSuggestionController.current = null;
    setAddressSuggestionLoading(false);
    setAddressSuggestionStatus('');
    setCoordinateCopyStatus('');

    setSelectedFiles([]);
    setFileInputKey((key) => key + 1);
    setSubmitError(null);
    setFileError(null);
    clearErrors();
    setStep(1);
    setLocationLoading(selectedLightPointId != null);
  }, [reportTargetIdentity, sourceTracker, reset, clearErrors, isCustomLocation, selectedLightPointId]);

  const requestAddressSuggestion = async () => {
    if (!coordinateTarget || customLatitude == null || customLongitude == null) return;

    addressSuggestionController.current?.abort();
    const controller = new AbortController();
    addressSuggestionController.current = controller;
    const sequence = addressSuggestionSequence.current + 1;
    addressSuggestionSequence.current = sequence;
    const targetIdentity = reportTargetIdentity;
    setAddressSuggestionLoading(true);
    setAddressSuggestionStatus('');

    try {
      const suggestion = await suggestReportAddress({
        latitude: customLatitude,
        longitude: customLongitude,
        targetKind: coordinateTarget.kind,
        language: locale,
      }, controller.signal);

      if (
        controller.signal.aborted ||
        addressSuggestionSequence.current !== sequence ||
        activeReportTargetIdentity.current !== targetIdentity
      ) return;

      let appliedSuggestion = false;
      if (sourceTracker.canAutofill('detailDescription')) {
        setValue('detailDescription', suggestion.address, { shouldValidate: true });
        sourceTracker.markAuto('detailDescription');
        appliedSuggestion = true;
      }

      if (sourceTracker.canAutofill('locality')) {
        const locality = findExactUniqueLocality(suggestion.locality ?? '', AUSEMIO_VO_LOCALITIES);
        if (locality) {
          setValue('locality', locality.value, { shouldValidate: true });
          sourceTracker.markAuto('locality');
          appliedSuggestion = true;
        } else if (sourceTracker.sourceOf('locality') === 'auto') {
          setValue('locality', '', { shouldValidate: true });
        }
      }

      setAddressSuggestionStatus(appliedSuggestion
        ? t.addressSuggestionApplied
        : t.addressSuggestionPreserved);
    } catch {
      if (
        !controller.signal.aborted &&
        addressSuggestionSequence.current === sequence &&
        activeReportTargetIdentity.current === targetIdentity
      ) {
        setAddressSuggestionStatus(t.addressSuggestionUnavailable);
      }
    } finally {
      if (addressSuggestionSequence.current === sequence) {
        addressSuggestionController.current = null;
        setAddressSuggestionLoading(false);
      }
    }
  };

  const copySelectedCoordinates = async () => {
    if (customLatitude == null || customLongitude == null) return;
    const coordinates = `${customLatitude.toFixed(6)}, ${customLongitude.toFixed(6)}`;
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(coordinates);
      setCoordinateCopyStatus(t.coordinatesCopied);
    } catch {
      setCoordinateCopyStatus(t.coordinatesCopyFallback);
    }
  };

  useEffect(() => {
    if (!hasValidReportTarget) {
      navigate('/map', { replace: true, state: { notice: 'target-required' } });
    }
  }, [hasValidReportTarget, navigate]);

  useEffect(() => {
    setLocationLoading(selectedLightPointId != null);
  }, [selectedLightPointId, customLatitude, customLongitude]);

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
        const locality = findExactUniqueLocality(address, AUSEMIO_VO_LOCALITIES);
        if (sourceTracker.canAutofill('locality')) {
          if (locality || sourceTracker.sourceOf('locality') === 'auto') {
            setValue('locality', locality?.value ?? '', { shouldValidate: true });
            sourceTracker.markAuto('locality');
          }
        }

        if (point.inventory_number?.trim() && sourceTracker.canAutofill('detailDescription')) {
          const inventoryNumber = point.inventory_number.trim();
          setValue('detailDescription', buildInventoryDetailLine(locale, inventoryNumber));
          sourceTracker.markAuto('detailDescription');
        } else if (
          !point.inventory_number?.trim() &&
          sourceTracker.sourceOf('detailDescription') === 'auto'
        ) {
          setValue('detailDescription', '');
        }
      })
      .catch(() => {
        if (!cancelled && sourceTracker.sourceOf('locality') === 'auto') {
          setValue('locality', '', { shouldValidate: true });
          sourceTracker.markAuto('locality');
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
  }, [selectedLightPointId, setValue, locale, sourceTracker]);

  const handleFilesChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setFileError(null);
    const list = event.target.files ? Array.from(event.target.files) : [];
    const parsed = reportFilesSchema.safeParse(list);

    if (!parsed.success) {
      setSelectedFiles([]);
      event.target.value = '';
      pendingFocusField.current = 'files';
      setFileError(parsed.error.errors[0]?.message ?? messages.validation.invalidFile);
      return;
    }

    setSelectedFiles(parsed.data);
  };

  const applyZodErrors = (issues: { path: PropertyKey[]; message: string }[]) => {
    const firstField = issues[0]?.path[0];
    if (typeof firstField === 'string') pendingFocusField.current = firstField;
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
    if (!hasValidReportTarget || step !== TOTAL_STEPS || localSubmissionStarted.current) {
      return;
    }

    setSubmitError(null);
    setFileError(null);

    const filesCheck = reportFilesSchema.safeParse(selectedFiles);
    if (!filesCheck.success) {
      pendingFocusField.current = 'files';
      setFileError(filesCheck.error.errors[0]?.message ?? messages.validation.invalidFile);
      setStep(2);
      return;
    }

    localSubmissionStarted.current = true;

    const locality = values.locality.trim();
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
        locality,
        detailDescription,
      },
      filesCheck.data,
      locale
    );

    try {
      const result = await api.sendLocalTestSubmission(formData);
      navigate('/result', {
        state: {
          success: true,
          message: 'Request received by the local test endpoint only; it was not sent to AUSEMIO.',
          status: result.status,
          locale,
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : messages.form.submitFailed;
      setSubmitError(message);
      navigate('/result', {
        state: {
          success: false,
          errorCode:
            err && typeof err === 'object' && 'code' in err && typeof err.code === 'string'
              ? err.code
              : undefined,
          message,
          locale,
        },
      });
    }
  };

  if (!hasValidReportTarget) {
    return null;
  }

  const { form: t } = messages;
  const localityRegistration = register('locality');
  const detailRegistration = register('detailDescription');
  const locationBlockRegistration = register('locationBlock');
  const faultTypeRegistration = register('faultType');

  return (
    <section className={styles.section}>
      <header className={styles.pageHeader}>
        <h2 className={styles.heading}>{t.title}</h2>
        <p className={styles.stepIndicator}>{t.step(step, TOTAL_STEPS)}</p>
        {isCustomLocation && (
          <p className={styles.contextBanner}>
            {isDeviceLocation
              ? t.deviceTargetBanner
              : t.customLocationBanner}
          </p>
        )}
        {reportTarget?.kind === 'manual' && (
          <p className={styles.contextBanner}>
            {t.manualTargetBanner}
          </p>
        )}
        <p className={styles.testModeHint}>{t.testModeHint}</p>
        <p className={styles.localeHint}>
          {t.languageFieldLabel}
        </p>
      </header>

      <form className={styles.form} onSubmit={handleSubmit(onSubmit)} noValidate>
        {hasValidationErrors && (
          <p className={styles.errorSummary} role="alert" aria-live="assertive" aria-atomic="true">
            {t.errorSummary}
          </p>
        )}
        <Link to="/map" className={styles.backToMapLink}>
          ← {t.backToMap}
        </Link>

        {step === 1 && (
          <>
            <div className={styles.field}>
              <label htmlFor="locality">
                {t.streetLabel} *
              </label>
              <p className={styles.hint} id="locality-hint">{t.streetCustomHint}</p>
              <LocalityCombobox
                id="locality"
                value={localityValue}
                choices={AUSEMIO_VO_LOCALITIES}
                resetKey={reportTargetIdentity}
                placeholder={t.localityPlaceholder}
                noMatchesText={t.localityNoMatches}
                selectionHint={messages.validation.localityChooseCanonical}
                describedBy={errors.locality ? `locality-hint locality-error` : 'locality-hint'}
                invalid={Boolean(errors.locality)}
                onEdit={() => {
                  sourceTracker.markUser('locality');
                  clearErrors('locality');
                  setValue('locality', '', { shouldDirty: true, shouldValidate: false });
                }}
                onSelect={(value) => {
                  sourceTracker.markUser('locality');
                  clearErrors('locality');
                  setValue('locality', value, { shouldDirty: true, shouldTouch: true, shouldValidate: true });
                }}
              />
              <input type="hidden" {...localityRegistration} value={localityValue} />
              {errors.locality && (
                <span className={styles.error} id="locality-error">{errors.locality.message}</span>
              )}
            </div>

            <div className={styles.field}>
              <label htmlFor="detailDescription">{t.detailLabel}</label>
              {isCustomLocation && <p className={styles.hint}>{t.detailCustomHint}</p>}
              <textarea
                id="detailDescription"
                rows={3}
                aria-invalid={Boolean(errors.detailDescription)}
                aria-describedby={errors.detailDescription ? 'detailDescription-error' : undefined}
                {...detailRegistration}
                onChange={(event) => {
                  sourceTracker.markUser('detailDescription');
                  void detailRegistration.onChange(event);
                }}
              />
              {errors.detailDescription && (
                <span className={styles.error} id="detailDescription-error">{errors.detailDescription.message}</span>
              )}
            </div>

            <fieldset
              className={`${styles.fieldset} ${styles.radioFieldset}`}
              aria-invalid={Boolean(errors.locationBlock)}
              aria-describedby={errors.locationBlock ? 'locationBlock-error' : undefined}
            >
              <legend>{t.locationBlockLabel}</legend>
              <div className={styles.radioGroup}>
                {REPORT_LOCATION_BLOCK_CODES.map((code) => (
                  <label className={styles.radioOption} htmlFor={`locationBlock-${code}`} key={code}>
                    <input
                      id={`locationBlock-${code}`}
                      type="radio"
                      value={code}
                      aria-invalid={Boolean(errors.locationBlock)}
                      {...locationBlockRegistration}
                    />
                    <span>{messages.locationBlocks[code]}</span>
                  </label>
                ))}
              </div>
              {errors.locationBlock && (
                <span className={styles.error} id="locationBlock-error">{errors.locationBlock.message}</span>
              )}
            </fieldset>

            <fieldset
              className={`${styles.fieldset} ${styles.radioFieldset}`}
              aria-invalid={Boolean(errors.faultType)}
              aria-describedby={errors.faultType ? 'faultType-error' : undefined}
            >
              <legend>{t.faultTypeLabel}</legend>
              <div className={styles.radioGroup}>
                {REPORT_FAULT_TYPE_CODES.map((code) => (
                  <label className={styles.radioOption} htmlFor={`faultType-${code}`} key={code}>
                    <input
                      id={`faultType-${code}`}
                      type="radio"
                      value={code}
                      aria-invalid={Boolean(errors.faultType)}
                      {...faultTypeRegistration}
                      onChange={(event) => {
                        const previousFault = getValues('faultType');
                        const nextFault = event.currentTarget.value;
                        void faultTypeRegistration.onChange(event);
                        if (shouldClearOtherFaultOnTypeChange(previousFault, nextFault)) {
                          setValue('otherFaultText', '', { shouldDirty: true, shouldValidate: false });
                        }
                      }}
                    />
                    <span>{messages.faultTypes[code]}</span>
                  </label>
                ))}
              </div>
              {errors.faultType && (
                <span className={styles.error} id="faultType-error">{errors.faultType.message}</span>
              )}
            </fieldset>

            {shouldShowOtherFault(faultType) && (
              <div className={styles.field}>
                <label htmlFor="otherFaultText">{t.otherFaultLabel}</label>
                <textarea
                  id="otherFaultText"
                  rows={3}
                  aria-invalid={Boolean(errors.otherFaultText)}
                  aria-describedby={errors.otherFaultText ? 'otherFaultText-error' : undefined}
                  {...register('otherFaultText')}
                />
                {errors.otherFaultText && (
                  <span className={styles.error} id="otherFaultText-error">{errors.otherFaultText.message}</span>
                )}
              </div>
            )}

            <div className={styles.field}>
              <label htmlFor="phone">{t.phoneLabel} *</label>
              <input
                id="phone"
                type="tel"
                aria-required="true"
                aria-invalid={Boolean(errors.phone)}
                autoComplete="tel"
                inputMode="tel"
                maxLength={16}
                aria-describedby={[errors.phone ? 'phone-error' : '', 'phone-hint'].filter(Boolean).join(' ')}
                {...register('phone')}
              />
              <p className={styles.hint} id="phone-hint">{t.phoneHint}</p>
              {errors.phone && <span className={styles.error} id="phone-error">{errors.phone.message}</span>}
            </div>

            {isCustomLocation && customLatitude != null && customLongitude != null && (
              <div className={styles.addressSuggestion}>
                <p className={styles.hint}>
                  {t.addressCoordinates}:{' '}
                  <span className={styles.coordinates}>
                    {customLatitude.toFixed(6)}, {customLongitude.toFixed(6)}
                  </span>
                </p>
                <div className={styles.addressSuggestionActions}>
                  <button
                    type="button"
                    className={styles.buttonSecondary}
                    onClick={() => void requestAddressSuggestion()}
                    disabled={addressSuggestionLoading}
                  >
                    {addressSuggestionLoading ? t.addressSuggestionLoading : t.addressSuggestionButton}
                  </button>
                  <button
                    type="button"
                    className={styles.buttonSecondary}
                    onClick={() => void copySelectedCoordinates()}
                  >
                    {t.copyCoordinates}
                  </button>
                </div>
                {addressSuggestionStatus && <p role="status" className={styles.hint}>{addressSuggestionStatus}</p>}
                {coordinateCopyStatus && <p role="status" className={styles.hint}>{coordinateCopyStatus}</p>}
              </div>
            )}
          </>
        )}

        {step === 2 && (
          <>
            <fieldset className={styles.fieldset}>
              <legend>{t.contactLegend}</legend>

              <div className={styles.field}>
                <label htmlFor="email">{t.emailLabel} *</label>
                <input
                  id="email"
                  type="email"
                  aria-required="true"
                  aria-invalid={Boolean(errors.email)}
                  aria-describedby={errors.email ? 'email-error' : undefined}
                  autoComplete="email"
                  {...register('email')}
                />
                {errors.email && <span className={styles.error} id="email-error">{errors.email.message}</span>}
              </div>
            </fieldset>

            <div className={styles.consentBlock}>
              <label className={styles.consentLabel}>
                <input
                  id="consent"
                  type="checkbox"
                  aria-invalid={Boolean(errors.consent)}
                  aria-describedby={errors.consent ? 'consent-error' : undefined}
                  {...register('consent')}
                />
                <span>{t.consentCheckbox}</span>
              </label>
              <p className={styles.consentLinks}>
                <a
                  href={KOSICE_PRIVACY_POLICY_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={styles.consentLink}
                >
                  {t.consentPrivacyLink}
                </a>
              </p>
              <p className={styles.consentNotice}>
                {t.consentDataNoticeBefore}
                <a
                  href={AUSEMIO_INFO_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={styles.consentLink}
                >
                  {t.consentDataNoticeLinkLabel}
                </a>
                {t.consentDataNoticeAfter}
              </p>
              {errors.consent && <span className={styles.error} id="consent-error">{errors.consent.message}</span>}
            </div>

            {/* Local product control; its placement is not an AUSEMIO contract claim. */}
            <div className={styles.field}>
              <label htmlFor="files">{t.attachmentsLabel}</label>
              <input
                key={fileInputKey}
                id="files"
                type="file"
                multiple
                aria-invalid={Boolean(fileError)}
                aria-describedby={fileError ? 'files-error' : undefined}
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
              {fileError && <span className={styles.error} id="files-error">{fileError}</span>}
            </div>
          </>
        )}

        {submitError && <p className={styles.error} role="alert">{submitError}</p>}

        <div className={styles.formFooter} data-testid="report-form-footer">
          <ReportFormLocaleSwitch compact />

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
        </div>
      </form>
    </section>
  );
}
