import { createHash, randomUUID } from 'node:crypto';
import { chmod, lstat, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { isIP } from 'node:net';
import { pipeline } from 'node:stream/promises';
import type { Readable } from 'node:stream';
import type { Pool } from 'pg';
import { assertMigrationsCurrent } from '../db/migrate.js';
import { PINNED_AGE_VERSION } from '../backup/config.js';
import { validateMigrationLedger, type BackupManifestV1, type MigrationLedgerRow } from '../backup/manifest.js';
import type { ExactObjectIdentity, ObjectIntegrity } from '../backup/storage.js';
import { isSha256, isUtcTimestamp } from './contracts.js';

export interface ControlledRestoreSource {
  verifyExactObject(identity: ExactObjectIdentity): Promise<ObjectIntegrity>;
  readExactManifest(identity: ExactObjectIdentity): Promise<Buffer>;
  openExactArchive(identity: ExactObjectIdentity): Promise<Readable>;
}

export interface RestoreTargetPool extends Pick<Pool, 'query' | 'end'> {}

export interface ControlledRestoreOptions {
  manifestIdentity: ExactObjectIdentity;
  expectedStorageNamespaceId: string;
  expectedRecipientKeyId: string;
  privateIdentityFile: string;
  databaseAdmin: { host: string; port: number; user: string; password: string };
  adminPool: Pick<Pool, 'query'>;
  openTargetAdminPool: (databaseName: string) => RestoreTargetPool;
  openRuntimePool: (databaseName: string) => Pick<Pool, 'query' | 'connect' | 'end'>;
  assertClusterRolesPrepared: () => Promise<void>;
  canonicalGrantSql: string;
  source: ControlledRestoreSource;
  ageBinary?: string;
  pgRestoreBinary?: string;
  appBuildSha: string;
  validateAdditionalData: (runtime: Pick<Pool, 'query' | 'connect' | 'end'>, manifest: BackupManifestV1) => Promise<void>;
  signal?: AbortSignal;
  maxRestoreDurationMs?: number;
}

export interface RestoreReceiptV1 {
  result_version: 1;
  phase: 'restore';
  state: 'complete';
  reason_code: 'exact_artifact_restored_and_verified';
  operation_id: string;
  manifest_id: string;
  archive_key: string;
  archive_provider_version_id: string;
  encrypted_bytes: number;
  encrypted_sha256: string;
  recipient_key_id: string;
  snapshot_started_at_utc: string;
  target_database: string;
  restore_started_at_utc: string;
  restore_finished_at_utc: string;
  migration_ledger: MigrationLedgerRow[];
  checks: { manifest: true; ciphertext_identity: true; ciphertext_hash: true; recipient: true; postgres16_restore: true; canonical_grants: true; migrations_current: true; postgis: true; relational_constraints: true; sequences: true; runtime_query: true; additional_data: boolean };
  app_build_sha: string;
}

function validateManifest(value: unknown, expectedNamespace: string, manifestIdentity: ExactObjectIdentity, recipientId: string): BackupManifestV1 {
  if (!value || typeof value !== 'object') throw new Error('restore_manifest_invalid');
  const manifest = value as Partial<BackupManifestV1>;
  if (manifest.schema_version !== 1 || manifest.manifest_id !== manifestIdentity.key
    || manifest.storage_namespace_id !== expectedNamespace || manifest.completion_state !== 'complete'
    || !manifest.run_id || !manifest.source || !manifest.source.logical_database_id || !manifest.times_utc
    || !manifest.archive || !manifest.encryption || !manifest.dump) {
    throw new Error('restore_manifest_identity_or_state_invalid');
  }
  if (manifestIdentity.storageNamespaceId !== expectedNamespace || !manifestIdentity.providerVersionId) throw new Error('restore_manifest_object_identity_invalid');
  if (!isUtcTimestamp(manifest.times_utc.run_started_at) || !isUtcTimestamp(manifest.times_utc.snapshot_started_at)
    || !isUtcTimestamp(manifest.times_utc.dump_finished_at) || !isUtcTimestamp(manifest.times_utc.encryption_finished_at)
    || !isUtcTimestamp(manifest.times_utc.archive_upload_completed_at) || !isUtcTimestamp(manifest.times_utc.manifest_publish_started_at)
    || !manifest.archive.provider_version_id || !isSha256(manifest.archive.encrypted_sha256)
    || !Number.isSafeInteger(manifest.archive.encrypted_bytes) || manifest.archive.encrypted_bytes <= 0
    || !manifest.archive.provider_checksum || manifest.archive.provider_checksum.algorithm !== 'sha256'
    || manifest.archive.provider_checksum.value !== manifest.archive.encrypted_sha256
    || manifest.archive.remote_integrity_result !== 'verified'
    || manifest.archive.upload_result !== 'success') throw new Error('restore_manifest_integrity_fields_invalid');
  if (manifest.dump.result !== 'success' || manifest.dump.format !== 'pg_dump-custom' || !manifest.dump.no_owner || !manifest.dump.no_privileges
    || manifest.encryption.format !== 'age-v1' || manifest.encryption.result !== 'success'
    || manifest.encryption.private_identity_available_to_writer !== false
    || !manifest.encryption.recipient_key_ids.includes(recipientId)) throw new Error('restore_manifest_contract_invalid');
  const expectedArchiveKey = manifestIdentity.key.replace(/\/manifest\.json$/, '/database.pgdump.age');
  if (!expectedArchiveKey || manifest.archive.object_key !== expectedArchiveKey) throw new Error('restore_archive_key_not_bound_to_manifest');
  validateMigrationLedger(manifest.source.migration_ledger);
  return manifest as BackupManifestV1;
}

function validateLoopback(host: string): void {
  const version = isIP(host);
  if ((version === 4 && host !== '127.0.0.1') || (version === 6 && host !== '::1') || version === 0) {
    throw new Error('offline_restore_requires_numeric_loopback');
  }
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new Error('controlled_restore_aborted');
}

async function verifyPrivateIdentity(file: string): Promise<void> {
  // The caller supplies a protected secret-file path; never read its contents into the manifest or logs.
  const statResult = await lstat(file);
  if (!statResult.isFile() || statResult.isSymbolicLink() || statResult.size < 1 || statResult.size > 4096
    || (process.platform !== 'win32' && ((statResult.mode & 0o077) !== 0
      || typeof process.getuid === 'function' && statResult.uid !== process.getuid()))) {
    throw new Error('restore_identity_file_permissions_invalid');
  }
}

function toolVersion(binary: string, args: string[]): string {
  const result = spawnSync(binary, args, { encoding: 'utf8', windowsHide: true, timeout: 5000, maxBuffer: 2048, shell: false });
  if (result.error || result.status !== 0) throw new Error('restore_tool_unavailable');
  return String(result.stdout).trim();
}

function cleanChildEnvironment(environment: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const allowed = ['PATH', 'HOME', 'TMPDIR', 'TEMP', 'TMP', 'SYSTEMROOT', 'WINDIR', 'LANG', 'LC_ALL', 'PGHOST', 'PGPORT', 'PGUSER', 'PGDATABASE', 'PGPASSFILE'];
  const result: NodeJS.ProcessEnv = {};
  for (const key of allowed) if (environment[key] !== undefined) result[key] = environment[key];
  return result;
}

function waitForProcess(child: ChildProcess): Promise<number> {
  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code) => resolve(code ?? 1));
  });
}

function escapePgpass(value: string): string { return value.replace(/\\/g, '\\\\').replace(/:/g, '\\:'); }

async function makePgpass(config: ControlledRestoreOptions['databaseAdmin']): Promise<{ directory: string; file: string }> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'lighting-restore-'));
  const file = path.join(directory, 'pgpass');
  try {
    await chmod(directory, 0o700);
    await writeFile(file, `${[config.host, String(config.port), '*', config.user, config.password].map(escapePgpass).join(':')}\n`, { flag: 'wx', mode: 0o600 });
    await chmod(file, 0o600);
    const info = await stat(file);
    if (process.platform !== 'win32' && (info.mode & 0o077) !== 0) throw new Error('restore_pgpass_permissions_invalid');
    return { directory, file };
  } catch {
    await rm(directory, { recursive: true, force: true }).catch(() => undefined);
    throw new Error('restore_pgpass_setup_failed');
  }
}

async function runAgeRestorePipeline(
  archive: Readable,
  identityFile: string,
  targetDatabase: string,
  options: ControlledRestoreOptions,
  pgpassFile: string,
): Promise<void> {
  const ageBinary = options.ageBinary ?? 'age';
  const pgRestoreBinary = options.pgRestoreBinary ?? 'pg_restore';
  const ageVersion = toolVersion(ageBinary, ['--version']);
  if (!ageVersion.includes(PINNED_AGE_VERSION)) throw new Error('restore_age_version_mismatch');
  const restoreVersion = toolVersion(pgRestoreBinary, ['--version']);
  if (!/\b16\./.test(restoreVersion)) throw new Error('restore_pg_restore_major_mismatch');
  const age = spawn(ageBinary, ['--decrypt', '--identity', identityFile], {
    shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env: cleanChildEnvironment(process.env),
  });
  const restore = spawn(pgRestoreBinary, ['--exit-on-error', '--no-owner', '--no-acl', `--dbname=${targetDatabase}`], {
    shell: false,
    windowsHide: true,
    stdio: ['pipe', 'ignore', 'pipe'],
    env: cleanChildEnvironment({
      ...process.env,
      PGHOST: options.databaseAdmin.host,
      PGPORT: String(options.databaseAdmin.port),
      PGUSER: options.databaseAdmin.user,
      PGDATABASE: targetDatabase,
      PGPASSFILE: pgpassFile,
    }),
  });
  let overflow = false;
  let stderrBytes = 0;
  const drain = (stream: NodeJS.ReadableStream | null) => stream?.on('data', (chunk: Buffer | string) => {
    const length = Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(chunk);
    stderrBytes += length;
    if (stderrBytes > 8192) overflow = true;
  });
  drain(age.stderr);
  drain(restore.stderr);
  const ageExit = waitForProcess(age);
  const restoreExit = waitForProcess(restore);
  let forceKillTimer: NodeJS.Timeout | undefined;
  const terminateChildren = () => {
    if (forceKillTimer) return;
    if (age.exitCode === null && age.signalCode === null) age.kill('SIGTERM');
    if (restore.exitCode === null && restore.signalCode === null) restore.kill('SIGTERM');
    forceKillTimer = setTimeout(() => {
      if (age.exitCode === null && age.signalCode === null) age.kill('SIGKILL');
      if (restore.exitCode === null && restore.signalCode === null) restore.kill('SIGKILL');
    }, 2000);
    forceKillTimer.unref();
  };
  const onAbort = () => terminateChildren();
  options.signal?.addEventListener('abort', onAbort, { once: true });
  try {
    try {
      if (options.signal?.aborted) throw new Error('restore_aborted');
      if (options.signal) await pipeline(archive, age.stdin, { signal: options.signal });
      else await pipeline(archive, age.stdin);
      if (options.signal) await pipeline(age.stdout, restore.stdin, { signal: options.signal });
      else await pipeline(age.stdout, restore.stdin);
    } catch {
      terminateChildren();
      await Promise.allSettled([ageExit, restoreExit]);
      throw new Error(options.signal?.aborted ? 'restore_process_aborted' : 'restore_stream_pipeline_failed');
    }
    const [ageResult, restoreResult] = await Promise.allSettled([ageExit, restoreExit]);
    if (ageResult.status === 'rejected' || restoreResult.status === 'rejected') throw new Error('restore_child_start_failed');
    if (options.signal?.aborted) throw new Error('restore_process_aborted');
    if (ageResult.value !== 0 || restoreResult.value !== 0) throw new Error(overflow ? 'restore_child_failed' : 'restore_child_nonzero');
  } finally {
    options.signal?.removeEventListener('abort', onAbort);
    if (forceKillTimer) clearTimeout(forceKillTimer);
  }
}

async function verifyIntegrity(actual: ObjectIntegrity, identity: ExactObjectIdentity, bytes: Buffer | null, expectedBytes?: number, expectedHash?: string): Promise<void> {
  if (actual.identity.storageNamespaceId !== identity.storageNamespaceId || actual.identity.key !== identity.key
    || actual.identity.providerVersionId !== identity.providerVersionId || actual.bytes <= 0
    || actual.checksum.algorithm !== 'sha256' || !isSha256(actual.checksum.value)) throw new Error('restore_object_identity_invalid');
  if (bytes) {
    const hash = createHash('sha256').update(bytes).digest('hex');
    if (bytes.length !== actual.bytes || hash !== actual.checksum.value) throw new Error('restore_manifest_bytes_mismatch');
  }
  if (expectedBytes !== undefined && actual.bytes !== expectedBytes) throw new Error('restore_archive_size_mismatch');
  if (expectedHash !== undefined && actual.checksum.value !== expectedHash) throw new Error('restore_archive_checksum_mismatch');
}

function newTargetDatabaseName(): string { return `ops_restore_${randomUUID().replaceAll('-', '').slice(0, 24)}`; }

export async function restoreExactBackupToFreshDatabase(options: ControlledRestoreOptions): Promise<RestoreReceiptV1> {
  if (process.env.NODE_ENV === 'production') throw new Error('offline_restore_test_mode_only');
  validateLoopback(options.databaseAdmin.host);
  await verifyPrivateIdentity(options.privateIdentityFile);
  const restoreLimit = options.maxRestoreDurationMs ?? 4 * 60 * 60 * 1000;
  if (!Number.isSafeInteger(restoreLimit) || restoreLimit < 1 || restoreLimit > 4 * 60 * 60 * 1000) {
    throw new Error('restore_duration_bound_invalid');
  }
  const restoreTimeout = AbortSignal.timeout(restoreLimit);
  const restoreSignal = options.signal ? AbortSignal.any([options.signal, restoreTimeout]) : restoreTimeout;
  await options.assertClusterRolesPrepared();

  const operationId = randomUUID();
  const startedAt = new Date().toISOString();
  const manifestIntegrity = await options.source.verifyExactObject(options.manifestIdentity);
  const manifestBytes = await options.source.readExactManifest(options.manifestIdentity);
  await verifyIntegrity(manifestIntegrity, options.manifestIdentity, manifestBytes);
  let manifest: BackupManifestV1;
  try { manifest = validateManifest(JSON.parse(manifestBytes.toString('utf8')), options.expectedStorageNamespaceId, options.manifestIdentity, options.expectedRecipientKeyId); }
  catch { throw new Error('restore_manifest_contract_rejected'); }

  const archiveIdentity: ExactObjectIdentity = {
    storageNamespaceId: manifest.storage_namespace_id,
    key: manifest.archive.object_key,
    providerVersionId: manifest.archive.provider_version_id,
  };
  if (!archiveIdentity.providerVersionId) throw new Error('restore_archive_version_missing');
  const archiveIntegrity = await options.source.verifyExactObject(archiveIdentity);
  await verifyIntegrity(archiveIntegrity, archiveIdentity, null, manifest.archive.encrypted_bytes, manifest.archive.encrypted_sha256);
  if (manifest.archive.provider_checksum.value !== archiveIntegrity.checksum.value) throw new Error('restore_provider_checksum_mismatch');

  throwIfAborted(restoreSignal);
  const targetName = newTargetDatabaseName();
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(targetName)) throw new Error('restore_target_name_invalid');
  let created = false;
  let adminTarget: RestoreTargetPool | undefined;
  let runtimeTarget: ReturnType<ControlledRestoreOptions['openRuntimePool']> | undefined;
  let pgpass: { directory: string; file: string } | undefined;
  try {
    const existing = await options.adminPool.query<{ exists: boolean }>('SELECT EXISTS (SELECT 1 FROM pg_database WHERE datname = $1) AS exists', [targetName]);
    if (existing.rows[0]?.exists) throw new Error('restore_target_database_collision');
    await options.adminPool.query(`CREATE DATABASE "${targetName}" TEMPLATE template0`);
    created = true;
    adminTarget = options.openTargetAdminPool(targetName);
    pgpass = await makePgpass(options.databaseAdmin);
    const archive = await options.source.openExactArchive(archiveIdentity);
    await runAgeRestorePipeline(archive, options.privateIdentityFile, targetName, { ...options, signal: restoreSignal }, pgpass.file);
    throwIfAborted(restoreSignal);
    await adminTarget.query(options.canonicalGrantSql);
    runtimeTarget = options.openRuntimePool(targetName);
    await assertMigrationsCurrent(runtimeTarget);
    const health = await runtimeTarget.query<{ ok: number }>('SELECT 1 AS ok');
    if (health.rows[0]?.ok !== 1) throw new Error('restore_runtime_query_failed');
    const postgis = await runtimeTarget.query<{ version: string | null }>('SELECT PostGIS_Full_Version() AS version');
    if (!postgis.rows[0]?.version) throw new Error('restore_postgis_check_failed');
    const counts = await runtimeTarget.query<{ foreign_keys: string; checks: string; sequences: string }>(
      `SELECT
         count(*) FILTER (WHERE contype = 'f' AND convalidated)::text AS foreign_keys,
         count(*) FILTER (WHERE contype = 'c' AND convalidated)::text AS checks,
         (SELECT count(*) FROM pg_sequences WHERE schemaname='public')::text AS sequences
       FROM pg_constraint constraint_row
       JOIN pg_class relation ON relation.oid = constraint_row.conrelid
       JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
       WHERE namespace.nspname = 'public'`,
    );
    const checks = counts.rows[0];
    if (!checks || Number(checks.foreign_keys) < 1 || Number(checks.checks) < 1 || Number(checks.sequences) < 1) {
      throw new Error('restore_relational_structure_check_failed');
    }
    const sequenceStates = await adminTarget.query<{ sequence_last: string; table_max: string }>(
      `SELECT last_value::text AS sequence_last, (SELECT COALESCE(max(id), 0)::text FROM public.light_points) AS table_max FROM public.light_points_id_seq
       UNION ALL SELECT last_value::text, (SELECT COALESCE(max(id), 0)::text FROM public.admins) FROM public.admins_id_seq
       UNION ALL SELECT last_value::text, (SELECT COALESCE(max(id), 0)::text FROM public.integration_logs) FROM public.integration_logs_id_seq
       UNION ALL SELECT last_value::text, (SELECT COALESCE(max(id), 0)::text FROM public.import_batches) FROM public.import_batches_id_seq
       UNION ALL SELECT last_value::text, (SELECT COALESCE(max(id), 0)::text FROM public.admin_activity_logs) FROM public.admin_activity_logs_id_seq
       UNION ALL SELECT last_value::text, (SELECT COALESCE(max(id), 0)::text FROM public.import_batch_rows) FROM public.import_batch_rows_id_seq
       UNION ALL SELECT last_value::text, (SELECT COALESCE(max(id), 0)::text FROM public.inventory_audit_events) FROM public.inventory_audit_events_id_seq`,
    );
    if (sequenceStates.rows.length !== 7 || sequenceStates.rows.some((row) => Number(row.sequence_last) < Number(row.table_max))) {
      throw new Error('restore_sequence_state_check_failed');
    }
    const ledger = await runtimeTarget.query<MigrationLedgerRow>('SELECT version, name, checksum FROM public.schema_migrations ORDER BY version');
    if (JSON.stringify(ledger.rows) !== JSON.stringify(manifest.source.migration_ledger)) throw new Error('restore_migration_ledger_mismatch');
    await options.validateAdditionalData(runtimeTarget, manifest);
    throwIfAborted(restoreSignal);
    await runtimeTarget.end();
    runtimeTarget = undefined;
    await adminTarget.end();
    adminTarget = undefined;
    if (pgpass) {
      await rm(pgpass.directory, { recursive: true, force: true });
      pgpass = undefined;
    }
    throwIfAborted(restoreSignal);
    return {
      result_version: 1,
      phase: 'restore',
      state: 'complete',
      reason_code: 'exact_artifact_restored_and_verified',
      operation_id: operationId,
      manifest_id: manifest.manifest_id,
      archive_key: archiveIdentity.key,
      archive_provider_version_id: archiveIdentity.providerVersionId,
      encrypted_bytes: archiveIntegrity.bytes,
      encrypted_sha256: archiveIntegrity.checksum.value,
      recipient_key_id: options.expectedRecipientKeyId,
      snapshot_started_at_utc: manifest.times_utc.snapshot_started_at,
      target_database: targetName,
      restore_started_at_utc: startedAt,
      restore_finished_at_utc: new Date().toISOString(),
      migration_ledger: ledger.rows,
      checks: {
        manifest: true, ciphertext_identity: true, ciphertext_hash: true, recipient: true,
        postgres16_restore: true, canonical_grants: true, migrations_current: true, postgis: true,
        relational_constraints: true, sequences: true, runtime_query: true,
        additional_data: true,
      },
      app_build_sha: options.appBuildSha,
    };
  } catch {
    let cleanupConfirmed = true;
    await runtimeTarget?.end().catch(() => { cleanupConfirmed = false; });
    await adminTarget?.end().catch(() => { cleanupConfirmed = false; });
    if (created) await options.adminPool.query(`DROP DATABASE IF EXISTS "${targetName}" WITH (FORCE)`).catch(() => { cleanupConfirmed = false; });
    if (pgpass) {
      try { await rm(pgpass.directory, { recursive: true, force: true }); pgpass = undefined; }
      catch { cleanupConfirmed = false; }
    }
    throw new Error(cleanupConfirmed ? 'controlled_restore_failed_fresh_target_discarded' : 'controlled_restore_failed_cleanup_unconfirmed');
  }
}

export function sha256Bytes(value: Buffer): string { return createHash('sha256').update(value).digest('hex'); }
