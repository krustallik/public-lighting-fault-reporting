import type {
  NormalizedReportPayload,
  ReportPayload,
  SendReportResult,
} from '../types/report.js';
import {
  REPORT_DEFAULTS,
  SIMULATED_REPORT_MESSAGE,
} from '../types/report.js';
import {
  isOtherFaultType,
  isValidFaultType,
  isValidLocationBlock,
} from '../config/ausemioFormOptions.js';
import { AppError } from '../utils/AppError.js';
import { appendStudentAppDetailSuffix } from '../utils/reportDetailDescription.js';
import * as aussemioService from './aussemio.service.js';
import * as lightPointsService from './lightPoints.service.js';

export async function sendFaultReport(payload: ReportPayload): Promise<SendReportResult> {
  const normalized = await normalizeReportPayload(payload);

  const integrationResult = await aussemioService.sendReportToExternalSystem(normalized);

  return {
    referenceCode: integrationResult.referenceCode,
    status: 'simulated',
    message: SIMULATED_REPORT_MESSAGE,
    ausemioPayload: integrationResult.ausemioPayload,
  };
}

async function normalizeReportPayload(raw: ReportPayload): Promise<NormalizedReportPayload> {
  const service = raw.service?.trim() || REPORT_DEFAULTS.service;
  const locationBlock = raw.locationBlock?.trim();
  const faultType = raw.faultType?.trim();

  if (service !== REPORT_DEFAULTS.service) {
    throw new AppError(400, 'Invalid service — only VO (2) is supported');
  }

  if (!locationBlock) {
    throw new AppError(400, 'Location block is required');
  }
  if (!isValidLocationBlock(locationBlock)) {
    throw new AppError(400, 'Invalid location block');
  }

  if (!faultType) {
    throw new AppError(400, 'Fault type is required');
  }
  if (!isValidFaultType(faultType)) {
    throw new AppError(400, 'Invalid fault type');
  }
  if (isOtherFaultType(faultType) && !raw.otherFaultText?.trim()) {
    throw new AppError(400, 'Other fault description is required');
  }

  if (raw.consent !== true) {
    throw new AppError(400, 'Consent is required');
  }

  const email = raw.email?.trim();
  if (!email) {
    throw new AppError(400, 'Email is required');
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new AppError(400, 'Invalid email address');
  }

  let resolvedLocation = raw.streetOrLocation?.trim() ?? '';
  let lightPointId: number | undefined;

  if (raw.lightPointId != null) {
    const numericId = Number(raw.lightPointId);
    if (!Number.isFinite(numericId) || numericId <= 0) {
      throw new AppError(400, 'Invalid light point id');
    }

    const point = await lightPointsService.getLightPointById(numericId);
    if (!point) {
      throw new AppError(400, 'Selected light point not found');
    }

    lightPointId = numericId;
    if (!resolvedLocation) {
      resolvedLocation = point.address?.trim() ?? '';
    }
  }

  if (!resolvedLocation) {
    throw new AppError(400, 'Street or location is required');
  }

  const files = normalizeReportFiles(raw.files);

  return {
    lightPointId,
    service: REPORT_DEFAULTS.service,
    streetOrLocation: resolvedLocation,
    detailDescription: appendStudentAppDetailSuffix(raw.detailDescription),
    locationBlock,
    faultType,
    otherFaultText: raw.otherFaultText?.trim() || undefined,
    phone: raw.phone?.trim() || undefined,
    failureOn: raw.failureOn?.trim() || undefined,
    email,
    consent: true,
    locale: raw.locale?.trim() || REPORT_DEFAULTS.locale,
    files,
  };
}

function normalizeReportFiles(
  raw: ReportPayload['files']
): NormalizedReportPayload['files'] {
  if (!raw || !Array.isArray(raw)) {
    return [];
  }

  if (raw.length > 5) {
    throw new AppError(400, 'Maximum 5 files allowed');
  }

  return raw
    .filter((file) => file && typeof file.name === 'string' && file.name.trim())
    .map((file) => ({
      name: file.name.trim(),
      size: typeof file.size === 'number' ? file.size : undefined,
      mimeType: typeof file.mimeType === 'string' ? file.mimeType : undefined,
    }));
}
