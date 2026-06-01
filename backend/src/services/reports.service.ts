import type { SendReportResult } from '../types/report.js';
import { SIMULATED_REPORT_MESSAGE } from '../types/report.js';
import { AUSEMIO_FIELDS, AUSEMIO_SUBMIT_LOCALE } from '../config/ausemioMapping.js';
import {
  isOtherFaultType,
  isValidFaultType,
  isValidLocationBlock,
} from '../config/ausemioFormOptions.js';
import { AppError } from '../utils/AppError.js';
import { parseAusemioMultipartBody } from '../utils/parseAusemioMultipartBody.js';
import { buildAusemioDebugPayload } from './ausemioMapper.js';
import * as aussemioService from './aussemio.service.js';
import * as lightPointsService from './lightPoints.service.js';

export async function sendFaultReport(
  rawBody: Record<string, unknown>,
  uploadedFiles: Express.Multer.File[],
  lightPointId?: number
): Promise<SendReportResult> {
  const fields = parseAusemioMultipartBody(rawBody);
  const files = uploadedFiles ?? [];

  if (files.length > 5) {
    throw new AppError(400, 'Maximum 5 files allowed');
  }

  validateAusemioFields(fields);

  if (lightPointId != null) {
    const point = await lightPointsService.getLightPointById(lightPointId);
    if (!point) {
      throw new AppError(400, 'Selected light point not found');
    }

    const dbAddress = point.address?.trim() ?? '';
    if (dbAddress) {
      fields[AUSEMIO_FIELDS.location] = dbAddress;
    }
  }

  if (!fields[AUSEMIO_FIELDS.location]) {
    throw new AppError(400, 'Street or location is required');
  }

  const ausemioPayload = buildAusemioDebugPayload(fields, files);
  const integrationResult = await aussemioService.sendReportToExternalSystem(
    fields,
    files.length,
    lightPointId ?? null,
    ausemioPayload
  );

  return {
    referenceCode: integrationResult.referenceCode,
    status: 'simulated',
    message: SIMULATED_REPORT_MESSAGE,
    ausemioPayload: integrationResult.ausemioPayload,
  };
}

function validateAusemioFields(fields: Record<string, string>): void {
  if (fields[AUSEMIO_FIELDS.service] !== '2') {
    throw new AppError(400, 'Invalid service — only VO (2) is supported');
  }

  if (!isValidLocationBlock(fields[AUSEMIO_FIELDS.locationBlock])) {
    throw new AppError(400, 'Invalid location block');
  }

  const faultType = fields[AUSEMIO_FIELDS.faultType];
  if (!isValidFaultType(faultType)) {
    throw new AppError(400, 'Invalid fault type');
  }
  if (isOtherFaultType(faultType) && !fields[AUSEMIO_FIELDS.otherFault]?.trim()) {
    throw new AppError(400, 'Other fault description is required');
  }

  const email = fields[AUSEMIO_FIELDS.email];
  if (!email) {
    throw new AppError(400, 'Email is required');
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new AppError(400, 'Invalid email address');
  }

  if (fields[AUSEMIO_FIELDS.locale] !== AUSEMIO_SUBMIT_LOCALE) {
    throw new AppError(400, 'Invalid locale — only "en" is supported');
  }
}
