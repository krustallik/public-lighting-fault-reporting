import { beforeEach, describe, expect, it, vi } from 'vitest';

const { query } = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('../../src/db/pool.js', () => ({ pool: { query } }));

import { getReportAnalyticsSummary, listReportAnalytics } from '../../src/services/adminReportAnalytics.service.js';

beforeEach(() => query.mockReset());

describe('local report analytics SQL', () => {
  it('returns an explicit empty-period summary when PostgreSQL has no aggregate row', async () => {
    query.mockResolvedValueOnce({ rows: [] });

    await expect(getReportAnalyticsSummary('24h')).resolves.toMatchObject({
      period: '24h', periodStart: null, periodEnd: null, totalLocalReports: 0,
      assignedToInventoryPoints: 0, customOrManualReports: 0, reportsForDeletedPoints: 0,
    });
  });

  it('uses rolling UTC boundaries and counts local reports without exposing payload fields', async () => {
    query.mockResolvedValueOnce({ rows: [{
      period_start: '2026-10-23T12:00:00.000Z', period_end: '2026-10-30T12:00:00.000Z',
      total_reports: '8', assigned_reports: '6', unassigned_reports: '2', orphaned_assigned_reports: '1',
    }] });
    await expect(getReportAnalyticsSummary('7d', new Date('2026-10-30T12:00:00.000Z'))).resolves.toEqual({
      period: '7d', periodStart: '2026-10-23T12:00:00.000Z', periodEnd: '2026-10-30T12:00:00.000Z',
      totalLocalReports: 8, assignedToInventoryPoints: 6, customOrManualReports: 2, reportsForDeletedPoints: 1,
    });
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain('history.submitted_at < bounds.period_end');
    expect(sql).toContain("history.target_kind = 'light-point'");
    expect(sql).toContain('point.id IS NULL');
    expect(sql).not.toMatch(/email|phone|description|attachment|ip_address/i);
    expect(params).toEqual([604_800, new Date('2026-10-30T12:00:00.000Z')]);
  });

  it('includes all inventory lights, defaults to descending reports, and has deterministic tie-breakers', async () => {
    query.mockResolvedValueOnce({ rows: [{ total: '52' }] }).mockResolvedValueOnce({ rows: [{ id: 9, report_count: 4 }, { id: 10, report_count: 0 }] });
    const referenceTime = new Date('2026-10-30T12:00:00.000Z');
    const result = await listReportAnalytics({ period: '30d', page: 2, limit: 25 }, referenceTime);
    expect(result.pagination).toEqual({ page: 2, limit: 25, total: 52, totalPages: 3 });
    const [countSql, params] = query.mock.calls[0];
    expect(countSql).toContain('FROM light_points point CROSS JOIN bounds');
    expect(countSql).toContain('LEFT JOIN fault_report_history');
    expect(countSql).toContain("history.target_kind = 'light-point'");
    expect(countSql).not.toContain('report_count > 0');
    expect(query.mock.calls[1][0]).toContain('ORDER BY report_count DESC, inventory_number COLLATE "C" ASC, id ASC');
    expect(params).toEqual([2_592_000, referenceTime]);
    expect(query.mock.calls[1][1]).toEqual([2_592_000, referenceTime, 25, 25]);
  });

  it('sorts the complete inventory ascending including zeroes, with parameterized universal search and status', async () => {
    query.mockResolvedValueOnce({ rows: [{ total: '1' }] }).mockResolvedValueOnce({ rows: [{ id: 1, report_count: 0 }] });
    await listReportAnalytics({ period: '24h', search: "%' OR TRUE --", status: 'inactive', page: 1, limit: 25, order: 'asc' });
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain('report_count');
    expect(sql).toContain('status = $4');
    expect(sql).not.toContain("%' OR TRUE");
    expect(params).toEqual([86_400, expect.any(Date), "%%' OR TRUE --%", 'inactive']);
    expect(query.mock.calls[1][0]).toContain('ORDER BY report_count ASC, inventory_number COLLATE "C" ASC, id ASC');
    expect(query.mock.calls[1][1]).toEqual([86_400, expect.any(Date), "%%' OR TRUE --%", 'inactive', 25, 0]);
  });

  it('counts only explicitly linked inventory reports and never assigns custom reports to a point', async () => {
    query.mockResolvedValueOnce({ rows: [{ total: '0' }] }).mockResolvedValueOnce({ rows: [] });
    await listReportAnalytics({ period: '90d', order: 'asc' });
    expect(query.mock.calls[0][0]).toContain("history.target_kind = 'light-point'");
    expect(query.mock.calls[0][0]).not.toContain('target_kind <>');
  });

  it.each(['1d', '30days', '', 'toString', 'constructor', '__proto__'])('rejects unsupported period %s before querying', async (period) => {
    await expect(getReportAnalyticsSummary(period)).rejects.toMatchObject({ status: 400 });
    expect(query).not.toHaveBeenCalled();
  });

  it('rejects unsupported status and order without executing database work', async () => {
    await expect(listReportAnalytics({ period: '7d', status: 'admin' as never })).rejects.toMatchObject({ status: 400 });
    await expect(listReportAnalytics({ period: '7d', order: 'sideways' as never })).rejects.toMatchObject({ status: 400 });
    expect(query).not.toHaveBeenCalled();
  });
});
