import { config } from '../config/index.js';
import type { AusemioDebugPayload, AusemioFileMetadata } from '../types/ausemio.js';

export function mapMulterFilesToAusemioMetadata(
  files: Express.Multer.File[]
): AusemioFileMetadata[] {
  return files.map((file) => ({
    fieldName: 'files[]',
    originalName: file.originalname,
    size: file.size,
    mimeType: file.mimetype || 'application/octet-stream',
  }));
}

/** Echo of received multipart body — not sent to AUSEMIO (test mode). */
export function buildAusemioDebugPayload(
  fields: Record<string, string>,
  files: Express.Multer.File[]
): AusemioDebugPayload {
  return {
    testMode: true,
    targetUrl: config.aussemio.baseUrl,
    method: 'POST',
    contentType: 'multipart/form-data',
    fields,
    files: mapMulterFilesToAusemioMetadata(files),
  };
}
