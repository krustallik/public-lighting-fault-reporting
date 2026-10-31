import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  poolEnd: vi.fn(async () => undefined),
  poolOptions: undefined as unknown,
  runScheduledBackup: vi.fn(),
  persistOperationsRecord: vi.fn(async () => 'synthetic-evidence.json'),
}));

vi.mock('pg', () => ({
  Pool: class {
    constructor(options: unknown) { mocks.poolOptions = options; }
    end = mocks.poolEnd;
  },
}));
vi.mock('../../src/backup/config.js', () => ({
  parseBackupConfig: vi.fn(() => ({
    database: { host: '127.0.0.1', port: 5432, name: 'lighting_test', user: 'lighting_backup', password: 'synthetic-password' },
    fakeStorageRoot: '/tmp/synthetic-backup-objects', storageNamespaceId: 'synthetic-namespace',
  })),
}));
vi.mock('../../src/backup/localFakeStorage.js', () => ({
  LocalFakeStorageAdapter: class { constructor(readonly root: string, readonly namespace: string) {} },
}));
vi.mock('../../src/backup/runner.js', () => ({ runBackupOnce: vi.fn() }));
vi.mock('../../src/operations/fileSchedulerJournal.js', () => ({
  FileSchedulerJournal: class { constructor(readonly directory: string) {} },
}));
vi.mock('../../src/operations/fileEvidence.js', () => ({ persistOperationsRecord: mocks.persistOperationsRecord }));
vi.mock('../../src/operations/scheduler.js', () => ({ runScheduledBackup: mocks.runScheduledBackup }));

import { runScheduledBackupCommand } from '../../src/scripts/databaseOperations.js';

let stdout = '';
const originalExitCode = process.exitCode;

beforeEach(() => {
  stdout = '';
  mocks.poolEnd.mockClear();
  mocks.poolOptions = undefined;
  mocks.runScheduledBackup.mockReset();
  mocks.persistOperationsRecord.mockClear();
  vi.stubEnv('NODE_ENV', 'test');
  vi.stubEnv('DATABASE_OPERATIONS_MODE', 'offline-test');
  vi.stubEnv('APP_BUILD_SHA', 'ABCDEF0123456789');
  vi.stubEnv('DATABASE_OPERATIONS_STATE_DIRECTORY', '/tmp/synthetic-operations-state');
  vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: string | Uint8Array) => {
    stdout += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8');
    return true;
  }) as typeof process.stdout.write);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  process.exitCode = originalExitCode;
});

function emitted(): Record<string, unknown> {
  return JSON.parse(stdout.trim()) as Record<string, unknown>;
}

describe('scheduled backup operations command mapping', () => {
  it.each([
    ['no due slot', { action: 'no_due_slot', state: 'complete', exit_code: 0 }, 0, 'complete', null, 0],
    ['overlapping invocation', { action: 'skipped_overlapping', state: 'skipped_overlapping', exit_code: 10 }, 10, 'skipped_overlapping', null, 0],
    ['retry not due', { action: 'retry_not_due', state: 'incomplete', retry_at_utc: '2026-10-31T12:15:00.000Z' }, 0, 'incomplete', '2026-10-31T12:15:00.000Z', 0],
    ['already completed slot', { action: 'already_final', state: 'complete', exit_code: 0 }, 0, 'complete', null, 0],
    ['already failed final slot', { action: 'already_final', state: 'integrity_failed', exit_code: 12 }, 0, 'integrity_failed', null, 0],
    ['attempted retryable failure', {
      action: 'attempted', slot: { slot_id: 'slot-id' }, attempt: 1, state: 'incomplete', retry_at_utc: '2026-10-31T12:15:00.000Z',
      backup_result: { run_id: 'run-id', run_started_at: '2026-10-31T12:00:00.000Z', state: 'incomplete', reason_code: 'synthetic_failure' },
    }, 1, 'incomplete', '2026-10-31T12:15:00.000Z', 1],
    ['attempted terminal failure without a retry time', {
      action: 'attempted', slot: { slot_id: 'slot-id' }, attempt: 2, state: 'integrity_failed', retry_at_utc: null,
    }, 12, 'integrity_failed', null, 2],
  ] as const)('records the %s outcome and always closes its bounded pool', async (_label, invocation, exitCode, state, retryAt, attempt) => {
    mocks.runScheduledBackup.mockResolvedValue(invocation);

    await expect(runScheduledBackupCommand()).resolves.toBe(exitCode);

    const record = emitted();
    expect(record).toMatchObject({
      phase: 'backup', state, app_build_sha: 'abcdef0123456789',
      evidence: { attempt, retry_at_utc: retryAt },
      evidence_file: 'synthetic-evidence.json',
    });
    expect(mocks.persistOperationsRecord).toHaveBeenCalledTimes(1);
    expect(mocks.poolOptions).toMatchObject({ host: '127.0.0.1', database: 'lighting_test', max: 2 });
    expect(mocks.poolEnd).toHaveBeenCalledOnce();
  });

  it('emits scheduler-only evidence when an attempted invocation lacks a backup result', async () => {
    mocks.runScheduledBackup.mockResolvedValue({
      action: 'attempted', slot: { slot_id: 'slot-id' }, attempt: 1,
      state: 'incomplete', retry_at_utc: null,
    });

    await expect(runScheduledBackupCommand()).resolves.toBe(12);

    expect(emitted()).toMatchObject({
      phase: 'backup', state: 'incomplete', reason_code: 'scheduler_attempted',
      evidence: { slot_id: 'slot-id', attempt: 1, retry_at_utc: null },
    });
    expect(emitted()).not.toHaveProperty('backup_result');
    expect(mocks.poolEnd).toHaveBeenCalledOnce();
  });

  it('closes the pool when the scheduler journal operation fails', async () => {
    mocks.runScheduledBackup.mockRejectedValueOnce(new Error('private filesystem path'));

    await expect(runScheduledBackupCommand()).rejects.toThrow('private filesystem path');
    expect(mocks.poolEnd).toHaveBeenCalledOnce();
    expect(mocks.persistOperationsRecord).not.toHaveBeenCalled();
  });

  it('does not return success if durable evidence cannot be persisted', async () => {
    mocks.runScheduledBackup.mockResolvedValue({ action: 'no_due_slot', state: 'complete', exit_code: 0 });
    mocks.persistOperationsRecord.mockRejectedValueOnce(new Error('private evidence path'));

    await expect(runScheduledBackupCommand()).rejects.toThrow('private evidence path');
    expect(mocks.poolEnd).toHaveBeenCalledOnce();
  });
});
