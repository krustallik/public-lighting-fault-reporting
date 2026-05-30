export interface IntegrationLogTechnicalPayload {
  lightPointId: number | null;
  faultType: string | null;
}

export interface IntegrationResult {
  referenceCode: string;
  status: string;
  externalResponse: {
    httpStatus?: number;
    status: string;
    message: string;
  };
}
