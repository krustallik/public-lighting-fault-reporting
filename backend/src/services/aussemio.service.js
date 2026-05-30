import { pool } from '../db/pool.js';

/**
 * Placeholder service for AUSEMIO / DPMK integration.
 *
 * Future implementation will:
 * - Map internal report fields to external API schema (see mapReportToExternalFormat)
 * - Authenticate using environment variables (AUSEMIO_BASE_URL, AUSEMIO_API_KEY)
 * - Send HTTP request and parse response
 * - Persist technical result in integration_logs (no long-term PII storage)
 */
export async function sendReportToExternalSystem(reportPayload) {
  const referenceCode = `RPT-${Date.now()}`;
  const mappedPayload = mapReportToExternalFormat(reportPayload);

  // TODO: replace with real HTTP call when integration is implemented
  const placeholderResponse = {
    externalId: null,
    status: 'simulated',
    message: 'Integration not configured',
  };

  try {
    await pool.query(
      `INSERT INTO integration_logs (reference_code, integration_type, request_payload, response_payload, status)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        referenceCode,
        'AUSEMIO_DPMK',
        JSON.stringify(mappedPayload),
        JSON.stringify(placeholderResponse),
        'simulated',
      ]
    );
  } catch (err) {
    console.warn('Could not write integration log:', err.message);
  }

  return {
    referenceCode,
    status: 'simulated',
    externalResponse: placeholderResponse,
  };
}

function mapReportToExternalFormat(report) {
  // TODO: implement field mapping according to AUSEMIO/DPMK specification
  return {
    source: 'public-lighting-app',
    lightPointId: report?.lightPointId ?? null,
    description: report?.description ?? '',
    faultType: report?.faultType ?? '',
    reportedAt: new Date().toISOString(),
  };
}
