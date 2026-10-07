import type {
  AdminDeleteResult,
  AdminLoginInput,
  AdminLoginResult,
} from '../types/admin.js';
import type { CreateLightPointInput, LightPointRow, UpdateLightPointInput } from '../types/lightPoint.js';
import * as lightPointsService from './lightPoints.service.js';

/** Admin authentication skeleton — full implementation later. */
export async function login(input: AdminLoginInput): Promise<AdminLoginResult> {
  void input.password;
  return {
    token: 'placeholder-jwt-token',
    user: { username: input.username || 'admin' },
    message: 'Login skeleton — authentication not implemented yet',
  };
}

export async function getAdminLightPoints(): Promise<LightPointRow[]> {
  return lightPointsService.getAllLightPoints();
}

export async function createLightPoint(input: CreateLightPointInput, actorAdminId: number | null = null, actorUsernameSnapshot: string | null = null): Promise<LightPointRow> {
  return lightPointsService.createLightPoint(input, actorAdminId, actorUsernameSnapshot);
}

export async function updateLightPoint(
  id: string | number,
  input: UpdateLightPointInput,
  actorAdminId: number | null = null,
  actorUsernameSnapshot: string | null = null
): Promise<LightPointRow> {
  return lightPointsService.updateLightPoint(id, input, actorAdminId, actorUsernameSnapshot);
}

export async function deleteLightPoint(id: string | number, actorAdminId: number | null = null, actorUsernameSnapshot: string | null = null): Promise<AdminDeleteResult> {
  return lightPointsService.deleteLightPoint(id, actorAdminId, actorUsernameSnapshot);
}
