/** File metadata for AUSEMIO multipart debug payload (no binary content). */
export interface AusemioFileMetadata {
  fieldName: 'files[]';
  name: string;
  size: number;
  mimeType: string;
}

/** Test/debug view of what would be sent to AUSEMIO as multipart/form-data. */
export interface AusemioDebugPayload {
  testMode: true;
  targetUrl: string;
  method: 'POST';
  contentType: 'multipart/form-data';
  fields: Record<string, string>;
  files: AusemioFileMetadata[];
}
