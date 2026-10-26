import { Router, type Express, type Request, type Response } from 'express';
import multer from 'multer';
import { AUSEMIO_FIELDS } from '../config/ausemioMapping.js';
import {
  mapLocalVoFieldsToDraft,
  type VoAttachmentMetadata,
} from '../integrations/ausemio/voSubmissionBoundary.js';
import type { EmailVerificationService } from '../services/emailVerification.service.js';
import {
  FaultHistoryInputError,
  type FaultHistoryStore,
} from '../services/faultReportHistory.service.js';
import { ReportTargetError } from '../domain/reportTarget.js';

export const DEFAULT_LOCAL_TEST_UPLOAD_LIMITS = {
  maxFileBytes: 10485760,
  maxFiles: 3,
  maxTotalUploadBytes: 20971520,
} as const;

const LOCAL_TEST_MAX_FIELD_BYTES = 65536;

export interface LocalTestUploadLimits {
  maxFileBytes: number;
  maxFiles: number;
  maxTotalUploadBytes: number;
}

export interface LocalTestUploadStorage {
  activeRequests: number;
  cleanupRequest(request: Request): void;
}

interface RequestUploadState {
  totalBytes: number;
}

class LocalTestResourceLimitError extends Error {
  constructor() {
    super('A local test upload resource limit was exceeded.');
    this.name = 'LocalTestResourceLimitError';
  }
}

class MetadataOnlyUploadStorage implements multer.StorageEngine, LocalTestUploadStorage {
  private readonly requests = new WeakMap<Request, RequestUploadState>();
  activeRequests = 0;

  constructor(private readonly limits: LocalTestUploadLimits) {}

  private requestState(request: Request): RequestUploadState {
    let state = this.requests.get(request);
    if (!state) {
      state = { totalBytes: 0 };
      this.requests.set(request, state);
      this.activeRequests += 1;
      request.once('aborted', () => this.cleanupRequest(request));
    }
    return state;
  }

  _handleFile(
    request: Request,
    file: Express.Multer.File,
    callback: (error?: any, info?: Partial<Express.Multer.File>) => void
  ): void {
    const state = this.requestState(request);
    let fileBytes = 0;
    let settled = false;

    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      file.stream.resume();
      callback(error);
    };

    file.stream.on('data', (chunk: Buffer) => {
      if (settled) return;
      fileBytes += chunk.length;
      state.totalBytes += chunk.length;
      if (
        fileBytes > this.limits.maxFileBytes ||
        state.totalBytes > this.limits.maxTotalUploadBytes
      ) {
        fail(new LocalTestResourceLimitError());
      }
    });
    file.stream.once('limit', () => fail(new LocalTestResourceLimitError()));
    file.stream.once('error', fail);
    file.stream.once('end', () => {
      if (settled) return;
      settled = true;
      callback(null, { size: fileBytes });
    });
  }

  _removeFile(
    _request: Request,
    _file: Express.Multer.File,
    callback: (error: Error | null) => void
  ): void {
    callback(null);
  }

  cleanupRequest(request: Request): void {
    if (!this.requests.has(request)) return;
    const state = this.requests.get(request);
    if (state) state.totalBytes = 0;
    this.requests.delete(request);
    this.activeRequests = Math.max(0, this.activeRequests - 1);
  }
}

const FIELD = {
  service: AUSEMIO_FIELDS.service,
  locality: AUSEMIO_FIELDS.location,
  detailDescription: AUSEMIO_FIELDS.detailDescription,
  locationBlock: AUSEMIO_FIELDS.locationBlock,
  faultType: AUSEMIO_FIELDS.faultType,
  otherFault: AUSEMIO_FIELDS.otherFault,
  phone: AUSEMIO_FIELDS.phone,
  email: AUSEMIO_FIELDS.email,
  locale: AUSEMIO_FIELDS.locale,
  verificationIntent: 'emailVerificationIntentId',
  verificationToken: 'emailVerificationToken',
  reportTarget: 'reportTarget',
  files: AUSEMIO_FIELDS.files,
} as const;

const ALLOWED_FIELDS = new Set<string>([
  FIELD.service,
  FIELD.locality,
  FIELD.detailDescription,
  FIELD.locationBlock,
  FIELD.faultType,
  FIELD.otherFault,
  FIELD.phone,
  FIELD.email,
  FIELD.locale,
  FIELD.reportTarget,
]);
type FlatFields = Record<string, unknown>;

function flattenMultipartBody(body: FlatFields): FlatFields {
  const flat: FlatFields = Object.create(null) as FlatFields;
  for (const [key, value] of Object.entries(body)) {
    if (
      key === 'properties' &&
      value !== null &&
      typeof value === 'object' &&
      !Array.isArray(value)
    ) {
      for (const [subKey, subValue] of Object.entries(value as FlatFields)) {
        flat[`properties[${subKey}]`] = subValue;
      }
    } else {
      flat[key] = value;
    }
  }
  return flat;
}

function invalidPayload(message = 'The local VO payload is invalid.') {
  return { status: 400, code: 'LOCAL_TEST_INVALID_PAYLOAD', message };
}

function validateFields(
  body: FlatFields,
  verificationEnabled: boolean
): { fields?: Record<string, string>; error?: ReturnType<typeof invalidPayload> } {
  const flat = flattenMultipartBody(body);
  const fields: Record<string, string> = Object.create(null) as Record<string, string>;
  const allowedFields = verificationEnabled
    ? new Set([...ALLOWED_FIELDS, FIELD.verificationIntent, FIELD.verificationToken])
    : ALLOWED_FIELDS;

  for (const [key, rawValue] of Object.entries(flat)) {
    if (!allowedFields.has(key) || typeof rawValue !== 'string') {
      return { error: invalidPayload() };
    }
    fields[key] = rawValue;
  }

  return { fields };
}

function sendError(
  response: Response,
  status: number,
  code: string,
  message: string
): void {
  response.setHeader('Cache-Control', 'no-store');
  response.status(status).json({ success: false, error: { code, message } });
}

function resolveUploadLimits(env: Record<string, string | undefined>): LocalTestUploadLimits {
  const parseLimit = (key: string, fallback: number): number => {
    const raw = env[key];
    if (raw === undefined || raw === '') return fallback;
    const value = Number(raw);
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new Error(`${key} must be a positive safe integer.`);
    }
    return value;
  };

  return {
    maxFileBytes: parseLimit('LOCAL_TEST_MAX_FILE_BYTES', DEFAULT_LOCAL_TEST_UPLOAD_LIMITS.maxFileBytes),
    maxFiles: parseLimit('LOCAL_TEST_MAX_FILES', DEFAULT_LOCAL_TEST_UPLOAD_LIMITS.maxFiles),
    maxTotalUploadBytes: parseLimit(
      'LOCAL_TEST_MAX_TOTAL_UPLOAD_BYTES',
      DEFAULT_LOCAL_TEST_UPLOAD_LIMITS.maxTotalUploadBytes
    ),
  };
}

export function isLocalTestSubmitEnabled(env: Record<string, string | undefined>): boolean {
  return (
    (env.NODE_ENV === 'development' || env.NODE_ENV === 'test') &&
    env.LOCAL_TEST_SUBMIT_ENABLED === 'true'
  );
}

export function mountLocalTestSubmitRoutes(
  app: Express,
  env: Record<string, string | undefined> = process.env,
  emailVerification?: Pick<EmailVerificationService, 'consumeSubmissionVerification'>,
  faultHistory?: FaultHistoryStore
): LocalTestUploadStorage | undefined {
  if (!isLocalTestSubmitEnabled(env)) return undefined;

  const limits = resolveUploadLimits(env);
  const storage = new MetadataOnlyUploadStorage(limits);
  const upload = multer({
    storage,
    limits: {
      files: limits.maxFiles,
      fields: 24,
      // Busboy marks fields over the configured byte ceiling as truncated; the exact ceiling remains accepted.
      fieldSize: LOCAL_TEST_MAX_FIELD_BYTES,
      // Defensive parser ceiling (bytes per field), not product/AUSEMIO text validation.
      fieldNameSize: 128,
    },
  });
  const router = Router();

  router.post('/ausemio-test-submit', (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    upload.array(FIELD.files, limits.maxFiles)(request, response, (parseError?: unknown) => {
      if (parseError) {
        storage.cleanupRequest(request);
        if (
          parseError instanceof LocalTestResourceLimitError ||
          (parseError instanceof multer.MulterError &&
            (parseError.code === 'LIMIT_FILE_SIZE' ||
              parseError.code === 'LIMIT_FILE_COUNT' ||
              parseError.code === 'LIMIT_FIELD_VALUE' ||
              (parseError.code === 'LIMIT_UNEXPECTED_FILE' &&
                parseError.field === FIELD.files)))
        ) {
          sendError(
            response,
            413,
            'LOCAL_TEST_RESOURCE_LIMIT',
            'A local test upload resource limit was exceeded.'
          );
          return;
        }
        sendError(
          response,
          400,
          'LOCAL_TEST_INVALID_MULTIPART',
          'The local test request is not valid multipart/form-data.'
        );
        return;
      }

      void (async () => {
      try {
        const { fields, error } = validateFields(
          (request.body ?? Object.create(null)) as FlatFields,
          emailVerification !== undefined
        );
        if (error || !fields) {
          sendError(response, error?.status ?? 400, error?.code ?? 'LOCAL_TEST_INVALID_PAYLOAD', error?.message ?? 'The local VO payload is invalid.');
          return;
        }

        const uploadedFiles = (request.files as Express.Multer.File[] | undefined) ?? [];
        const attachmentMetadata: VoAttachmentMetadata[] = uploadedFiles.map((file) => ({
          originalName: file.originalname,
          sizeBytes: file.size,
          mediaType: file.mimetype || 'application/octet-stream',
        }));
        const mapping = mapLocalVoFieldsToDraft(fields, attachmentMetadata);
        if (!mapping.ok) {
          sendError(response, 400, 'LOCAL_TEST_INVALID_PAYLOAD', mapping.message);
          return;
        }

        let reportTarget: unknown;
        try {
          reportTarget = JSON.parse(fields[FIELD.reportTarget] ?? 'null');
        } catch {
          sendError(response, 400, 'LOCAL_TEST_INVALID_PAYLOAD', 'The report location is invalid.');
          return;
        }

        if (!faultHistory) {
          sendError(response, 503, 'LOCAL_TEST_SUBMISSION_UNAVAILABLE', 'The local test endpoint is unavailable.');
          return;
        }

        const historyResult = await faultHistory.recordSubmission({
          locality: mapping.draft.locality,
          detailDescription: mapping.draft.detailDescription,
          locationBlockCode: mapping.draft.locationBlock,
          faultTypeCode: mapping.draft.faultType,
          reportTarget,
        }, emailVerification ? async (client) => {
          const intentId = fields[FIELD.verificationIntent];
          const verificationToken = fields[FIELD.verificationToken];
          return intentId && verificationToken
            ? emailVerification.consumeSubmissionVerification({
              email: fields[FIELD.email],
              intentId,
              verificationToken,
            }, client)
            : false;
        } : undefined);

        if (!historyResult.authorized) {
          sendError(
            response,
            403,
            'EMAIL_VERIFICATION_REQUIRED',
            'Verify the submitted email address before submitting this report.'
          );
          return;
        }

        const filesReceived = mapping.draft.attachments.length;

        response.status(200).json({
          success: true,
          status: 'local_test_received',
          filesReceived,
        });
      } catch (error) {
        if (error instanceof FaultHistoryInputError || error instanceof ReportTargetError) {
          const status = error instanceof ReportTargetError ? error.status : 400;
          sendError(response, status, 'LOCAL_TEST_INVALID_REPORT_LOCATION', 'The report location or category is invalid.');
          return;
        }
        sendError(response, 503, 'LOCAL_TEST_SUBMISSION_UNAVAILABLE', 'The local test endpoint is unavailable.');
      } finally {
        storage.cleanupRequest(request);
      }
      })();
    });
  });

  app.use('/api/dev', router);
  return storage;
}
