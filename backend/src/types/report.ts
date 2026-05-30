/** Incoming report payload from frontend — forwarded to AUSEMIO/DPMK, not stored locally. */
export interface ReportPayload {
  lightPointId?: number;
  faultType?: string;
  description?: string;
  reporterName?: string;
  reporterEmail?: string;
  reporterPhone?: string;
  customFaultText?: string;
  locale?: string;
}

export interface SendReportResult {
  referenceCode: string;
  status: string;
  message: string;
}
