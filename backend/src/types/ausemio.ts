/** Local debug metadata only; does not establish an external multipart part name or file policy. */
export interface AusemioFileMetadata {
  fieldName: 'files[]';
  originalName: string;
  size: number;
  mimeType: string;
}

/** Legacy test-mode preview; its target/method labels do not indicate a live AUSEMIO request. */
export interface AusemioDebugPayload {
  testMode: true;
  targetUrl: string;
  method: 'POST';
  contentType: 'multipart/form-data';
  fields: Record<string, string>;
  files: AusemioFileMetadata[];
}
