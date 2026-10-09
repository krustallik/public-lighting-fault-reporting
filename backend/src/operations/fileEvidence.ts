import { randomUUID } from 'node:crypto';
import { chmod, link, lstat, mkdir, open, rm } from 'node:fs/promises';
import path from 'node:path';
import type { OperationsRecordV1 } from './contracts.js';
import { isSha256, isUtcTimestamp } from './contracts.js';
import type { BackupResult, BackupState } from '../backup/runner.js';

const SECRET_FIELD = /(password|secret|credential|identity|token|payload|contact|email|coordinate|private.?key)/i;
const MAX_OPERATIONS_RECORD_BYTES = 64 * 1024;
const OPERATION_STATES = new Set(['complete', 'skipped_overlapping', 'blocked_by_migration', 'preflight_rejected', 'incomplete', 'success_with_backlog']);
const BACKUP_STATES = new Set<BackupState>(['complete', 'skipped_overlapping', 'blocked_by_migration', 'preflight_rejected', 'incomplete']);
const RETENTION_COUNT_FIELDS = new Set([
  'admin_activity_logs', 'inventory_audit_events', 'admin_refresh_sessions',
  'admin_activity_logs_eligible', 'inventory_audit_events_eligible', 'admin_refresh_sessions_eligible',
  'deferred_import_batches', 'import_batches_missing_completion', 'import_batches_with_pending_rows',
  'import_batches_referenced_by_retained_audit', 'chunks',
]);

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function isSafeObjectKey(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 512 && /^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(value)
    && !value.includes('..') && !value.includes('//');
}

export function sanitizeBackupResult(value: unknown): BackupResult {
  const fields = ['result_version', 'state', 'exit_code', 'reason_code', 'run_id', 'run_started_at', 'duration_ms',
    'snapshot_started_at', 'migration_ledger', 'manifest_id', 'archive_encrypted_bytes', 'archive_encrypted_sha256',
    'cleanup_error_code', 'recipient_key_id', 'app_build_sha'];
  if (!isObject(value) || !exactKeys(value, fields) || value.result_version !== 1
    || typeof value.state !== 'string' || !BACKUP_STATES.has(value.state as BackupState)
    || !Number.isSafeInteger(value.exit_code) || typeof value.reason_code !== 'string' || !/^[a-z0-9_]{1,80}$/.test(value.reason_code)
    || typeof value.run_id !== 'string' || !/^[a-f0-9-]{16,64}$/i.test(value.run_id)
    || !isUtcTimestamp(value.run_started_at) || typeof value.duration_ms !== 'number' || !Number.isFinite(value.duration_ms) || value.duration_ms < 0
    || typeof value.recipient_key_id !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(value.recipient_key_id)
    || typeof value.app_build_sha !== 'string' || !/^[a-f0-9]{7,64}$/i.test(value.app_build_sha)) {
    throw new Error('operations_evidence_backup_result_invalid');
  }
  if (value.snapshot_started_at !== undefined && !isUtcTimestamp(value.snapshot_started_at)) throw new Error('operations_evidence_backup_result_invalid');
  if (value.migration_ledger !== undefined) {
    if (!Array.isArray(value.migration_ledger) || value.migration_ledger.length > 256 || value.migration_ledger.some((row) => {
      if (!isObject(row) || !exactKeys(row, ['version', 'name', 'checksum'])) return true;
      return typeof row.version !== 'string' || !/^\d{4}$/.test(row.version)
        || typeof row.name !== 'string' || !/^[a-z0-9_-]{1,128}$/.test(row.name)
        || typeof row.checksum !== 'string' || !isSha256(row.checksum);
    })) throw new Error('operations_evidence_backup_result_invalid');
  }
  if (value.manifest_id !== undefined && !isSafeObjectKey(value.manifest_id)
    || value.archive_encrypted_bytes !== undefined && (!Number.isSafeInteger(value.archive_encrypted_bytes) || Number(value.archive_encrypted_bytes) <= 0)
    || value.archive_encrypted_sha256 !== undefined && !isSha256(value.archive_encrypted_sha256)
    || value.cleanup_error_code !== undefined && (typeof value.cleanup_error_code !== 'string' || !/^[a-z0-9_]{1,80}$/.test(value.cleanup_error_code))) {
    throw new Error('operations_evidence_backup_result_invalid');
  }
  return {
    result_version: 1,
    state: value.state as BackupState,
    exit_code: Number(value.exit_code),
    reason_code: value.reason_code,
    run_id: value.run_id,
    run_started_at: value.run_started_at,
    duration_ms: value.duration_ms,
    ...(value.snapshot_started_at !== undefined ? { snapshot_started_at: value.snapshot_started_at as string } : {}),
    ...(Array.isArray(value.migration_ledger) ? { migration_ledger: value.migration_ledger.map((row) => ({
      version: (row as Record<string, string>).version,
      name: (row as Record<string, string>).name,
      checksum: (row as Record<string, string>).checksum,
    })) } : {}),
    ...(value.manifest_id !== undefined ? { manifest_id: value.manifest_id as string } : {}),
    ...(value.archive_encrypted_bytes !== undefined ? { archive_encrypted_bytes: Number(value.archive_encrypted_bytes) } : {}),
    ...(value.archive_encrypted_sha256 !== undefined ? { archive_encrypted_sha256: value.archive_encrypted_sha256 as string } : {}),
    ...(value.cleanup_error_code !== undefined ? { cleanup_error_code: value.cleanup_error_code as string } : {}),
    recipient_key_id: value.recipient_key_id,
    app_build_sha: value.app_build_sha,
  };
}

function validateEvidence(phase: OperationsRecordV1['phase'], evidence: unknown): Record<string, string | number | boolean | null> | undefined {
  if (evidence === undefined) return undefined;
  if (!isObject(evidence)) throw new Error('operations_evidence_field_rejected');
  const allowedByPhase: Record<OperationsRecordV1['phase'], Set<string>> = {
    backup: new Set(['slot_id', 'attempt', 'retry_at_utc']),
    restore: new Set([]),
    recovery_drill: new Set(['evidence_class', 'rpo_ms', 'rto_ms', 'synthetic_rpo_target_ms', 'synthetic_rto_target_ms', 'synthetic_targets_met', 'manifest_id', 'encrypted_sha256', 'loss_event_at_utc', 'restore_started_at_utc', 'restore_finished_at_utc']),
    retention: new Set([...RETENTION_COUNT_FIELDS, 'cutoff_utc']),
    monitoring: new Set(['event_count', 'critical_count', 'warning_count', 'delivery_configured']),
  };
  if (Object.keys(evidence).some((key) => SECRET_FIELD.test(key) || !allowedByPhase[phase].has(key))) {
    throw new Error('operations_evidence_field_rejected');
  }
  for (const [key, value] of Object.entries(evidence)) {
    if (RETENTION_COUNT_FIELDS.has(key) || ['attempt', 'event_count', 'critical_count', 'warning_count', 'rpo_ms', 'rto_ms', 'synthetic_rpo_target_ms', 'synthetic_rto_target_ms'].includes(key)) {
      if (!Number.isSafeInteger(value) || Number(value) < 0) throw new Error('operations_evidence_field_rejected');
    } else if (['slot_id', 'cutoff_utc', 'retry_at_utc', 'loss_event_at_utc', 'restore_started_at_utc', 'restore_finished_at_utc'].includes(key)) {
      if (!(value === null && (key === 'cutoff_utc' || key === 'retry_at_utc')) && !isUtcTimestamp(value)) throw new Error('operations_evidence_field_rejected');
    } else if (key === 'manifest_id') {
      if (!isSafeObjectKey(value)) throw new Error('operations_evidence_field_rejected');
    } else if (key === 'encrypted_sha256') {
      if (!isSha256(value)) throw new Error('operations_evidence_field_rejected');
    } else if (key === 'evidence_class') {
      if (value !== 'synthetic_ci') throw new Error('operations_evidence_field_rejected');
    } else if (key === 'synthetic_targets_met' || key === 'delivery_configured') {
      if (typeof value !== 'boolean' || key === 'delivery_configured' && value !== false) throw new Error('operations_evidence_field_rejected');
    } else if (value !== null) throw new Error('operations_evidence_field_rejected');
  }
  return { ...evidence } as Record<string, string | number | boolean | null>;
}

function assertSecretFreeEnvelope(record: OperationsRecordV1): void {
  if (record.operations_version !== 1 || !/^[a-z][a-z0-9_]{0,40}$/.test(record.phase)
    || !['backup', 'restore', 'recovery_drill', 'retention', 'monitoring'].includes(record.phase)
    || !/^[a-f0-9-]{16,64}$/i.test(record.operation_id)
    || !/^[a-f0-9]{7,64}$/i.test(record.app_build_sha)
    || !/^[a-z0-9_]{1,80}$/.test(record.reason_code)
    || !OPERATION_STATES.has(record.state)
    || !isUtcTimestamp(record.started_at_utc) || !isUtcTimestamp(record.finished_at_utc)) throw new Error('operations_evidence_envelope_invalid');
  validateEvidence(record.phase, record.evidence);
  if (record.backup_result !== undefined) {
    const backup = sanitizeBackupResult(record.backup_result);
    if (record.phase === 'backup' && backup.run_id !== record.operation_id) throw new Error('operations_evidence_backup_result_invalid');
  }
  if (record.artifact !== undefined) {
    const artifact = record.artifact as unknown;
    if (!isObject(artifact) || !exactKeys(artifact, ['manifest_id', 'archive_key', 'archive_provider_version_id', 'encrypted_bytes', 'encrypted_sha256', 'recipient_key_ids', 'snapshot_started_at_utc'])
      || !isSafeObjectKey(artifact.manifest_id) || !isSafeObjectKey(artifact.archive_key)
      || typeof artifact.archive_provider_version_id !== 'string' || !/^[A-Za-z0-9._:-]{1,256}$/.test(artifact.archive_provider_version_id)
      || !Number.isSafeInteger(artifact.encrypted_bytes) || Number(artifact.encrypted_bytes) <= 0
      || !isSha256(artifact.encrypted_sha256) || !Array.isArray(artifact.recipient_key_ids)
      || artifact.recipient_key_ids.length < 1 || artifact.recipient_key_ids.length > 16
      || artifact.recipient_key_ids.some((id) => typeof id !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(id))
      || !isUtcTimestamp(artifact.snapshot_started_at_utc)) throw new Error('operations_evidence_artifact_invalid');
  }
}

/** Stores one private, create-only, fsync'd, secret-free result envelope. */
export async function persistOperationsRecord(directory: string, record: OperationsRecordV1): Promise<string> {
  assertSecretFreeEnvelope(record);
  if (!path.isAbsolute(directory)) throw new Error('operations_evidence_directory_must_be_absolute');
  const absoluteDirectory = path.resolve(directory);
  const fileName = `${record.phase}-${randomUUID()}.json`;
  const filePath = path.join(absoluteDirectory, fileName);
  const temporaryPath = path.join(absoluteDirectory, `.pending-${randomUUID()}.part`);
  let handle;
  try {
    await mkdir(absoluteDirectory, { recursive: true, mode: 0o700 });
    let directoryInfo = await lstat(absoluteDirectory);
    if (!directoryInfo.isDirectory() || directoryInfo.isSymbolicLink()
      || process.platform !== 'win32' && typeof process.getuid === 'function' && directoryInfo.uid !== process.getuid()) {
      throw new Error('operations_evidence_directory_invalid');
    }
    await chmod(absoluteDirectory, 0o700);
    directoryInfo = await lstat(absoluteDirectory);
    if (!directoryInfo.isDirectory() || directoryInfo.isSymbolicLink()
      || process.platform !== 'win32' && (directoryInfo.mode & 0o077) !== 0) throw new Error('operations_evidence_directory_invalid');
    handle = await open(temporaryPath, 'wx', 0o600);
    const safeEnvelope: OperationsRecordV1 = {
      operations_version: record.operations_version,
      phase: record.phase,
      operation_id: record.operation_id,
      state: record.state,
      reason_code: record.reason_code,
      started_at_utc: record.started_at_utc,
      finished_at_utc: record.finished_at_utc,
      app_build_sha: record.app_build_sha,
      ...(record.artifact ? { artifact: { ...record.artifact, recipient_key_ids: [...record.artifact.recipient_key_ids] } } : {}),
      ...(record.backup_result ? { backup_result: sanitizeBackupResult(record.backup_result) } : {}),
      ...(record.evidence ? { evidence: validateEvidence(record.phase, record.evidence) } : {}),
    };
    const serialized = `${JSON.stringify(safeEnvelope)}\n`;
    if (Buffer.byteLength(serialized, 'utf8') > MAX_OPERATIONS_RECORD_BYTES) throw new Error('operations_evidence_size_limit_exceeded');
    await handle.writeFile(serialized, 'utf8');
    await handle.sync();
    const fileInfo = await handle.stat();
    if (!fileInfo.isFile() || process.platform !== 'win32' && (fileInfo.mode & 0o077) !== 0) {
      throw new Error('operations_evidence_permissions_invalid');
    }
    await handle.close();
    handle = undefined;
    await link(temporaryPath, filePath);
    await rm(temporaryPath, { force: true });
    if (process.platform !== 'win32') {
      const directoryHandle = await open(absoluteDirectory, 'r');
      try { await directoryHandle.sync(); } finally { await directoryHandle.close(); }
    }
    return fileName;
  } catch {
    await handle?.close().catch(() => undefined);
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    throw new Error('operations_evidence_persist_failed');
  }
}
