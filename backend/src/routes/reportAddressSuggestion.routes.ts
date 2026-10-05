import { Router, type Request, type Response } from 'express';
import {
  reportAddressSuggestionService,
  ReportAddressSuggestionError,
  type ReportAddressLanguage,
  type ReportAddressSuggestionRequest,
  type ReportAddressSuggestionService,
  type ReportAddressTargetKind,
} from '../services/reportAddressSuggestion.service.js';

const REQUEST_FIELDS = ['latitude', 'longitude', 'targetKind', 'language'];

function parseRequest(body: unknown): ReportAddressSuggestionRequest | undefined {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return undefined;

  const record = body as Record<string, unknown>;
  if (
    Object.keys(record).length !== REQUEST_FIELDS.length ||
    REQUEST_FIELDS.some((field) => !Object.hasOwn(record, field)) ||
    typeof record.latitude !== 'number' ||
    typeof record.longitude !== 'number' ||
    (record.targetKind !== 'custom' && record.targetKind !== 'device') ||
    (record.language !== 'sk' && record.language !== 'en')
  ) {
    return undefined;
  }

  return {
    latitude: record.latitude,
    longitude: record.longitude,
    targetKind: record.targetKind as ReportAddressTargetKind,
    language: record.language as ReportAddressLanguage,
  };
}

async function suggestAddress(
  req: Request,
  res: Response,
  service: ReportAddressSuggestionService
): Promise<void> {
  const request = parseRequest(req.body);
  if (!request) {
    res.status(400).json({
      success: false,
      code: 'invalid_request',
      message: 'Invalid address suggestion request',
    });
    return;
  }

  try {
    const data = await service.suggest(request);
    res.json({ success: true, data });
  } catch (error) {
    if (error instanceof ReportAddressSuggestionError) {
      res.status(error.status).json({
        success: false,
        code: error.code,
        message: error.message,
      });
      return;
    }
    throw error;
  }
}

export function createReportAddressSuggestionRouter(
  service: ReportAddressSuggestionService = reportAddressSuggestionService
) {
  const router = Router();
  router.post('/address-suggestion', (req, res, next) => {
    void suggestAddress(req, res, service).catch(next);
  });
  return router;
}
