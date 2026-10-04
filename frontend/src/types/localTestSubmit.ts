export interface LocalTestSubmitResponse {
  success: true;
  status: 'local_test_received';
  fields: Record<string, string>;
  files: Array<{
    filename: string;
    mimeType: string;
    size: number;
  }>;
}

export interface LocalTestSubmitErrorResponse {
  success: false;
  error: {
    code: string;
    message: string;
  };
}
