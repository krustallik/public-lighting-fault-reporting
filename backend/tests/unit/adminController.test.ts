import { beforeEach, describe, expect, it, vi } from 'vitest';

const services = vi.hoisted(() => ({
  login: vi.fn(), getAdminLightPoints: vi.fn(), createLightPoint: vi.fn(),
  updateLightPoint: vi.fn(), deleteLightPoint: vi.fn(),
}));
vi.mock('../../src/services/admin.service.js', () => services);

import * as controller from '../../src/controllers/admin.controller.js';

function response() {
  return { status: vi.fn().mockReturnThis(), json: vi.fn() };
}

beforeEach(() => {
  Object.values(services).forEach((service) => service.mockReset());
});

describe('unmounted legacy admin controller adapter contract', () => {
  it('forwards each operation and passes the optional audit actor without inventing one', async () => {
    services.login.mockResolvedValue({ token: 'legacy', user: { username: 'resident-admin' } });
    services.getAdminLightPoints.mockResolvedValue([{ id: 1 }]);
    services.createLightPoint.mockResolvedValue({ id: 2 });
    services.updateLightPoint.mockResolvedValue({ id: 2, status: 'inactive' });
    services.deleteLightPoint.mockResolvedValue({ id: 2 });

    const loginResponse = response();
    await controller.login({ body: { username: 'admin', password: 'synthetic' } } as never, loginResponse as never, vi.fn());
    expect(services.login).toHaveBeenCalledWith({ username: 'admin', password: 'synthetic' });
    expect(loginResponse.json).toHaveBeenCalledWith({ success: true, data: { token: 'legacy', user: { username: 'resident-admin' } } });

    const listResponse = response();
    await controller.getLightPoints({} as never, listResponse as never, vi.fn());
    expect(services.getAdminLightPoints).toHaveBeenCalledOnce();
    expect(listResponse.json).toHaveBeenCalledWith({ success: true, data: [{ id: 1 }] });

    const createResponse = response();
    await controller.createLightPoint({ body: { inventory_number: 'LEGACY-2' } } as never, createResponse as never, vi.fn());
    expect(services.createLightPoint).toHaveBeenCalledWith({ inventory_number: 'LEGACY-2' }, null, null);
    expect(createResponse.status).toHaveBeenCalledWith(201);

    const actor = { id: 7, username: 'legacy.admin' };
    await controller.updateLightPoint({ params: { id: '2' }, body: { status: 'inactive' }, admin: actor } as never, response() as never, vi.fn());
    expect(services.updateLightPoint).toHaveBeenCalledWith('2', { status: 'inactive' }, 7, 'legacy.admin');
    const deleteResponse = response();
    await controller.deleteLightPoint({ params: { id: '2' }, admin: actor } as never, deleteResponse as never, vi.fn());
    expect(services.deleteLightPoint).toHaveBeenCalledWith('2', 7, 'legacy.admin');
    expect(deleteResponse.json).toHaveBeenCalledWith({ success: true, message: 'Light point deleted' });
  });

  it.each([
    ['login', () => controller.login({ body: {} } as never, response() as never, next), () => services.login],
    ['list', () => controller.getLightPoints({} as never, response() as never, next), () => services.getAdminLightPoints],
    ['create', () => controller.createLightPoint({ body: {} } as never, response() as never, next), () => services.createLightPoint],
    ['update', () => controller.updateLightPoint({ params: { id: '1' }, body: {} } as never, response() as never, next), () => services.updateLightPoint],
    ['delete', () => controller.deleteLightPoint({ params: { id: '1' } } as never, response() as never, next), () => services.deleteLightPoint],
  ])('forwards %s service errors to Express error handling', async (_name, invoke, getService) => {
    const error = new Error('synthetic legacy adapter failure');
    getService().mockRejectedValueOnce(error);
    await invoke();
    expect(next).toHaveBeenCalledWith(error);
  });
});

const next = vi.fn();
