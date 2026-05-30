import type {
  AdminActivityLog,
  AdminUser,
  ImportBatchLog,
  ImportConfirmResult,
  ImportPreview,
  IntegrationLog,
  IntegrationSettings,
  PaginatedStreetLights,
  StreetLightsListParams,
} from '@/types/admin';
import type { AdminStreetLightRow } from '@/types/admin';
import type { LightPointStatus } from '@/types/lightPoint';
import type { ApiResponse } from '@/types';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';

let refreshPromise: Promise<boolean> | null = null;

async function tryRefresh(): Promise<boolean> {
  if (!refreshPromise) {
    refreshPromise = fetch(`${API_BASE}/admin/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
    })
      .then((response) => {
        refreshPromise = null;
        return response.ok;
      })
      .catch(() => {
        refreshPromise = null;
        return false;
      });
  }
  return refreshPromise;
}

function buildQuery(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') {
      search.set(key, String(value));
    }
  }
  const qs = search.toString();
  return qs ? `?${qs}` : '';
}

async function parseJson<T>(response: Response): Promise<T> {
  const body = (await response.json()) as ApiResponse<T> & { message?: string };
  if (!response.ok) {
    throw new Error(body.message || `Request failed (${response.status})`);
  }
  if ('success' in body && body.success && 'data' in body) {
    return body.data as T;
  }
  return body as T;
}

async function adminRequest<T>(
  path: string,
  options: RequestInit = {},
  retried = false,
  silent = false
): Promise<T> {
  const isFormData = options.body instanceof FormData;
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    credentials: 'include',
    headers: {
      ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
      ...options.headers,
    },
  });

  const isAuthPath =
    path.includes('/admin/auth/login') || path.includes('/admin/auth/refresh');

  if (response.status === 401 && !retried && !isAuthPath) {
    const refreshed = await tryRefresh();
    if (refreshed) {
      return adminRequest<T>(path, options, true, silent);
    }
    if (!silent && typeof window !== 'undefined') {
      window.location.assign('/admin/login');
    }
    throw new Error('Relácia vypršala');
  }

  return parseJson<T>(response);
}

export const adminApi = {
  login: (username: string, password: string) =>
    adminRequest<AdminUser>('/admin/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }),

  logout: () =>
    adminRequest<{ message: string }>('/admin/auth/logout', { method: 'POST' }),

  me: () => adminRequest<AdminUser>('/admin/auth/me', {}, false, true),

  listStreetLights: (params: StreetLightsListParams = {}) =>
    adminRequest<PaginatedStreetLights>(
      `/admin/street-lights${buildQuery({
        page: params.page,
        limit: params.limit,
        search: params.search,
        status: params.status || undefined,
        district: params.district,
        sortBy: params.sortBy,
        sortOrder: params.sortOrder,
      })}`
    ),

  getStreetLight: (id: number) =>
    adminRequest<AdminStreetLightRow>(`/admin/street-lights/${id}`),

  createStreetLight: (payload: {
    inventoryNumber: string;
    latitude: number;
    longitude: number;
    address?: string;
    district?: string;
    lampType?: string;
    status?: LightPointStatus;
  }) =>
    adminRequest<AdminStreetLightRow>('/admin/street-lights', {
      method: 'POST',
      body: JSON.stringify({
        inventoryNumber: payload.inventoryNumber,
        latitude: payload.latitude,
        longitude: payload.longitude,
        address: payload.address,
        district: payload.district,
        lamp_type: payload.lampType,
        status: payload.status,
      }),
    }),

  updateStreetLight: (
    id: number,
    payload: {
      inventoryNumber?: string;
      latitude?: number;
      longitude?: number;
      address?: string | null;
      district?: string | null;
      lampType?: string | null;
      status?: LightPointStatus;
    }
  ) =>
    adminRequest<AdminStreetLightRow>(`/admin/street-lights/${id}`, {
      method: 'PUT',
      body: JSON.stringify({
        inventoryNumber: payload.inventoryNumber,
        latitude: payload.latitude,
        longitude: payload.longitude,
        address: payload.address,
        district: payload.district,
        lamp_type: payload.lampType,
        status: payload.status,
      }),
    }),

  deleteStreetLight: (id: number) =>
    adminRequest<{ message: string }>(`/admin/street-lights/${id}`, {
      method: 'DELETE',
    }),

  importPreview: (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    return adminRequest<ImportPreview>('/admin/street-lights/import/preview', {
      method: 'POST',
      body: formData,
    });
  },

  importConfirm: (previewId: string, allowUpdate: boolean) =>
    adminRequest<ImportConfirmResult>('/admin/street-lights/import/confirm', {
      method: 'POST',
      body: JSON.stringify({ previewId, allowUpdate }),
    }),

  exportStreetLights: async (
    format: 'csv' | 'json' | 'geojson',
    filters: Pick<StreetLightsListParams, 'search' | 'status' | 'district'> = {}
  ): Promise<void> => {
    const qs = buildQuery({
      format,
      search: filters.search,
      status: filters.status || undefined,
      district: filters.district,
    });
    const response = await fetch(`${API_BASE}/admin/street-lights/export${qs}`, {
      credentials: 'include',
    });

    if (response.status === 401) {
      const refreshed = await tryRefresh();
      if (refreshed) {
        return adminApi.exportStreetLights(format, filters);
      }
      window.location.assign('/admin/login');
      throw new Error('Relácia vypršala');
    }

    if (!response.ok) {
      throw new Error(`Export zlyhal (${response.status})`);
    }

    const blob = await response.blob();
    const disposition = response.headers.get('Content-Disposition') || '';
    const match = disposition.match(/filename="(.+)"/);
    const filename = match?.[1] || `street-lights.${format === 'geojson' ? 'geojson' : format}`;

    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  },

  getIntegrationSettings: () =>
    adminRequest<IntegrationSettings>('/admin/integration/settings'),

  getActivityLogs: () => adminRequest<AdminActivityLog[]>('/admin/logs/activity'),

  getImportBatches: () => adminRequest<ImportBatchLog[]>('/admin/logs/imports'),

  getIntegrationLogs: () =>
    adminRequest<IntegrationLog[]>('/admin/logs/integration'),
};
