import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { Pool } from 'pg';
import { parseBackupConfig } from '../backup/config.js';
import { LocalFakeStorageAdapter } from '../backup/localFakeStorage.js';
import { runBackupOnce } from '../backup/runner.js';
import { runRetentionOnce } from '../operations/retention.js';
import { evaluateMonitoring, type MonitoringSnapshot } from '../operations/monitoring.js';
import { FileSchedulerJournal } from '../operations/fileSchedulerJournal.js';
import { persistOperationsRecord } from '../operations/fileEvidence.js';
import { runScheduledBackup } from '../operations/scheduler.js';
import { runWithTerminationSignal } from '../operations/processSignal.js';
import { randomUUID } from 'node:crypto';

const ALLOWED_COMMANDS = new Set(['backup-scheduled', 'retention-once', 'monitor-once']);

function emit(value: unknown): void { process.stdout.write(`${JSON.stringify(value)}\n`); }
function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error('operations_configuration_missing');
  return value;
}
function isLoopback(host: string): boolean { return host === '127.0.0.1' || host === '::1'; }
function safeBuildSha(): string {
  const value = process.env.APP_BUILD_SHA ?? '';
  if (!/^[a-f0-9]{7,64}$/i.test(value)) throw new Error('operations_build_identity_invalid');
  return value.toLowerCase();
}

function productionBoundary(): boolean {
  if (process.env.NODE_ENV !== 'production') return false;
  emit({ result_version: 1, phase: 'operations', state: 'preflight_rejected', reason_code: 'production_operations_adapter_not_configured' });
  process.exitCode = 12;
  return true;
}

function requireOfflineTestMode(): void {
  if (process.env.DATABASE_OPERATIONS_MODE !== 'offline-test' || process.env.NODE_ENV === 'production') {
    throw new Error('offline_test_mode_required');
  }
}

export async function runScheduledBackupCommand(signal?: AbortSignal): Promise<number> {
  requireOfflineTestMode();
  const buildSha = safeBuildSha();
  const allowedBackupEnv = {
    NODE_ENV: 'test',
    BACKUP_TEST_MODE: process.env.BACKUP_TEST_MODE,
    BACKUP_STORAGE_ADAPTER: process.env.BACKUP_STORAGE_ADAPTER,
    BACKUP_DB_HOST: process.env.BACKUP_DB_HOST,
    BACKUP_DB_PORT: process.env.BACKUP_DB_PORT,
    BACKUP_DB_NAME: process.env.BACKUP_DB_NAME,
    BACKUP_DB_USER: process.env.BACKUP_DB_USER,
    BACKUP_DB_PASSWORD_FILE: process.env.BACKUP_DB_PASSWORD_FILE,
    BACKUP_MAX_SNAPSHOT_LIFETIME: process.env.BACKUP_MAX_SNAPSHOT_LIFETIME,
    BACKUP_AGE_RECIPIENT: process.env.BACKUP_AGE_RECIPIENT,
    APP_BUILD_SHA: buildSha,
    BACKUP_LOGICAL_DATABASE_ID: process.env.BACKUP_LOGICAL_DATABASE_ID,
    BACKUP_STORAGE_NAMESPACE_ID: process.env.BACKUP_STORAGE_NAMESPACE_ID,
    BACKUP_FAKE_STORAGE_ROOT: process.env.BACKUP_FAKE_STORAGE_ROOT,
    BACKUP_AGE_BINARY: process.env.BACKUP_AGE_BINARY,
    BACKUP_PG_DUMP_BINARY: process.env.BACKUP_PG_DUMP_BINARY,
  };
  const config = parseBackupConfig(allowedBackupEnv);
  const pool = new Pool({
    host: config.database.host, port: config.database.port, database: config.database.name,
    user: config.database.user, password: config.database.password, max: 2, connectionTimeoutMillis: 5000,
  });
  const storage = new LocalFakeStorageAdapter(config.fakeStorageRoot, config.storageNamespaceId);
  const stateDirectory = required('DATABASE_OPERATIONS_STATE_DIRECTORY');
  try {
    const journal = new FileSchedulerJournal(stateDirectory);
    const invocation = await runScheduledBackup({
      now: () => new Date(), schedulerPool: pool, journal,
      executeBackup: (runId) => runBackupOnce({ config, pool, storage, runId, signal }),
    });
    const started = invocation.action === 'attempted' && invocation.backup_result
      ? invocation.backup_result.run_started_at : new Date().toISOString();
    const finished = new Date().toISOString();
    const result = invocation.action === 'attempted' || invocation.action === 'already_final' || invocation.action === 'skipped_overlapping'
      ? invocation.state : invocation.action === 'retry_not_due' ? invocation.state : 'complete';
    const backupResult = invocation.action === 'attempted' ? invocation.backup_result : undefined;
    const record = {
      operations_version: 1 as const, phase: 'backup' as const,
      operation_id: backupResult?.run_id ?? randomUUID(), state: result,
      reason_code: backupResult?.reason_code ?? (invocation.action === 'retry_not_due' ? 'bounded_retry_not_due' : `scheduler_${invocation.action}`),
      started_at_utc: started, finished_at_utc: finished, app_build_sha: buildSha,
      ...(backupResult ? { backup_result: backupResult } : {}),
      evidence: {
        slot_id: 'slot' in invocation ? invocation.slot.slot_id : null,
        attempt: 'attempt' in invocation ? invocation.attempt : 0,
        retry_at_utc: 'retry_at_utc' in invocation ? invocation.retry_at_utc : null,
      },
    };
    const evidenceFile = await persistOperationsRecord(stateDirectory, record);
    emit({ ...record, evidence_file: evidenceFile });
    if (invocation.action === 'skipped_overlapping') return 10;
    if (invocation.action === 'retry_not_due') return 0;
    // A terminal result is already durably represented in the journal. A
    // later minute-poll is a successful no-op; only the actual failed attempt
    // returns nonzero, and no systemd restart loop is needed.
    if (invocation.action === 'already_final') return 0;
    if (result === 'complete') return 0;
    return invocation.action === 'attempted' && invocation.retry_at_utc ? 1 : 12;
  } finally { await pool.end(); }
}

function readOfflinePassword(file: string): string {
  const absolute = path.resolve(file);
  const info = statSync(absolute);
  if (!info.isFile() || info.size < 1 || info.size > 4096
    || process.platform !== 'win32' && (info.mode & 0o077) !== 0) throw new Error('operations_password_file_invalid');
  const password = readFileSync(absolute, 'utf8').replace(/[\r\n]+$/, '');
  if (!password || /[\r\n]/.test(password)) throw new Error('operations_password_file_invalid');
  return password;
}

async function runRetentionCommand(): Promise<number> {
  requireOfflineTestMode();
  const host = required('RETENTION_DB_HOST');
  const name = required('RETENTION_DB_NAME');
  if (!isLoopback(host) || !/_test$/i.test(name)) throw new Error('retention_requires_loopback_disposable_test_database');
  const pool = new Pool({
    host, port: Number(required('RETENTION_DB_PORT')), database: name,
    user: 'lighting_retention', password: readOfflinePassword(required('RETENTION_DB_PASSWORD_FILE')),
    max: 2, connectionTimeoutMillis: 5000,
  });
  try {
    const result = await runRetentionOnce(pool, { appBuildSha: safeBuildSha() });
    const evidenceFile = await persistOperationsRecord(required('DATABASE_OPERATIONS_STATE_DIRECTORY'), {
      operations_version: 1, phase: 'retention', operation_id: result.run_id, state: result.state,
      reason_code: result.reason_code, started_at_utc: result.run_started_at_utc,
      finished_at_utc: result.run_finished_at_utc, app_build_sha: result.app_build_sha,
      evidence: { ...result.counts, cutoff_utc: result.cutoff_utc },
    });
    emit({ ...result, evidence_file: evidenceFile });
    return result.exit_code;
  } finally { await pool.end(); }
}

async function runMonitorCommand(): Promise<number> {
  requireOfflineTestMode();
  const raw = required('DATABASE_OPERATIONS_MONITOR_SNAPSHOT_JSON');
  if (Buffer.byteLength(raw, 'utf8') > 16 * 1024) throw new Error('monitor_snapshot_size_limit_exceeded');
  const snapshot = JSON.parse(raw) as MonitoringSnapshot;
  const events = evaluateMonitoring({ ...snapshot, appBuildSha: safeBuildSha() });
  const now = snapshot.nowUtc;
  const evidenceFile = await persistOperationsRecord(required('DATABASE_OPERATIONS_STATE_DIRECTORY'), {
    operations_version: 1, phase: 'monitoring', operation_id: randomUUID(),
    state: 'complete',
    reason_code: 'monitoring_checks_evaluated', started_at_utc: now, finished_at_utc: now,
    app_build_sha: safeBuildSha(), evidence: {
      event_count: events.length,
      critical_count: events.filter((event) => event.severity === 'critical').length,
      warning_count: events.filter((event) => event.severity === 'warning').length,
      unknown_count: events.filter((event) => event.severity === 'unknown').length,
      delivery_configured: false,
    },
  });
  emit({ phase: 'monitoring', state: 'evaluated', delivery_status: 'not_configured', evidence_file: evidenceFile, events });
  return 0;
}

async function main(): Promise<void> {
  if (productionBoundary()) return;
  const command = process.argv[2];
  if (process.argv.length !== 3 || !command || !ALLOWED_COMMANDS.has(command)) {
    emit({ result_version: 1, phase: 'operations', state: 'preflight_rejected', reason_code: 'fixed_command_required' });
    process.exitCode = 12;
    return;
  }
  try {
    process.exitCode = command === 'backup-scheduled'
      ? await runWithTerminationSignal((signal) => runScheduledBackupCommand(signal))
      : command === 'retention-once' ? await runRetentionCommand() : await runMonitorCommand();
  } catch (error) {
    const reason = error instanceof Error && /^[a-z0-9_]{1,80}$/.test(error.message) ? error.message : 'operations_preflight_failed';
    emit({ result_version: 1, phase: command === 'backup-scheduled' ? 'backup' : command === 'retention-once' ? 'retention' : 'monitoring', state: 'preflight_rejected', reason_code: reason });
    process.exitCode = 12;
  }
}

void main();
