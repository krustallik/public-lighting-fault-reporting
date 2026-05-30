import * as aussemioService from './aussemio.service.js';

export async function sendFaultReport(payload) {
  // TODO: validate payload (light_point_id, description, etc.)

  const integrationResult = await aussemioService.sendReportToExternalSystem(payload);

  return {
    referenceCode: integrationResult.referenceCode,
    status: integrationResult.status,
    message: 'Report accepted (skeleton — not sent to real AUSEMIO/DPMK yet)',
  };
}
