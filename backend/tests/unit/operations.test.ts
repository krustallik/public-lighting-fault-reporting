import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
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
    recipient_key_id: `sha256:${'a'.repeat(64)}`, app_build_sha: 'abcdef0123456789',
  };
}

describe('database operations scheduler', () => {
  it('keeps the systemd templates reference-only and polls durable retries across reboot', async () => {
    const service = await readFile(new URL('../../../database/operations/systemd/public-lighting-backup.service.in', import.meta.url), 'utf8');
    const timer = await readFile(new URL('../../../database/operations/systemd/public-lighting-backup.timer.in', import.meta.url), 'utf8');
    const [, serviceSection = ''] = service.split('[Service]');
    expect(serviceSection).not.toMatch(/^Restart=/m);
    expect(serviceSection).not.toContain('RestartSec=');
    expect(timer).toContain('OnCalendar=*-*-* *:*:00 UTC');
    expect(timer).toContain('Persistent=true');
    expect(timer).toContain('AccuracySec=1s');
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

  it.skipIf(process.platform === 'win32')('handles OS SIGTERM through the operation abort signal and returns its final exit code', async () => {
    const helper = fileURLToPath(new URL('../../src/operations/processSignal.ts', import.meta.url));
    const source = await readFile(helper, 'utf8');
    const javascript = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const helperUrl = `data:text/javascript;base64,${Buffer.from(javascript).toString('base64')}`;
    const childProgram = `import { runWithTerminationSignal } from ${JSON.stringify(helperUrl)};
      void runWithTerminationSignal(async (signal) => new Promise((resolve) => {
        signal.addEventListener('abort', () => {
          process.stdout.write('abort-received\\n');
          resolve(23);
        }, { once: true });
        process.stdout.write('operation-ready\\n');
        setImmediate(() => process.kill(process.pid, 'SIGTERM'));
      })).then((code) => {
        process.stdout.write('operation-exit:' + code + '\\n');
        process.exitCode = code;
      }).catch(() => { process.exitCode = 99; });`;
    const child = spawnSync(process.execPath, ['--input-type=module', '--eval', childProgram], {
      encoding: 'utf8', windowsHide: true, shell: false, timeout: 10_000,
    });
    expect(child.error).toBeUndefined();
    expect(child.stderr).toBe('');
    expect(child.stdout).toContain('operation-ready');
    expect(child.stdout).toContain('abort-received');
    expect(child.stdout).toContain('operation-exit:23');
    expect(child.status).toBe(23);
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
    const startEvents = journal.events.filter((event) => event.kind === 'attempt_started');
    expect(startEvents[0]?.run_id).not.toBe(startEvents[1]?.run_id);
  });

  it('retries from the durable journal after a simulated reboot before and after the retry deadline', async () => {
    for (const restartAt of ['2026-10-09T12:14:59.999Z', '2026-10-09T12:15:00.000Z']) {
      const root = await temporaryRoot();
      let now = new Date('2026-10-09T12:00:00.000Z');
      let runs = 0;
      const schedulerPoolForRestart = schedulerPool({ held: false });
      const firstJournal = new FileSchedulerJournal(root);
      const first = await runScheduledBackup({
        now: () => now, schedulerPool: schedulerPoolForRestart, journal: firstJournal,
        createRunId: () => '00000000-0000-4000-8000-000000000021',
        executeBackup: async (runId) => { runs += 1; return { ...backupResult('incomplete'), run_id: runId }; },
      });
      expect(first).toMatchObject({ attempt: 1, retry_at_utc: '2026-10-09T12:15:00.000Z' });

      // A new journal instance represents a fresh service process after reboot.
      now = new Date(restartAt);
      const restartedJournal = new FileSchedulerJournal(root);
      const restarted = await runScheduledBackup({
        now: () => now, schedulerPool: schedulerPool({ held: false }), journal: restartedJournal,
        createRunId: () => '00000000-0000-4000-8000-000000000022',
        executeBackup: async (runId) => { runs += 1; return { ...backupResult('complete'), run_id: runId }; },
      });
      if (Date.parse(restartAt) < Date.parse('2026-10-09T12:15:00.000Z')) {
        expect(restarted).toMatchObject({ action: 'retry_not_due', retry_at_utc: '2026-10-09T12:15:00.000Z' });
        now = new Date('2026-10-09T12:15:00.000Z');
        expect(await runScheduledBackup({
          now: () => now, schedulerPool: schedulerPool({ held: false }), journal: new FileSchedulerJournal(root),
          createRunId: () => '00000000-0000-4000-8000-000000000023',
          executeBackup: async (runId) => { runs += 1; return { ...backupResult('complete'), run_id: runId }; },
        })).toMatchObject({ action: 'attempted', attempt: 2, state: 'complete' });
      } else {
        expect(restarted).toMatchObject({ action: 'attempted', attempt: 2, state: 'complete' });
      }
      expect(runs).toBe(2);
      expect((await new FileSchedulerJournal(root).readEvents()).filter((event) => event.kind === 'attempt_started')).toHaveLength(2);
    }
  });

  it('coalesces a retry crossing the next UTC slot without delaying the new slot', async () => {
    const journal = new MemoryJournal();
    let calls = 0;
    const invoke = (at: string) => runScheduledBackup({
      now: () => new Date(at), schedulerPool: schedulerPool({ held: false }), journal,
      createRunId: () => `00000000-0000-4000-8000-${String(++calls).padStart(12, '0')}`,
      executeBackup: async (runId) => ({ ...backupResult(calls === 1 ? 'incomplete' : 'complete'), run_id: runId }),
    });
    expect(await invoke('2026-10-09T17:55:00.000Z')).toMatchObject({
      action: 'attempted', slot: { slot_id: '2026-10-09T12:00:00.000Z' }, retry_at_utc: '2026-10-09T18:10:00.000Z',
    });
    expect(await invoke('2026-10-09T18:00:00.000Z')).toMatchObject({
      action: 'attempted', slot: { slot_id: '2026-10-09T18:00:00.000Z' }, attempt: 1, state: 'complete',
    });
    expect(calls).toBe(2);
  });

  it('never retries beyond attempt two and leaves a terminal failure final', async () => {
    const journal = new MemoryJournal();
    let now = new Date('2026-10-09T12:00:00.000Z');
    let calls = 0;
    const lockState = { held: false };
    const options = {
      now: () => now, schedulerPool: schedulerPool(lockState), journal,
      createRunId: () => `00000000-0000-4000-8000-${String(++calls).padStart(12, '0')}`,
      executeBackup: async (runId: string) => ({ ...backupResult('incomplete'), run_id: runId }),
    };
    expect(await runScheduledBackup(options)).toMatchObject({ action: 'attempted', attempt: 1, retry_at_utc: '2026-10-09T12:15:00.000Z' });
    now = new Date('2026-10-09T12:15:00.000Z');
    expect(await runScheduledBackup(options)).toMatchObject({ action: 'attempted', attempt: 2, retry_at_utc: null });
    expect(await runScheduledBackup(options)).toMatchObject({ action: 'already_final', state: 'incomplete', exit_code: 1 });
    expect(calls).toBe(2);
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

  it('repairs a torn tail durably before appending and retains every committed record', async () => {
    const root = await temporaryRoot();
    const journal = new FileSchedulerJournal(root);
    const event: SchedulerJournalEvent = { event_version: 1, kind: 'attempt_started', slot_id: '2026-10-09T00:00:00.000Z', attempt: 1, run_id: '00000000-0000-4000-8000-000000000001', started_at_utc: '2026-10-09T00:00:00.000Z' };
    const next: SchedulerJournalEvent = { ...event, run_id: '00000000-0000-4000-8000-000000000002', started_at_utc: '2026-10-09T00:01:00.000Z' };
    await journal.append(event);
    const filePath = path.join(root, 'backup-attempts.jsonl');
    await (await import('node:fs/promises')).appendFile(filePath, '{"event_version":1,"kind":"attempt_started"');
    expect(await journal.readEvents()).toEqual([event]);
    await journal.append(next);
    expect(await journal.readEvents()).toEqual([event, next]);
    if (process.platform !== 'win32') expect((await stat(filePath)).mode & 0o077).toBe(0);
  });

  it('leaves committed records recoverable when a repair fsync fails, and permits repeated repair', async () => {
    const root = await temporaryRoot();
    const filePath = path.join(root, 'backup-attempts.jsonl');
    const fs = await import('node:fs/promises');
    const first: SchedulerJournalEvent = { event_version: 1, kind: 'attempt_started', slot_id: '2026-10-09T00:00:00.000Z', attempt: 1, run_id: '00000000-0000-4000-8000-000000000011', started_at_utc: '2026-10-09T00:00:00.000Z' };
    const second: SchedulerJournalEvent = { ...first, run_id: '00000000-0000-4000-8000-000000000012', started_at_utc: '2026-10-09T00:01:00.000Z' };
    const stable = new FileSchedulerJournal(root);
    await stable.append(first);
    await fs.appendFile(filePath, '{"partial":"tail"');
    const failingRepair = new FileSchedulerJournal(root, async () => { throw new Error('synthetic fsync failure'); });
    await expect(failingRepair.append(second)).rejects.toThrow('scheduler_journal_append_failed');
    expect(await stable.readEvents()).toEqual([first]);
    await stable.append(second);
    expect(await stable.readEvents()).toEqual([first, second]);
  });

  it('does not start a backup when first-record file or directory durability cannot be confirmed', async () => {
    const root = await temporaryRoot();
    let executions = 0;
    const journal = new FileSchedulerJournal(root, async () => undefined, async () => { throw new Error('synthetic directory fsync failure'); });
    await expect(runScheduledBackup({
      now: () => new Date('2026-10-09T00:00:00.000Z'), schedulerPool: schedulerPool({ held: false }), journal,
      executeBackup: async () => { executions += 1; return backupResult('complete'); },
    })).rejects.toThrow();
    expect(executions).toBe(0);
  });

  it('rejects malformed committed middle records and journals beyond the size bound', async () => {
    const root = await temporaryRoot();
    const journal = new FileSchedulerJournal(root);
    const filePath = path.join(root, 'backup-attempts.jsonl');
    const fs = await import('node:fs/promises');
    await fs.writeFile(filePath, '{"bad":true}\n{"partial":');
    await fs.chmod(filePath, 0o600);
    await expect(journal.readEvents()).rejects.toThrow('scheduler_journal_corrupt');
    await fs.writeFile(filePath, Buffer.alloc(16 * 1024 * 1024 + 1, 0x61));
    await expect(journal.append({
      event_version: 1, kind: 'attempt_started', slot_id: '2026-10-09T00:00:00.000Z', attempt: 1,
      run_id: '00000000-0000-4000-8000-000000000013', started_at_utc: '2026-10-09T00:00:00.000Z',
    })).rejects.toThrow('scheduler_journal_size_limit_exceeded');
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

  it('requires explicit offline mode and inspects the actual Pool target before retention connects', async () => {
    const previousNodeEnv = process.env.NODE_ENV;
    const previousMode = process.env.DATABASE_OPERATIONS_MODE;
    let connections = 0;
    const fakePool = (host: string, database: string) => ({
      options: { host, database },
      connect: async () => { connections += 1; throw new Error('must not connect'); },
    } as never);
    process.env.NODE_ENV = 'test';
    delete process.env.DATABASE_OPERATIONS_MODE;
    try {
      await expect(runRetentionOnce(fakePool('127.0.0.1', 'lighting_test'), { appBuildSha: 'abcdef0123456789' }))
        .rejects.toThrow('offline_test_mode_required');
      process.env.DATABASE_OPERATIONS_MODE = 'offline-test';
      await expect(runRetentionOnce(fakePool('192.0.2.10', 'lighting_test'), { appBuildSha: 'abcdef0123456789' }))
        .rejects.toThrow('retention_requires_loopback_disposable_test_database');
      await expect(runRetentionOnce(fakePool('127.0.0.1', 'lighting_live'), { appBuildSha: 'abcdef0123456789' }))
        .rejects.toThrow('retention_requires_loopback_disposable_test_database');
      expect(connections).toBe(0);
    } finally {
      if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousNodeEnv;
      if (previousMode === undefined) delete process.env.DATABASE_OPERATIONS_MODE;
      else process.env.DATABASE_OPERATIONS_MODE = previousMode;
    }
  });

  it('accepts only real UTC timestamps rather than normalized impossible dates', () => {
    expect(isUtcTimestamp('2026-10-09T12:00:00.000Z')).toBe(true);
    expect(isUtcTimestamp('2026-10-09T12:00:00.123456Z')).toBe(true);
    expect(isUtcTimestamp('2026-10-09T12:00:00.1234567Z')).toBe(false);
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
      latestRestoreDrillAtUtc: null, latestRestoreDrillEvidenceClass: null, databaseAvailable: true, migrationFailed: false,
    };
    const recentTargetClassDrill = { latestRestoreDrillAtUtc: '2026-10-09T11:00:00.000Z', latestRestoreDrillEvidenceClass: 'target_class' as const };
    expect(evaluateMonitoring({ ...base, ...recentTargetClassDrill, latestRecoveryVerifiedSnapshotAtUtc: '2026-10-08T17:59:00.000Z' }).map((event) => event.severity)).toEqual(['warning']);
    expect(evaluateMonitoring({ ...base, ...recentTargetClassDrill, latestRecoveryVerifiedSnapshotAtUtc: '2026-10-08T12:00:00.000Z' }).map((event) => event.threshold)).toContain('critical boundary at >=24h');
    expect(evaluateMonitoring({ ...base, ...recentTargetClassDrill, latestRecoveryVerifiedSnapshotAtUtc: '2026-10-08T11:59:00.000Z' }).map((event) => event.threshold)).toContain('RPO exceeded when age >24h');
    expect(evaluateMonitoring({ ...base, latestRecoveryVerifiedSnapshotAtUtc: null })[0]).toMatchObject({ severity: 'critical', measured_value: null, delivery_status: 'not_configured' });
    expect(evaluateMonitoring({ ...base, latestRecoveryVerifiedSnapshotAtUtc: '2026-10-09T11:30:00.000Z' }))
      .toContainEqual(expect.objectContaining({ component: 'restore_drill_evidence_missing', severity: 'unknown', measured_value: null }));
    expect(evaluateMonitoring({ ...base, latestRestoreDrillAtUtc: '2026-10-09T11:00:00.000Z', latestRestoreDrillEvidenceClass: 'synthetic_ci' }))
      .toContainEqual(expect.objectContaining({ component: 'restore_drill_evidence_missing', severity: 'unknown', measured_value: 'synthetic_ci' }));
    expect(() => evaluateMonitoring({ ...base, latestRestoreDrillAtUtc: '2026-10-09T11:00:00.000Z' }))
      .toThrow('monitor_restore_drill_evidence_class_invalid');
    expect(evaluateMonitoring({ ...base, latestFinalScheduledBackupFailureAtUtc: '2026-10-09T11:59:59.000Z' }))
      .toContainEqual(expect.objectContaining({ component: 'backup_final_failure', severity: 'critical' }));
    expect(evaluateMonitoring({ ...base, latestRestoreDrillAtUtc: '2026-07-01T00:00:00.000Z', latestRestoreDrillEvidenceClass: 'target_class',
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
    const drillAt90 = evaluateMonitoring({ ...base, latestRestoreDrillAtUtc: '2026-07-11T12:00:00.000Z', latestRestoreDrillEvidenceClass: 'target_class' });
    const drillAt120 = evaluateMonitoring({ ...base, latestRestoreDrillAtUtc: '2026-06-11T12:00:00.000Z', latestRestoreDrillEvidenceClass: 'target_class' });
    expect(drillAt90.some((event) => event.component === 'restore_drill_age')).toBe(false);
    expect(drillAt120).toContainEqual(expect.objectContaining({ component: 'restore_drill_age', severity: 'warning' }));
    expect(evaluateMonitoring({ ...base, latestRestoreDrillAtUtc: '2026-07-11T11:59:00.000Z', latestRestoreDrillEvidenceClass: 'target_class' }))
      .toContainEqual(expect.objectContaining({ component: 'restore_drill_age', severity: 'warning' }));
    expect(evaluateMonitoring({ ...base, latestRestoreDrillAtUtc: '2026-06-11T11:59:00.000Z', latestRestoreDrillEvidenceClass: 'target_class' }))
      .toContainEqual(expect.objectContaining({ component: 'restore_drill_age', severity: 'critical' }));
  });

  it('writes an immutable private result envelope and rejects sensitive evidence field names', async () => {
    const root = await temporaryRoot();
    const record = {
      operations_version: 1 as const, phase: 'monitoring' as const, operation_id: '12345678-1234-4234-8234-123456789abc',
      state: 'complete' as const, reason_code: 'monitoring_checks_evaluated',
      started_at_utc: '2026-10-09T12:00:00.000Z', finished_at_utc: '2026-10-09T12:00:01.000Z',
      app_build_sha: 'abcdef0123456789', evidence: { critical_count: 2, unknown_count: 1, delivery_configured: false },
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
        archive_encrypted_sha256: 'a'.repeat(64), snapshot_started_at: '2026-10-09T12:00:00.123456Z',
      }),
      injectSyntheticDataLoss: async () => ({ occurred_at_utc: '2026-10-09T12:01:00.123456Z', synthetic_record_removed: true }),
      restoreExactArtifact: async (manifestId) => ({
        result_version: 1, phase: 'restore', state: 'complete', reason_code: 'exact_artifact_restored_and_verified',
        operation_id: 'synthetic-restore-000001', manifest_id: manifestId,
        archive_key: 'backups/v1/runs/synthetic/database.pgdump.age', archive_provider_version_id: 'synthetic-version',
        encrypted_bytes: 4, encrypted_sha256: 'a'.repeat(64), recipient_key_id: 'sha256:synthetic',
        snapshot_started_at_utc: '2026-10-09T12:00:00.123456Z', target_database: 'synthetic_restore_target',
        restore_started_at_utc: '2026-10-09T12:02:00.123456Z', restore_finished_at_utc: '2026-10-09T12:05:00.123456Z',
        migration_ledger: [], checks: { manifest: true, ciphertext_identity: true, ciphertext_hash: true, recipient: true,
          postgres16_restore: true, canonical_grants: true, migrations_current: true, postgis: true,
          relational_constraints: true, sequences: true, runtime_query: true, additional_data: true }, app_build_sha: 'abcdef0123456789',
      }),
      disposeRestoredDatabase: async () => { disposed = true; },
    });
    expect(result).toMatchObject({ state: 'complete', evidence: {
      evidence_class: 'synthetic_ci', snapshot_started_at_utc: '2026-10-09T12:00:00.123456Z',
      synthetic_snapshot_to_loss_elapsed_ms: 60_000, synthetic_loss_to_restore_elapsed_ms: 240_000,
      synthetic_snapshot_to_loss_target_met: true,
    } });
    expect(result.evidence).not.toHaveProperty('rto_ms');
    expect(result.evidence).not.toHaveProperty('synthetic_rto_target_ms');
    expect(result.evidence).not.toHaveProperty('synthetic_targets_met');
    expect(disposed).toBe(true);
  });
});
