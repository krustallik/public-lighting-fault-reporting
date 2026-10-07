import { Router, type Request, type Response } from 'express';
import { addressIpLimiter, type AddressLimitResult } from '../security/addressIpLimiter.js';
import { kosiceServiceAreaClassifier, type ServiceAreaClassification } from '../domain/serviceArea.js';
import { ReportTargetError, resolveAndValidateReportTarget } from '../domain/reportTarget.js';
import {
  reportAddressSuggestionService,
  ReportAddressSuggestionError,
  type ReportAddressLanguage,
  type ReportAddressSuggestionRequest,
  type ReportAddressSuggestionService,
  type ReportAddressTargetKind,
} from '../services/reportAddressSuggestion.service.js';

const REVERSE_FIELDS = ['latitude', 'longitude', 'targetKind', 'language'];
type Limiter = Pick<typeof addressIpLimiter, 'consume'>;
type Classifier = (point: unknown) => ServiceAreaClassification;

function fieldsAreExact(record: Record<string, unknown>, fields: string[]): boolean {
  return Object.keys(record).length === fields.length && fields.every((field) => Object.hasOwn(record, field));
}

function parseReverse(body: unknown): ReportAddressSuggestionRequest | 'invalid' | 'coordinates' {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return 'invalid';
  const record = body as Record<string, unknown>;
  if (!fieldsAreExact(record, REVERSE_FIELDS) ||
    (record.targetKind !== 'custom' && record.targetKind !== 'device') ||
    (record.language !== 'sk' && record.language !== 'en')) return 'invalid';
  if (typeof record.latitude !== 'number' || typeof record.longitude !== 'number') return 'coordinates';
  if (!Number.isFinite(record.latitude) || !Number.isFinite(record.longitude) ||
    record.latitude < -90 || record.latitude > 90 || record.longitude < -180 || record.longitude > 180) return 'coordinates';
  return {
    latitude: record.latitude,
    longitude: record.longitude,
    targetKind: record.targetKind as ReportAddressTargetKind,
    language: record.language as ReportAddressLanguage,
  };
}

function applyRateLimit(response: Response, result: AddressLimitResult): boolean {
  if (result.allowed) return true;
  response.setHeader('Retry-After', String(result.retryAfterSeconds));
  response.status(429).json({
    success: false,
    code: result.code,
    message: 'Address assistance is temporarily unavailable.',
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
  response.status(error.status).json({ success: false, code: error.code, message: error.message });
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
  classifyArea: Classifier = kosiceServiceAreaClassifier
) {
  const router = Router();
  router.get('/address-assistance-capability', (_req, res) => {
    res.json({ success: true, data: { enabled: service.enabled === true } });
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
    if (!applyRateLimit(res, limiter.consume(req.ip ?? req.socket.remoteAddress ?? ''))) return;
    void resolveAndValidateReportTarget({
      kind: request.targetKind,
      latitude: request.latitude,
      longitude: request.longitude,
    }, undefined, classifyArea).then((resolved) => withCancellation(req, res, (signal) => service.suggest({
      ...request,
      latitude: resolved.latitude,
      longitude: resolved.longitude,
    }, signal))).then((data) => {
      if (!res.destroyed && data !== undefined) res.json({ success: true, data });
    }).catch((error: unknown) => {
      if (res.destroyed) return;
      if (respondReportTargetError(error, res)) return;
      if (error instanceof ReportAddressSuggestionError) {
        sendAddressSuggestionError(error, res);
        return;
      }
      next(error);
    });
  });

  return router;
}
