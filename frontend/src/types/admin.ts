import type { LightPointStatus } from './lightPoint';

export interface AdminUser {
  id: number;
  username: string;
  fullName: string | null;
}

export interface AdminStreetLightRow {
  id: number;
  external_id: string | null;
  latitude: string;
  longitude: string;
  address: string | null;
  district: string | null;
  lamp_type: string | null;
  status: LightPointStatus;
  created_at: string;
  updated_at: string;
}

export interface AdminStreetLight {
  id: number;
  inventoryNumber: string | null;
  latitude: number;
  longitude: number;
  address: string | null;
  district: string | null;
  lampType: string | null;
  status: LightPointStatus;
  createdAt: string;
  updatedAt: string;
}

export interface StreetLightsListParams {
  page?: number;
  limit?: number;
  search?: string;
  status?: LightPointStatus | '';
  district?: string;
  sortBy?: 'id' | 'external_id' | 'address' | 'status' | 'created_at' | 'updated_at';
  sortOrder?: 'asc' | 'desc';
}

export interface PaginatedStreetLights {
  items: AdminStreetLightRow[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface ImportRowResult {
  rowIndex: number;
  inventoryNumber: string;
  action: 'create' | 'update' | 'skip' | 'error';
  message?: string;
  existingId?: number;
}

export interface ImportPreview {
  previewId: string;
  filename: string;
  totalRows: number;
  results: ImportRowResult[];
  summary: {
    toCreate: number;
    toUpdate: number;
    skipped: number;
    errors: number;
  };
}

export interface ImportConfirmResult {
  batchId: number;
  summary: ImportPreview['summary'];
}

export interface IntegrationSettings {
  baseUrl: string;
  testMode: boolean;
  submitLocales: string[];
  apiKeyConfigured: boolean;
  fieldMapping: Record<string, string>;
}

export interface AdminActivityLog {
  id: number;
  action: string;
  entity_type: string | null;
  entity_id: number | null;
  details: Record<string, unknown> | null;
  created_at: string;
  admin_username: string | null;
}

export interface ImportBatchLog {
  id: number;
  filename: string;
  uploaded_by_admin_id: number | null;
  uploaded_by_username: string | null;
  total_rows: number;
  created_rows: number;
  updated_rows: number;
  skipped_rows: number;
  failed_rows: number;
  created_at: string;
}

export interface IntegrationLog {
  id: number;
  reference_code: string | null;
  integration_type: string;
  status: string;
  error_message: string | null;
  created_at: string;
}

export function mapAdminStreetLight(row: AdminStreetLightRow): AdminStreetLight {
  return {
    id: row.id,
    inventoryNumber: row.external_id,
    latitude: Number(row.latitude),
    longitude: Number(row.longitude),
    address: row.address,
    district: row.district,
    lampType: row.lamp_type,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
