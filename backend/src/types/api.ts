export interface ApiSuccessResponse<T> {
  success: true;
  data: T;
  message?: string;
}

export interface ApiErrorResponse {
  success: false;
  message: string;
  stack?: string;
}

export interface HealthResponse {
  status: string;
  timestamp: string;
  service: string;
}
