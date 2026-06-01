/** File metadata for AUSEMIO multipart debug payload (no binary stored). */
export interface AusemioFileMetadata {
  fieldName: 'files[]';
  originalName: string;
  size: number;
  mimeType: string;
}

/** Echo of received multipart/form-data (test mode preview). */
export interface AusemioDebugPayload {
  testMode: true;
  targetUrl: string;
  method: 'POST';
  contentType: 'multipart/form-data';
  fields: Record<string, string>;
  files: AusemioFileMetadata[];
}
