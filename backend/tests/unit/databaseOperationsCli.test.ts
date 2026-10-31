import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runDatabaseOperationsCli } from '../../src/scripts/databaseOperations.js';

const temporaryDirectories: string[] = [];
const originalExitCode = process.exitCode;
let stdout = '';

beforeEach(() => {
  stdout = '';
  vi.stubEnv('NODE_ENV', 'test');
  vi.stubEnv('DATABASE_OPERATIONS_MODE', '');
  vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: string | Uint8Array) => {
    stdout += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8');
    return true;
  }) as typeof process.stdout.write);
});

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  process.exitCode = originalExitCode;
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'database-operations-cli-'));
  temporaryDirectories.push(directory);
  return directory;
}

function resultLine(): Record<string, unknown> {
  return JSON.parse(stdout.trim()) as Record<string, unknown>;
}

describe('database operations CLI', () => {
  it('rejects production invocation before parsing any command or touching storage', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('DATABASE_OPERATIONS_MODE', 'offline-test');

    await expect(runDatabaseOperationsCli(['monitor-once'])).resolves.toBe(12);

    expect(resultLine()).toMatchObject({
      phase: 'operations', state: 'preflight_rejected',
      reason_code: 'production_operations_adapter_not_configured',
    });
    expect(process.exitCode).toBe(12);
  });

  it.each([
    ['no command', []],
    ['multiple commands', ['monitor-once', 'retention-once']],
    ['unknown command', ['send-to-production']],
  ])('rejects %s with a fixed, non-sensitive reason', async (_description, args) => {
    await expect(runDatabaseOperationsCli(args)).resolves.toBe(12);
    expect(resultLine()).toMatchObject({
      phase: 'operations', state: 'preflight_rejected', reason_code: 'fixed_command_required',
    });
  });

  it.each([
    ['backup-scheduled', 'backup'],
    ['retention-once', 'retention'],
    ['monitor-once', 'monitoring'],
  ])('requires explicit offline mode for %s', async (command, phase) => {
    await expect(runDatabaseOperationsCli([command])).resolves.toBe(12);
    expect(resultLine()).toMatchObject({
      phase, state: 'preflight_rejected', reason_code: 'offline_test_mode_required',
    });
  });

  it('rejects an invalid build identity before opening the backup database', async () => {
    vi.stubEnv('DATABASE_OPERATIONS_MODE', 'offline-test');
    vi.stubEnv('APP_BUILD_SHA', 'not-a-build-hash');

    await expect(runDatabaseOperationsCli(['backup-scheduled'])).resolves.toBe(12);
    expect(resultLine()).toMatchObject({
      phase: 'backup', state: 'preflight_rejected', reason_code: 'operations_build_identity_invalid',
    });
  });

  it.each([
    ['requires the offline fake-storage adapter', {
      BACKUP_TEST_MODE: '', BACKUP_STORAGE_ADAPTER: '', BACKUP_DB_HOST: '',
    }, 'test_only_fake_storage_required'],
    ['rejects a non-loopback database host', {
      BACKUP_TEST_MODE: 'true', BACKUP_STORAGE_ADAPTER: 'local-fake', BACKUP_DB_HOST: 'db.internal',
    }, 'backup_test_database_must_be_loopback'],
  ])('keeps backup command safe: %s', async (_description, overrides, reason) => {
    vi.stubEnv('DATABASE_OPERATIONS_MODE', 'offline-test');
    vi.stubEnv('APP_BUILD_SHA', 'abcdef0123456789');
    for (const [key, value] of Object.entries(overrides)) vi.stubEnv(key, value);

    await expect(runDatabaseOperationsCli(['backup-scheduled'])).resolves.toBe(12);

    expect(resultLine()).toMatchObject({ phase: 'backup', state: 'preflight_rejected', reason_code: reason });
  });

  it('reports missing retention configuration without attempting a database connection', async () => {
    vi.stubEnv('DATABASE_OPERATIONS_MODE', 'offline-test');
    vi.stubEnv('APP_BUILD_SHA', 'abcdef0123456789');

    await expect(runDatabaseOperationsCli(['retention-once'])).resolves.toBe(12);
    expect(resultLine()).toMatchObject({
      phase: 'retention', state: 'preflight_rejected', reason_code: 'operations_configuration_missing',
    });
  });

  it.each([
    ['rejects a non-loopback host', 'localhost', 'lighting_test', 'retention_requires_loopback_disposable_test_database'],
    ['rejects a non-disposable database name', '127.0.0.1', 'lighting_production', 'retention_requires_loopback_disposable_test_database'],
  ])('keeps retention bounded: %s', async (_description, host, database, reason) => {
    vi.stubEnv('DATABASE_OPERATIONS_MODE', 'offline-test');
    vi.stubEnv('APP_BUILD_SHA', 'abcdef0123456789');
    vi.stubEnv('RETENTION_DB_HOST', host);
    vi.stubEnv('RETENTION_DB_NAME', database);

    await expect(runDatabaseOperationsCli(['retention-once'])).resolves.toBe(12);

    expect(resultLine()).toMatchObject({ phase: 'retention', state: 'preflight_rejected', reason_code: reason });
  });

  it('rejects missing and empty offline retention password files before connecting', async () => {
    const stateDirectory = await temporaryDirectory();
    const emptyPasswordFile = path.join(stateDirectory, 'empty-password');
    await writeFile(emptyPasswordFile, '');
    vi.stubEnv('DATABASE_OPERATIONS_MODE', 'offline-test');
    vi.stubEnv('APP_BUILD_SHA', 'abcdef0123456789');
    vi.stubEnv('RETENTION_DB_HOST', '127.0.0.1');
    vi.stubEnv('RETENTION_DB_NAME', 'lighting_disposable_test');
    vi.stubEnv('RETENTION_DB_PORT', '5432');

    vi.stubEnv('RETENTION_DB_PASSWORD_FILE', path.join(stateDirectory, 'missing-password'));
    await expect(runDatabaseOperationsCli(['retention-once'])).resolves.toBe(12);
    expect(resultLine()).toMatchObject({ reason_code: 'operations_preflight_failed' });

    stdout = '';
    vi.stubEnv('RETENTION_DB_PASSWORD_FILE', emptyPasswordFile);
    await expect(runDatabaseOperationsCli(['retention-once'])).resolves.toBe(12);
    expect(resultLine()).toMatchObject({ reason_code: 'operations_password_file_invalid' });
  });

  it('bounds monitoring input and sanitizes malformed JSON parser errors', async () => {
    vi.stubEnv('DATABASE_OPERATIONS_MODE', 'offline-test');
    vi.stubEnv('APP_BUILD_SHA', 'abcdef0123456789');
    vi.stubEnv('DATABASE_OPERATIONS_MONITOR_SNAPSHOT_JSON', 'x'.repeat(16 * 1024 + 1));
    await expect(runDatabaseOperationsCli(['monitor-once'])).resolves.toBe(12);
    expect(resultLine()).toMatchObject({ reason_code: 'monitor_snapshot_size_limit_exceeded' });

    stdout = '';
    vi.stubEnv('DATABASE_OPERATIONS_MONITOR_SNAPSHOT_JSON', '{invalid');
    await expect(runDatabaseOperationsCli(['monitor-once'])).resolves.toBe(12);
    expect(resultLine()).toMatchObject({ reason_code: 'operations_preflight_failed' });
    expect(stdout).not.toContain('SyntaxError');
  });

  it('writes a secret-free monitoring result envelope and emits evaluated events', async () => {
    const stateDirectory = await temporaryDirectory();
    vi.stubEnv('DATABASE_OPERATIONS_MODE', 'offline-test');
    vi.stubEnv('APP_BUILD_SHA', 'abcdef0123456789');
    vi.stubEnv('DATABASE_OPERATIONS_STATE_DIRECTORY', stateDirectory);
    vi.stubEnv('DATABASE_OPERATIONS_MONITOR_SNAPSHOT_JSON', JSON.stringify({
      nowUtc: '2026-10-31T12:00:00.000Z', appBuildSha: 'abcdef0123456789',
      latestRecoveryVerifiedSnapshotAtUtc: null,
      latestFinalScheduledBackupFailureAtUtc: null,
      latestIntegrityFailureAtUtc: null,
      latestRetentionSuccessAtUtc: null,
      retentionFailureAtUtc: null,
      eligibleRetentionBacklogSinceUtc: null,
      latestRestoreDrillAtUtc: null,
      latestRestoreDrillEvidenceClass: null,
      databaseAvailable: true,
      migrationFailed: false,
    }));

    await expect(runDatabaseOperationsCli(['monitor-once'])).resolves.toBe(0);

    const emitted = resultLine();
    expect(emitted).toMatchObject({ phase: 'monitoring', state: 'evaluated', delivery_status: 'not_configured' });
    expect(emitted.events).toEqual(expect.arrayContaining([
      expect.objectContaining({ component: 'recovery_verified_backup_age', severity: 'critical' }),
      expect.objectContaining({ component: 'restore_drill_evidence_missing', severity: 'unknown' }),
    ]));
    const evidenceFile = String(emitted.evidence_file);
    expect(evidenceFile).toMatch(/^monitoring-[a-f0-9-]+\.json$/);
    const files = await readdir(stateDirectory);
    expect(files).toEqual([evidenceFile]);
    const persisted = await readFile(path.join(stateDirectory, evidenceFile), 'utf8');
    expect(JSON.parse(persisted)).toMatchObject({
      phase: 'monitoring', reason_code: 'monitoring_checks_evaluated',
      evidence: { critical_count: 1, unknown_count: 1, delivery_configured: false },
    });
    expect(persisted).not.toMatch(/password|api[_-]?key|email/i);
  });
});
