import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import {
  api,
  EmailVerificationApiError,
  LocalTestEndpointError,
  LocalTestTransportUnavailableError,
} from '@/services/api';
import {
  isRecoverableAddressEnrichmentFailure,
  isReportTargetValidationFailure,
  suggestReportAddress,
} from '@/services/geocodingApi';
import { getLightPoint } from '@/services/lightPointsApi';
import { buildReportFormData } from '@/utils/buildReportFormData';
import {
  buildInventoryDetailLine,
} from '@/utils/inventoryDetailLine';
import {
  type ReportTarget,
  readReportTarget,
} from '@/utils/reportNavigationTarget';
import {
  createReportFilesSchema,
  createReportFormSchema,
  createReportFormStep1Schema,
  shouldShowOtherFault,
  type ReportFormValues,
} from '@/schemas/reportSchema';
import {
  AutofillPrecedenceTracker,
  findUniqueLocalityInAddress,
} from '@/utils/autofillPrecedence';
import {
  INITIAL_REPORT_FORM_VALUES,
  getReportTargetIdentity,
  shouldClearOtherFaultOnTypeChange,
  transitionReportTarget,
} from '@/utils/reportTargetSession';
import {
  createReportDraftId,
  getReportDraftId,
  getReportDraftStep,
  readReportAttachments,
  readReportDraft,
  readReportVerification,
  removeReportAttachments,
  removeReportDraft,
  removeReportVerification,
  markReportAttachmentCleanupPending,
  clearReportAttachmentCleanupPending,
  saveReportAttachments,
  saveReportDraft,
  saveReportVerification,
  REPORT_SUBMISSION_RECEIPT_TTL_MS,
  type PreparedReportSubmission,
} from '@/utils/reportDraftStorage';
import styles from './ReportFormPage.module.css';

interface InventoryAddressResolution {
  lightPointId: number;
  address: string;
  locality: string | null;
  source: 'inventory' | 'geocoder';
}

function reportTargetIdentityFor(target: ReportTarget | null): string | null {
  if (!target) return null;
  if (target.kind === 'light-point') return getReportTargetIdentity(target.lightPointId, null, null);
  if (target.kind === 'manual') return getReportTargetIdentity(null, null, null, 'manual');
  return getReportTargetIdentity(null, target.latitude, target.longitude, target.kind);
}

export function ReportFormPage() {
  return <ReportFormPageContent />;
}

function ReportFormPageContent() {
  const navigate = useNavigate();
  const routeLocation = useLocation();
  const { locale, messages } = useReportFormLocale();
  const localeRef = useRef(locale);
  localeRef.current = locale;
  const { form: t } = messages;
  const routeDraftId = useMemo(() => getReportDraftId(routeLocation.search), [routeLocation.search]);
  const storedDraft = useMemo(() => readReportDraft(routeDraftId), [routeDraftId]);
  const [step, setStep] = useState<1 | 2 | 3>(
    () => getReportDraftStep(routeLocation.search) ?? storedDraft?.step ?? 1
  );
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submissionPending, setSubmissionPending] = useState(() => storedDraft?.submissionPending ?? false);
  const [submissionPendingSince, setSubmissionPendingSince] = useState<number | null>(
    () => storedDraft?.submissionPendingSince ?? null
  );
  const [submissionRetryClockNow, setSubmissionRetryClockNow] = useState(() => Date.now());
  const submissionRetryBlocked = storedDraft?.submissionRetryBlocked ?? false;
  const submissionRetryUnavailable = submissionPending && (
    submissionRetryBlocked || submissionPendingSince === null ||
    submissionRetryClockNow < submissionPendingSince ||
    submissionRetryClockNow >= submissionPendingSince + REPORT_SUBMISSION_RECEIPT_TTL_MS
  );
  const [preparedSubmission, setPreparedSubmission] = useState<PreparedReportSubmission | null>(
    () => storedDraft?.preparedSubmission ?? null
  );
  const [fileError, setFileError] = useState<string | null>(null);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [fileInputKey, setFileInputKey] = useState(0);
  const [attachmentsRestoredDraftId, setAttachmentsRestoredDraftId] = useState<string | null>(null);
  const [attachmentRestoreFailed, setAttachmentRestoreFailed] = useState(false);
  const [attachmentStorageFailed, setAttachmentStorageFailed] = useState(false);
  const [attachmentSaving, setAttachmentSaving] = useState(false);
  const [attachmentCount, setAttachmentCount] = useState(storedDraft?.attachmentCount ?? 0);
  const attachmentCountRef = useRef(attachmentCount);
  attachmentCountRef.current = attachmentCount;
  const [draftStorageFailed, setDraftStorageFailed] = useState(false);
  const [locationLoading, setLocationLoading] = useState(true);
  const [inventoryAddress, setInventoryAddress] = useState<InventoryAddressResolution | null>(null);
  const [inventoryAddressLookupFailed, setInventoryAddressLookupFailed] = useState(false);
  const [isInventoryLocalityEditing, setIsInventoryLocalityEditing] = useState(false);
  const inventoryAddressCache = useRef(new Map<number, InventoryAddressResolution>());
  const inventoryAddressLookupAttempted = useRef(new Set<number>());
  const [inventoryPointData, setInventoryPointData] = useState<{
    lightPointId: number;
    inventoryNumber: string | null;
  } | null>(null);
  const [coordinateCopyStatus, setCoordinateCopyStatus] = useState('');
  const [emailVerificationEnabled, setEmailVerificationEnabled] = useState<boolean | null>(null);
  const [emailVerificationStatusFailed, setEmailVerificationStatusFailed] = useState(false);
  const [verificationIntentId, setVerificationIntentId] = useState<string | null>(null);
  const [verificationEmail, setVerificationEmail] = useState('');
  const [verificationCode, setVerificationCode] = useState('');
  const [verificationToken, setVerificationToken] = useState<string | null>(null);
  const [verificationBusy, setVerificationBusy] = useState<'idle' | 'requesting' | 'verifying'>('idle');
  const [verificationError, setVerificationError] = useState<string | null>(null);
  const [verificationExpiresAt, setVerificationExpiresAt] = useState<number | null>(null);
  const [verificationRetryAt, setVerificationRetryAt] = useState<number | null>(null);
  const [verificationRestoredDraftId, setVerificationRestoredDraftId] = useState<string | null>(null);
  // Wall-clock deadlines continue to advance while a mobile device is asleep.
  // The API remains authoritative if the user's clock changes during the flow.
  const [verificationClockNow, setVerificationClockNow] = useState(() => Date.now());
  const pendingFocusField = useRef<string | null>(null);
  const localSubmissionStarted = useRef(false);
  const draftCreationIdentity = useRef<string | null>(null);
  const currentDraftId = useRef(routeDraftId);
  const attachmentSaveSequence = useRef(0);
  const attachmentPersistenceQueue = useRef<Promise<void>>(Promise.resolve());
  const verificationRequestSequence = useRef(0);
  const autofillSources = useRef<
    AutofillPrecedenceTracker<'locality' | 'detailDescription'> | null
  >(null);
  if (!autofillSources.current) {
    const tracker = new AutofillPrecedenceTracker<'locality' | 'detailDescription'>();
    if (storedDraft?.userEditedFields.includes('locality')) tracker.markUser('locality');
    if (storedDraft?.userEditedFields.includes('detailDescription')) tracker.markUser('detailDescription');
    autofillSources.current = tracker;
  }

  const reportFormSchema = useMemo(() => createReportFormSchema(messages), [messages]);
  const reportFormStep1Schema = useMemo(
    () => createReportFormStep1Schema(messages),
    [messages]
  );
  const reportFilesSchema = useMemo(() => createReportFilesSchema(messages), [messages]);
  const resolver = useMemo(() => zodResolver(reportFormSchema), [reportFormSchema]);

  const reportTarget = useMemo(
    () => readReportTarget(routeLocation.state) ?? storedDraft?.target ?? null,
    [routeLocation.state, storedDraft]
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
  const previousReportTargetIdentity = useRef(reportTargetIdentity);

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    setError,
    clearErrors,
    getValues,
    trigger,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<ReportFormValues>({
    resolver,
    defaultValues: storedDraft?.formValues ?? { ...INITIAL_REPORT_FORM_VALUES },
    shouldFocusError: true,
  });

  const hasValidationErrors = Object.keys(errors).length > 0 || Boolean(fileError);
  const watchedFormValues = watch();
  const watchedFormValuesJson = JSON.stringify(watchedFormValues);
  const faultType = watchedFormValues.faultType;
  const consent = watchedFormValues.consent;
  const localityValue = watchedFormValues.locality ?? '';
  const phoneValue = watchedFormValues.phone ?? '';
  const currentEmail = watchedFormValues.email ?? '';
  const normalizedCurrentEmail = currentEmail.trim().toLowerCase();
  const verificationExpiresIn = verificationExpiresAt === null
    ? null
    : Math.max(0, Math.ceil((verificationExpiresAt - verificationClockNow) / 1000));
  const verificationRetryAfter = verificationRetryAt === null
    ? 0
    : Math.max(0, Math.ceil((verificationRetryAt - verificationClockNow) / 1000));
  const hasCurrentEmailVerification = Boolean(
    verificationToken &&
    verificationIntentId &&
    verificationEmail === normalizedCurrentEmail &&
    verificationExpiresAt !== null &&
    verificationExpiresAt > Date.now()
  );
  const totalSteps = emailVerificationEnabled ? 3 : 2;
  const attachmentsReady = !attachmentSaving && (!routeDraftId || attachmentsRestoredDraftId === routeDraftId);
  const sourceTracker = autofillSources.current;
  const inventoryLocalityResolved = Boolean(
    selectedLightPointId != null &&
    inventoryAddress?.lightPointId === selectedLightPointId &&
    inventoryAddress.locality &&
    inventoryAddress.locality === localityValue &&
    !isInventoryLocalityEditing &&
    sourceTracker.sourceOf('locality') !== 'user'
  );

  const resetEmailVerification = useCallback(() => {
    verificationRequestSequence.current += 1;
    setVerificationIntentId(null);
    setVerificationEmail('');
    setVerificationCode('');
    setVerificationToken(null);
    setVerificationBusy('idle');
    setVerificationError(null);
    setVerificationExpiresAt(null);
    setVerificationRetryAt(null);
    removeReportVerification(routeDraftId);
  }, [routeDraftId]);

  const handleEmailChange = (nextEmail: string) => {
    const nextNormalized = nextEmail.trim().toLowerCase();
    const hasVerificationState = Boolean(
      verificationEmail || verificationIntentId || verificationToken || verificationRetryAt || verificationBusy !== 'idle'
    );
    if (nextNormalized !== normalizedCurrentEmail && hasVerificationState) {
      resetEmailVerification();
      setStep((current) => current === 3 ? 2 : current);
    }
  };

  useEffect(() => {
    const field = pendingFocusField.current;
    if (!field) return;
    const control = document.getElementById(field) ??
      document.querySelector<HTMLElement>(`[name="${field}"]`);
    if (control instanceof HTMLElement) control.focus();
    pendingFocusField.current = null;
  }, [errors, fileError, step]);

  useEffect(() => {
    clearErrors();
  }, [locale, clearErrors]);

  useEffect(() => {
    let cancelled = false;
    api.getEmailVerificationStatus()
      .then((status) => {
        if (!cancelled) setEmailVerificationEnabled(status.enabled);
      })
      .catch(() => {
        if (!cancelled) setEmailVerificationStatusFailed(true);
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (verificationExpiresAt === null && verificationRetryAt === null) return;
    const refreshClock = () => setVerificationClockNow(Date.now());
    const timer = window.setInterval(refreshClock, 1000);
    window.addEventListener('focus', refreshClock);
    document.addEventListener('visibilitychange', refreshClock);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', refreshClock);
      document.removeEventListener('visibilitychange', refreshClock);
    };
  }, [verificationExpiresAt, verificationRetryAt]);

  useEffect(() => {
    if (verificationExpiresIn !== 0 || !verificationToken) return;
    setVerificationToken(null);
    setVerificationError(t.emailVerificationExpired);
    setStep(2);
  }, [verificationExpiresIn, verificationToken, t.emailVerificationExpired]);

  useEffect(() => {
    const previousIdentity = previousReportTargetIdentity.current;
    previousReportTargetIdentity.current = reportTargetIdentity;

    const changed = transitionReportTarget(
      previousIdentity,
      reportTargetIdentity,
      sourceTracker,
      reset
    );
    if (changed && currentDraftId.current) {
      const previousDraftId = currentDraftId.current;
      removeReportDraft(previousDraftId);
      removeReportVerification(previousDraftId);
      const cleanup = attachmentPersistenceQueue.current
        .catch(() => undefined)
        .then(() => removeReportAttachments(previousDraftId))
        .catch(() => undefined);
      attachmentPersistenceQueue.current = cleanup;
    }
    currentDraftId.current = routeDraftId;
    if (!changed) return;

    draftCreationIdentity.current = null;
    attachmentSaveSequence.current += 1;
    attachmentCountRef.current = 0;
    setCoordinateCopyStatus('');

    setSelectedFiles([]);
    setAttachmentCount(0);
    setFileInputKey((key) => key + 1);
    setAttachmentsRestoredDraftId(null);
    setAttachmentRestoreFailed(false);
    setAttachmentStorageFailed(false);
    setAttachmentSaving(false);
    setSubmitError(null);
    setFileError(null);
    setSubmissionPending(false);
    setSubmissionPendingSince(null);
    setPreparedSubmission(null);
    clearErrors();
    resetEmailVerification();
    localSubmissionStarted.current = false;
    setStep(1);
    setLocationLoading(selectedLightPointId != null);
  }, [reportTargetIdentity, sourceTracker, reset, clearErrors, isCustomLocation, selectedLightPointId, resetEmailVerification]);

  useEffect(() => {
    if (!submissionPending) return;
    let disposed = false;
    let deadlineTimer: number | undefined;
    const refreshClock = () => {
      if (!disposed) setSubmissionRetryClockNow(Date.now());
    };
    const retryDeadline = submissionPendingSince === null
      ? Date.now()
      : submissionPendingSince + REPORT_SUBMISSION_RECEIPT_TTL_MS;
    const scheduleDeadlineRefresh = () => {
      const remaining = retryDeadline - Date.now();
      if (remaining <= 0) {
        refreshClock();
        return;
      }
      // Browser timers clamp delays above 2^31-1 ms to an immediate callback.
      deadlineTimer = window.setTimeout(() => {
        refreshClock();
        if (!disposed && Date.now() < retryDeadline) scheduleDeadlineRefresh();
      }, Math.min(remaining, 2_147_000_000));
    };
    refreshClock();
    scheduleDeadlineRefresh();
    window.addEventListener('focus', refreshClock);
    document.addEventListener('visibilitychange', refreshClock);
    return () => {
      disposed = true;
      if (deadlineTimer !== undefined) window.clearTimeout(deadlineTimer);
      window.removeEventListener('focus', refreshClock);
      document.removeEventListener('visibilitychange', refreshClock);
    };
  }, [submissionPending, submissionPendingSince]);

  useEffect(() => {
    if (!hasValidReportTarget || routeDraftId) return;
    if (draftCreationIdentity.current === reportTargetIdentity) return;
    draftCreationIdentity.current = reportTargetIdentity;
    let draftId: string;
    try {
      draftId = createReportDraftId();
    } catch {
      setDraftStorageFailed(true);
      return;
    }
    const saved = saveReportDraft(draftId, {
      target: reportTarget!,
      formValues: getValues(),
      step,
      attachmentCount: attachmentCountRef.current,
      submissionPending,
      submissionPendingSince,
      submissionRetryBlocked,
      preparedSubmission,
      userEditedFields: (['locality', 'detailDescription'] as const).filter(
        (field) => sourceTracker.sourceOf(field) === 'user'
      ),
    });
    setDraftStorageFailed(!saved);
    const query = new URLSearchParams();
    query.set('draft', draftId);
    query.set('step', String(step));
    navigate({ pathname: routeLocation.pathname, search: `?${query.toString()}` }, {
      replace: true,
      state: routeLocation.state,
    });
  }, [hasValidReportTarget, routeDraftId, reportTargetIdentity, reportTarget, getValues, step, attachmentCount, submissionPending, submissionPendingSince, submissionRetryBlocked, preparedSubmission, sourceTracker, navigate, routeLocation.pathname, routeLocation.state]);

  useEffect(() => {
    if (!routeDraftId || !hasValidReportTarget) return;
    const params = new URLSearchParams(routeLocation.search);
    if (params.get('draft') === routeDraftId && params.get('step') === String(step)) return;
    params.set('draft', routeDraftId);
    params.set('step', String(step));
    navigate({ pathname: routeLocation.pathname, search: `?${params.toString()}` }, {
      replace: true,
      state: routeLocation.state,
    });
  }, [step, routeDraftId, hasValidReportTarget, routeLocation.pathname, routeLocation.search, routeLocation.state, navigate]);

  useEffect(() => {
    if (!routeDraftId || !hasValidReportTarget) return;
    const values = JSON.parse(watchedFormValuesJson) as ReportFormValues;
    const saved = saveReportDraft(routeDraftId, {
      target: reportTarget!,
      formValues: values,
      step,
      attachmentCount: attachmentCountRef.current,
      submissionPending,
      submissionPendingSince,
      submissionRetryBlocked,
      preparedSubmission,
      userEditedFields: (['locality', 'detailDescription'] as const).filter(
        (field) => sourceTracker.sourceOf(field) === 'user'
      ),
    });
    setDraftStorageFailed(!saved);
  }, [routeDraftId, hasValidReportTarget, reportTarget, watchedFormValuesJson, step, attachmentCount, submissionPending, submissionPendingSince, submissionRetryBlocked, preparedSubmission, sourceTracker]);

  useEffect(() => {
    if (!routeDraftId) {
      setVerificationRestoredDraftId(null);
      return;
    }
    const saved = readReportVerification(routeDraftId);
    if (saved && saved.email === getValues('email').trim().toLowerCase()) {
      setVerificationIntentId(saved.intentId);
      setVerificationEmail(saved.email);
      setVerificationExpiresAt(saved.expiresAt);
      setVerificationRetryAt(saved.retryAt);
      setVerificationToken(saved.verificationToken);
      setVerificationClockNow(Date.now());
    } else {
      removeReportVerification(routeDraftId);
    }
    setVerificationRestoredDraftId(routeDraftId);
  }, [routeDraftId, getValues]);

  useEffect(() => {
    if (!routeDraftId || verificationRestoredDraftId !== routeDraftId) return;
    const hasPendingVerification = Boolean(
      verificationIntentId && verificationEmail && verificationExpiresAt !== null
    );
    saveReportVerification(routeDraftId, hasPendingVerification ? {
      intentId: verificationIntentId!,
      email: verificationEmail,
      expiresAt: verificationExpiresAt!,
      retryAt: verificationRetryAt,
      verificationToken,
    } : null);
  }, [routeDraftId, verificationRestoredDraftId, verificationIntentId, verificationEmail, verificationExpiresAt, verificationRetryAt, verificationToken]);

  useEffect(() => {
    if (!routeDraftId || !hasValidReportTarget) {
      setAttachmentsRestoredDraftId(null);
      return;
    }
    const draft = readReportDraft(routeDraftId);
    if (!draft || reportTargetIdentityFor(draft.target) !== reportTargetIdentity || draft.attachmentCount === 0) {
      setSelectedFiles([]);
      setAttachmentRestoreFailed(false);
      setAttachmentsRestoredDraftId(routeDraftId);
      return;
    }
    let cancelled = false;
    setAttachmentsRestoredDraftId(null);
    setAttachmentRestoreFailed(false);
    const restore = attachmentPersistenceQueue.current
      .catch(() => undefined)
      .then(() => readReportAttachments(routeDraftId));
    restore.then((files) => {
      if (cancelled) return;
      setSelectedFiles(files);
      if (files.length !== draft.attachmentCount) {
        setAttachmentRestoreFailed(true);
        setFileError(t.attachmentsRestoreFailed);
      }
      setAttachmentsRestoredDraftId(routeDraftId);
    }).catch(() => {
      if (cancelled) return;
      setAttachmentRestoreFailed(true);
      setFileError(t.attachmentsRestoreFailed);
      setAttachmentsRestoredDraftId(routeDraftId);
    });
    return () => { cancelled = true; };
  }, [routeDraftId, reportTargetIdentity, hasValidReportTarget, t.attachmentsRestoreFailed]);

  useEffect(() => {
    if (!routeDraftId || verificationRestoredDraftId !== routeDraftId || emailVerificationEnabled === null || submissionPending) return;
    if (!emailVerificationEnabled && step === 3) setStep(2);
    else if (emailVerificationEnabled && step === 3 && !hasCurrentEmailVerification) setStep(2);
  }, [routeDraftId, verificationRestoredDraftId, emailVerificationEnabled, step, hasCurrentEmailVerification, submissionPending]);

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
      setInventoryAddress(null);
      setInventoryAddressLookupFailed(false);
      setIsInventoryLocalityEditing(false);
      setInventoryPointData(null);
      return;
    }

    let cancelled = false;
    const controller = new AbortController();

    setLocationLoading(true);
    setInventoryAddress(null);
    setInventoryAddressLookupFailed(false);
    setIsInventoryLocalityEditing(false);

    getLightPoint(selectedLightPointId)
      .then(async (point) => {
        if (cancelled) return;

        let address = point.address?.trim() ?? '';
        let source: InventoryAddressResolution['source'] = 'inventory';
        if (!address) {
          const cached = inventoryAddressCache.current.get(selectedLightPointId);
          if (cached) {
            address = cached.address;
            source = cached.source;
          } else if (!inventoryAddressLookupAttempted.current.has(selectedLightPointId)) {
            source = 'geocoder';
            inventoryAddressLookupAttempted.current.add(selectedLightPointId);
            try {
              const suggestion = await suggestReportAddress({
                targetKind: 'light-point',
                lightPointId: selectedLightPointId,
                language: localeRef.current,
              }, controller.signal);
              address = suggestion?.address ?? '';
            } catch {
              if (cancelled) {
                inventoryAddressLookupAttempted.current.delete(selectedLightPointId);
                return;
              }
              setInventoryAddressLookupFailed(true);
            }
          } else {
            setInventoryAddressLookupFailed(true);
          }
        }
        if (cancelled) return;

        const locality = address
          ? findUniqueLocalityInAddress(address, AUSEMIO_VO_LOCALITIES)
          : undefined;
        const resolution: InventoryAddressResolution = {
          lightPointId: selectedLightPointId,
          address,
          locality: locality?.value ?? null,
          source,
        };
        inventoryAddressCache.current.set(selectedLightPointId, resolution);
        setInventoryAddress(resolution);
        setInventoryPointData({
          lightPointId: selectedLightPointId,
          inventoryNumber: point.inventory_number?.trim() || null,
        });
        if (sourceTracker.canAutofill('locality')) {
          if (locality || sourceTracker.sourceOf('locality') === 'auto') {
            setValue('locality', locality?.value ?? '', { shouldValidate: true });
            sourceTracker.markAuto('locality');
          }
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
      controller.abort();
      if (!inventoryAddressCache.current.has(selectedLightPointId)) {
        inventoryAddressLookupAttempted.current.delete(selectedLightPointId);
      }
    };
  }, [selectedLightPointId, setValue, sourceTracker]);

  useEffect(() => {
    if (selectedLightPointId == null) {
      if (sourceTracker.sourceOf('detailDescription') === 'auto') setValue('detailDescription', '');
      return;
    }
    if (inventoryPointData?.lightPointId !== selectedLightPointId) return;
    if (inventoryPointData.inventoryNumber && sourceTracker.canAutofill('detailDescription')) {
      setValue('detailDescription', buildInventoryDetailLine(locale, inventoryPointData.inventoryNumber));
      sourceTracker.markAuto('detailDescription');
    } else if (!inventoryPointData.inventoryNumber && sourceTracker.sourceOf('detailDescription') === 'auto') {
      setValue('detailDescription', '');
    }
  }, [inventoryPointData, locale, selectedLightPointId, setValue, sourceTracker]);

  const persistAttachmentSelection = (files: File[]) => {
    setSelectedFiles(files);
    setAttachmentRestoreFailed(false);
    setAttachmentStorageFailed(false);
    if (!routeDraftId) {
      attachmentCountRef.current = files.length;
      setAttachmentCount(files.length);
      return;
    }
    const sequence = attachmentSaveSequence.current + 1;
    attachmentSaveSequence.current = sequence;
    setAttachmentSaving(true);
    const save = attachmentPersistenceQueue.current
      .catch(() => undefined)
      .then(async () => {
        if (attachmentSaveSequence.current !== sequence) return;
        await saveReportAttachments(routeDraftId, files);
        if (attachmentSaveSequence.current !== sequence) return;
        const saved = saveReportDraft(routeDraftId, {
          target: reportTarget!,
          formValues: getValues(),
          step,
          attachmentCount: files.length,
          submissionPending,
          submissionPendingSince,
          submissionRetryBlocked,
          preparedSubmission,
          userEditedFields: (['locality', 'detailDescription'] as const).filter(
            (field) => sourceTracker.sourceOf(field) === 'user'
          ),
        });
        setDraftStorageFailed(!saved);
        attachmentCountRef.current = files.length;
        setAttachmentCount(files.length);
      });
    attachmentPersistenceQueue.current = save.catch(() => undefined);
    void save.catch(() => {
      if (attachmentSaveSequence.current === sequence) {
        setAttachmentStorageFailed(true);
        attachmentCountRef.current = files.length;
        setAttachmentCount(files.length);
      }
    }).finally(() => {
      if (attachmentSaveSequence.current === sequence) setAttachmentSaving(false);
    });
  };

  const handleFilesChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setFileError(null);
    const list = event.target.files ? Array.from(event.target.files) : [];
    const parsed = reportFilesSchema.safeParse(list);

    if (!parsed.success) {
      persistAttachmentSelection([]);
      event.target.value = '';
      pendingFocusField.current = 'files';
      setFileError(parsed.error.issues[0]?.message ?? messages.validation.invalidFile);
      return;
    }

    persistAttachmentSelection(parsed.data);
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
    setStep((current) => current === 3 ? 2 : 1);
  };

  const continueToReview = () => {
    const now = Date.now();
    const currentEmail = getValues('email').trim().toLowerCase();
    if (!verificationIntentId || !verificationToken || verificationEmail !== currentEmail || verificationExpiresAt === null) return;
    if (verificationExpiresAt <= now) {
      setVerificationClockNow(now);
      setVerificationToken(null);
      setVerificationError(t.emailVerificationExpired);
      return;
    }
    setSubmitError(null);
    setVerificationError(null);
    setStep(3);
  };

  const verificationErrorMessage = (error: unknown): string => {
    if (!(error instanceof EmailVerificationApiError)) return t.emailVerificationGenericError;
    if (error.retryAfterSeconds) {
      const now = Date.now();
      setVerificationClockNow(now);
      setVerificationRetryAt(now + error.retryAfterSeconds * 1000);
    }
    if (error.code === 'EMAIL_VERIFICATION_INVALID_EMAIL') return messages.validation.invalidEmail;
    if (error.code === 'EMAIL_VERIFICATION_INVALID_CODE' || error.code === 'EMAIL_VERIFICATION_ALREADY_USED') {
      return t.emailVerificationCodeInvalid;
    }
    if (error.code === 'EMAIL_VERIFICATION_EXPIRED') return t.emailVerificationExpired;
    if (error.code === 'EMAIL_VERIFICATION_RATE_LIMITED' ||
      error.code === 'EMAIL_VERIFICATION_ATTEMPTS_EXHAUSTED' ||
      error.code === 'EMAIL_VERIFICATION_SEND_LIMIT' ||
      error.code === 'EMAIL_VERIFICATION_RESEND_COOLDOWN') return t.emailVerificationRateLimited;
    return t.emailVerificationGenericError;
  };

  const requestEmailCode = async (resend: boolean) => {
    if (emailVerificationEnabled !== true || verificationBusy !== 'idle' || verificationRetryAfter > 0) return;
    if (!await trigger('email')) return;
    const email = getValues('email').trim().toLowerCase();
    const intentId = resend && verificationExpiresIn !== 0 ? verificationIntentId ?? undefined : undefined;
    const sequence = verificationRequestSequence.current + 1;
    verificationRequestSequence.current = sequence;
    setVerificationBusy('requesting');
    setVerificationError(null);
    try {
      const result = await api.requestEmailVerificationCode(email, locale, intentId ?? undefined);
      if (verificationRequestSequence.current !== sequence || getValues('email').trim().toLowerCase() !== email) return;
      setVerificationIntentId(result.intentId);
      setVerificationEmail(email);
      setVerificationCode('');
      setVerificationToken(null);
      const now = Date.now();
      setVerificationClockNow(now);
      setVerificationExpiresAt(now + result.expiresInSeconds * 1000);
      setVerificationRetryAt(result.retryAfterSeconds > 0
        ? now + result.retryAfterSeconds * 1000
        : null);
      setVerificationError(null);
    } catch (error) {
      if (verificationRequestSequence.current !== sequence) return;
      const message = verificationErrorMessage(error);
      if (error instanceof EmailVerificationApiError && [
        'EMAIL_VERIFICATION_DELIVERY_UNAVAILABLE',
        'EMAIL_VERIFICATION_EXPIRED',
        'EMAIL_VERIFICATION_NOT_FOUND',
        'EMAIL_VERIFICATION_SEND_LIMIT',
      ].includes(error.code)) {
        resetEmailVerification();
      }
      setVerificationError(message);
    } finally {
      if (verificationRequestSequence.current === sequence) setVerificationBusy('idle');
    }
  };

  const verifyEmailCode = async () => {
    if (emailVerificationEnabled !== true || !verificationIntentId || verificationBusy !== 'idle') return;
    if (!/^\d{6}$/.test(verificationCode)) {
      setVerificationError(t.emailVerificationCodeInvalid);
      return;
    }
    const email = getValues('email').trim().toLowerCase();
    const sequence = verificationRequestSequence.current + 1;
    verificationRequestSequence.current = sequence;
    setVerificationBusy('verifying');
    setVerificationError(null);
    try {
      const result = await api.verifyEmailCode(verificationIntentId, email, verificationCode);
      if (verificationRequestSequence.current !== sequence || getValues('email').trim().toLowerCase() !== email) return;
      setVerificationEmail(email);
      setVerificationToken(result.verificationToken);
      const now = Date.now();
      setVerificationClockNow(now);
      setVerificationExpiresAt(now + result.expiresInSeconds * 1000);
      setVerificationError(null);
      setStep(3);
    } catch (error) {
      if (verificationRequestSequence.current !== sequence) return;
      const message = verificationErrorMessage(error);
      if (error instanceof EmailVerificationApiError && [
        'EMAIL_VERIFICATION_EXPIRED',
        'EMAIL_VERIFICATION_NOT_FOUND',
        'EMAIL_VERIFICATION_ATTEMPTS_EXHAUSTED',
      ].includes(error.code)) {
        resetEmailVerification();
      }
      setVerificationError(message);
    } finally {
      if (verificationRequestSequence.current === sequence) setVerificationBusy('idle');
    }
  };

  const persistSubmissionPending = (
    pending: boolean,
    formValues: ReportFormValues,
    draftStep: 1 | 2 | 3,
    prepared: PreparedReportSubmission | null = preparedSubmission
  ): boolean => {
    if (!routeDraftId || !reportTarget) return false;
    const pendingSince = pending ? submissionPendingSince ?? Date.now() : null;
    const saved = saveReportDraft(routeDraftId, {
      target: reportTarget,
      formValues,
      step: draftStep,
      attachmentCount: attachmentCountRef.current,
      submissionPending: pending,
      submissionPendingSince: pendingSince,
      submissionRetryBlocked: pending && submissionRetryBlocked,
      preparedSubmission: pending ? prepared : null,
      userEditedFields: (['locality', 'detailDescription'] as const).filter(
        (field) => sourceTracker.sourceOf(field) === 'user'
      ),
    });
    setDraftStorageFailed(!saved);
    if (saved) setSubmissionPendingSince(pendingSince);
    return saved;
  };

  const onSubmit = async (values: ReportFormValues) => {
    if (!hasValidReportTarget || !routeDraftId || (!submissionPending && step !== totalSteps) || localSubmissionStarted.current) {
      return;
    }
    const retryNow = Date.now();
    const retryWindowExpired = submissionPending && (
      submissionPendingSince === null || retryNow < submissionPendingSince ||
      retryNow >= submissionPendingSince + REPORT_SUBMISSION_RECEIPT_TTL_MS
    );
    if (submissionPending && (submissionRetryBlocked || retryWindowExpired)) {
      setSubmissionRetryClockNow(retryNow);
      return;
    }
    const restoredPreparedSubmission = submissionPending
      ? preparedSubmission ?? readReportDraft(routeDraftId)?.preparedSubmission ?? null
      : null;
    const submittedValues = restoredPreparedSubmission?.formValues ?? (submissionPending ? getValues() : values);

    if (!submissionPending && (emailVerificationEnabled === null || emailVerificationStatusFailed)) {
      setSubmitError(t.emailVerificationStatusUnavailable);
      return;
    }
    if (!submissionPending && emailVerificationEnabled && (!verificationIntentId || !verificationToken || verificationEmail !== submittedValues.email.trim().toLowerCase())) {
      setSubmitError(t.emailVerificationGenericError);
      setStep(2);
      return;
    }
    if (!submissionPending && emailVerificationEnabled && verificationExpiresAt !== null && verificationExpiresAt <= Date.now()) {
      setVerificationClockNow(Date.now());
      setVerificationToken(null);
      setSubmitError(t.emailVerificationExpired);
      setStep(2);
      return;
    }

    setSubmitError(null);
    setFileError(null);

    if (!attachmentsReady || attachmentRestoreFailed) {
      setFileError(t.attachmentsRestoreFailed);
      return;
    }

    const filesCheck = reportFilesSchema.safeParse(selectedFiles);
    if (!filesCheck.success) {
      pendingFocusField.current = 'files';
      setFileError(filesCheck.error.issues[0]?.message ?? messages.validation.invalidFile);
      setStep(2);
      return;
    }

    localSubmissionStarted.current = true;

    const locality = submittedValues.locality.trim();
    let generatedAddress: string | null = restoredPreparedSubmission?.automaticAddress ?? null;
    let generatedAddressProof: string | null = restoredPreparedSubmission?.automaticAddressProof ?? null;
    let addressEnrichmentStatus: 'unavailable' | 'not-found' | undefined = restoredPreparedSubmission?.addressEnrichmentStatus;

    if (!restoredPreparedSubmission && coordinateTarget && customLatitude != null && customLongitude != null) {
      try {
        const suggestion = await suggestReportAddress({
          latitude: customLatitude,
          longitude: customLongitude,
          targetKind: coordinateTarget.kind,
          language: locale,
        });
        generatedAddress = suggestion?.proof ? suggestion.address : null;
        generatedAddressProof = suggestion?.proof ?? null;
        if (!generatedAddress) addressEnrichmentStatus = 'not-found';
      } catch (error) {
        if (isRecoverableAddressEnrichmentFailure(error)) {
          addressEnrichmentStatus = 'unavailable';
        } else {
          setSubmitError(isReportTargetValidationFailure(error)
            ? t.locationValidationFailed
            : t.locationValidationUnavailable);
          localSubmissionStarted.current = false;
          return;
        }
      }
    }

    const submissionLocale = restoredPreparedSubmission?.locale ?? locale;
    const preparedValues: ReportFormValues = {
      ...submittedValues,
      locality: restoredPreparedSubmission?.formValues.locality ?? locality,
      detailDescription: submittedValues.detailDescription?.trim() ?? '',
    };
    const formData = buildReportFormData(
      preparedValues,
      filesCheck.data,
      submissionLocale,
      reportTarget!,
      routeDraftId
    );
    if (generatedAddress && generatedAddressProof && coordinateTarget) {
      formData.set('automaticAddress', generatedAddress);
      formData.set('automaticAddressProof', generatedAddressProof);
    }
    if (emailVerificationEnabled && verificationIntentId && verificationToken) {
      formData.set('emailVerificationIntentId', verificationIntentId);
      formData.set('emailVerificationToken', verificationToken);
    }

    const preparedForRetry: PreparedReportSubmission = {
      formValues: preparedValues,
      locale: submissionLocale,
      ...(generatedAddress && generatedAddressProof ? {
        automaticAddress: generatedAddress,
        automaticAddressProof: generatedAddressProof,
      } : {}),
      ...(addressEnrichmentStatus ? { addressEnrichmentStatus } : {}),
    };
    if (!persistSubmissionPending(true, submittedValues, step, preparedForRetry)) {
      localSubmissionStarted.current = false;
      setSubmitError(t.draftStorageFailed);
      return;
    }
    setPreparedSubmission(preparedForRetry);
    if (!submissionPending) setSubmissionPending(true);

    try {
      const result = await api.sendLocalTestSubmission(formData);
      const cleanupMarkerPersisted = markReportAttachmentCleanupPending(routeDraftId);
      let attachmentCleanupPending = false;
      try {
        await removeReportAttachments(routeDraftId);
        clearReportAttachmentCleanupPending(routeDraftId);
      } catch {
        attachmentCleanupPending = true;
      }
      const reportDraftRemoved = removeReportDraft(routeDraftId);
      removeReportVerification(routeDraftId);
      const attachmentCleanup = attachmentCleanupPending
        ? cleanupMarkerPersisted || reportDraftRemoved ? 'retryable' : 'manual'
        : undefined;
      navigate('/result', {
        replace: true,
        state: {
          success: true,
          message: 'Local metadata history was updated; nothing was sent to AUSEMIO.',
          status: result.status,
          alreadyRecorded: result.duplicate === true,
          addressEnrichmentStatus,
          attachmentCleanup,
          locale: submissionLocale,
        },
      });
    } catch (err) {
      if (err instanceof LocalTestEndpointError && err.code === 'EMAIL_VERIFICATION_REQUIRED') {
        persistSubmissionPending(false, getValues(), 2, null);
        setSubmissionPending(false);
        setPreparedSubmission(null);
        resetEmailVerification();
        setVerificationError(t.emailVerificationExpired);
        setStep(2);
        localSubmissionStarted.current = false;
        return;
      }
      if (emailVerificationEnabled && (
        err instanceof LocalTestTransportUnavailableError ||
        (err instanceof LocalTestEndpointError &&
          err.status === 503 &&
          err.code === 'LOCAL_TEST_SUBMISSION_UNAVAILABLE')
      )) {
        localSubmissionStarted.current = false;
        setSubmitError(t.emailVerificationGenericError);
        return;
      }
      if (err instanceof LocalTestEndpointError && err.status >= 400 && err.status < 500) {
        persistSubmissionPending(false, getValues(), step, null);
        setSubmissionPending(false);
        setPreparedSubmission(null);
      }
      localSubmissionStarted.current = false;
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

  const localityRegistration = register('locality');
  const detailRegistration = register('detailDescription');
  const locationBlockRegistration = register('locationBlock');
  const faultTypeRegistration = register('faultType');
  const phoneRegistration = register('phone');
  const emailRegistration = register('email');

  return (
    <section className={styles.section}>
      <header className={styles.pageHeader}>
        <h1 className={styles.heading}>{t.title}</h1>
        <p className={styles.stepIndicator}>{t.step(step, totalSteps)}</p>
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
        <p className={styles.hint} role="note">{t.draftStorageNotice}</p>
        {draftStorageFailed && <p className={styles.error} role="alert">{t.draftStorageFailed}</p>}
        <p className={styles.localeHint}>
          {t.languageFieldLabel}
        </p>
      </header>

      <form className={styles.form} onSubmit={handleSubmit(onSubmit)} noValidate>
        <fieldset className={styles.submissionFields} disabled={isSubmitting || submissionPending}>
        {hasValidationErrors && (
          <p className={styles.errorSummary} role="alert" aria-live="assertive" aria-atomic="true">
            {t.errorSummary}
          </p>
        )}
        {submissionPending ? (
          <p className={styles.backToMapLink} aria-disabled="true">← {t.backToMap}</p>
        ) : (
          <Link to="/map" className={styles.backToMapLink}>
            ← {t.backToMap}
          </Link>
        )}

        {step === 1 && (
          <>
            <div className={styles.field} data-testid="locality-field">
              {inventoryLocalityResolved ? (
                <p className={styles.readOnlyLabel}>{t.streetLabel} *</p>
              ) : (
                <label htmlFor="locality">{t.streetLabel} *</label>
              )}
              {selectedLightPointId == null && (
                <p className={styles.hint} id="locality-hint">{t.streetCustomHint}</p>
              )}
              {coordinateTarget && customLatitude != null && customLongitude != null && (
                <div className={styles.locationAssistance} data-testid="location-assistance">
                  <div className={styles.coordinateRow}>
                    <div className={styles.coordinateValue}>
                      <span className={styles.coordinateLabel}>{t.addressCoordinates}</span>
                      <span className={styles.coordinates}>
                        {customLatitude.toFixed(6)}, {customLongitude.toFixed(6)}
                      </span>
                    </div>
                    <button
                      type="button"
                      className={styles.coordinateCopyButton}
                      aria-label={t.copyCoordinates}
                      onClick={() => void copySelectedCoordinates()}
                    >
                      {t.copyCoordinatesShort}
                    </button>
                  </div>
                  <p className={styles.hint}>{t.automaticAddressOnSubmit}</p>
                  <p className={styles.locationQualifier}>{t.automaticAddressQualifier}</p>
                  {coordinateCopyStatus && (
                    <p role="status" className={styles.hint}>{coordinateCopyStatus}</p>
                  )}
                </div>
              )}
              {selectedLightPointId != null && locationLoading ? (
                <p className={styles.hint} role="status">{t.inventoryAddressLoading}</p>
              ) : inventoryLocalityResolved ? (
                <div className={styles.inventoryAddress}>
                  <p><strong>{localityValue}</strong></p>
                  {inventoryAddress?.address && <p className={styles.hint}>{inventoryAddress.address}</p>}
                  <p className={styles.hint} role="status">{t.inventoryAddressResolved}</p>
                  <button
                    type="button"
                    className={styles.buttonSecondary}
                    onClick={() => setIsInventoryLocalityEditing(true)}
                  >
                    {t.editInventoryLocality}
                  </button>
                </div>
              ) : (
                <>
                  {selectedLightPointId != null && (
                    <>
                      {inventoryAddress?.lightPointId === selectedLightPointId && inventoryAddress.address && (
                        <p className={styles.hint}>{inventoryAddress.address}</p>
                      )}
                      <p className={styles.hint}>
                        {inventoryAddressLookupFailed ? t.inventoryAddressLookupFailed : t.inventoryAddressManualHint}
                      </p>
                    </>
                  )}
                  <LocalityCombobox
                    id="locality"
                    value={localityValue}
                    choices={AUSEMIO_VO_LOCALITIES}
                    resetKey={reportTargetIdentity}
                    placeholder={t.localityPlaceholder}
                    noMatchesText={t.localityNoMatches}
                    listboxLabel={t.streetLabel}
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
                </>
              )}
              <input
                type="hidden"
                id={inventoryLocalityResolved ? 'locality' : undefined}
                {...localityRegistration}
                value={localityValue}
              />
              {errors.locality && (
                <span className={styles.error} id="locality-error">{errors.locality.message}</span>
              )}
            </div>

            <div className={styles.field}>
              <label htmlFor="detailDescription">{t.detailLabel}</label>
              {isCustomLocation && <p className={styles.hint} id="detail-description-custom-hint">{t.detailCustomHint}</p>}
              <textarea
                id="detailDescription"
                rows={3}
                aria-invalid={Boolean(errors.detailDescription)}
                aria-describedby={[
                  isCustomLocation ? 'detail-description-custom-hint' : '',
                  errors.detailDescription ? 'detailDescription-error' : '',
                ].filter(Boolean).join(' ') || undefined}
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
                aria-describedby={[errors.phone ? 'phone-error' : '', 'phone-hint'].filter(Boolean).join(' ')}
                {...phoneRegistration}
                onChange={(event) => {
                  void phoneRegistration.onChange(event);
                  if (errors.phone) void trigger('phone');
                }}
              />
              <p className={styles.hint} id="phone-hint">{t.phoneHint}</p>
              {errors.phone && <span className={styles.error} id="phone-error">{errors.phone.message}</span>}
            </div>

          </>
        )}

        {step === 2 && (
          <>
            {/* Attachments are presented first as requested; this is a local product control. */}
            <div className={styles.field}>
              <label htmlFor="files">{t.attachmentsLabel}</label>
              <input
                key={fileInputKey}
                id="files"
                type="file"
                multiple
                disabled={!attachmentsReady}
                aria-invalid={Boolean(fileError)}
                aria-describedby={fileError ? 'files-error' : undefined}
                onChange={handleFilesChange}
              />
              <p className={styles.hint}>{t.attachmentsHint}</p>
              {!attachmentsReady && <p className={styles.hint} role="status">{t.attachmentsRestoring}</p>}
              {attachmentSaving && <p className={styles.hint} role="status">{t.attachmentsSaving}</p>}
              {attachmentStorageFailed && <p className={styles.error} role="alert">{t.attachmentsSaveFailed}</p>}
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
                  {...emailRegistration}
                  onChange={(event) => {
                    void emailRegistration.onChange(event);
                    handleEmailChange(event.currentTarget.value);
                  }}
                />
                {errors.email && <span className={styles.error} id="email-error">{errors.email.message}</span>}
              </div>
            </fieldset>

            {emailVerificationEnabled === true && (
              <fieldset className={styles.fieldset} aria-describedby="email-verification-hint">
                <legend>{t.emailVerificationLegend}</legend>
                <p className={styles.hint} id="email-verification-hint">{t.emailVerificationHint}</p>
                {hasCurrentEmailVerification ? (
                  <p className={styles.verificationStatus} role="status">{t.emailVerificationVerified}</p>
                ) : (
                  <>
                    {verificationIntentId && verificationExpiresIn === 0 && (
                      <p className={styles.error} role="alert">{t.emailVerificationExpired}</p>
                    )}
                    {verificationIntentId && verificationExpiresIn !== 0 && (
                      <div className={styles.field}>
                        <label htmlFor="email-verification-code">{t.emailVerificationCodeLabel}</label>
                        <input
                          id="email-verification-code"
                          type="text"
                          inputMode="numeric"
                          autoComplete="one-time-code"
                          pattern="[0-9]{6}"
                          maxLength={6}
                          value={verificationCode}
                          aria-invalid={Boolean(verificationError)}
                          aria-describedby={verificationError ? 'email-verification-error' : undefined}
                          onChange={(event) => {
                            setVerificationCode(event.currentTarget.value.replace(/\D/g, '').slice(0, 6));
                            setVerificationError(null);
                          }}
                        />
                      </div>
                    )}
                    {verificationIntentId && verificationExpiresIn !== 0 && (
                      <p className={styles.verificationStatus} role="status">{t.emailVerificationSent}</p>
                    )}
                    <div className={styles.verificationActions}>
                      {(!verificationIntentId || verificationExpiresIn === 0) && (
                        <button
                          type="button"
                          className={styles.buttonSecondary}
                          onClick={() => void requestEmailCode(false)}
                          disabled={verificationBusy !== 'idle' || verificationRetryAfter > 0 || !normalizedCurrentEmail}
                        >
                          {verificationBusy === 'requesting' ? t.submitting : t.emailVerificationSend}
                        </button>
                      )}
                      {verificationIntentId && verificationExpiresIn !== 0 && (
                        <>
                          <button
                            type="button"
                            className={styles.buttonSecondary}
                            onClick={() => void verifyEmailCode()}
                            disabled={verificationBusy !== 'idle' || verificationCode.length !== 6}
                          >
                            {verificationBusy === 'verifying' ? t.submitting : t.emailVerificationVerify}
                          </button>
                          <button
                            type="button"
                            className={styles.buttonSecondary}
                            onClick={() => void requestEmailCode(true)}
                            disabled={verificationBusy !== 'idle' || verificationRetryAfter > 0}
                          >
                            {t.emailVerificationResend}
                          </button>
                        </>
                      )}
                    </div>
                    {verificationRetryAfter > 0 && (
                      <p className={styles.hint} role="timer" aria-live="off">
                        {verificationIntentId
                          ? t.emailVerificationResendCountdown(verificationRetryAfter)
                          : t.emailVerificationRequestCountdown(verificationRetryAfter)}
                      </p>
                    )}
                    {verificationError && (
                      <p className={styles.error} id="email-verification-error" role="alert">{verificationError}</p>
                    )}
                  </>
                )}
              </fieldset>
            )}

          </>
        )}

        {(step === 2 || step === 3) && (
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
        )}
        </fieldset>

        {submissionPending && !isSubmitting && (
          <p className={styles.error} role="alert">
            {submissionRetryUnavailable ? t.submissionRetryUnavailable : t.submissionRetryPending}
          </p>
        )}

        {step === 2 && emailVerificationEnabled === null && !emailVerificationStatusFailed && (
          <p className={styles.verificationStatus} role="status" aria-live="polite">
            {t.emailVerificationChecking}
          </p>
        )}

        {step === 3 && emailVerificationEnabled === true && (
          <fieldset className={styles.fieldset}>
            <legend>{t.reviewTitle}</legend>
            <dl className={styles.reviewList}>
              <div><dt>{t.reviewEmail}</dt><dd>{submissionPending ? currentEmail : verificationEmail}</dd></div>
              <div><dt>{t.reviewLocation}</dt><dd>{localityValue}</dd></div>
              <div><dt>{t.reviewPhone}</dt><dd>{phoneValue}</dd></div>
            </dl>
            <p className={styles.hint}>{t.reviewFinalHint}</p>
            {verificationExpiresIn === 0 && (
              <p className={styles.error} role="alert">{t.emailVerificationExpired}</p>
            )}
          </fieldset>
        )}

        {emailVerificationStatusFailed && (
          <p className={styles.error} role="alert">{t.emailVerificationStatusUnavailable}</p>
        )}

        {submitError && <p className={styles.error} role="alert">{submitError}</p>}

        <div className={styles.formFooter} data-testid="report-form-footer">
          {!submissionPending && <ReportFormLocaleSwitch compact />}

          <div className={styles.actions}>
            {(step === 2 || step === 3) && (
              <button
                type="button"
                className={styles.buttonSecondary}
                onClick={goToPreviousStep}
                disabled={isSubmitting || submissionPending}
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

            {!submissionPending && step === 2 && emailVerificationEnabled === true && hasCurrentEmailVerification && (
              <button
                type="button"
                className={styles.button}
                onClick={continueToReview}
                disabled={isSubmitting || verificationBusy !== 'idle'}
              >
                {t.emailVerificationContinue}
              </button>
            )}

            {!submissionPending && step === 2 && emailVerificationEnabled === false && (
              <button
                type="submit"
                className={styles.button}
                disabled={isSubmitting || !consent || !attachmentsReady || attachmentRestoreFailed}
              >
                {isSubmitting ? t.submitting : t.submit}
              </button>
            )}
            {!submissionPending && step === 3 && emailVerificationEnabled === true && (
              <button
                type="submit"
                className={styles.button}
                disabled={isSubmitting || !consent || !verificationToken || verificationExpiresIn === 0 || !attachmentsReady || attachmentRestoreFailed}
              >
                {isSubmitting ? t.submitting : t.submit}
              </button>
            )}
            {submissionPending && (
              <button
                type="submit"
                className={styles.button}
                disabled={isSubmitting || submissionRetryUnavailable || !consent || !attachmentsReady || attachmentRestoreFailed}
              >
                {isSubmitting ? t.submitting : t.retrySubmission}
              </button>
            )}
          </div>
        </div>
      </form>
    </section>
  );
}
