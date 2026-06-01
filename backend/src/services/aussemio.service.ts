import { mapReportToTechnicalLog } from '../config/ausemioMapping.js';
import { pool } from '../db/pool.js';
import type { AusemioDebugPayload } from '../types/ausemio.js';
import type { IntegrationResult } from '../types/integration.js';

/**
 * Test mode only — never POSTs to kosice.ausemio.io.
 * Persists technical integration_logs only (no PII).
 */
export async function sendReportToExternalSystem(
  fields: Record<string, string>,
  fileCount: number,
  lightPointId: number | null,
  ausemioPayload: AusemioDebugPayload
): Promise<IntegrationResult> {
  const referenceCode = `RPT-${Date.now()}`;
  const timestamp = new Date().toISOString();

  const technicalLog = mapReportToTechnicalLog(
    fields,
    fileCount,
    referenceCode,
    timestamp,
    lightPointId
  );

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
