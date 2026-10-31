import bcrypt from 'bcrypt';
import { randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { AUTH_COOKIE, authConfig } from '../../src/config/auth.js';
import { createApp } from '../../src/app.js';
import { pool } from '../../src/db/pool.js';
import { createReportAddressProof } from '../../src/services/reportAddressProof.js';

const enabled = process.env.PRODUCTION_FOUNDATION_POSTGRES === 'true';
const seededUsers: string[] = [];
const seededActivityActors: string[] = [];
const seededInventory: string[] = [];
const seededImportFiles: string[] = [];
const seededSubmissionAttemptIds: string[] = [];
let server: Server | undefined;
let baseUrl = '';

async function startApi(localTestSubmitEnabled = false, useCommittedServiceArea = false): Promise<void> {
  const env = {
    NODE_ENV: 'test',
    JWT_SECRET: authConfig.jwtSecret,
    EMAIL_VERIFICATION_ENABLED: 'false',
    LOCAL_TEST_SUBMIT_ENABLED: String(localTestSubmitEnabled),
  };
  server = createServer(createApp(env, useCommittedServiceArea ? {} : { serviceAreaClassifier: () => 'inside' }));
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
  if (seededSubmissionAttemptIds.length) {
    const attempts = seededSubmissionAttemptIds.splice(0);
    await pool.query(
      `DELETE FROM fault_report_history
        WHERE id IN (SELECT history_id FROM report_submission_attempts WHERE attempt_id = ANY($1::uuid[]))`, [attempts]
    );
    await pool.query('DELETE FROM report_submission_attempts WHERE attempt_id = ANY($1::uuid[])', [attempts]);
  }
  if (seededImportFiles.length) {
    await pool.query('DELETE FROM import_batches WHERE filename = ANY($1::text[])', [seededImportFiles.splice(0)]);
  }
  if (seededUsers.length) {
    await pool.query('DELETE FROM admin_activity_logs WHERE actor_username_snapshot = ANY($1::text[])', [seededUsers]);
  }
  if (seededActivityActors.length) {
    await pool.query('DELETE FROM admin_activity_logs WHERE actor_username_snapshot = ANY($1::text[])', [seededActivityActors.splice(0)]);
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
    expect((await fetch(`${baseUrl}/api/admin/reports/overview`)).status).toBe(401);
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
    submission.set('submissionAttemptId', randomUUID());
    submission.set('properties[detail_decription]', privateDescription);
    submission.set('properties[typ_poruchy]', 'Q10');
    submission.set('reportTarget', JSON.stringify({ kind: 'light-point', lightPointId: point.data.id }));
    const submissionAttemptId = randomUUID();
    seededSubmissionAttemptIds.push(submissionAttemptId);
    submission.set('submissionAttemptId', submissionAttemptId);
    submission.append('files[]', new Blob([privateAttachmentText], { type: 'text/plain' }), privateAttachmentName);

    const publicResponse = await fetch(`${baseUrl}/api/dev/ausemio-test-submit`, {
      method: 'POST', body: submission,
    });
    const publicBody = await publicResponse.text();
    expect(publicResponse.status).toBe(200);
    expect(JSON.parse(publicBody)).toEqual({
      success: true,
      status: 'local_test_received',
      duplicate: false,
      filesReceived: 1,
      receiptId: submissionAttemptId,
    });
    expect(publicBody).not.toContain('Posledné predchádzajúce hlásenie na evidovanom svietidle');
    for (const privateValue of [privateDescription, privateAttachmentName, privateAttachmentText, 'resident@example.test', '+421900000000']) {
      expect(publicBody).not.toContain(privateValue);
    }

    const changedDescription = `PRIVATE-CHANGED-REPORT-${randomUUID()}`;
    submission.set('properties[detail_decription]', changedDescription);
    submission.set('properties[typ_poruchy]', 'Q1');
    const duplicateResponse = await fetch(`${baseUrl}/api/dev/ausemio-test-submit`, {
      method: 'POST', body: submission,
    });
    const duplicateBody = await duplicateResponse.json() as Record<string, unknown>;
    expect(duplicateResponse.status).toBe(200);
    expect(duplicateBody).toEqual({
      success: true,
      status: 'local_test_received',
      duplicate: true,
      filesReceived: 1,
      receiptId: submissionAttemptId,
    });
    expect(JSON.stringify(duplicateBody)).not.toContain(changedDescription);
    const duplicatePersistence = await pool.query<{ attempts: string; matching_history: string; fault_type: string }>(
      `SELECT COUNT(DISTINCT attempt.attempt_id)::text AS attempts,
              COUNT(DISTINCT history.id)::text AS matching_history,
              MIN(history.fault_type_code) AS fault_type
         FROM report_submission_attempts attempt
         JOIN fault_report_history history ON history.id = attempt.history_id
        WHERE attempt.attempt_id = $1`, [submissionAttemptId]
    );
    expect(duplicatePersistence.rows[0]).toEqual({ attempts: '1', matching_history: '1', fault_type: 'Q10' });

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
    expect(historyBody).toContain('"Posledné predchádzajúce hlásenie na evidovanom svietidle #');
    for (const privateValue of [privateDescription, privateAttachmentName, privateAttachmentText, 'resident@example.test', '+421900000000']) {
      expect(historyBody).not.toContain(privateValue);
    }

    const persisted = await pool.query<{ row: string }>(
      `SELECT to_jsonb(report)::text AS row FROM fault_report_history report
        WHERE light_point_id = $1 ORDER BY submitted_at DESC, id DESC LIMIT 1`, [point.data.id]
    );
    expect(persisted.rows[0]?.row).toContain('Posledné predchádzajúce hlásenie na evidovanom svietidle #');
    for (const privateValue of [privateDescription, privateAttachmentName, privateAttachmentText, 'resident@example.test', '+421900000000']) {
      expect(persisted.rows[0]?.row).not.toContain(privateValue);
    }

    const customDescription = `PRIVATE-CUSTOM-REPORT-${randomUUID()}`;
    const customAttemptId = randomUUID();
    seededSubmissionAttemptIds.push(customAttemptId);
    const trustedAddress = 'Synthetic custom street, Košice';
    const customSubmission = new FormData();
    customSubmission.set('properties[vyber_sluzby]', '2');
    customSubmission.set('properties[ulica_miesto_poruchy_lokalita]', 'Spam');
    customSubmission.set('properties[tel_cislo]', '+421900000000');
    customSubmission.set('email', 'resident@example.test');
    customSubmission.set('locale', 'sk');
    customSubmission.set('submissionAttemptId', customAttemptId);
    customSubmission.set('properties[detail_decription]', customDescription);
    customSubmission.set('properties[typ_poruchy]', 'Q10');
    customSubmission.set('reportTarget', JSON.stringify({ kind: 'custom', latitude: 48.7164, longitude: 21.2611 }));
    customSubmission.set('automaticAddress', trustedAddress);
    customSubmission.set('automaticAddressProof', createReportAddressProof(
      trustedAddress, 'custom', 48.7164, 21.2611, authConfig.jwtSecret
    ));
    const customResponse = await fetch(`${baseUrl}/api/dev/ausemio-test-submit`, { method: 'POST', body: customSubmission });
    expect(customResponse.status).toBe(200);
    const customPersisted = await pool.query<{ row: string }>(
      `SELECT to_jsonb(history)::text AS row
         FROM report_submission_attempts attempt
         JOIN fault_report_history history ON history.id = attempt.history_id
        WHERE attempt.attempt_id = $1`, [customAttemptId]
    );
    expect(customPersisted.rows[0]?.row).toContain('"automatic_notes": []');
    expect(customPersisted.rows[0]?.row).not.toContain(trustedAddress);
    expect(customPersisted.rows[0]?.row).not.toContain(customDescription);

    const forgedAttemptId = randomUUID();
    seededSubmissionAttemptIds.push(forgedAttemptId);
    const forgedSubmission = new FormData();
    for (const [key, value] of customSubmission.entries()) forgedSubmission.append(key, value);
    forgedSubmission.set('submissionAttemptId', forgedAttemptId);
    forgedSubmission.set('automaticAddress', 'resident@example.test');
    const forgedResponse = await fetch(`${baseUrl}/api/dev/ausemio-test-submit`, { method: 'POST', body: forgedSubmission });
    expect(forgedResponse.status).toBe(400);
    const forgedPersistence = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM report_submission_attempts WHERE attempt_id = $1`, [forgedAttemptId]
    );
    expect(forgedPersistence.rows[0]?.count).toBe('0');
  });

  it('rejects a direct final local submission outside the committed Košice polygon before persistence', async () => {
    await startApi(true, true);
    const attemptId = randomUUID();
    seededSubmissionAttemptIds.push(attemptId);
    const submission = new FormData();
    submission.set('properties[vyber_sluzby]', '2');
    submission.set('properties[ulica_miesto_poruchy_lokalita]', 'Spam');
    submission.set('properties[tel_cislo]', '+421900000000');
    submission.set('email', 'resident@example.test');
    submission.set('locale', 'sk');
    submission.set('submissionAttemptId', attemptId);
    submission.set('properties[detail_decription]', 'Synthetic outside-location report');
    submission.set('properties[typ_poruchy]', 'Q10');
    submission.set('reportTarget', JSON.stringify({ kind: 'custom', latitude: 0, longitude: 0 }));

    const response = await fetch(`${baseUrl}/api/dev/ausemio-test-submit`, { method: 'POST', body: submission });
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({
      success: false,
      error: { code: 'LOCAL_TEST_INVALID_REPORT_LOCATION' },
    });

    const attempt = await pool.query<{ count: string }>(
      'SELECT COUNT(*)::text AS count FROM report_submission_attempts WHERE attempt_id = $1', [attemptId]
    );
    const history = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM fault_report_history
        WHERE target_kind = 'custom' AND ST_X(target_geom) = 0 AND ST_Y(target_geom) = 0`
    );
    expect(attempt.rows[0]?.count).toBe('0');
    expect(history.rows[0]?.count).toBe('0');
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

    expect((await fetch(`${baseUrl}/api/admin/auth/admins`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'unauthorized-test', password: 'synthetic-strong-password' }),
    })).status).toBe(401);
    const secondUsername = `coverage-admin-${randomUUID()}`;
    const secondPassword = 'synthetic-second-admin-password';
    const provisionedResponse = await fetch(`${baseUrl}/api/admin/auth/admins`, {
      method: 'POST', headers,
      body: JSON.stringify({ username: secondUsername, password: secondPassword, fullName: 'Synthetic Second Admin' }),
    });
    expect(provisionedResponse.status).toBe(201);
    seededUsers.push(secondUsername);
    const provisioned = await provisionedResponse.json() as { data: { id: number; username: string } };
    expect(provisioned.data).toMatchObject({ username: secondUsername, id: expect.any(Number) });
    const storedSecond = await pool.query<{ password_hash: string }>('SELECT password_hash FROM admins WHERE id = $1', [provisioned.data.id]);
    expect(storedSecond.rows[0]?.password_hash).not.toBe(secondPassword);
    expect(await bcrypt.compare(secondPassword, storedSecond.rows[0]!.password_hash)).toBe(true);
    const secondLogin = await fetch(`${baseUrl}/api/admin/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: secondUsername, password: secondPassword }),
    });
    expect(secondLogin.status).toBe(200);
    const secondCookies = cookieHeader(secondLogin);
    expect(await (await fetch(`${baseUrl}/api/admin/auth/me`, { headers: { Cookie: secondCookies } })).json())
      .toMatchObject({ success: true, data: { id: provisioned.data.id, username: secondUsername } });
    const accountAudit = await pool.query<{ actor_username_snapshot: string; entity_id: number }>(
      `SELECT actor_username_snapshot, entity_id FROM admin_activity_logs
        WHERE action = 'admin_created' AND entity_id = $1 ORDER BY id DESC LIMIT 1`, [provisioned.data.id]
    );
    expect(accountAudit.rows[0]).toMatchObject({ actor_username_snapshot: admin.username, entity_id: provisioned.data.id });

    const tieTime = '2099-01-01T00:00:00.000Z';
    const tieActors = [`synthetic-order-${randomUUID()}-a`, `synthetic-order-${randomUUID()}-b`];
    seededActivityActors.push(...tieActors);
    await pool.query(
      `INSERT INTO admin_activity_logs
         (admin_id, action, details, actor_username_snapshot, created_at)
       VALUES (NULL, 'synthetic_order_test', '{}'::jsonb, $1, $3),
              (NULL, 'synthetic_order_test', '{}'::jsonb, $2, $3)
       `, [tieActors[0], tieActors[1], tieTime]
    );
    const tieEvents = await pool.query<{ id: number; actor_username_snapshot: string }>(
      `SELECT id, actor_username_snapshot FROM admin_activity_logs
        WHERE actor_username_snapshot = ANY($1::text[]) ORDER BY id ASC`, [tieActors]
    );
    expect(tieEvents.rows).toHaveLength(2);
    const activityPageOne = await fetch(`${baseUrl}/api/admin/logs/activity?limit=1&page=1`, { headers });
    const activityPageTwo = await fetch(`${baseUrl}/api/admin/logs/activity?limit=1&page=2`, { headers });
    const activityOne = await activityPageOne.json() as { data: { items: Array<{ id: number; admin_username: string }> } };
    const activityTwo = await activityPageTwo.json() as { data: { items: Array<{ id: number; admin_username: string }> } };
    expect(activityOne.data.items[0]).toMatchObject({ id: tieEvents.rows[1]!.id, admin_username: tieEvents.rows[1]!.actor_username_snapshot });
    expect(activityTwo.data.items[0]).toMatchObject({ id: tieEvents.rows[0]!.id, admin_username: tieEvents.rows[0]!.actor_username_snapshot });

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
    const overview = await fetch(`${baseUrl}/api/admin/reports/overview`, { headers });
    expect(overview.status).toBe(200);
    expect(await overview.json()).toMatchObject({ success: true, data: {
      inventoryTotal: expect.any(Number), reports24h: expect.any(Number),
      reports7d: expect.any(Number), reports30d: expect.any(Number),
      recent: expect.arrayContaining([expect.objectContaining({ automatic_notes: ['Synthetic operator recurrence note.'] })]),
    } });

    const listed = await fetch(`${baseUrl}/api/admin/street-lights?search=${encodeURIComponent(inventoryNumber)}&page=1&limit=5`, { headers });
    expect(await listed.json()).toMatchObject({ success: true, data: { items: [{ id: created.data.id, inventory_number: inventoryNumber }] } });
    const filtered = await fetch(`${baseUrl}/api/admin/street-lights?page=0&limit=0&status=active&district=Synthetic&sortBy=address&sortOrder=desc`, { headers });
    expect(await filtered.json()).toMatchObject({ success: true, data: { pagination: { page: 1, limit: 20 } } });
    const byLampType = await fetch(`${baseUrl}/api/admin/street-lights?search=LED&sortBy=district&sortOrder=desc`, { headers });
    expect(await byLampType.json()).toMatchObject({ success: true, data: { items: expect.arrayContaining([expect.objectContaining({ id: created.data.id, lamp_type: 'LED' })]) } });
    expect((await fetch(`${baseUrl}/api/admin/street-lights?sortBy=lamp_type&sortOrder=asc`, { headers })).status).toBe(200);
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
    expect(await defaultPreviewRows.json()).toMatchObject({ success: true, data: { pagination: { page: 1, limit: 25 } } });
    const sortedPreviewRows = await fetch(`${baseUrl}/api/admin/street-lights/import/preview/${preview.data.previewId}?page=1&limit=25&sortBy=action&sortOrder=desc`, { headers: { Cookie: cookies } });
    const sortedPreview = await sortedPreviewRows.json() as { data: { results: Array<{ rowIndex: number; action: string }> } };
    expect(sortedPreview.data.results.map(({ action }) => action)).toEqual(['error', 'create']);
    expect(sortedPreview.data.results[0]).toMatchObject({ rowIndex: 2, action: 'error' });
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
