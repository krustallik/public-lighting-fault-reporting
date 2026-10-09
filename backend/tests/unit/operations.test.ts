import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { FileSchedulerJournal } from '../../src/operations/fileSchedulerJournal.js';
import { evaluateMonitoring } from '../../src/operations/monitoring.js';
import { latestDueBackupSlot, runScheduledBackup, type SchedulerJournal, type SchedulerJournalEvent } from '../../src/operations/scheduler.js';
import { runRetentionOnce, utcCalendarYearCutoff } from '../../src/operations/retention.js';
import { isUtcTimestamp } from '../../src/operations/contracts.js';
import { persistOperationsRecord } from '../../src/operations/fileEvidence.js';
import { runSyntheticRecoveryDrill } from '../../src/operations/recoveryDrill.js';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

function temporaryRoot(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), 'operations-test-')).then((root) => { roots.push(root); return root; });
}

function schedulerPool(lockState: { held: boolean }) {
  return {
    connect: async () => ({
      query: async (sql: string) => ({ rows: [{ [sql.includes('pg_try_advisory_lock') ? 'locked' : 'unlocked']: sql.includes('pg_try_advisory_lock') ? !lockState.held && (lockState.held = true, true) : (lockState.held = false, true) }] }),
      release: () => undefined,
    }),
  } as never;
}

class MemoryJournal implements SchedulerJournal {
  events: SchedulerJournalEvent[] = [];
  async readEvents() { return [...this.events]; }
  async append(event: SchedulerJournalEvent) { this.events.push(event); }
}

function backupResult(state: 'complete' | 'incomplete' | 'blocked_by_migration' | 'preflight_rejected' | 'skipped_overlapping') {
  return {
    result_version: 1 as const, state, exit_code: state === 'complete' ? 0 : 1, reason_code: `test_${state}`,
    run_id: 'synthetic-run-id-0001', run_started_at: '2026-10-09T12:00:00.000Z', duration_ms: 1,
    recipient_key_id: 'sha256:synthetic', app_build_sha: 'abcdef0123456789',
  };
}

describe('database operations scheduler', () => {
  it('keeps the systemd templates reference-only and bounds failure restart behavior', async () => {
    const service = await readFile(new URL('../../../database/operations/systemd/public-lighting-backup.service.in', import.meta.url), 'utf8');
    const timer = await readFile(new URL('../../../database/operations/systemd/public-lighting-backup.timer.in', import.meta.url), 'utf8');
    const [unitSection, serviceSection = ''] = service.split('[Service]');
    expect(unitSection).toContain('StartLimitIntervalSec=1h');
    expect(unitSection).toContain('StartLimitBurst=2');
    expect(serviceSection).toContain('Restart=on-failure');
    expect(serviceSection).toContain('RestartSec=15min');
    expect(serviceSection).toContain('RestartPreventExitStatus=10 12 78');
    expect(serviceSection).not.toContain('StartLimitIntervalSec=');
    expect(timer).toContain('OnCalendar=*-*-* 00,06,12,18:00:00 UTC');
    expect(timer).toContain('Persistent=true');
    expect(service).not.toMatch(/^\[Install\]$/m);
    expect(timer).not.toMatch(/^\[Install\]$/m);
  });

  it('rejects every production operations command before configuration or database access', () => {
    const cli = fileURLToPath(new URL('../../src/scripts/databaseOperations.ts', import.meta.url));
    const tsx = path.resolve(process.cwd(), 'node_modules/tsx/dist/cli.mjs');
    for (const command of ['backup-scheduled', 'retention-once', 'monitor-once']) {
      const result = spawnSync(process.execPath, [tsx, cli, command], {
        encoding: 'utf8', windowsHide: true, timeout: 10_000, shell: false,
        env: { ...process.env, NODE_ENV: 'production', DATABASE_OPERATIONS_MODE: 'production' },
      });
      expect(result.error, `${command} child process`).toBeUndefined();
      expect(result.status, `${command} exit`).toBe(12);
      expect(JSON.parse(result.stdout)).toMatchObject({ phase: 'operations', state: 'preflight_rejected', reason_code: 'production_operations_adapter_not_configured' });
    }
  });

  it('selects the latest UTC slot and coalesces missed slots without replay', () => {
    expect(latestDueBackupSlot(new Date('2026-10-09T14:49:00.000Z')).scheduled_at_utc).toBe('2026-10-09T12:00:00.000Z');
    expect(latestDueBackupSlot(new Date('2026-10-09T23:59:00.000Z')).scheduled_at_utc).toBe('2026-10-09T18:00:00.000Z');
    expect(latestDueBackupSlot(new Date('2026-10-10T00:00:00.000Z')).scheduled_at_utc).toBe('2026-10-10T00:00:00.000Z');
  });

  it('writes a durable attempt once, does not repeat a completed slot, and permits one bounded retry', async () => {
    const journal = new MemoryJournal();
    const state = { held: false };
    let now = new Date('2026-10-09T12:00:00.000Z');
    let calls = 0;
    const options = {
      now: () => now, schedulerPool: schedulerPool(state), journal,
      executeBackup: async (runId: string) => { calls += 1; return { ...backupResult(calls === 1 ? 'incomplete' : 'complete'), run_id: runId }; },
      createRunId: () => `00000000-0000-4000-8000-${String(calls + 1).padStart(12, '0')}`,
    };
    expect(await runScheduledBackup(options)).toMatchObject({ action: 'attempted', attempt: 1, state: 'incomplete', retry_at_utc: '2026-10-09T12:15:00.000Z' });
    expect((await runScheduledBackup(options)).action).toBe('retry_not_due');
    now = new Date('2026-10-09T12:15:00.000Z');
    expect(await runScheduledBackup(options)).toMatchObject({ action: 'attempted', attempt: 2, state: 'complete', retry_at_utc: null });
    expect((await runScheduledBackup(options)).action).toBe('already_final');
    expect(calls).toBe(2);
    expect(journal.events.map((event) => event.kind)).toEqual(['attempt_started', 'attempt_finished', 'attempt_started', 'attempt_finished']);
  });

  it('serializes duplicate triggers with the separate scheduler advisory lock', async () => {
    const journal = new MemoryJournal();
    const lockState = { held: false };
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const started = new Promise<void>((resolve) => setTimeout(resolve, 0));
    let executions = 0;
    const options = {
      now: () => new Date('2026-10-09T18:00:00.000Z'), schedulerPool: schedulerPool(lockState), journal,
      executeBackup: async (runId: string) => { executions += 1; await blocked; return { ...backupResult('complete'), run_id: runId }; },
    };
    const first = runScheduledBackup(options);
    await started;
    const second = await runScheduledBackup(options);
    expect(second.action).toBe('skipped_overlapping');
    release();
    expect((await first).action).toBe('attempted');
    expect(executions).toBe(1);
  });

  it('reconciles a crash and waits the remainder of the 15-minute retry delay', async () => {
    const journal = new MemoryJournal();
    journal.events.push({ event_version: 1, kind: 'attempt_started', slot_id: '2026-10-09T06:00:00.000Z', attempt: 1, run_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', started_at_utc: '2026-10-09T06:01:00.000Z' });
    let calls = 0;
    const options = {
      now: () => new Date('2026-10-09T06:10:00.000Z'), schedulerPool: schedulerPool({ held: false }), journal,
      executeBackup: async () => { calls += 1; return backupResult('complete'); },
    };
    expect(await runScheduledBackup(options)).toMatchObject({ action: 'retry_not_due', retry_at_utc: '2026-10-09T06:16:00.000Z' });
    expect(journal.events.at(-1)).toMatchObject({ kind: 'attempt_finished', slot_id: '2026-10-09T06:00:00.000Z', state: 'incomplete', reason_code: 'scheduler_crash_reconciled', retry_at_utc: '2026-10-09T06:16:00.000Z' });
    expect(calls).toBe(0);
  });

  it('reconciles an abandoned older slot without consuming the current coalesced slot', async () => {
    const journal = new MemoryJournal();
    journal.events.push({
      event_version: 1, kind: 'attempt_started', slot_id: '2026-10-09T00:00:00.000Z', attempt: 1,
      run_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', started_at_utc: '2026-10-09T00:01:00.000Z',
    });
    const now = new Date('2026-10-09T12:10:00.000Z');
    let executions = 0;
    const currentRunId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const result = await runScheduledBackup({
      now: () => now, schedulerPool: schedulerPool({ held: false }), journal,
      createRunId: () => currentRunId,
      executeBackup: async (runId) => { executions += 1; return { ...backupResult('complete'), run_id: runId }; },
    });
    expect(result).toMatchObject({ action: 'attempted', slot: { slot_id: '2026-10-09T12:00:00.000Z' }, attempt: 1, state: 'complete' });
    expect(journal.events[1]).toMatchObject({ kind: 'attempt_finished', slot_id: '2026-10-09T00:00:00.000Z', reason_code: 'scheduler_crash_reconciled' });
    expect(journal.events[2]).toMatchObject({ kind: 'attempt_started', slot_id: '2026-10-09T12:00:00.000Z', attempt: 1, run_id: currentRunId });
    expect(executions).toBe(1);
  });

  it('recomputes the due slot after obtaining the scheduler lock', async () => {
    const journal = new MemoryJournal();
    let clock = new Date('2026-10-09T05:59:59.900Z');
    const pool = {
      connect: async () => {
        clock = new Date('2026-10-09T06:00:00.100Z');
        return {
          query: async (sql: string) => ({ rows: [{ [sql.includes('pg_try_advisory_lock') ? 'locked' : 'unlocked']: true }] }),
          release: () => undefined,
        };
      },
    } as never;
    const runId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    const result = await runScheduledBackup({
      now: () => clock, schedulerPool: pool, journal, createRunId: () => runId,
      executeBackup: async (id) => ({ ...backupResult('complete'), run_id: id }),
    });
    expect(result).toMatchObject({ action: 'attempted', slot: { slot_id: '2026-10-09T06:00:00.000Z' } });
  });

  it('records an executor exception without fabricating backup identity fields', async () => {
    const root = await temporaryRoot();
    const journal = new FileSchedulerJournal(root);
    const result = await runScheduledBackup({
      now: () => new Date('2026-10-09T12:00:00.000Z'), schedulerPool: schedulerPool({ held: false }), journal,
      createRunId: () => 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      executeBackup: async () => { throw new Error('synthetic credential detail'); },
    });
    expect(result).toMatchObject({ action: 'attempted', state: 'incomplete', exit_code: 1, retry_at_utc: '2026-10-09T12:15:00.000Z' });
    expect(result).not.toHaveProperty('backup_result');
    const events = await journal.readEvents();
    expect(events[1]).toMatchObject({ kind: 'attempt_finished', reason_code: 'scheduler_executor_failed', state: 'incomplete' });
    expect(JSON.stringify(events)).not.toContain('synthetic credential detail');
  });

  it('file journal fsyncs complete records and ignores only an unterminated crash tail', async () => {
    const root = await temporaryRoot();
    const journal = new FileSchedulerJournal(root);
    const event: SchedulerJournalEvent = { event_version: 1, kind: 'attempt_started', slot_id: '2026-10-09T00:00:00.000Z', attempt: 1, run_id: '00000000-0000-4000-8000-000000000001', started_at_utc: '2026-10-09T00:00:00.000Z' };
    await journal.append(event);
    const filePath = path.join(root, 'backup-attempts.jsonl');
    await (await import('node:fs/promises')).appendFile(filePath, '{"event_version":1,"kind":"attempt_started"');
    expect(await journal.readEvents()).toEqual([event]);
    if (process.platform !== 'win32') expect((await stat(filePath)).mode & 0o077).toBe(0);
  });
});

describe('database operations retention and monitoring', () => {
  it('keeps destructive retention disabled in production before acquiring a database connection', async () => {
    const originalNodeEnv = process.env.NODE_ENV;
    let connections = 0;
    process.env.NODE_ENV = 'production';
    try {
      await expect(runRetentionOnce({ connect: async () => { connections += 1; throw new Error('must not connect'); } } as never, {
        appBuildSha: 'abcdef0123456789',
      })).rejects.toThrow('production_retention_not_approved');
      expect(connections).toBe(0);
    } finally {
      if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = originalNodeEnv;
    }
  });

  it('accepts only real UTC timestamps rather than normalized impossible dates', () => {
    expect(isUtcTimestamp('2026-10-09T12:00:00.000Z')).toBe(true);
    expect(isUtcTimestamp('2026-02-30T12:00:00.000Z')).toBe(false);
    expect(isUtcTimestamp('2026-10-09T12:00:00+02:00')).toBe(false);
  });

  it('uses UTC calendar anniversary semantics including leap-day clamp and strict cutoff', () => {
    expect(utcCalendarYearCutoff(new Date('2024-02-29T12:34:56.789Z')).toISOString()).toBe('2023-02-28T12:34:56.789Z');
    expect(utcCalendarYearCutoff(new Date('2025-03-01T00:00:00.000Z')).toISOString()).toBe('2024-03-01T00:00:00.000Z');
  });

  it('emits the approved backup-age boundaries and never treats producer-only state as recovery proof', () => {
    const base = {
      nowUtc: '2026-10-09T12:00:00.000Z', appBuildSha: 'abcdef0123456',
      latestRecoveryVerifiedSnapshotAtUtc: null,
      latestFinalScheduledBackupFailureAtUtc: null, latestIntegrityFailureAtUtc: null,
      latestRetentionSuccessAtUtc: null, retentionFailureAtUtc: null, eligibleRetentionBacklogSinceUtc: null,
      latestRestoreDrillAtUtc: null, databaseAvailable: true, migrationFailed: false,
    };
    expect(evaluateMonitoring({ ...base, latestRecoveryVerifiedSnapshotAtUtc: '2026-10-08T17:59:00.000Z' }).map((event) => event.severity)).toEqual(['warning']);
    expect(evaluateMonitoring({ ...base, latestRecoveryVerifiedSnapshotAtUtc: '2026-10-08T12:00:00.000Z' }).map((event) => event.threshold)).toContain('critical boundary at >=24h');
    expect(evaluateMonitoring({ ...base, latestRecoveryVerifiedSnapshotAtUtc: '2026-10-08T11:59:00.000Z' }).map((event) => event.threshold)).toContain('RPO exceeded when age >24h');
    expect(evaluateMonitoring({ ...base, latestRecoveryVerifiedSnapshotAtUtc: null })[0]).toMatchObject({ severity: 'critical', measured_value: null, delivery_status: 'not_configured' });
    expect(evaluateMonitoring({ ...base, latestFinalScheduledBackupFailureAtUtc: '2026-10-09T11:59:59.000Z' }))
      .toContainEqual(expect.objectContaining({ component: 'backup_final_failure', severity: 'critical' }));
    expect(evaluateMonitoring({ ...base, latestRestoreDrillAtUtc: '2026-07-01T00:00:00.000Z',
      eligibleRetentionBacklogSinceUtc: '2026-10-07T11:00:00.000Z', databaseAvailable: false, migrationFailed: true,
      resourceObservation: { cpuPercent: 75, rssBytes: 1000, freeDiskBytes: 2000, observedAtUtc: '2026-10-09T11:00:00.000Z' } })
      .map((event) => event.component)).toEqual(expect.arrayContaining([
      'restore_drill_age', 'retention_backlog', 'database_availability', 'migration_failure',
      'cpu_observation', 'memory_observation', 'free_disk_observation',
    ]));
    expect(() => evaluateMonitoring({ ...base, latestRecoveryVerifiedSnapshotAtUtc: '2026-02-30T12:00:00.000Z' }))
      .toThrow('monitor_snapshot_timestamp_invalid');
    expect(() => evaluateMonitoring({ ...base, latestRecoveryVerifiedSnapshotAtUtc: '2026-10-10T12:00:00.000Z' }))
      .toThrow('monitor_snapshot_timestamp_invalid');
    expect(evaluateMonitoring({ ...base, latestRecoveryVerifiedSnapshotAtUtc: null })[0]?.check_id).toBe('recovery_verified_backup_age');
  });

  it('writes an immutable private result envelope and rejects sensitive evidence field names', async () => {
    const root = await temporaryRoot();
    const record = {
      operations_version: 1 as const, phase: 'monitoring' as const, operation_id: '12345678-1234-4234-8234-123456789abc',
      state: 'complete' as const, reason_code: 'monitoring_checks_evaluated',
      started_at_utc: '2026-10-09T12:00:00.000Z', finished_at_utc: '2026-10-09T12:00:01.000Z',
      app_build_sha: 'abcdef0123456789', evidence: { critical_count: 2, delivery_configured: false },
    };
    const fileName = await persistOperationsRecord(root, record);
    expect(JSON.parse(await readFile(path.join(root, fileName), 'utf8'))).toEqual(record);
    await expect(persistOperationsRecord(root, { ...record, evidence: { token_hash: 'nope' } })).rejects.toThrow('operations_evidence_field_rejected');
    await expect(persistOperationsRecord(root, { ...record, evidence: { critical_count: 'secret detail' } as never }))
      .rejects.toThrow('operations_evidence_field_rejected');
    await expect(persistOperationsRecord(root, {
      ...record,
      backup_result: { ...backupResult('complete'), identity_file: 'private-path' } as never,
    })).rejects.toThrow('operations_evidence_backup_result_invalid');
  });

  it('measures a synthetic drill only for the exact completed artifact and always disposes the restored target', async () => {
    let disposed = false;
    const result = await runSyntheticRecoveryDrill({
      appBuildSha: 'abcdef0123456789',
      now: () => new Date('2026-10-09T12:10:00.000Z'),
      produceBackup: async () => ({
        ...backupResult('complete'), manifest_id: 'backups/v1/runs/synthetic/manifest.json',
        archive_encrypted_sha256: 'a'.repeat(64), snapshot_started_at: '2026-10-09T12:00:00.000Z',
      }),
      injectSyntheticDataLoss: async () => ({ occurred_at_utc: '2026-10-09T12:01:00.000Z', synthetic_record_removed: true }),
      restoreExactArtifact: async (manifestId) => ({
        result_version: 1, phase: 'restore', state: 'complete', reason_code: 'exact_artifact_restored_and_verified',
        operation_id: 'synthetic-restore-000001', manifest_id: manifestId,
        archive_key: 'backups/v1/runs/synthetic/database.pgdump.age', archive_provider_version_id: 'synthetic-version',
        encrypted_bytes: 4, encrypted_sha256: 'a'.repeat(64), recipient_key_id: 'sha256:synthetic',
        snapshot_started_at_utc: '2026-10-09T12:00:00.000Z', target_database: 'synthetic_restore_target',
        restore_started_at_utc: '2026-10-09T12:02:00.000Z', restore_finished_at_utc: '2026-10-09T12:05:00.000Z',
        migration_ledger: [], checks: { manifest: true, ciphertext_identity: true, ciphertext_hash: true, recipient: true,
          postgres16_restore: true, canonical_grants: true, migrations_current: true, postgis: true,
          relational_constraints: true, sequences: true, runtime_query: true, additional_data: true }, app_build_sha: 'abcdef0123456789',
      }),
      disposeRestoredDatabase: async () => { disposed = true; },
    });
    expect(result).toMatchObject({ state: 'complete', evidence: { evidence_class: 'synthetic_ci', rpo_ms: 60_000, rto_ms: 240_000, synthetic_targets_met: true } });
    expect(disposed).toBe(true);
  });
});
