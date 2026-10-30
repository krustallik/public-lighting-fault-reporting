import bcrypt from 'bcrypt';
import { randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AUTH_COOKIE, authConfig } from '../../src/config/auth.js';
import { createApp } from '../../src/app.js';
import { pool } from '../../src/db/pool.js';
import { getReportAnalyticsSummary, listReportAnalytics } from '../../src/services/adminReportAnalytics.service.js';

const databaseIsExplicitlyDisposable = process.env.ADMIN_REPORT_ANALYTICS_POSTGRES_TEST === 'true' &&
  process.env.DB_HOST === '127.0.0.1' && process.env.DB_PORT === '55439' &&
  ['plfr_admin_analytics_disposable_20261030', 'plfr_admin_analytics_disposable_clean_20261030'].includes(process.env.DB_NAME ?? '') &&
  process.env.DB_USER === 'plfr_bench';
const suite = databaseIsExplicitlyDisposable ? describe : describe.skip;
const seededInventory: string[] = [];
const seededHistoryIds: string[] = [];
let seededAdmin: { id: number; username: string } | undefined;
let server: Server | undefined;
let baseUrl = '';

function cookieHeader(response: Response): string {
  const setCookie = response.headers.get('set-cookie') ?? '';
  const values = setCookie.split(/,\s*(?=[^;,]+=)/).map((cookie) => cookie.split(';', 1)[0]);
  const access = values.find((value) => value.startsWith(`${AUTH_COOKIE.access}=`));
  const refresh = values.find((value) => value.startsWith(`${AUTH_COOKIE.refresh}=`));
  return [access, refresh].filter(Boolean).join('; ');
}

async function insertPoint(input: {
  inventoryNumber: string;
  district: string | null;
  lampType: string;
  status: 'active' | 'inactive' | 'maintenance';
}): Promise<number> {
  const { rows } = await pool.query<{ id: number }>(
    `INSERT INTO light_points (inventory_number, geom, address, district, lamp_type, status)
     VALUES ($1, ST_SetSRID(ST_MakePoint(21.2611, 48.7164), 4326), 'Synthetic analytics street', $2, $3, $4)
     RETURNING id`,
    [input.inventoryNumber, input.district, input.lampType, input.status]
  );
  seededInventory.push(input.inventoryNumber);
  return rows[0].id;
}

async function insertHistory(input: {
  submittedAt: string;
  targetKind: 'light-point' | 'custom' | 'manual';
  pointId: number | null;
}): Promise<void> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO fault_report_history
       (submitted_at, service_code, locality, fault_type_code, target_kind, light_point_id, target_geom)
     VALUES ($1, 2, 'Košice', 'Q10', $2::varchar, $3,
       CASE WHEN $2::varchar = 'manual' THEN NULL ELSE ST_SetSRID(ST_MakePoint(21.2611, 48.7164), 4326) END)
     RETURNING id`,
    [input.submittedAt, input.targetKind, input.pointId]
  );
  seededHistoryIds.push(rows[0].id);
}

suite('admin report analytics PostgreSQL API on explicitly disposable database', () => {
  beforeAll(async () => {
    const username = `analytics-test-${randomUUID()}`;
    const passwordHash = await bcrypt.hash('synthetic-analytics-password', 4);
    const admin = await pool.query<{ id: number }>(
      'INSERT INTO admins (username, password_hash, full_name) VALUES ($1, $2, $3) RETURNING id',
      [username, passwordHash, 'Synthetic Analytics Admin']
    );
    seededAdmin = { id: admin.rows[0].id, username };

    server = createServer(createApp({ NODE_ENV: 'test', JWT_SECRET: authConfig.jwtSecret }));
    await new Promise<void>((resolve, reject) => {
      server?.once('error', reject);
      server?.listen(0, '127.0.0.1', resolve);
    });
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    const anchor = new Date('2026-10-30T12:00:00.000Z');
    const anchorIso = anchor.toISOString();
    const start = new Date(anchor.getTime() - 7 * 24 * 60 * 60 * 1000);
    const many = await insertPoint({ inventoryNumber: 'ANALYTICS-MANY', district: null, lampType: 'LED', status: 'inactive' });
    await insertPoint({ inventoryNumber: 'ANALYTICS-LEAST', district: 'Synthetic District', lampType: 'HPS', status: 'maintenance' });
    await insertPoint({ inventoryNumber: 'ANALYTICS-NONE', district: '', lampType: 'Sodium', status: 'active' });

    await insertHistory({ submittedAt: start.toISOString(), targetKind: 'light-point', pointId: many });
    await insertHistory({ submittedAt: new Date(start.getTime() + 86_400_000).toISOString(), targetKind: 'light-point', pointId: many });
    await insertHistory({ submittedAt: new Date(anchor.getTime() - 1).toISOString(), targetKind: 'light-point', pointId: many });
    await insertHistory({ submittedAt: anchorIso, targetKind: 'light-point', pointId: many });
    await insertHistory({ submittedAt: new Date(start.getTime() - 1).toISOString(), targetKind: 'light-point', pointId: many });
    await insertHistory({ submittedAt: new Date(anchor.getTime() - 86_400_000).toISOString(), targetKind: 'light-point', pointId: many + 1 });
    await insertHistory({ submittedAt: new Date(anchor.getTime() - 172_800_000).toISOString(), targetKind: 'manual', pointId: null });
    await insertHistory({ submittedAt: new Date(anchor.getTime() - 172_800_000).toISOString(), targetKind: 'custom', pointId: null });
    await insertHistory({ submittedAt: new Date(anchor.getTime() - 172_800_000).toISOString(), targetKind: 'light-point', pointId: 2_000_000_000 });
  });

  afterAll(async () => {
    if (server?.listening) {
      await new Promise<void>((resolve, reject) => server?.close((error) => error ? reject(error) : resolve()));
    }
    if (seededHistoryIds.length) {
      await pool.query('DELETE FROM fault_report_history WHERE id = ANY($1::bigint[])', [seededHistoryIds]);
    }
    if (seededInventory.length) {
      await pool.query('DELETE FROM light_points WHERE inventory_number = ANY($1::text[])', [seededInventory]);
    }
    if (seededAdmin) {
      await pool.query('DELETE FROM inventory_audit_events WHERE actor_admin_id = $1', [seededAdmin.id]);
      await pool.query('DELETE FROM admin_activity_logs WHERE admin_id = $1', [seededAdmin.id]);
      await pool.query('DELETE FROM admins WHERE id = $1', [seededAdmin.id]);
    }
  });

  it('authenticates analytics, honors UTC boundaries, and keeps manual/orphan reports out of point rankings', async () => {
    expect((await fetch(`${baseUrl}/api/admin/reports/analytics/summary?period=7d`)).status).toBe(401);

    const login = await fetch(`${baseUrl}/api/admin/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: seededAdmin?.username, password: 'synthetic-analytics-password' }),
    });
    expect(login.status).toBe(200);
    const cookie = cookieHeader(login);

    const activityResponse = await fetch(`${baseUrl}/api/admin/logs/activity`, { headers: { Cookie: cookie } });
    const activity = (await activityResponse.json() as { data: { items: Array<Record<string, unknown>> } }).data.items;
    const loginEvent = activity.find((event) => event.action === 'login' && event.admin_username === seededAdmin?.username);
    expect(loginEvent).toMatchObject({ entity_type: null, entity_id: null });
    expect(loginEvent).not.toHaveProperty('details');

    const anchor = new Date('2026-10-30T12:00:00.000Z');
    const summaryResponse = await fetch(`${baseUrl}/api/admin/reports/analytics/summary?period=7d`, { headers: { Cookie: cookie } });
    expect(summaryResponse.status).toBe(200);
    const summary = (await summaryResponse.json() as { data: Record<string, unknown> }).data;
    expect(summary).toMatchObject({
      period: '7d', totalLocalReports: 7, assignedToInventoryPoints: 5,
      customOrManualReports: 2, reportsForDeletedPoints: 1,
    });

    const mostResponse = await fetch(`${baseUrl}/api/admin/reports/analytics?period=7d&sortOrder=desc&limit=25`, { headers: { Cookie: cookie } });
    expect(mostResponse.status).toBe(200);
    const most = (await mostResponse.json() as { data: { items: Array<Record<string, unknown>> } }).data.items;
    expect(most[0]).toMatchObject({ inventory_number: 'ANALYTICS-MANY', report_count: 3, status: 'inactive' });
    expect(most.map((item) => item.inventory_number)).toContain('ANALYTICS-NONE');

    const leastResponse = await fetch(`${baseUrl}/api/admin/reports/analytics?period=7d&sortOrder=asc&limit=25`, { headers: { Cookie: cookie } });
    const least = (await leastResponse.json() as { data: { items: Array<Record<string, unknown>> } }).data.items;
    expect(least[0]).toMatchObject({ inventory_number: 'ANALYTICS-NONE', report_count: 0, status: 'active' });

    const filteredResponse = await fetch(`${baseUrl}/api/admin/reports/analytics?period=7d&search=ANALYTICS-MANY&status=inactive`, { headers: { Cookie: cookie } });
    const filtered = (await filteredResponse.json() as { data: { items: Array<Record<string, unknown>> } }).data.items;
    expect(filtered).toHaveLength(1);
    expect(filtered[0].inventory_number).toBe('ANALYTICS-MANY');

    const optionsResponse = await fetch(`${baseUrl}/api/admin/street-lights/filter-options`, { headers: { Cookie: cookie } });
    const options = (await optionsResponse.json() as { data: { lampTypes: string[]; districts: string[]; hasMissingDistrict: boolean; statuses: Array<{ value: string }> } }).data;
    expect(options).toMatchObject({ hasMissingDistrict: true });
    expect(options.lampTypes).toContain('LED');
    expect(options.districts).toContain('Synthetic District');
    expect(options.statuses.map(({ value }) => value)).toContain('maintenance');

    const deterministicSummary = await getReportAnalyticsSummary('7d', anchor);
    expect(deterministicSummary).toMatchObject({
      totalLocalReports: 7, assignedToInventoryPoints: 5,
      customOrManualReports: 2, reportsForDeletedPoints: 1,
      periodStart: new Date(anchor.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString(),
      periodEnd: anchor.toISOString(),
    });
    const exactBoundaryRows = await listReportAnalytics({
      period: '7d', search: 'ANALYTICS-MANY',
    }, anchor);
    expect(exactBoundaryRows.items).toHaveLength(1);
    expect(exactBoundaryRows.items[0]).toMatchObject({ report_count: 3, inventory_number: 'ANALYTICS-MANY' });
  });
});
