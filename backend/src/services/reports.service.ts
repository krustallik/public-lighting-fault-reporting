import type { SendReportResult } from '../types/report.js';
import { SIMULATED_REPORT_MESSAGE } from '../types/report.js';
import { AUSEMIO_FIELDS, isValidSubmitLocale } from '../config/ausemioMapping.js';
import { isValidFaultType, isValidLocationBlock } from '../config/ausemioFormOptions.js';
import { AppError } from '../utils/AppError.js';
import { parseAusemioMultipartBody } from '../utils/parseAusemioMultipartBody.js';
import { appendInteractiveMapDetailSuffix } from '../utils/reportDetailDescription.js';
import {
  formatSlovakPhoneE164,
  isValidSlovakPhone,
} from '../utils/slovakPhone.js';
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

  fields[AUSEMIO_FIELDS.detailDescription] = appendInteractiveMapDetailSuffix(
    fields[AUSEMIO_FIELDS.detailDescription]
  );

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

  const phone = fields[AUSEMIO_FIELDS.phone];
  if (phone && !isValidSlovakPhone(phone)) {
    throw new AppError(
      400,
      'Invalid phone number — use +421XXXXXXXXX, 421XXXXXXXXX, or 0XXXXXXXXX'
    );
  }
  if (phone) {
    fields[AUSEMIO_FIELDS.phone] = formatSlovakPhoneE164(phone);
  }

  const email = fields[AUSEMIO_FIELDS.email];
  if (!email) {
    throw new AppError(400, 'Email is required');
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new AppError(400, 'Invalid email address');
  }

  if (!isValidSubmitLocale(fields[AUSEMIO_FIELDS.locale])) {
    throw new AppError(400, 'Invalid locale — only "sk" and "en" are supported');
  }
}
