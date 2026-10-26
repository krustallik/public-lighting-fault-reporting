import bcrypt from 'bcrypt';
import { randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { AUTH_COOKIE, authConfig } from '../../src/config/auth.js';
import { createApp } from '../../src/app.js';
import { pool } from '../../src/db/pool.js';

const enabled = process.env.PRODUCTION_FOUNDATION_POSTGRES === 'true';
const seededUsers: string[] = [];
const seededInventory: string[] = [];
const seededImportFiles: string[] = [];
let server: Server | undefined;
let baseUrl = '';

async function startApi(localTestSubmitEnabled = false): Promise<void> {
  const env = {
    NODE_ENV: 'test',
    JWT_SECRET: authConfig.jwtSecret,
    EMAIL_VERIFICATION_ENABLED: 'false',
    LOCAL_TEST_SUBMIT_ENABLED: String(localTestSubmitEnabled),
  };
  server = createServer(createApp(env, { serviceAreaClassifier: () => 'inside' }));
  await new Promise<void>((resolve, reject) => {
    server?.once('error', reject);
    server?.listen(0, '127.0.0.1', resolve);
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

async function stopApi(): Promise<void> {
  if (!server?.listening) return;
  await new Promise<void>((resolve, reject) => server?.close((error) => error ? reject(error) : resolve()));
  server = undefined;
}

async function createAdmin(): Promise<{ id: number; username: string; password: string }> {
  const username = `coverage-api-${randomUUID()}`;
  const password = 'synthetic-api-password';
  seededUsers.push(username);
  const passwordHash = await bcrypt.hash(password, 4);
  const { rows } = await pool.query<{ id: number }>(
    'INSERT INTO admins (username, password_hash, full_name) VALUES ($1, $2, $3) RETURNING id',
    [username, passwordHash, 'Synthetic API Admin']
  );
  return { id: rows[0].id, username, password };
}

function cookieHeader(response: Response): string {
  const setCookie = response.headers.get('set-cookie') ?? '';
  const values = setCookie.split(/,\s*(?=[^;,]+=)/).map((cookie) => cookie.split(';', 1)[0]);
  const access = values.find((value) => value.startsWith(`${AUTH_COOKIE.access}=`));
  const refresh = values.find((value) => value.startsWith(`${AUTH_COOKIE.refresh}=`));
  return [access, refresh].filter(Boolean).join('; ');
}

afterEach(async () => {
  await stopApi();
  if (seededImportFiles.length) {
    await pool.query('DELETE FROM import_batches WHERE filename = ANY($1::text[])', [seededImportFiles.splice(0)]);
  }
  if (seededInventory.length) {
    await pool.query(
      `DELETE FROM fault_report_history WHERE light_point_id IN
        (SELECT id FROM light_points WHERE inventory_number = ANY($1::text[]))`, [seededInventory]
    );
    await pool.query('DELETE FROM light_points WHERE inventory_number = ANY($1::text[])', [seededInventory.splice(0)]);
  }
  if (seededUsers.length) {
    await pool.query('DELETE FROM admins WHERE username = ANY($1::text[])', [seededUsers.splice(0)]);
  }
});

describe.skipIf(!enabled)('public and admin HTTP API with disposable PostgreSQL', () => {
  it('serves public inventory, validates IDs, and requires an admin session for inventory mutation', async () => {
    await startApi();
    expect(await (await fetch(`${baseUrl}/api/health`)).json()).toMatchObject({ status: 'ok', service: 'public-lighting-api' });
    const publicList = await fetch(`${baseUrl}/api/light-points`);
    expect(publicList.status).toBe(200);
    expect((await publicList.json() as { success: boolean; data: unknown[] }).success).toBe(true);
    expect((await fetch(`${baseUrl}/api/light-points?bbox=21.2%2C48.6%2C21.4%2C48.8`)).status).toBe(200);
    expect((await fetch(`${baseUrl}/api/light-points?bbox=21.2&bbox=21.4`)).status).toBe(400);
    expect(await (await fetch(`${baseUrl}/api/light-points/not-a-number`)).json()).toMatchObject({ success: false, message: 'Light point not found' });
    expect(await (await fetch(`${baseUrl}/api/admin/street-lights`)).json()).toMatchObject({ success: false, message: 'Authentication required' });
    expect((await fetch(`${baseUrl}/api/admin/street-lights/1`, { method: 'DELETE' })).status).toBe(401);
    expect((await fetch(`${baseUrl}/api/admin/reports/history`)).status).toBe(401);
  });

  it('saves a multipart local report to PostgreSQL and exposes only metadata and notes in admin history', async () => {
    const admin = await createAdmin();
    await startApi(true);
    const login = await fetch(`${baseUrl}/api/admin/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: admin.username, password: admin.password }),
    });
    expect(login.status).toBe(200);
    const adminCookies = cookieHeader(login);

    const inventoryNumber = `COV-REPORT-${randomUUID()}`;
    seededInventory.push(inventoryNumber);
    const createPoint = await fetch(`${baseUrl}/api/admin/street-lights`, {
      method: 'POST', headers: { Cookie: adminCookies, 'Content-Type': 'application/json' },
      body: JSON.stringify({ inventory_number: inventoryNumber, latitude: 48.7164, longitude: 21.2611, address: 'Synthetic report street' }),
    });
    expect(createPoint.status).toBe(201);
    const point = await createPoint.json() as { data: { id: number } };
    await pool.query(
      `INSERT INTO fault_report_history
         (submitted_at, service_code, locality, fault_type_code, target_kind, light_point_id, target_geom)
       SELECT clock_timestamp() - interval '1 day', 2, 'Spam', 'Q10', 'light-point', id, geom
         FROM light_points WHERE id = $1`, [point.data.id]
    );

    const privateDescription = `PRIVATE-SYNTHETIC-REPORT-${randomUUID()}`;
    const privateAttachmentName = `PRIVATE-SYNTHETIC-FILE-${randomUUID()}.txt`;
    const privateAttachmentText = `PRIVATE-SYNTHETIC-ATTACHMENT-${randomUUID()}`;
    const submission = new FormData();
    submission.set('properties[vyber_sluzby]', '2');
    submission.set('properties[ulica_miesto_poruchy_lokalita]', 'Spam');
    submission.set('properties[tel_cislo]', '+421900000000');
    submission.set('email', 'resident@example.test');
    submission.set('locale', 'sk');
    submission.set('properties[detail_decription]', privateDescription);
    submission.set('properties[typ_poruchy]', 'Q10');
    submission.set('reportTarget', JSON.stringify({ kind: 'light-point', lightPointId: point.data.id }));
    submission.append('files[]', new Blob([privateAttachmentText], { type: 'text/plain' }), privateAttachmentName);

    const publicResponse = await fetch(`${baseUrl}/api/dev/ausemio-test-submit`, {
      method: 'POST', body: submission,
    });
    const publicBody = await publicResponse.text();
    expect(publicResponse.status).toBe(200);
    expect(JSON.parse(publicBody)).toEqual({ success: true, status: 'local_test_received', filesReceived: 1 });
    expect(publicBody).not.toContain('Posledné predchádzajúce hlásenie:');
    for (const privateValue of [privateDescription, privateAttachmentName, privateAttachmentText, 'resident@example.test', '+421900000000']) {
      expect(publicBody).not.toContain(privateValue);
    }

    const historyResponse = await fetch(`${baseUrl}/api/admin/reports/history?limit=10&offset=0`, {
      headers: { Cookie: adminCookies },
    });
    expect(historyResponse.status).toBe(200);
    const historyBody = await historyResponse.text();
    expect(historyBody).toContain(`"light_point_id":${point.data.id}`);
    expect(historyBody).toContain('"service_code":2');
    expect(historyBody).toContain('"fault_type_code":"Q10"');
    expect(historyBody).toContain('"target_kind":"light-point"');
    expect(historyBody).toContain('"automatic_notes":["');
    expect(historyBody).toContain('"Posledné predchádzajúce hlásenie:');
    for (const privateValue of [privateDescription, privateAttachmentName, privateAttachmentText, 'resident@example.test', '+421900000000']) {
      expect(historyBody).not.toContain(privateValue);
    }

    const persisted = await pool.query<{ row: string }>(
      `SELECT to_jsonb(report)::text AS row FROM fault_report_history report
        WHERE light_point_id = $1 ORDER BY submitted_at DESC, id DESC LIMIT 1`, [point.data.id]
    );
    expect(persisted.rows[0]?.row).toContain('Posledné predchádzajúce hlásenie:');
    for (const privateValue of [privateDescription, privateAttachmentName, privateAttachmentText, 'resident@example.test', '+421900000000']) {
      expect(persisted.rows[0]?.row).not.toContain(privateValue);
    }
  });

  it('logs in, performs inventory CRUD and export, and serves activity and import history through the protected API', async () => {
    const admin = await createAdmin();
    await startApi();
    const missingCredentials = await fetch(`${baseUrl}/api/admin/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: ' ', password: '' }),
    });
    expect(missingCredentials.status).toBe(400);
    const badCredentials = await fetch(`${baseUrl}/api/admin/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: admin.username, password: 'wrong-password' }),
    });
    expect(badCredentials.status).toBe(401);
    expect(await (await fetch(`${baseUrl}/api/admin/auth/me`)).json()).toMatchObject({ success: true, data: null });
    expect(await (await fetch(`${baseUrl}/api/admin/auth/me`, { headers: { Cookie: `${AUTH_COOKIE.access}=malformed` } })).json())
      .toMatchObject({ success: true, data: null });
    expect((await fetch(`${baseUrl}/api/admin/auth/refresh`, { method: 'POST' })).status).toBe(401);
    expect((await fetch(`${baseUrl}/api/admin/auth/refresh`, {
      method: 'POST', headers: { Cookie: `${AUTH_COOKIE.refresh}=malformed` },
    })).status).toBe(401);

    const login = await fetch(`${baseUrl}/api/admin/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: admin.username, password: admin.password }),
    });
    expect(login.status).toBe(200);
    const cookies = cookieHeader(login);
    expect(cookies).toContain(`${AUTH_COOKIE.access}=`);
    expect(cookies).toContain(`${AUTH_COOKIE.refresh}=`);
    expect(await login.json()).toMatchObject({ success: true, data: { id: admin.id, username: admin.username } });
    const headers = { Cookie: cookies, 'Content-Type': 'application/json' };

    const refreshed = await fetch(`${baseUrl}/api/admin/auth/refresh`, { method: 'POST', headers: { Cookie: cookies } });
    expect(refreshed.status).toBe(200);
    const refreshedCookies = cookieHeader(refreshed);
    expect(refreshedCookies).toContain(`${AUTH_COOKIE.refresh}=`);
    expect(refreshedCookies).not.toBe(cookies);
    expect((await fetch(`${baseUrl}/api/admin/auth/refresh`, {
      method: 'POST', headers: { Cookie: `${AUTH_COOKIE.refresh}=${cookies.split('; ').find((value) => value.startsWith(`${AUTH_COOKIE.refresh}=`))?.split('=')[1]}` },
    })).status).toBe(401);

    expect(await (await fetch(`${baseUrl}/api/admin/auth/me`, { headers })).json()).toMatchObject({ success: true, data: { id: admin.id } });
    const inventoryNumber = `COV-${randomUUID()}`;
    seededInventory.push(inventoryNumber);
    const createdResponse = await fetch(`${baseUrl}/api/admin/street-lights`, {
      method: 'POST', headers,
      body: JSON.stringify({ inventory_number: inventoryNumber, latitude: 48.7164, longitude: 21.2611, address: 'Synthetic API street', district: 'Synthetic district', lamp_type: 'LED' }),
    });
    expect(createdResponse.status).toBe(201);
    const created = await createdResponse.json() as { data: { id: number; inventory_number: string } };
    expect(created.data.inventory_number).toBe(inventoryNumber);
    expect((await fetch(`${baseUrl}/api/light-points/${created.data.id}`)).status).toBe(200);

    await pool.query(
      `INSERT INTO fault_report_history
         (submitted_at, service_code, locality, fault_type_code, target_kind, light_point_id, target_geom, automatic_notes)
       SELECT clock_timestamp(), 2, 'Spam', 'Q10', 'light-point', id, geom, ARRAY['Synthetic operator recurrence note.']::text[]
         FROM light_points WHERE id = $1`, [created.data.id]
    );
    const reportHistory = await fetch(`${baseUrl}/api/admin/reports/history?limit=10&offset=0`, { headers });
    const historyBody = await reportHistory.text();
    expect(reportHistory.status).toBe(200);
    expect(historyBody).toContain('Synthetic operator recurrence note.');
    expect(historyBody).toContain('"light_point_id":' + created.data.id);
    expect(historyBody).not.toContain('telephone');
    expect(historyBody).not.toContain('email');
    expect(historyBody).not.toContain('description');
    expect((await fetch(`${baseUrl}/api/admin/reports/history?limit=101`, { headers })).status).toBe(400);

    const listed = await fetch(`${baseUrl}/api/admin/street-lights?search=${encodeURIComponent(inventoryNumber)}&page=1&limit=5`, { headers });
    expect(await listed.json()).toMatchObject({ success: true, data: { items: [{ id: created.data.id, inventory_number: inventoryNumber }] } });
    const filtered = await fetch(`${baseUrl}/api/admin/street-lights?page=0&limit=0&status=active&district=Synthetic&sortBy=address&sortOrder=desc`, { headers });
    expect(await filtered.json()).toMatchObject({ success: true, data: { pagination: { page: 1, limit: 20 } } });
    expect((await fetch(`${baseUrl}/api/admin/street-lights?sortBy=untrusted-column&sortOrder=sideways`, { headers })).status).toBe(200);
    expect((await fetch(`${baseUrl}/api/admin/street-lights/${created.data.id}`, { headers })).status).toBe(200);
    const updated = await fetch(`${baseUrl}/api/admin/street-lights/${created.data.id}`, {
      method: 'PUT', headers, body: JSON.stringify({ inventoryNumber, address: 'Updated synthetic street', status: 'maintenance' }),
    });
    expect(await updated.json()).toMatchObject({ success: true, data: { address: 'Updated synthetic street', status: 'maintenance' } });

    const exportResponse = await fetch(`${baseUrl}/api/admin/street-lights/export?format=json&search=${encodeURIComponent(inventoryNumber)}`, { headers });
    expect(exportResponse.status).toBe(200);
    expect(await exportResponse.text()).toContain(inventoryNumber);
    expect((await fetch(`${baseUrl}/api/admin/street-lights/export?format=exe`, { headers })).status).toBe(400);
    expect((await fetch(`${baseUrl}/api/admin/street-lights/export`, { headers })).status).toBe(200);
    expect((await fetch(`${baseUrl}/api/admin/street-lights/export?format=geojson`, { headers })).status).toBe(200);

    const camelCaseInventory = `COV-ALIAS-${randomUUID()}`;
    seededInventory.push(camelCaseInventory);
    const aliasCreated = await fetch(`${baseUrl}/api/admin/street-lights`, {
      method: 'POST', headers,
      body: JSON.stringify({ inventoryNumber: camelCaseInventory, external_id: `EXT-${randomUUID()}`, latitude: 48.7165, longitude: 21.2612, address: 'Alias street' }),
    });
    expect(aliasCreated.status).toBe(201);
    expect(await aliasCreated.json()).toMatchObject({ success: true, data: { inventory_number: camelCaseInventory } });

    const importFilename = `coverage-import-${randomUUID()}.json`;
    seededImportFiles.push(importFilename);
    const importBody = new FormData();
    importBody.append('file', new Blob([JSON.stringify([
      { inventory_number: `IMPORT-${randomUUID()}`, latitude: 48.718, longitude: 21.263, address: 'Synthetic imported address' },
      { inventory_number: '', latitude: 48.719, longitude: 21.264 },
    ])], { type: 'application/json' }), importFilename);
    const previewResponse = await fetch(`${baseUrl}/api/admin/street-lights/import/preview`, {
      method: 'POST', headers: { Cookie: cookies }, body: importBody,
    });
    expect(previewResponse.status).toBe(200);
    const preview = await previewResponse.json() as { data: { previewId: string; summary: { toCreate: number; errors: number } } };
    expect(preview.data.summary).toMatchObject({ toCreate: 1, errors: 1 });
    const defaultPreviewRows = await fetch(`${baseUrl}/api/admin/street-lights/import/preview/${preview.data.previewId}`, { headers: { Cookie: cookies } });
    expect(await defaultPreviewRows.json()).toMatchObject({ success: true, data: { pagination: { page: 1, limit: 50 } } });
    const invalidPreviewPage = await fetch(`${baseUrl}/api/admin/street-lights/import/preview/${preview.data.previewId}?page=bad`, { headers: { Cookie: cookies } });
    expect(invalidPreviewPage.status).toBe(400);
    const previewRows = await fetch(`${baseUrl}/api/admin/street-lights/import/preview/${preview.data.previewId}?page=1&limit=10`, { headers: { Cookie: cookies } });
    expect(await previewRows.json()).toMatchObject({ success: true, data: { totalRows: 2, results: expect.any(Array) } });
    expect((await fetch(`${baseUrl}/api/admin/street-lights/import/preview`, {
      method: 'POST', headers: { Cookie: cookies }, body: new FormData(),
    })).status).toBe(400);
    const emptyImport = new FormData();
    emptyImport.append('file', new Blob(['[]'], { type: 'application/json' }), `coverage-empty-${randomUUID()}.json`);
    expect((await fetch(`${baseUrl}/api/admin/street-lights/import/preview`, {
      method: 'POST', headers: { Cookie: cookies }, body: emptyImport,
    })).status).toBe(400);
    const missingConfirmation = await fetch(`${baseUrl}/api/admin/street-lights/import/confirm`, {
      method: 'POST', headers, body: JSON.stringify({ previewId: preview.data.previewId }),
    });
    expect(missingConfirmation.status).toBe(400);
    const confirmation = await fetch(`${baseUrl}/api/admin/street-lights/import/confirm`, {
      method: 'POST', headers, body: JSON.stringify({ previewId: preview.data.previewId, allowUpdate: false }),
    });
    expect(confirmation.status).toBe(202);
    const batch = await confirmation.json() as { data: { batchId: number } };
    expect((await fetch(`${baseUrl}/api/admin/street-lights/imports/${batch.data.batchId}`, { headers })).status).toBe(200);
    expect((await fetch(`${baseUrl}/api/admin/street-lights/imports/999999`, { headers })).status).toBe(404);
    expect((await fetch(`${baseUrl}/api/admin/street-lights/imports/${batch.data.batchId}/rows?limit=10&cursor=0`, { headers })).status).toBe(200);
    expect((await fetch(`${baseUrl}/api/admin/street-lights/imports/${batch.data.batchId}/rows`, { headers })).status).toBe(200);
    expect((await fetch(`${baseUrl}/api/admin/street-lights/imports/${batch.data.batchId}/rows?limit=bad`, { headers })).status).toBe(400);
    expect((await fetch(`${baseUrl}/api/admin/street-lights/imports/not-a-number`, { headers })).status).toBe(400);
    expect((await fetch(`${baseUrl}/api/admin/street-lights/imports/999999/rows`, { headers })).status).toBe(404);

    expect((await fetch(`${baseUrl}/api/admin/street-lights/not-a-number`, { headers })).status).toBe(400);
    expect(await (await fetch(`${baseUrl}/api/admin/street-lights/not-a-number`, { headers })).json()).toMatchObject({ success: false, message: 'Invalid street light id' });
    expect((await fetch(`${baseUrl}/api/admin/street-lights/not-a-number`, { method: 'PUT', headers, body: JSON.stringify({ address: 'invalid id' }) })).status).toBe(400);
    expect((await fetch(`${baseUrl}/api/admin/street-lights/not-a-number`, { method: 'DELETE', headers })).status).toBe(400);

    expect((await fetch(`${baseUrl}/api/admin/logs/activity`, { headers })).status).toBe(200);
    expect(await (await fetch(`${baseUrl}/api/admin/logs/imports?limit=3&offset=0`, { headers })).json()).toMatchObject({ success: true, data: { limit: 3, offset: 0 } });
    expect((await fetch(`${baseUrl}/api/admin/logs/imports?limit=0`, { headers })).status).toBe(400);
    expect((await fetch(`${baseUrl}/api/admin/logs/integration`, { headers })).status).toBe(200);
    expect((await fetch(`${baseUrl}/api/admin/integration/settings`, { headers })).status).toBe(200);

    expect((await fetch(`${baseUrl}/api/admin/street-lights/${created.data.id}`, { method: 'DELETE', headers })).status).toBe(200);
    expect((await fetch(`${baseUrl}/api/admin/street-lights/${created.data.id}`, { headers })).status).toBe(404);
    const logout = await fetch(`${baseUrl}/api/admin/auth/logout`, { method: 'POST', headers });
    expect(await logout.json()).toMatchObject({ success: true, message: 'Logged out' });
    expect(logout.headers.get('set-cookie')).toContain(`${AUTH_COOKIE.access}=`);
  });
});
