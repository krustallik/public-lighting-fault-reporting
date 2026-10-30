import { beforeEach, describe, expect, it, vi } from 'vitest';

const { query } = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('../../src/db/pool.js', () => ({ pool: { query } }));

import { getAdminDashboardOverview } from '../../src/services/adminDashboard.service.js';

beforeEach(() => query.mockReset());

describe('admin dashboard overview', () => {
  it('returns database aggregates and a bounded, PII-free recent history page', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ inventory_total: '255', reports_24h: '2', reports_7d: '6', reports_30d: '12' }] })
      .mockResolvedValueOnce({ rows: [{
        id: '41', submitted_at: '2026-10-30T10:00:00.000Z', locality: 'Jarná',
        target_kind: 'light-point', light_point_id: 17, latitude: 48.7, longitude: 21.2,
        fault_type_code: 'Q', automatic_notes: ['2 predchádzajúcich hlásení na evidovanom svietidle #17 za posledné 3 dni.'],
      }] });

    const result = await getAdminDashboardOverview();
    expect(result).toMatchObject({ inventoryTotal: 255, reports24h: 2, reports7d: 6, reports30d: 12 });
    expect(result.recent).toHaveLength(1);
    expect(query.mock.calls[0][0]).toContain("INTERVAL '30 days'");
    expect(query.mock.calls[1][0]).toContain('LIMIT 8');
    expect(query.mock.calls[1][0]).not.toMatch(/email|phone|description|attachment|ip_address/i);
  });
});
