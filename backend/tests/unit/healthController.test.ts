import { describe, expect, it, vi } from 'vitest';

const { checkHealth } = vi.hoisted(() => ({ checkHealth: vi.fn() }));
vi.mock('../../src/services/health.service.js', () => ({ checkHealth }));

import { getHealth } from '../../src/controllers/health.controller.js';

describe('health controller HTTP response', () => {
  it('returns the service health document and forwards database failures', async () => {
    const health = { status: 'ok', timestamp: '2026-10-16T00:00:00.000Z', service: 'public-lighting-api' };
    const response = { json: vi.fn() };
    const next = vi.fn();
    checkHealth.mockResolvedValueOnce(health);
    await getHealth({} as never, response as never, next);
    expect(response.json).toHaveBeenCalledWith(health);

    const failure = new Error('synthetic database unavailable');
    checkHealth.mockRejectedValueOnce(failure);
    await getHealth({} as never, response as never, next);
    expect(next).toHaveBeenCalledWith(failure);
  });
});
