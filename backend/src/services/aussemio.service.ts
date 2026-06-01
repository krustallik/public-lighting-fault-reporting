import { mapReportToTechnicalLog } from '../config/ausemioMapping.js';
import { pool } from '../db/pool.js';
import { buildAusemioDebugPayload } from './ausemioMapper.js';
import type { IntegrationResult } from '../types/integration.js';
import type { NormalizedReportPayload } from '../types/report.js';

/**
 * AUSEMIO / DPMK integration — test mode only.
 * Builds multipart-like debug payload in memory; does not POST externally or persist PII.
 */
export async function sendReportToExternalSystem(
  reportPayload: NormalizedReportPayload
): Promise<IntegrationResult> {
  const referenceCode = `RPT-${Date.now()}`;
  const timestamp = new Date().toISOString();
  const ausemioPayload = buildAusemioDebugPayload(reportPayload);

  const technicalLog = mapReportToTechnicalLog(reportPayload, referenceCode, timestamp);

  const simulatedResponse = {
    testMode: true as const,
    referenceCode,
    timestamp,
    simulatedExternalStatus: 'simulated' as const,
    httpStatus: 201 as const,
  };

  try {
    await pool.query(
      `INSERT INTO integration_logs (
         reference_code, integration_type, request_payload, response_payload, status
       ) VALUES ($1, $2, $3, $4, $5)`,
      [
        referenceCode,
        'AUSEMIO_DPMK',
        JSON.stringify(technicalLog),
        JSON.stringify(simulatedResponse),
        'simulated',
      ]
    );
  } catch (err) {
    console.warn(
      'Could not write integration log:',
      err instanceof Error ? err.message : err
    );
  }

  return {
    referenceCode,
    status: 'simulated',
    externalResponse: simulatedResponse,
    ausemioPayload,
  };
}
