export interface EmailVerificationStatus {
  enabled: boolean;
}

export interface EmailVerificationRequestResponse {
  success: true;
  intentId: string;
  expiresInSeconds: number;
  retryAfterSeconds: number;
}

export interface EmailVerificationConfirmResponse {
  success: true;
  verificationToken: string;
  expiresInSeconds: number;
}
