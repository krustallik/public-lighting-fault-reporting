export interface LocalTestSubmitResponse {
  success: true;
  status: 'local_test_received' | 'locally_recorded';
  filesReceived: number;
}

export interface LocalTestSubmitErrorResponse {
  success: false;
  error: {
    code: string;
    message: string;
  };
}
