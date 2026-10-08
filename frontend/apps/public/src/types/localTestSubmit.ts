export interface LocalTestSubmitResponse {
  success: true;
  status: 'local_test_received';
  filesReceived: number;
}

export interface LocalTestSubmitErrorResponse {
  success: false;
  error: {
    code: string;
    message: string;
  };
}
