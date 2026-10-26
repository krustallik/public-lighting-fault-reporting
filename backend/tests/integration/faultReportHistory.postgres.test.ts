import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../../src/db/pool.js';
import { EmailVerificationCrypto } from '../../src/services/emailVerificationCrypto.js';
import { PostgresEmailVerificationStore } from '../../src/services/emailVerificationStore.js';
import { FAULT_HISTORY_SUMMARY_SQL, PostgresFaultHistoryStore } from '../../src/services/faultReportHistory.service.js';

const isCiDisposable = process.env.P2C_POSTGRES_INTEGRATION === 'true' &&
  process.env.DB_HOST === '127.0.0.1' && process.env.DB_NAME === 'p3_ci_test';
const isLocalUatDisposable = process.env.REPORT_HISTORY_UAT_TEST === 'true' &&
  process.env.LOCAL_UAT_MODE === 'true' && process.env.DB_HOST === '127.0.0.1' &&
  process.env.DB_PORT === '5433' && process.env.DB_NAME === 'lighting_faults_local_uat_dev' &&
  process.env.DB_USER === 'plfr_uat';
const isLocalDockerTestDatabase = process.env.REPORT_HISTORY_DOCKER_TEST === 'true' &&
  process.env.NODE_ENV === 'development' && process.env.LOCAL_UAT_MODE === 'true' &&
  process.env.LOCAL_UAT_CONTAINER_MODE === 'true' && process.env.DB_HOST === 'db' &&
  process.env.DB_PORT === '5432' && process.env.DB_NAME === 'p3_ci_test' &&
  process.env.DB_USER === 'plfr_uat';
const enabled = isCiDisposable || isLocalUatDisposable || isLocalDockerTestDatabase;
const suite = enabled ? describe : describe.skip;
const service = new PostgresFaultHistoryStore(pool, () => 'inside');
const crypto = new EmailVerificationCrypto(Buffer.alloc(32, 19).toString('base64url'));
const verificationStore = new PostgresEmailVerificationStore(pool);
const pointIds: number[] = [];

suite('privacy-safe fault history PostgreSQL integration', () => {
  beforeAll(async () => {
    for (let index = 0; index < 6; index += 1) {
      const result = await pool.query<{ id: number }>(
        `INSERT INTO light_points (inventory_number, geom, address, status)
         VALUES ($1, ST_SetSRID(ST_MakePoint(21.2611, 48.7164), 4326), 'Synthetic local test', 'active')
         RETURNING id`,
        [`HISTORY-TEST-${process.pid}-${index}-${randomUUID()}`]
      );
      pointIds.push(result.rows[0].id);
    }
  });

  afterAll(async () => {
    try {
      if (pointIds.length) {
        await pool.query('DELETE FROM fault_report_history WHERE light_point_id = ANY($1::integer[])', [pointIds]);
        await pool.query('DELETE FROM light_points WHERE id = ANY($1::integer[])', [pointIds]);
      }
    } finally {
      await pool.end();
    }
  });

  it('derives inventory-only recurrence, composes the operator field in memory, and stores no citizen payload', async () => {
    const pointId = pointIds[0];
    await pool.query(
      `INSERT INTO fault_report_history
         (submitted_at, service_code, locality, fault_type_code, target_kind, light_point_id, target_geom)
       SELECT clock_timestamp() - (age.days * interval '1 day'), 2, 'Spam', 'Q10', 'light-point', $1, geom
         FROM light_points CROSS JOIN (VALUES (1), (2), (8), (12), (20)) AS age(days)
        WHERE id = $1`, [pointId]
    );

    const result = await service.recordSubmission({
      locality: 'Spam', faultTypeCode: 'Q10', detailDescription: 'Private user description test string',
      reportTarget: { kind: 'light-point', lightPointId: pointId, latitude: 0, longitude: 0 },
    });

    expect(result.authorized).toBe(true);
    expect(result.automaticNotes).toEqual([
      'Opakované hlásenia: 5 predchádzajúcich hlásení za posledných 30 dní, z toho 2 za posledné 3 dni.',
    ]);
    expect(result.operatorPayload?.additionalInfo).toBe(
      'Private user description test string\n\nAutomatické poznámky pre operátora: Opakované hlásenia: 5 predchádzajúcich hlásení za posledných 30 dní, z toho 2 za posledné 3 dni.'
    );
    const roundTripTimestamp = await pool.query<{ submitted_at: string }>(
      `SELECT to_char(submitted_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS submitted_at
         FROM fault_report_history WHERE id = $1`, [result.id]
    );
    expect(roundTripTimestamp.rows[0]?.submitted_at).toBe(result.submittedAt);

    const stored = await pool.query<{ columns: string[]; row: string }>(
      `SELECT array_agg(column_name ORDER BY column_name) AS columns,
              (SELECT to_jsonb(report)::text FROM fault_report_history report WHERE id = $1) AS row
         FROM information_schema.columns
        WHERE table_schema = current_schema() AND table_name = 'fault_report_history'`,
      [result.id]
    );
    expect(stored.rows[0].columns).not.toContain('email');
    expect(stored.rows[0].columns).not.toContain('telephone');
    expect(stored.rows[0].columns).not.toContain('detail_description');
    expect(stored.rows[0].columns).not.toContain('attachment_metadata');
    expect(stored.rows[0].row).not.toContain('Private user description test string');
    expect(stored.rows[0].row).not.toContain('resident@example.test');
  });

  it('uses inclusive UTC recurrence windows and excludes rows one microsecond outside', async () => {
    const anchor = '2030-01-01T00:00:00.000000Z';
    const recentAndRecurringPointId = pointIds[3];
    await pool.query(
      `INSERT INTO fault_report_history
         (submitted_at, service_code, locality, target_kind, light_point_id, target_geom)
       SELECT age.submitted_at, 2, 'Spam', 'light-point', $1, geom
         FROM light_points
         CROSS JOIN (VALUES
           ($2::timestamptz - interval '72 hours'),
           ($2::timestamptz - interval '72 hours' - interval '1 microsecond'),
           ($2::timestamptz - interval '720 hours'),
           ($2::timestamptz - interval '720 hours' - interval '1 microsecond')
         ) AS age(submitted_at)
        WHERE id = $1`,
      [recentAndRecurringPointId, anchor]
    );
    const boundary = await pool.query<{
      recent_count: string;
      recurring_count: string;
      latest_previous_within_days: boolean;
    }>(FAULT_HISTORY_SUMMARY_SQL, [recentAndRecurringPointId, anchor]);
    expect(boundary.rows[0]).toMatchObject({
      recent_count: '1',
      recurring_count: '3',
      latest_previous_within_days: true,
    });

    const exactPreviousWindowPointId = pointIds[4];
    const outsidePreviousWindowPointId = pointIds[5];
    await pool.query(
      `INSERT INTO fault_report_history
         (submitted_at, service_code, locality, target_kind, light_point_id, target_geom)
       SELECT $2::timestamptz - age.delta, 2, 'Spam', 'light-point', id, geom
         FROM light_points
         JOIN (VALUES (interval '168 hours'), (interval '168 hours' + interval '1 microsecond')) AS age(delta)
           ON id IN ($1, $3)
        WHERE (id = $1 AND age.delta = interval '168 hours')
           OR (id = $3 AND age.delta = interval '168 hours' + interval '1 microsecond')`,
      [exactPreviousWindowPointId, anchor, outsidePreviousWindowPointId]
    );
    const exactPreviousWindow = await pool.query<{ latest_previous_within_days: boolean }>(
      FAULT_HISTORY_SUMMARY_SQL, [exactPreviousWindowPointId, anchor]
    );
    const outsidePreviousWindow = await pool.query<{ latest_previous_within_days: boolean }>(
      FAULT_HISTORY_SUMMARY_SQL, [outsidePreviousWindowPointId, anchor]
    );
    expect(exactPreviousWindow.rows[0].latest_previous_within_days).toBe(true);
    expect(outsidePreviousWindow.rows[0].latest_previous_within_days).toBe(false);
  });

  it('does not derive recurrence for custom or manual locations', async () => {
    const pointId = pointIds[0];
    const seeded = await pool.query<{ geom: string }>('SELECT ST_AsText(geom) AS geom FROM light_points WHERE id = $1', [pointId]);
    expect(seeded.rows[0]?.geom).toBe('POINT(21.2611 48.7164)');

    const custom = await service.recordSubmission({ locality: 'Spam', reportTarget: { kind: 'custom', latitude: 48.7164, longitude: 21.2611 } });
    const manual = await service.recordSubmission({ locality: 'Spam', reportTarget: { kind: 'manual' } });
    expect(custom.automaticNotes).toEqual([]);
    expect(manual.automaticNotes).toEqual([]);

    const rows = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM fault_report_history
        WHERE id IN ($1, $2) AND light_point_id IS NULL`, [custom.id, manual.id]
    );
    expect(rows.rows[0].count).toBe('2');
  });

  it('keeps report metadata and coordinate snapshots when a selected inventory light is later removed', async () => {
    const pointId = pointIds[2];
    const recorded = await service.recordSubmission({
      locality: 'Spam', reportTarget: { kind: 'light-point', lightPointId: pointId },
    });
    await pool.query('DELETE FROM light_points WHERE id = $1', [pointId]);

    const retained = await pool.query<{ light_point_id: number; latitude: number; longitude: number }>(
      `SELECT light_point_id, ST_Y(target_geom)::float8 AS latitude, ST_X(target_geom)::float8 AS longitude
         FROM fault_report_history WHERE id = $1`, [recorded.id]
    );
    expect(retained.rows).toEqual([{ light_point_id: pointId, latitude: 48.7164, longitude: 21.2611 }]);
  });

  it('serializes concurrent reports for the same selected light using a PostgreSQL row lock', async () => {
    const pointId = pointIds[1];
    await pool.query(
      `INSERT INTO fault_report_history
         (submitted_at, service_code, locality, target_kind, light_point_id, target_geom)
       SELECT clock_timestamp() - interval '1 day', 2, 'Spam', 'light-point', id, geom
         FROM light_points WHERE id = $1`, [pointId]
    );
    const submit = () => service.recordSubmission({
      locality: 'Spam', reportTarget: { kind: 'light-point', lightPointId: pointId },
    });
    const outcomes = await Promise.all([submit(), submit()]);
    const recentNotes = outcomes.flatMap((row) => row.automaticNotes ?? []).filter((note) => note.includes('za posledné 3 dni'));
    expect(recentNotes).toHaveLength(1);
    expect(recentNotes[0]).toContain('2 predchádzajúcich hlásení');
  });

  it('rolls back OTP capability consumption when the metadata insert fails', async () => {
    const pointId = pointIds[2];
    const intentId = crypto.createIntentId();
    const emailDigest = crypto.emailDigest('synthetic-owner@example.test');
    const token = crypto.createVerificationToken();
    const tokenDigest = crypto.verificationTokenDigest(intentId, emailDigest, token);
    await pool.query(
      `INSERT INTO email_verification_challenges
         (intent_id, email_digest, otp_digest, verification_token_digest, verified_at, expires_at)
       VALUES ($1, $2, $3, $4, clock_timestamp(), clock_timestamp() + interval '5 minutes')`,
      [intentId, emailDigest, randomBytes(32), tokenDigest]
    );
    await pool.query(`
      CREATE OR REPLACE FUNCTION reject_synthetic_fault_history_insert() RETURNS trigger
      LANGUAGE plpgsql AS $$ BEGIN
        IF NEW.light_point_id = ${pointId} AND NEW.locality = 'Spam' THEN
          RAISE EXCEPTION 'synthetic rollback probe';
        END IF;
        RETURN NEW;
      END $$
    `);
    await pool.query(`CREATE TRIGGER reject_synthetic_fault_history_insert BEFORE INSERT ON fault_report_history
      FOR EACH ROW EXECUTE FUNCTION reject_synthetic_fault_history_insert()`);
    try {
      await expect(service.recordSubmission({
        locality: 'Spam', reportTarget: { kind: 'light-point', lightPointId: pointId },
      }, (client) => verificationStore.consumeVerification(intentId, emailDigest, tokenDigest, client)))
        .rejects.toThrow();
      const challenge = await pool.query<{ consumed_at: Date | null }>(
        'SELECT consumed_at FROM email_verification_challenges WHERE intent_id = $1', [intentId]
      );
      expect(challenge.rows[0].consumed_at).toBeNull();
      await pool.query('DROP TRIGGER reject_synthetic_fault_history_insert ON fault_report_history');
      await pool.query('DROP FUNCTION reject_synthetic_fault_history_insert()');
    } finally {
      await pool.query('DROP TRIGGER IF EXISTS reject_synthetic_fault_history_insert ON fault_report_history');
      await pool.query('DROP FUNCTION IF EXISTS reject_synthetic_fault_history_insert()');
      await pool.query('DELETE FROM email_verification_challenges WHERE intent_id = $1', [intentId]);
    }
  });
});
