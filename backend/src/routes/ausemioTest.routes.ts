import { Router, type Express, type Request, type Response } from 'express';
import multer from 'multer';
import {
  AUSEMIO_FAULT_TYPE_OTHER,
  AUSEMIO_FAULT_TYPE_VALUES,
  AUSEMIO_LOCATION_BLOCK_VALUES,
} from '../config/ausemioFormOptions.js';
import { AUSEMIO_VO_LOCALITIES } from '../config/data/ausemioVoLocalities.generated.js';

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
  service: 'properties[vyber_sluzby]',
  locality: 'properties[ulica_miesto_poruchy_lokalita]',
  detailDescription: 'properties[detail_decription]',
  locationBlock: 'properties[lokalizacia_blok]',
  faultType: 'properties[typ_poruchy]',
  otherFault: 'properties[iny_druh_poruchy]',
  phone: 'properties[tel_cislo]',
  email: 'email',
  locale: 'locale',
  files: 'files[]',
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
]);
const localityValues = new Set<string>(AUSEMIO_VO_LOCALITIES.map(({ value }) => value));
const locationBlockValues = new Set<string>(AUSEMIO_LOCATION_BLOCK_VALUES);
const faultTypeValues = new Set<string>(AUSEMIO_FAULT_TYPE_VALUES);

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

function validateFields(body: FlatFields): { fields?: Record<string, string>; error?: ReturnType<typeof invalidPayload> } {
  const flat = flattenMultipartBody(body);
  const fields: Record<string, string> = Object.create(null) as Record<string, string>;

  for (const [key, rawValue] of Object.entries(flat)) {
    if (!ALLOWED_FIELDS.has(key) || typeof rawValue !== 'string') {
      return { error: invalidPayload() };
    }
    fields[key] = rawValue;
  }

  if (fields[FIELD.service] !== '2') {
    return { error: invalidPayload('Only service 2 / VO is accepted by the local test endpoint.') };
  }

  const locality = fields[FIELD.locality];
  if (!locality || !localityValues.has(locality)) {
    return { error: invalidPayload('Select a locality from the approved VO locality list.') };
  }

  const phone = fields[FIELD.phone];
  if (!phone || !phone.trim()) {
    return { error: invalidPayload('A telephone contact is required.') };
  }

  const email = fields[FIELD.email];
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
    return { error: invalidPayload('A valid local email value is required.') };
  }

  if (fields[FIELD.locale] !== 'sk' && fields[FIELD.locale] !== 'en') {
    return { error: invalidPayload('Select a supported form locale.') };
  }

  const locationBlock = fields[FIELD.locationBlock];
  if (locationBlock !== undefined && locationBlock !== '' && !locationBlockValues.has(locationBlock)) {
    return { error: invalidPayload('Select a valid VO location block code.') };
  }

  const faultType = fields[FIELD.faultType];
  if (faultType !== undefined && faultType !== '' && !faultTypeValues.has(faultType)) {
    return { error: invalidPayload('Select a valid VO fault type code.') };
  }

  const otherFault = fields[FIELD.otherFault];
  if (otherFault !== undefined && faultType !== AUSEMIO_FAULT_TYPE_OTHER) {
    return { error: invalidPayload('Other-fault text is only valid for Q99.') };
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
  env: Record<string, string | undefined> = process.env
): LocalTestUploadStorage | undefined {
  if (!isLocalTestSubmitEnabled(env)) return undefined;

  const limits = resolveUploadLimits(env);
  const storage = new MetadataOnlyUploadStorage(limits);
  const upload = multer({
    storage,
    limits: {
      files: limits.maxFiles,
      fields: 24,
      // Busboy truncates when the configured limit is reached, so add one to keep 65,536 bytes inclusive.
      fieldSize: LOCAL_TEST_MAX_FIELD_BYTES + 1,
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

      try {
        const { fields, error } = validateFields(
          (request.body ?? Object.create(null)) as FlatFields
        );
        if (error || !fields) {
          sendError(response, error?.status ?? 400, error?.code ?? 'LOCAL_TEST_INVALID_PAYLOAD', error?.message ?? 'The local VO payload is invalid.');
          return;
        }

        const filesReceived = (request.files as Express.Multer.File[] | undefined)?.length ?? 0;

        response.status(200).json({
          success: true,
          status: 'local_test_received',
          filesReceived,
        });
      } catch {
        sendError(response, 400, 'LOCAL_TEST_INVALID_PAYLOAD', 'The local VO payload is invalid.');
      } finally {
        storage.cleanupRequest(request);
      }
    });
  });

  app.use('/api/dev', router);
  return storage;
}
