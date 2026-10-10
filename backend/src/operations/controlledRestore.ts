import { createHash, randomUUID } from 'node:crypto';
import { chmod, lstat, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { isIP } from 'node:net';
import { pipeline } from 'node:stream/promises';
import type { Readable } from 'node:stream';
import type { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';
import { assertMigrationsCurrent } from '../db/migrate.js';
import { PINNED_AGE_VERSION } from '../backup/config.js';
import { validateMigrationLedger, type BackupManifestV1, type MigrationLedgerRow } from '../backup/manifest.js';
import type { ExactObjectIdentity, ObjectIntegrity } from '../backup/storage.js';
import { isSha256, isUtcTimestamp } from './contracts.js';

export interface ControlledRestoreSource {
  verifyExactObject(identity: ExactObjectIdentity, signal: AbortSignal): Promise<ObjectIntegrity>;
  readExactManifest(identity: ExactObjectIdentity, signal: AbortSignal): Promise<Buffer>;
  openExactArchive(identity: ExactObjectIdentity, signal: AbortSignal): Promise<Readable>;
}

export type RestoreTargetPool = Pool;

export interface ControlledRestoreOptions {
  manifestIdentity: ExactObjectIdentity;
  expectedStorageNamespaceId: string;
  expectedRecipientKeyId: string;
  privateIdentityFile: string;
  databaseAdmin: { host: string; port: number; user: string; password: string };
  adminPool: Pool;
  openTargetAdminPool: (databaseName: string) => RestoreTargetPool;
  openRuntimePool: (databaseName: string) => Pool;
  assertClusterRolesPrepared: (signal: AbortSignal) => Promise<void>;
  canonicalGrantSql: string;
  source: ControlledRestoreSource;
  ageBinary?: string;
  pgRestoreBinary?: string;
  appBuildSha: string;
  validateAdditionalData: (runtime: Pick<Pool, 'query' | 'end'>, manifest: BackupManifestV1, signal: AbortSignal) => Promise<void>;
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
  if (signal.aborted) throw new Error(signal.reason instanceof Error && (signal.reason.message === 'restore_deadline_exceeded' || signal.reason.name === 'TimeoutError')
    ? 'controlled_restore_deadline_exceeded' : 'controlled_restore_aborted');
}

function deadlineRemaining(deadlineAt: number, signal: AbortSignal): number {
  throwIfAborted(signal);
  const remaining = Math.floor(deadlineAt - Date.now());
  if (remaining < 1) throw new Error('controlled_restore_deadline_exceeded');
  return remaining;
}

async function awaitRestoreStage<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  try {
    const value = await operation;
    throwIfAborted(signal);
    return value;
  } catch (error) {
    if (signal.aborted) throwIfAborted(signal);
    throw error;
  }
}

async function queryClientWithinDeadline<T extends QueryResultRow>(
  client: PoolClient,
  deadlineAt: number,
  signal: AbortSignal,
  sql: string,
  values?: unknown[],
): Promise<QueryResult<T>> {
  const remaining = deadlineRemaining(deadlineAt, signal);
  const result = await queryClientWithSessionTimeouts<T>(client, `${remaining}ms`, sql, values, deadlineAt, signal);
  deadlineRemaining(deadlineAt, signal);
  return result;
}

class RestoreSessionTimeoutResetError extends Error {
  constructor() {
    super('restore_session_timeout_reset_failed');
    this.name = 'RestoreSessionTimeoutResetError';
  }
}

class RestoreAdminQueryDeadlineError extends Error {
  constructor() {
    super('controlled_restore_deadline_exceeded');
    this.name = 'RestoreAdminQueryDeadlineError';
  }
}

class RestoreAdminQueryCancellationError extends Error {
  constructor() {
    super('restore_admin_query_cancellation_unconfirmed');
    this.name = 'RestoreAdminQueryCancellationError';
  }
}

const untrustedRestoreClients = new WeakSet<PoolClient>();
const RESTORE_QUERY_CANCELLATION_SETTLE_MS = 1_000;

function markRestoreClientUntrusted(client: PoolClient): void {
  untrustedRestoreClients.add(client);
}

function isRestoreClientUntrusted(client: PoolClient): boolean {
  return untrustedRestoreClients.has(client);
}

function destroyRestoreClient(client: PoolClient): void {
  markRestoreClientUntrusted(client);
  // Client.end marks the intentional close before it destroys a socket with
  // an active query, so pg does not emit an unexpected-disconnect error while
  // pg-pool has removed its idle listener for this checked-out client.
  void (client as unknown as { end: () => Promise<void> }).end().catch(() => undefined);
}

async function settleRestoreQueryAfterDestroy(operation: Promise<unknown>): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  try {
    const settled = await Promise.race([
      operation.then(() => true, () => true),
      new Promise<boolean>((resolve) => { timer = setTimeout(() => resolve(false), RESTORE_QUERY_CANCELLATION_SETTLE_MS); }),
    ]);
    if (!settled) throw new RestoreAdminQueryCancellationError();
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function restoreAbortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    && (signal.reason.message === 'restore_deadline_exceeded' || signal.reason.name === 'TimeoutError')
    ? new Error('controlled_restore_deadline_exceeded')
    : new Error('controlled_restore_aborted');
}

async function queryClientRawWithinDeadline<T extends QueryResultRow>(
  client: PoolClient,
  deadlineAt: number,
  signal: AbortSignal,
  sql: string,
  values?: unknown[],
): Promise<QueryResult<T>> {
  const remaining = deadlineRemaining(deadlineAt, signal);
  let timer: NodeJS.Timeout | undefined;
  let abortListener: (() => void) | undefined;
  const operation = Promise.resolve().then(() => client.query<T>(sql, values as never));
  const expired = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new RestoreAdminQueryDeadlineError()), remaining);
    abortListener = () => reject(restoreAbortError(signal));
    signal.addEventListener('abort', abortListener, { once: true });
  });
  try {
    const result = await Promise.race([operation, expired]);
    deadlineRemaining(deadlineAt, signal);
    return result;
  } catch (error) {
    const deadlineExpired = error instanceof RestoreAdminQueryDeadlineError
      || signal.aborted || Date.now() >= deadlineAt;
    if (!deadlineExpired) throw error;
    destroyRestoreClient(client);
    try { await settleRestoreQueryAfterDestroy(operation); }
    catch { throw new RestoreAdminQueryCancellationError(); }
    if (signal.aborted) throw restoreAbortError(signal);
    throw new RestoreAdminQueryDeadlineError();
  } finally {
    if (timer) clearTimeout(timer);
    if (abortListener) signal.removeEventListener('abort', abortListener);
  }
}

async function connectRestoreClientWithinDeadline(pool: Pool, deadlineAt: number, signal: AbortSignal): Promise<PoolClient> {
  const remaining = deadlineRemaining(deadlineAt, signal);
  const configuredTimeout = pool.options.connectionTimeoutMillis;
  if (typeof configuredTimeout !== 'number' || !Number.isSafeInteger(configuredTimeout) || configuredTimeout < 1) {
    throw new Error('restore_pool_connect_timeout_unconfigured');
  }
  let timer: NodeJS.Timeout | undefined;
  let abortListener: (() => void) | undefined;
  const operation = pool.connect();
  const expired = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new RestoreAdminQueryDeadlineError()), Math.min(remaining, configuredTimeout));
    abortListener = () => reject(restoreAbortError(signal));
    signal.addEventListener('abort', abortListener, { once: true });
  });
  try {
    const client = await Promise.race([operation, expired]);
    deadlineRemaining(deadlineAt, signal);
    return client;
  } catch (error) {
    const deadlineExpired = error instanceof RestoreAdminQueryDeadlineError
      || signal.aborted || Date.now() >= deadlineAt;
    if (!deadlineExpired) throw error;
    // pg-pool bounds the outstanding checkout with its immutable configured timeout.
    // If it completes after our earlier deadline, immediately discard that late client.
    void operation.then((client) => client.release(new Error('restore_pool_connect_after_deadline')), () => undefined);
    if (signal.aborted) throw restoreAbortError(signal);
    throw new RestoreAdminQueryDeadlineError();
  } finally {
    if (timer) clearTimeout(timer);
    if (abortListener) signal.removeEventListener('abort', abortListener);
  }
}

const RESTORE_TARGET_DRAIN_TIMEOUT_MS = 10_000;
const RESTORE_TARGET_POOL_END_TIMEOUT_MS = 5_000;
const RESTORE_CLEANUP_TIMEOUT_MS = 20_000;
const restoreTargetPoolEndPromises = new WeakMap<Pool, Promise<void>>();

async function endRestoreTargetPool(pool: Pool): Promise<void> {
  // pg-pool removes idle clients before the underlying Client.end callback completes.
  let endPromise = restoreTargetPoolEndPromises.get(pool);
  if (!endPromise) {
    endPromise = Promise.resolve().then(() => pool.end());
    restoreTargetPoolEndPromises.set(pool, endPromise);
  }
  let timer: NodeJS.Timeout | undefined;
  try {
    const ended = await Promise.race([
      endPromise.then(() => true, () => { throw new Error('restore_target_pool_end_failed'); }),
      new Promise<boolean>((resolve) => { timer = setTimeout(() => resolve(false), RESTORE_TARGET_POOL_END_TIMEOUT_MS); }),
    ]);
    if (!ended) throw new Error('restore_target_pool_end_timeout');
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function queryRestoreTargetSessions(
  adminClient: PoolClient,
  targetName: string,
  deadlineAt: number,
  signal: AbortSignal,
): Promise<number> {
  const result = await queryClientWithSessionTimeouts<{ restore_active_sessions: string }>(
    adminClient,
    '1000ms',
    'SELECT count(*)::text AS restore_active_sessions FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()',
    [targetName],
    deadlineAt,
    signal,
  );
  const activeSessions = Number(result.rows[0]?.restore_active_sessions);
  if (!Number.isSafeInteger(activeSessions) || activeSessions < 0) throw new Error('restore_target_session_state_unavailable');
  return activeSessions;
}

async function waitForRestoreTargetSessionsClosed(
  adminClient: PoolClient,
  targetName: string,
  operationDeadlineAt: number,
  signal: AbortSignal,
): Promise<void> {
  const deadlineAt = Math.min(operationDeadlineAt, Date.now() + RESTORE_TARGET_DRAIN_TIMEOUT_MS);
  while (Date.now() < deadlineAt) {
    if (await queryRestoreTargetSessions(adminClient, targetName, deadlineAt, signal) === 0) return;
    await new Promise<void>((resolve) => setTimeout(resolve, Math.min(25, Math.max(1, deadlineAt - Date.now()))));
  }
  throw new Error('restore_target_sessions_drain_timeout');
}

async function verifyRestoreTargetExists(
  adminClient: PoolClient,
  targetName: string,
  deadlineAt: number,
  signal: AbortSignal,
): Promise<void> {
  await waitForRestoreTargetSessionsClosed(adminClient, targetName, deadlineAt, signal);
  const result = await queryClientWithSessionTimeouts<{ exists: boolean }>(
    adminClient, '1000ms', 'SELECT EXISTS (SELECT 1 FROM pg_database WHERE datname = $1) AS exists', [targetName],
    deadlineAt, signal,
  );
  if (!result.rows[0]?.exists) throw new Error('restore_target_database_missing');
}

async function dropRestoreTargetAfterDrain(
  adminClient: PoolClient,
  targetName: string,
  deadlineAt: number,
  signal: AbortSignal,
): Promise<void> {
  await waitForRestoreTargetSessionsClosed(adminClient, targetName, deadlineAt, signal);
  await queryClientWithSessionTimeouts(adminClient, '10000ms', `DROP DATABASE IF EXISTS "${targetName}"`, undefined, deadlineAt, signal);
  const remaining = await queryClientWithSessionTimeouts<{ exists: boolean }>(
    adminClient, '1000ms', 'SELECT EXISTS (SELECT 1 FROM pg_database WHERE datname = $1) AS exists', [targetName],
    deadlineAt, signal,
  );
  if (remaining.rows[0]?.exists || await queryRestoreTargetSessions(adminClient, targetName, deadlineAt, signal) !== 0) {
    throw new Error('restore_target_disposal_unconfirmed');
  }
}

async function queryClientWithSessionTimeouts<T extends QueryResultRow>(
  client: PoolClient,
  timeout: string,
  sql: string,
  values?: unknown[],
  deadlineAt?: number,
  signal?: AbortSignal,
): Promise<QueryResult<T>> {
  if (deadlineAt === undefined || signal === undefined) throw new Error('restore_query_deadline_required');
  const previous = await queryClientRawWithinDeadline<{ statement_timeout: string; lock_timeout: string }>(
    client, deadlineAt, signal,
    "SELECT current_setting('statement_timeout') AS statement_timeout, current_setting('lock_timeout') AS lock_timeout",
  );
  const previousStatementTimeout = previous.rows[0]?.statement_timeout;
  const previousLockTimeout = previous.rows[0]?.lock_timeout;
  if (previousStatementTimeout === undefined || previousLockTimeout === undefined) {
    markRestoreClientUntrusted(client);
    throw new RestoreSessionTimeoutResetError();
  }

  let settingsMayHaveChanged = false;
  try {
    // Mark dirty before issuing the query: if the connection fails mid-flight its state is unknown.
    settingsMayHaveChanged = true;
    await queryClientRawWithinDeadline(client, deadlineAt, signal,
      "SELECT set_config('statement_timeout', $1, false), set_config('lock_timeout', $1, false)", [timeout]);
    return await queryClientRawWithinDeadline<T>(client, deadlineAt, signal, sql, values);
  } finally {
    if (settingsMayHaveChanged && !isRestoreClientUntrusted(client)) {
      let resetFailed = false;
      for (const [setting, previousValue] of [
        ['statement_timeout', previousStatementTimeout],
        ['lock_timeout', previousLockTimeout],
      ]) {
        try {
          await queryClientRawWithinDeadline(client, deadlineAt, signal,
            `SELECT set_config('${setting}', $1, false)`, [previousValue]);
        } catch {
          resetFailed = true;
          if (isRestoreClientUntrusted(client)) break;
        }
      }
      if (resetFailed) {
        markRestoreClientUntrusted(client);
        throw new RestoreSessionTimeoutResetError();
      }
    }
  }
}

async function queryPoolWithinDeadline<T extends QueryResultRow>(
  pool: Pool,
  deadlineAt: number,
  signal: AbortSignal,
  sql: string,
  values?: unknown[],
): Promise<QueryResult<T>> {
  let client: PoolClient | undefined;
  let discardReason: Error | undefined;
  try {
    client = await connectRestoreClientWithinDeadline(pool, deadlineAt, signal);
    return await queryClientWithinDeadline<T>(client, deadlineAt, signal, sql, values);
  } catch (error) {
    if (client && isRestoreClientUntrusted(client)) discardReason = new Error('restore_session_state_untrusted');
    throw error;
  } finally {
    client?.release(discardReason);
  }
}

function deadlineBoundRuntimePool(pool: Pool, deadlineAt: number, signal: AbortSignal): Pick<Pool, 'connect'> {
  return {
    connect: async () => {
      const client = await connectRestoreClientWithinDeadline(pool, deadlineAt, signal);
      return {
        query: <T extends QueryResultRow = QueryResultRow>(sql: string, values?: unknown[]) =>
          queryClientWithinDeadline<T>(client, deadlineAt, signal, sql, values),
        release: () => client.release(isRestoreClientUntrusted(client)
          ? new Error('restore_runtime_session_state_untrusted') : undefined),
      } as unknown as PoolClient;
    },
  };
}

async function verifyPrivateIdentity(file: string, signal: AbortSignal): Promise<void> {
  // The caller supplies a protected secret-file path; never read its contents into the manifest or logs.
  throwIfAborted(signal);
  const statResult = await lstat(file);
  throwIfAborted(signal);
  if (!statResult.isFile() || statResult.isSymbolicLink() || statResult.size < 1 || statResult.size > 4096
    || (process.platform !== 'win32' && ((statResult.mode & 0o077) !== 0
      || typeof process.getuid === 'function' && statResult.uid !== process.getuid()))) {
    throw new Error('restore_identity_file_permissions_invalid');
  }
}

function toolVersion(binary: string, args: string[], timeoutMs = 5000): string {
  const result = spawnSync(binary, args, { encoding: 'utf8', windowsHide: true, timeout: timeoutMs, maxBuffer: 2048, shell: false });
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

function waitForExitBounded(exit: Promise<number>, milliseconds: number): Promise<boolean> {
  return Promise.race([
    exit.then(() => true, () => true),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), milliseconds)),
  ]);
}

async function terminateRestoreChild(child: ChildProcess, exit: Promise<number>): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) { await exit.catch(() => undefined); return; }
  child.kill('SIGTERM');
  if (await waitForExitBounded(exit, 2000)) return;
  if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  if (!await waitForExitBounded(exit, 1000)) throw new Error('restore_child_termination_unconfirmed');
}

function escapePgpass(value: string): string { return value.replace(/\\/g, '\\\\').replace(/:/g, '\\:'); }

async function makePgpass(config: ControlledRestoreOptions['databaseAdmin'], signal: AbortSignal): Promise<{ directory: string; file: string }> {
  throwIfAborted(signal);
  const directory = await mkdtemp(path.join(os.tmpdir(), 'lighting-restore-'));
  const file = path.join(directory, 'pgpass');
  try {
    await chmod(directory, 0o700);
    throwIfAborted(signal);
    await writeFile(file, `${[config.host, String(config.port), '*', config.user, config.password].map(escapePgpass).join(':')}\n`, { flag: 'wx', mode: 0o600 });
    await chmod(file, 0o600);
    throwIfAborted(signal);
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
  deadlineAt: number,
): Promise<void> {
  const ageBinary = options.ageBinary ?? 'age';
  const pgRestoreBinary = options.pgRestoreBinary ?? 'pg_restore';
  const ageVersion = toolVersion(ageBinary, ['--version'], Math.min(5000, deadlineRemaining(deadlineAt, options.signal!)));
  throwIfAborted(options.signal!);
  if (!ageVersion.includes(PINNED_AGE_VERSION)) throw new Error('restore_age_version_mismatch');
  const restoreVersion = toolVersion(pgRestoreBinary, ['--version'], Math.min(5000, deadlineRemaining(deadlineAt, options.signal!)));
  throwIfAborted(options.signal!);
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
  const pipelineController = new AbortController();
  let termination: Promise<void> | undefined;
  const terminateChildren = () => termination ??= Promise.all([
    terminateRestoreChild(age, ageExit), terminateRestoreChild(restore, restoreExit),
  ]).then(() => undefined);
  const abortPipelines = () => {
    if (!pipelineController.signal.aborted) pipelineController.abort(new Error('restore_pipeline_cancelled'));
    void terminateChildren();
  };
  const onAbort = () => abortPipelines();
  options.signal?.addEventListener('abort', onAbort, { once: true });
  try {
    if (options.signal?.aborted) throw new Error('restore_aborted');
    const archivePipeline = pipeline(archive, age.stdin, { signal: pipelineController.signal }).catch((error: unknown) => {
      abortPipelines();
      throw error;
    });
    const decryptedPipeline = pipeline(age.stdout, restore.stdin, { signal: pipelineController.signal }).catch((error: unknown) => {
      abortPipelines();
      throw error;
    });
    const [archiveResult, decryptedResult, ageResult, restoreResult] = await Promise.allSettled([
      archivePipeline, decryptedPipeline, ageExit, restoreExit,
    ]);
    if (archiveResult.status === 'rejected' || decryptedResult.status === 'rejected') {
      abortPipelines();
      await terminateChildren();
      throw new Error(options.signal?.aborted ? 'restore_process_aborted' : 'restore_stream_pipeline_failed');
    }
    if (ageResult.status === 'rejected' || restoreResult.status === 'rejected') throw new Error('restore_child_start_failed');
    if (options.signal?.aborted) throw new Error('restore_process_aborted');
    if (ageResult.value !== 0 || restoreResult.value !== 0) throw new Error(overflow ? 'restore_child_failed' : 'restore_child_nonzero');
  } finally {
    options.signal?.removeEventListener('abort', onAbort);
    if (options.signal?.aborted || age.exitCode === null || restore.exitCode === null) {
      abortPipelines();
      await terminateChildren().catch(() => undefined);
    }
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
  const restoreLimit = options.maxRestoreDurationMs ?? 4 * 60 * 60 * 1000;
  if (!Number.isSafeInteger(restoreLimit) || restoreLimit < 1 || restoreLimit > 4 * 60 * 60 * 1000) {
    throw new Error('restore_duration_bound_invalid');
  }
  const restoreTimeout = AbortSignal.timeout(restoreLimit);
  const restoreSignal = options.signal ? AbortSignal.any([options.signal, restoreTimeout]) : restoreTimeout;
  const deadlineAt = Date.now() + restoreLimit;
  await verifyPrivateIdentity(options.privateIdentityFile, restoreSignal);
  throwIfAborted(restoreSignal);
  await awaitRestoreStage(options.assertClusterRolesPrepared(restoreSignal), restoreSignal);
  throwIfAborted(restoreSignal);

  const operationId = randomUUID();
  const startedAt = new Date().toISOString();
  const manifestIntegrity = await awaitRestoreStage(options.source.verifyExactObject(options.manifestIdentity, restoreSignal), restoreSignal);
  const manifestBytes = await awaitRestoreStage(options.source.readExactManifest(options.manifestIdentity, restoreSignal), restoreSignal);
  await verifyIntegrity(manifestIntegrity, options.manifestIdentity, manifestBytes);
  let manifest: BackupManifestV1;
  try { manifest = validateManifest(JSON.parse(manifestBytes.toString('utf8')), options.expectedStorageNamespaceId, options.manifestIdentity, options.expectedRecipientKeyId); }
  catch { throw new Error('restore_manifest_contract_rejected'); }
  throwIfAborted(restoreSignal);

  const archiveIdentity: ExactObjectIdentity = {
    storageNamespaceId: manifest.storage_namespace_id,
    key: manifest.archive.object_key,
    providerVersionId: manifest.archive.provider_version_id,
  };
  if (!archiveIdentity.providerVersionId) throw new Error('restore_archive_version_missing');
  const archiveIntegrity = await awaitRestoreStage(options.source.verifyExactObject(archiveIdentity, restoreSignal), restoreSignal);
  await verifyIntegrity(archiveIntegrity, archiveIdentity, null, manifest.archive.encrypted_bytes, manifest.archive.encrypted_sha256);
  if (manifest.archive.provider_checksum.value !== archiveIntegrity.checksum.value) throw new Error('restore_provider_checksum_mismatch');

  throwIfAborted(restoreSignal);
  const targetName = newTargetDatabaseName();
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(targetName)) throw new Error('restore_target_name_invalid');
  let targetMayExist = false;
  let adminClient: PoolClient | undefined;
  let adminTarget: RestoreTargetPool | undefined;
  let runtimeTarget: Pool | undefined;
  let pgpass: { directory: string; file: string } | undefined;
  let cleanupConfirmed = true;
  try {
    adminClient = await connectRestoreClientWithinDeadline(options.adminPool, deadlineAt, restoreSignal);
    const existing = await queryClientWithinDeadline<{ exists: boolean }>(adminClient, deadlineAt, restoreSignal,
      'SELECT EXISTS (SELECT 1 FROM pg_database WHERE datname = $1) AS exists', [targetName]);
    if (existing.rows[0]?.exists) throw new Error('restore_target_database_collision');
    targetMayExist = true;
    await queryClientWithinDeadline(adminClient, deadlineAt, restoreSignal, `CREATE DATABASE "${targetName}" TEMPLATE template0`);
    adminTarget = options.openTargetAdminPool(targetName);
    pgpass = await makePgpass(options.databaseAdmin, restoreSignal);
    const archive = await awaitRestoreStage(options.source.openExactArchive(archiveIdentity, restoreSignal), restoreSignal);
    throwIfAborted(restoreSignal);
    await runAgeRestorePipeline(archive, options.privateIdentityFile, targetName, { ...options, signal: restoreSignal }, pgpass.file, deadlineAt);
    throwIfAborted(restoreSignal);
    await queryPoolWithinDeadline(adminTarget, deadlineAt, restoreSignal, options.canonicalGrantSql);
    runtimeTarget = options.openRuntimePool(targetName);
    await assertMigrationsCurrent(deadlineBoundRuntimePool(runtimeTarget, deadlineAt, restoreSignal), {
      signal: restoreSignal, statementTimeoutMs: deadlineRemaining(deadlineAt, restoreSignal),
    });
    const health = await queryPoolWithinDeadline<{ ok: number }>(runtimeTarget, deadlineAt, restoreSignal, 'SELECT 1 AS ok');
    if (health.rows[0]?.ok !== 1) throw new Error('restore_runtime_query_failed');
    const postgis = await queryPoolWithinDeadline<{ version: string | null }>(runtimeTarget, deadlineAt, restoreSignal, 'SELECT PostGIS_Full_Version() AS version');
    if (!postgis.rows[0]?.version) throw new Error('restore_postgis_check_failed');
    const counts = await queryPoolWithinDeadline<{ foreign_keys: string; checks: string; sequences: string }>(runtimeTarget, deadlineAt, restoreSignal,
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
    const sequenceStates = await queryPoolWithinDeadline<{ sequence_last: string; table_max: string }>(adminTarget, deadlineAt, restoreSignal,
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
    const ledger = await queryPoolWithinDeadline<MigrationLedgerRow>(runtimeTarget, deadlineAt, restoreSignal,
      'SELECT version, name, checksum FROM public.schema_migrations ORDER BY version');
    if (JSON.stringify(ledger.rows) !== JSON.stringify(manifest.source.migration_ledger)) throw new Error('restore_migration_ledger_mismatch');
    const boundedRuntime = {
      query: <T extends QueryResultRow = QueryResultRow>(sql: string, values?: unknown[]) =>
        queryPoolWithinDeadline<T>(runtimeTarget!, deadlineAt, restoreSignal, sql, values),
      end: () => runtimeTarget!.end(),
    } as Pick<Pool, 'query' | 'end'>;
    await awaitRestoreStage(options.validateAdditionalData(boundedRuntime, manifest, restoreSignal), restoreSignal);
    throwIfAborted(restoreSignal);
    await endRestoreTargetPool(runtimeTarget);
    runtimeTarget = undefined;
    await endRestoreTargetPool(adminTarget);
    adminTarget = undefined;
    if (!adminClient) throw new Error('restore_admin_connection_unavailable');
    await verifyRestoreTargetExists(adminClient, targetName, deadlineAt, restoreSignal);
    throwIfAborted(restoreSignal);
    if (pgpass) {
      await rm(pgpass.directory, { recursive: true, force: true });
      pgpass = undefined;
    }
    throwIfAborted(restoreSignal);
    if (adminClient) { adminClient.release(); adminClient = undefined; }
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
  } catch (error) {
    const cleanupDeadlineAt = Date.now() + RESTORE_CLEANUP_TIMEOUT_MS;
    const cleanupSignal = AbortSignal.timeout(RESTORE_CLEANUP_TIMEOUT_MS);
    const runtimePool = runtimeTarget;
    runtimeTarget = undefined;
    if (runtimePool) await endRestoreTargetPool(runtimePool).catch(() => { cleanupConfirmed = false; });
    const adminPool = adminTarget;
    adminTarget = undefined;
    if (adminPool) await endRestoreTargetPool(adminPool).catch(() => { cleanupConfirmed = false; });

    if (adminClient && isRestoreClientUntrusted(adminClient)) {
      adminClient.release(new Error('restore_admin_session_state_untrusted'));
      adminClient = undefined;
    }
    if (targetMayExist) {
      if (!adminClient) {
        try { adminClient = await connectRestoreClientWithinDeadline(options.adminPool, cleanupDeadlineAt, cleanupSignal); }
        catch { cleanupConfirmed = false; }
      }
      if (adminClient) {
        await dropRestoreTargetAfterDrain(adminClient, targetName, cleanupDeadlineAt, cleanupSignal)
          .catch(() => { cleanupConfirmed = false; });
      }
    }
    if (pgpass) {
      try { await rm(pgpass.directory, { recursive: true, force: true }); pgpass = undefined; }
      catch { cleanupConfirmed = false; }
    }
    if (adminClient) {
      const discardReason = !cleanupConfirmed
        ? new Error('restore_cleanup_unconfirmed')
        : isRestoreClientUntrusted(adminClient) ? new Error('restore_admin_session_state_untrusted') : undefined;
      adminClient.release(discardReason);
    }
    if (!targetMayExist && cleanupConfirmed) {
      const message = error instanceof Error ? error.message : 'controlled_restore_preflight_failed';
      if (/^[a-z0-9_]{1,80}$/.test(message)) throw new Error(message);
      throw new Error('controlled_restore_preflight_failed');
    }
    const publicFailureCode = cleanupConfirmed
      ? 'controlled_restore_failed_fresh_target_discarded'
      : 'controlled_restore_failed_cleanup_unconfirmed';
    const internalFailureCode = error instanceof Error && /^[a-z0-9_]{1,80}$/.test(error.message)
      ? error.message
      : 'restore_internal_failure';
    throw new Error(publicFailureCode, { cause: new Error(internalFailureCode) });
  }
}

export function sha256Bytes(value: Buffer): string { return createHash('sha256').update(value).digest('hex'); }
