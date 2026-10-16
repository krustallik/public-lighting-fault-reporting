import { beforeEach, describe, expect, it, vi } from 'vitest';

const lightPointServices = vi.hoisted(() => ({
  getAllLightPoints: vi.fn(), createLightPoint: vi.fn(), updateLightPoint: vi.fn(), deleteLightPoint: vi.fn(),
}));
vi.mock('../../src/services/lightPoints.service.js', () => lightPointServices);

import * as adminService from '../../src/services/admin.service.js';

beforeEach(() => Object.values(lightPointServices).forEach((service) => service.mockReset()));

describe('unmounted legacy admin service adapter', () => {
  it('delegates inventory operations and documents that legacy login is only a placeholder', async () => {
    lightPointServices.getAllLightPoints.mockResolvedValue([{ id: 1 }]);
    lightPointServices.createLightPoint.mockResolvedValue({ id: 2 });
    lightPointServices.updateLightPoint.mockResolvedValue({ id: 2, status: 'maintenance' });
    lightPointServices.deleteLightPoint.mockResolvedValue({ id: 2, deleted: true });

    await expect(adminService.getAdminLightPoints()).resolves.toEqual([{ id: 1 }]);
    const input = { inventory_number: 'LEGACY-2' } as never;
    await adminService.createLightPoint(input, 9, 'legacy.admin');
    expect(lightPointServices.createLightPoint).toHaveBeenCalledWith(input, 9, 'legacy.admin');
    await adminService.updateLightPoint(2, { status: 'maintenance' }, 9, 'legacy.admin');
    expect(lightPointServices.updateLightPoint).toHaveBeenCalledWith(2, { status: 'maintenance' }, 9, 'legacy.admin');
    await adminService.deleteLightPoint(2, 9, 'legacy.admin');
    expect(lightPointServices.deleteLightPoint).toHaveBeenCalledWith(2, 9, 'legacy.admin');

    const legacyLogin = await adminService.login({ username: 'admin', password: 'synthetic' });
    expect(legacyLogin.message).toContain('authentication not implemented');
    expect(legacyLogin.token).toBe('placeholder-jwt-token');
  });
});
