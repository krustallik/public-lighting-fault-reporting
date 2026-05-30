import { config } from '../config/index.js';
import { mapReportToAusemioForm, mapReportToTechnicalLog } from '../config/ausemioMapping.js';
import { pool } from '../db/pool.js';
import type { IntegrationResult } from '../types/integration.js';
import type { ReportPayload } from '../types/report.js';

/**
 * Placeholder service for AUSEMIO / DPMK integration.
 * Forwards reports externally; does not persist citizen PII in integration_logs.
 */
export async function sendReportToExternalSystem(
  reportPayload: ReportPayload,
  options: { address?: string | null } = {}
): Promise<IntegrationResult> {
  const referenceCode = `RPT-${Date.now()}`;
  const technicalLog = mapReportToTechnicalLog(reportPayload);

  // Mapped form for future multipart POST — not persisted locally
  const _formFields = mapReportToAusemioForm(reportPayload, {
    address: options.address,
    locale: config.aussemio.locale,
  });

  void _formFields;

  // TODO: build multipart/form-data and POST to config.aussemio.baseUrl
  // Respect config.aussemio.testMode until production approval
  const placeholderResponse = {
    httpStatus: 200,
    status: config.aussemio.testMode ? 'simulated' : 'pending',
    message: config.aussemio.testMode
      ? 'Integration test mode — request not sent to AUSEMIO/DPMK'
      : 'Integration not configured',
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
        JSON.stringify({
          httpStatus: placeholderResponse.httpStatus,
          status: placeholderResponse.status,
          message: placeholderResponse.message,
        }),
        placeholderResponse.status,
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
    status: placeholderResponse.status,
    externalResponse: placeholderResponse,
  };
}
