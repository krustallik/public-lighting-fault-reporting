export type LightPointStatus = 'active' | 'inactive' | 'maintenance';

export interface LightPointRow {
  id: number;
  external_id: string | null;
  latitude: string;
  longitude: string;
  address: string | null;
  district: string | null;
  lamp_type: string | null;
  status: LightPointStatus;
}

export interface CreateLightPointInput {
  external_id?: string | null;
  latitude: number;
  longitude: number;
  address?: string | null;
  district?: string | null;
  lamp_type?: string | null;
  status?: LightPointStatus;
}

export interface UpdateLightPointInput extends Partial<CreateLightPointInput> {}
