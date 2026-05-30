import type { ReportPayload, SendReportResult } from '../types/report.js';
import { AppError } from '../utils/AppError.js';
import * as aussemioService from './aussemio.service.js';
import * as lightPointsService from './lightPoints.service.js';

export async function sendFaultReport(payload: ReportPayload): Promise<SendReportResult> {
  validateReportPayload(payload);

  let address: string | null = null;
  if (payload.lightPointId != null) {
    const point = await lightPointsService.getLightPointById(payload.lightPointId);
    if (!point) {
      throw new AppError(400, 'Selected light point not found');
    }
    address = point.address;
  }

  const integrationResult = await aussemioService.sendReportToExternalSystem(payload, {
    address,
  });

  return {
    referenceCode: integrationResult.referenceCode,
    status: integrationResult.status,
    message:
      integrationResult.status === 'simulated'
        ? 'Report accepted (test mode — not sent to real AUSEMIO/DPMK yet)'
        : 'Report forwarded',
  };
}

function validateReportPayload(payload: ReportPayload): void {
  if (!payload.faultType?.trim()) {
    throw new AppError(400, 'Fault type is required');
  }
  if (!payload.description?.trim() || payload.description.trim().length < 10) {
    throw new AppError(400, 'Description must be at least 10 characters');
  }
}
