export interface LocalTestSubmitResponse {
  success: true;
  status: 'local_test_received' | 'locally_recorded';
  filesReceived: number;
  receiptId: string;
}

export interface LocalTestSubmitErrorResponse {
  success: false;
  error: {
    code: string;
    message: string;
  };
}
