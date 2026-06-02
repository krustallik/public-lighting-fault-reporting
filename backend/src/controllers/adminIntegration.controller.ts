import type { NextFunction, Request, Response } from 'express';
import { config } from '../config/index.js';
import { AUSEMIO_FIELDS, AUSEMIO_SUBMIT_LOCALES } from '../config/ausemioMapping.js';

/** Read-only technical integration info (no secrets, no citizen data). */
export async function getSettings(
  _req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    res.json({
      success: true,
      data: {
        baseUrl: config.aussemio.baseUrl,
        testMode: config.aussemio.testMode,
        submitLocales: [...AUSEMIO_SUBMIT_LOCALES],
        apiKeyConfigured: Boolean(config.aussemio.apiKey),
        fieldMapping: AUSEMIO_FIELDS,
      },
    });
  } catch (err) {
    next(err);
  }
}
