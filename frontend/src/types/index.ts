export type LightPointStatus = 'active' | 'inactive' | 'maintenance';

export interface LightPoint {
  id: number;
  external_id: string | null;
  latitude: number;
  longitude: number;
  address: string | null;
  district: string | null;
  lamp_type: string | null;
  status: LightPointStatus;
}

export interface ReportFormData {
  lightPointId: number;
  faultType: string;
  description: string;
  reporterName?: string;
  reporterEmail?: string;
  reporterPhone?: string;
}

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  message?: string;
}

export interface HealthResponse {
  status: string;
  timestamp: string;
  service: string;
}

export interface SendReportResponse {
  referenceCode: string;
  status: string;
  message: string;
}

export interface AdminLoginResponse {
  token: string;
  user: { username: string; role: string };
  message: string;
}

export interface AdminLoginFormData {
  username: string;
  password: string;
}
