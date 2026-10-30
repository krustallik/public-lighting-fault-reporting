import { Router, type Request, type Response } from 'express';
import { addressIpLimiter, type AddressLimitResult } from '../security/addressIpLimiter.js';
import { kosiceServiceAreaClassifier, type ServiceAreaClassification } from '../domain/serviceArea.js';
import {
  ReportTargetError,
  postgresLightPointCoordinateRepository,
  resolveAndValidateReportTarget,
  type LightPointCoordinateRepository,
} from '../domain/reportTarget.js';
import {
  reportAddressSuggestionService,
  ReportAddressSuggestionError,
  type ReportAddressLanguage,
  type ReportAddressSuggestionService,
  type ReportAddressTargetKind,
} from '../services/reportAddressSuggestion.service.js';
import {
  postgresLightPointAddressRepository,
  type LightPointAddressRepository,
} from '../services/lightPointAddressRepository.js';
import { createReportAddressProof } from '../services/reportAddressProof.js';

const COORDINATE_FIELDS = ['latitude', 'longitude', 'targetKind', 'language'];
const LIGHT_POINT_FIELDS = ['targetKind', 'lightPointId', 'language'];
type Limiter = Pick<typeof addressIpLimiter, 'consume'>;
type Classifier = (point: unknown) => ServiceAreaClassification;
type ReverseInput =
  | { kind: 'coordinates'; latitude: number; longitude: number; targetKind: ReportAddressTargetKind; language: ReportAddressLanguage }
  | { kind: 'light-point'; lightPointId: number; language: ReportAddressLanguage };
type TargetValidationInput =
  | { kind: 'coordinates'; latitude: number; longitude: number; targetKind: ReportAddressTargetKind }
  | { kind: 'light-point'; lightPointId: number };

function fieldsAreExact(record: Record<string, unknown>, fields: string[]): boolean {
  return Object.keys(record).length === fields.length && fields.every((field) => Object.hasOwn(record, field));
}

function parseReverse(body: unknown): ReverseInput | 'invalid' | 'coordinates' {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return 'invalid';
  const record = body as Record<string, unknown>;
  if (record.targetKind === 'light-point') {
    if (!fieldsAreExact(record, LIGHT_POINT_FIELDS) ||
      !Number.isSafeInteger(record.lightPointId) || (record.lightPointId as number) <= 0 ||
      (record.language !== 'sk' && record.language !== 'en')) return 'invalid';
    return {
      kind: 'light-point',
      lightPointId: record.lightPointId as number,
      language: record.language as ReportAddressLanguage,
    };
  }
  if (!fieldsAreExact(record, COORDINATE_FIELDS) ||
    (record.targetKind !== 'custom' && record.targetKind !== 'device') ||
    (record.language !== 'sk' && record.language !== 'en')) return 'invalid';
  if (typeof record.latitude !== 'number' || typeof record.longitude !== 'number') return 'coordinates';
  if (!Number.isFinite(record.latitude) || !Number.isFinite(record.longitude) ||
    record.latitude < -90 || record.latitude > 90 || record.longitude < -180 || record.longitude > 180) return 'coordinates';
  return {
    kind: 'coordinates',
    latitude: record.latitude,
    longitude: record.longitude,
    targetKind: record.targetKind as ReportAddressTargetKind,
    language: record.language as ReportAddressLanguage,
  };
}

function parseTargetValidation(body: unknown): TargetValidationInput | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const record = body as Record<string, unknown>;
  if (record.targetKind === 'light-point') {
    if (!fieldsAreExact(record, ['targetKind', 'lightPointId']) ||
      !Number.isSafeInteger(record.lightPointId) || (record.lightPointId as number) <= 0) return null;
    return { kind: 'light-point', lightPointId: record.lightPointId as number };
  }
  if (!fieldsAreExact(record, ['targetKind', 'latitude', 'longitude']) ||
    (record.targetKind !== 'custom' && record.targetKind !== 'device') ||
    typeof record.latitude !== 'number' || typeof record.longitude !== 'number') return null;
  return {
    kind: 'coordinates',
    latitude: record.latitude,
    longitude: record.longitude,
    targetKind: record.targetKind,
  };
}

function applyRateLimit(response: Response, result: AddressLimitResult): boolean {
  if (result.allowed) return true;
  response.setHeader('Retry-After', String(result.retryAfterSeconds));
  response.status(429).json({
    success: false,
    code: result.code,
    message: 'Address assistance is temporarily unavailable.',
    targetValidated: true,
  });
  return false;
}

function respondReportTargetError(error: unknown, response: Response): boolean {
  if (!(error instanceof ReportTargetError)) return false;
  const message = error.code === 'outside_service_area'
    ? 'Selected coordinates are outside the service area.'
    : 'Address assistance is unavailable.';
  response.status(error.status).json({ success: false, code: error.code, message });
  return true;
}

function sendAddressSuggestionError(error: ReportAddressSuggestionError, response: Response): void {
  if (error.status === 429) {
    const retryAfter = error.code === 'daily_budget_exceeded'
      ? Math.max(1, Math.ceil((Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate() + 1) - Date.now()) / 1000))
      : 1;
    response.setHeader('Retry-After', String(retryAfter));
  }
  response.status(error.status).json({
    success: false,
    code: error.code,
    message: error.message,
    targetValidated: true,
  });
}

async function withCancellation<T>(req: Request, res: Response, execute: (signal: AbortSignal) => Promise<T>): Promise<T | undefined> {
  const cancellation = new AbortController();
  const abortForDisconnect = () => cancellation.abort();
  const abortForResponseClose = () => { if (!res.writableFinished) cancellation.abort(); };
  const abortForIncompleteRequest = () => { if (!req.complete) cancellation.abort(); };
  req.once('aborted', abortForDisconnect);
  req.once('close', abortForIncompleteRequest);
  res.once('close', abortForResponseClose);
  try {
    return await execute(cancellation.signal);
  } finally {
    req.off('aborted', abortForDisconnect);
    req.off('close', abortForIncompleteRequest);
    res.off('close', abortForResponseClose);
  }
}

export function createReportAddressSuggestionRouter(
  service: ReportAddressSuggestionService = reportAddressSuggestionService,
  limiter: Limiter = addressIpLimiter,
  classifyArea: Classifier = kosiceServiceAreaClassifier,
  coordinateRepository: LightPointCoordinateRepository = postgresLightPointCoordinateRepository,
  addressRepository: LightPointAddressRepository = postgresLightPointAddressRepository,
  addressProofSecret: string
) {
  const router = Router();
  router.post('/target-validation', (req, res, next) => {
    const request = parseTargetValidation(req.body);
    if (!request) {
      res.status(400).json({ success: false, code: 'invalid_request', message: 'Invalid report location.' });
      return;
    }

    const target = request.kind === 'light-point'
      ? { kind: 'light-point' as const, lightPointId: request.lightPointId }
      : { kind: request.targetKind, latitude: request.latitude, longitude: request.longitude };
    void resolveAndValidateReportTarget(target, coordinateRepository, classifyArea)
      .then(() => res.json({ success: true, data: { valid: true } }))
      .catch((error: unknown) => {
        if (res.destroyed) return;
        if (respondReportTargetError(error, res)) return;
        next(error);
      });
  });

  router.post('/address-suggestion', (req, res, next) => {
    const request = parseReverse(req.body);
    if (request === 'invalid') {
      res.status(400).json({ success: false, code: 'invalid_request', message: 'Invalid address suggestion request.' });
      return;
    }
    if (request === 'coordinates') {
      res.status(400).json({ success: false, code: 'invalid_coordinates', message: 'Selected coordinates are invalid.' });
      return;
    }
    void (async () => {
      let resolved;
      try {
        resolved = request.kind === 'light-point'
          ? await resolveAndValidateReportTarget({
            kind: 'light-point', lightPointId: request.lightPointId,
          }, coordinateRepository, classifyArea)
          : await resolveAndValidateReportTarget({
            kind: request.targetKind,
            latitude: request.latitude,
            longitude: request.longitude,
          }, coordinateRepository, classifyArea);
      } catch (error) {
        if (res.destroyed) return;
        if (respondReportTargetError(error, res)) return;
        next(error);
        return;
      }
      if (res.destroyed) return;

      if (request.kind === 'light-point') {
        let point;
        try {
          point = await addressRepository.findById(request.lightPointId);
        } catch (error) {
          next(error);
          return;
        }
        if (!point) {
          res.status(404).json({ success: false, code: 'light_point_not_found', message: 'Selected light point was not found.' });
          return;
        }
        if (point.latitude !== resolved.latitude || point.longitude !== resolved.longitude) {
          res.status(409).json({ success: false, code: 'light_point_changed', message: 'The selected light point changed. Select it again.' });
          return;
        }
        if (point.address) {
          res.json({ success: true, data: { address: point.address } });
          return;
        }
      }

      if (!applyRateLimit(res, limiter.consume(req.ip ?? req.socket.remoteAddress ?? ''))) return;

      let data;
      try {
        data = await withCancellation(req, res, (signal) => service.suggest({
          targetKind: request.kind === 'light-point' ? 'custom' : request.targetKind,
          language: request.language,
          latitude: resolved.latitude,
          longitude: resolved.longitude,
        }, signal));
      } catch (error) {
        if (res.destroyed) return;
        if (error instanceof ReportAddressSuggestionError) {
          sendAddressSuggestionError(error, res);
          return;
        }
        next(error);
        return;
      }
      if (res.destroyed || data === undefined) return;

      if (request.kind === 'light-point' && data?.address) {
        let stored;
        try {
          stored = await addressRepository.persistIfMissing({
            id: request.lightPointId,
            latitude: resolved.latitude,
            longitude: resolved.longitude,
            address: data.address,
          });
        } catch (error) {
          next(error);
          return;
        }
        if (stored.status === 'missing') {
          res.status(404).json({ success: false, code: 'light_point_not_found', message: 'Selected light point was not found.' });
          return;
        }
        if (stored.status === 'coordinates_changed') {
          if (stored.address) {
            res.json({ success: true, data: { address: stored.address } });
          } else {
            res.status(409).json({ success: false, code: 'light_point_changed', message: 'The selected light point changed. Select it again.' });
          }
          return;
        }
        if (stored.status === 'existing') {
          res.json({ success: true, data: { address: stored.address } });
          return;
        }
      }

      const proof = request.kind === 'coordinates' && data?.address
        ? createReportAddressProof(data.address, request.targetKind, resolved.latitude, resolved.longitude, addressProofSecret)
        : undefined;
      res.json({
        success: true,
        data: data && proof ? { ...data, proof } : data,
      });
    })().catch(next);
  });

  return router;
}
