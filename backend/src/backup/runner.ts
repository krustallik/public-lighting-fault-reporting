import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, chmod, writeFile, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  spawn,
  spawnSync,
  type ChildProcessByStdio,
  type ChildProcessWithoutNullStreams,
} from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { Transform, type Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { Pool as PgPool, PoolClient } from 'pg';
import { BACKUP_ADVISORY_LOCK, MIGRATION_ADVISORY_LOCK } from '../db/advisoryLockIds.js';
import { PINNED_AGE_VERSION, type BackupConfig } from './config.js';
import { validateMigrationLedger, type BackupManifestV1, type MigrationLedgerRow } from './manifest.js';
import type { BackupStorageAdapter, ImmutableUpload } from './storage.js';

const STDERR_BYTE_LIMIT = 8192;
const CHILD_TERMINATION_GRACE_MS = 2000;
const CHILD_FORCE_KILL_WAIT_MS = 1000;

export type BackupState = 'complete' | 'skipped_overlapping' | 'blocked_by_migration' | 'preflight_rejected' | 'incomplete';

export interface BackupResult {
  result_version: 1;
  state: BackupState;
  exit_code: number;
  reason_code: string;
  run_id: string;
  run_started_at: string;
  duration_ms: number;
  snapshot_started_at?: string;
  migration_ledger?: MigrationLedgerRow[];
  manifest_id?: string;
  archive_encrypted_bytes?: number;
  archive_encrypted_sha256?: string;
  recipient_key_id: string;
  app_build_sha: string;
}

export interface BackupRunnerHooks {
  afterSnapshot?: (snapshot: { backendPid: number; snapshotId: string }) => Promise<void> | void;
  afterDumpSpawn?: () => Promise<void> | void;
  afterMigrationBarrierRelease?: () => Promise<void> | void;
}

export interface RunBackupOptions {
  config: BackupConfig;
  pool: Pick<PgPool, 'connect'>;
  storage: BackupStorageAdapter;
  signal?: AbortSignal;
  hooks?: BackupRunnerHooks;
}

class BackupFailure extends Error {
  constructor(readonly reason: string, readonly preflight = false) { super(reason); }
}

interface ChildExit { code: number | null; signal: NodeJS.Signals | null }
type ProcessWithPipes = ChildProcessByStdio<null, Readable, Readable>;
type EncryptorProcess = ChildProcessWithoutNullStreams;

function cleanEnvironment(values: Record<string, string | undefined>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const name of ['PATH', 'HOME', 'TMPDIR', 'TEMP', 'TMP', 'SYSTEMROOT', 'WINDIR', 'LANG', 'LC_ALL']) {
    const value = values[name];
    if (value !== undefined) env[name] = value;
  }
  return env;
}

function toolVersion(binary: string, args: string[]): string {
  const result = spawnSync(binary, args, {
    encoding: 'utf8', windowsHide: true, shell: false, timeout: 5000, maxBuffer: 2048,
    env: cleanEnvironment(process.env),
  });
  if (result.error || result.status !== 0) throw new BackupFailure('required_tool_unavailable', true);
  return String(result.stdout).trim().slice(0, 256);
}

function preflightTools(config: BackupConfig): { ageVersion: string; pgDumpVersion: string } {
  const ageVersion = toolVersion(config.ageBinary, ['--version']);
  if (!new RegExp(`\\b${PINNED_AGE_VERSION.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(ageVersion)) {
    throw new BackupFailure('age_version_mismatch', true);
  }
  const pgDumpVersion = toolVersion(config.pgDumpBinary, ['--version']);
  if (!/\b16\./.test(pgDumpVersion)) throw new BackupFailure('pg_dump_major_mismatch', true);
  return { ageVersion, pgDumpVersion };
}

function escapePgpass(value: string): string { return value.replace(/\\/g, '\\\\').replace(/:/g, '\\:'); }

async function createPgpass(config: BackupConfig): Promise<{ directory: string; file: string }> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'lighting-backup-'));
  const file = path.join(directory, 'pgpass');
  try {
    await chmod(directory, 0o700);
    const contents = [config.database.host, String(config.database.port), config.database.name,
      config.database.user, config.database.password].map(escapePgpass).join(':');
    await writeFile(file, `${contents}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    await chmod(file, 0o600);
    const info = await stat(file);
    if (process.platform !== 'win32' && (info.mode & 0o077) !== 0) throw new BackupFailure('backup_password_file_permissions_invalid', true);
    return { directory, file };
  } catch (error) {
    await rm(directory, { recursive: true, force: true }).catch(() => undefined);
    if (error instanceof BackupFailure) throw error;
    throw new BackupFailure('backup_password_file_preparation_failed', true);
  }
}

function waitForChild(child: ProcessWithPipes | EncryptorProcess): Promise<ChildExit> {
  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => resolve({ code, signal }));
  });
}

function drainBoundedStderr(child: ProcessWithPipes | EncryptorProcess): void {
  let consumed = 0;
  child.stderr.on('data', (chunk: Buffer) => { consumed = Math.min(STDERR_BYTE_LIMIT, consumed + chunk.length); });
  child.stderr.resume();
}

function sleep(ms: number): Promise<void> { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function terminateChild(child: ProcessWithPipes | EncryptorProcess, exit: Promise<ChildExit>): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) { await exit.catch(() => undefined); return; }
  child.kill('SIGTERM');
  const graceful = await Promise.race([exit.then(() => true, () => true), sleep(CHILD_TERMINATION_GRACE_MS).then(() => false)]);
  if (!graceful && child.exitCode === null && child.signalCode === null) {
    child.kill('SIGKILL');
    await Promise.race([exit.then(() => undefined, () => undefined), sleep(CHILD_FORCE_KILL_WAIT_MS)]);
  }
}

function raceWithAbort<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason ?? new Error('aborted'));
  return new Promise((resolve, reject) => {
    const cleanup = () => signal.removeEventListener('abort', onAbort);
    const onAbort = () => { cleanup(); reject(signal.reason ?? new Error('aborted')); };
    signal.addEventListener('abort', onAbort, { once: true });
    operation.then((value) => { cleanup(); resolve(value); }, (error: unknown) => { cleanup(); reject(error); });
    if (signal.aborted) onAbort();
  });
}

function currentAbortReason(signal: AbortSignal, clientLost: boolean, timedOut: boolean): string {
  if (clientLost) return 'database_connection_lost';
  if (timedOut) return 'snapshot_max_lifetime_exceeded';
  if (signal.aborted) return 'termination_requested';
  return 'backup_pipeline_failed';
}

function makeResult(args: {
  state: BackupState; exitCode: number; reason: string; runId: string; startedAt: string; startedMono: number;
  config: BackupConfig; snapshotAt?: string; ledger?: MigrationLedgerRow[]; manifestId?: string;
  bytes?: number; sha256?: string;
}): BackupResult {
  return {
    result_version: 1,
    state: args.state,
    exit_code: args.exitCode,
    reason_code: args.reason,
    run_id: args.runId,
    run_started_at: args.startedAt,
    duration_ms: Math.max(0, Math.round(performance.now() - args.startedMono)),
    ...(args.snapshotAt ? { snapshot_started_at: args.snapshotAt } : {}),
    ...(args.ledger ? { migration_ledger: args.ledger } : {}),
    ...(args.manifestId ? { manifest_id: args.manifestId } : {}),
    ...(args.bytes !== undefined ? { archive_encrypted_bytes: args.bytes } : {}),
    ...(args.sha256 ? { archive_encrypted_sha256: args.sha256 } : {}),
    recipient_key_id: args.config.recipientKeyId,
    app_build_sha: args.config.appBuildSha,
  };
}

async function unlock(client: PoolClient, lock: { namespace: number; key: number }): Promise<void> {
  const result = await client.query<{ unlocked: boolean }>('SELECT pg_advisory_unlock($1, $2) AS unlocked', [lock.namespace, lock.key]);
  if (result.rows[0]?.unlocked !== true) throw new Error('advisory_lock_ownership_lost');
}

export async function runBackupOnce(options: RunBackupOptions): Promise<BackupResult> {
  const { config, pool, storage, signal: externalSignal, hooks } = options;
  const runId = randomUUID();
  const startedAt = new Date().toISOString();
  const startedMono = performance.now();
  let result: BackupResult | undefined;
  let client: PoolClient | undefined;
  let backupLockHeld = false;
  let migrationLockHeld = false;
  let transactionOpen = false;
  let clientLost = false;
  let timedOut = false;
  let upload: ImmutableUpload | undefined;
  let pgDump: ProcessWithPipes | undefined;
  let age: EncryptorProcess | undefined;
  let pgDumpExit: Promise<ChildExit> | undefined;
  let ageExit: Promise<ChildExit> | undefined;
  let dumpPipe: Promise<void> | undefined;
  let encryptedUploadPipe: Promise<void> | undefined;
  let snapshotAt: string | undefined;
  let ledger: MigrationLedgerRow[] | undefined;
  let archiveBytes: number | undefined;
  let archiveSha256: string | undefined;
  let dumpFinishedAt: string | undefined;
  let encryptionFinishedAt: string | undefined;
  let manifestId: string | undefined;
  let pgpass: { directory: string; file: string } | undefined;
  let snapshotTimer: NodeJS.Timeout | undefined;
  const abortController = new AbortController();
  const relayExternalAbort = () => abortController.abort(externalSignal?.reason ?? new Error('termination requested'));
  externalSignal?.addEventListener('abort', relayExternalAbort, { once: true });
  if (externalSignal?.aborted) relayExternalAbort();
  const onClientError = () => { clientLost = true; abortController.abort(new Error('database connection lost')); };

  try {
    if (abortController.signal.aborted) throw new BackupFailure('termination_requested', true);
    const versions = preflightTools(config);
    pgpass = await createPgpass(config);
    client = await pool.connect();
    client.on('error', onClientError);

    const backupLock = await client.query<{ locked: boolean }>(
      'SELECT pg_try_advisory_lock($1, $2) AS locked', [BACKUP_ADVISORY_LOCK.namespace, BACKUP_ADVISORY_LOCK.key],
    );
    if (backupLock.rows[0]?.locked !== true) {
      result = makeResult({ state: 'skipped_overlapping', exitCode: 10, reason: 'backup_already_running', runId, startedAt, startedMono, config });
      return result;
    }
    backupLockHeld = true;

    const migrationLock = await client.query<{ locked: boolean }>(
      'SELECT pg_try_advisory_lock($1, $2) AS locked', [MIGRATION_ADVISORY_LOCK.namespace, MIGRATION_ADVISORY_LOCK.key],
    );
    if (migrationLock.rows[0]?.locked !== true) {
      result = makeResult({ state: 'blocked_by_migration', exitCode: 11, reason: 'migration_barrier_busy', runId, startedAt, startedMono, config });
      return result;
    }
    migrationLockHeld = true;

    const serverCheck = await client.query<{ server_version: string; server_version_num: string }>(
      `SELECT current_setting('server_version') AS server_version,
              current_setting('server_version_num') AS server_version_num`,
    );
    if (!serverCheck.rows[0] || Math.floor(Number(serverCheck.rows[0].server_version_num) / 10000) !== 16) {
      throw new BackupFailure('postgres_server_major_mismatch', true);
    }
    await client.query("SELECT set_config('statement_timeout', $1, false)", [`${config.maxSnapshotLifetimeMs}ms`]);
    await client.query("SET TIME ZONE 'UTC'");
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    transactionOpen = true;
    const snapshotStartedMono = performance.now();
    snapshotTimer = setTimeout(() => {
      timedOut = true;
      abortController.abort(new Error('snapshot maximum exceeded'));
    }, config.maxSnapshotLifetimeMs);
    const snapshot = await client.query<{
      snapshot_id: string; snapshot_started_at: string; backend_pid: number | string;
      postgres_server_version: string; postgis_version: string;
    }>(`SELECT pg_export_snapshot() AS snapshot_id,
               to_char(transaction_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS snapshot_started_at,
               pg_backend_pid() AS backend_pid,
               current_setting('server_version') AS postgres_server_version,
               postgis_lib_version() AS postgis_version`);
    if (performance.now() - snapshotStartedMono >= config.maxSnapshotLifetimeMs) {
      timedOut = true;
      throw new Error('snapshot_max_lifetime_exceeded');
    }
    const snapshotRow = snapshot.rows[0];
    if (!snapshotRow?.snapshot_id || !snapshotRow.snapshot_started_at || !snapshotRow.postgres_server_version || !snapshotRow.postgis_version) {
      throw new Error('snapshot_metadata_unavailable');
    }
    snapshotAt = snapshotRow.snapshot_started_at;
    if (hooks?.afterSnapshot) {
      await raceWithAbort(Promise.resolve(hooks.afterSnapshot({ backendPid: Number(snapshotRow.backend_pid), snapshotId: snapshotRow.snapshot_id })), abortController.signal);
    }
    if (abortController.signal.aborted) throw new Error('aborted');

    const ledgerResult = await client.query<MigrationLedgerRow>(
      'SELECT version, name, checksum FROM schema_migrations ORDER BY version',
    );
    ledger = ledgerResult.rows;
    validateMigrationLedger(ledger);
    if (performance.now() - snapshotStartedMono >= config.maxSnapshotLifetimeMs) {
      timedOut = true;
      throw new Error('snapshot_max_lifetime_exceeded');
    }

    const archiveKey = `backups/v1/runs/${runId}/database.pgdump.age`;
    upload = await storage.createImmutableObject(archiveKey, 'application/octet-stream');
    const cipherHash = createHash('sha256');
    let cipherBytes = 0;
    const hashAndCount = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        cipherHash.update(chunk);
        cipherBytes += chunk.length;
        callback(null, chunk);
      },
    });
    const childEnv = cleanEnvironment(process.env);
    const ageEnv = { ...childEnv };
    const pgDumpProcess = spawn(config.pgDumpBinary, [
      '--no-password', `--snapshot=${snapshotRow.snapshot_id}`, '--format=custom', '--no-owner', '--no-privileges',
    ], {
      shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...childEnv,
        PGHOST: config.database.host,
        PGPORT: String(config.database.port),
        PGDATABASE: config.database.name,
        PGUSER: config.database.user,
        PGPASSFILE: pgpass.file,
        PGOPTIONS: `-c statement_timeout=${config.maxSnapshotLifetimeMs}ms`,
        PGAPPNAME: `lighting-backup-${runId}`,
      },
    });
    const ageProcess = spawn(config.ageBinary, ['--encrypt', '--recipient', config.ageRecipient], {
      shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env: ageEnv,
    });
    pgDump = pgDumpProcess;
    age = ageProcess;
    drainBoundedStderr(pgDump);
    drainBoundedStderr(age);
    pgDumpExit = waitForChild(pgDump);
    ageExit = waitForChild(age);
    dumpPipe = pipeline(pgDump.stdout, age.stdin, { signal: abortController.signal }).catch(async (error: unknown) => {
      const ageFailure = await Promise.race([
        ageExit!.then((status) => status.code === 0 ? undefined : status),
        sleep(100).then(() => undefined),
      ]);
      if (ageFailure) throw new BackupFailure('age_encrypt_failed');
      throw error;
    });
    encryptedUploadPipe = pipeline(age.stdout, hashAndCount, upload.writable, { signal: abortController.signal });
    void dumpPipe.catch(() => undefined);
    void encryptedUploadPipe.catch(() => undefined);
    if (hooks?.afterDumpSpawn) await raceWithAbort(Promise.resolve(hooks.afterDumpSpawn()), abortController.signal);

    const earlyPipelineFailure = raceWithAbort(Promise.race([
      encryptedUploadPipe.then(() => new Promise<never>(() => undefined)),
      ageExit.then((status) => status.code === 0 ? new Promise<never>(() => undefined) : Promise.reject(new BackupFailure('age_encrypt_failed'))),
    ]), abortController.signal);
    const pgDumpResult = await Promise.race([
      Promise.all([pgDumpExit, dumpPipe]).then(([status]) => status),
      earlyPipelineFailure,
    ]);
    if (pgDumpResult.code !== 0) throw new BackupFailure('pg_dump_failed');
    dumpFinishedAt = new Date().toISOString();
    if (timedOut || performance.now() - snapshotStartedMono >= config.maxSnapshotLifetimeMs) {
      timedOut = true;
      throw new BackupFailure('snapshot_max_lifetime_exceeded');
    }
    await client.query('COMMIT');
    transactionOpen = false;
    await unlock(client, MIGRATION_ADVISORY_LOCK);
    migrationLockHeld = false;
    if (snapshotTimer) clearTimeout(snapshotTimer);
    snapshotTimer = undefined;
    await hooks?.afterMigrationBarrierRelease?.();

    const [ageStatus] = await raceWithAbort(Promise.all([ageExit, encryptedUploadPipe]), abortController.signal);
    if (ageStatus.code !== 0) throw new BackupFailure('age_encrypt_failed');
    encryptionFinishedAt = new Date().toISOString();
    archiveBytes = cipherBytes;
    archiveSha256 = cipherHash.digest('hex');
    const archiveIdentity = await upload.finalize();
    if (archiveIdentity.key !== archiveKey || archiveIdentity.storageNamespaceId !== config.storageNamespaceId || !archiveIdentity.providerVersionId) {
      throw new BackupFailure('remote_archive_identity_mismatch');
    }
    const archiveUploadCompletedAt = new Date().toISOString();
    const verifiedArchive = await storage.verifyExactObject(archiveIdentity);
    if (verifiedArchive.identity.key !== archiveIdentity.key
      || verifiedArchive.identity.storageNamespaceId !== archiveIdentity.storageNamespaceId
      || verifiedArchive.identity.providerVersionId !== archiveIdentity.providerVersionId
      || verifiedArchive.bytes !== archiveBytes
      || verifiedArchive.checksum.algorithm !== 'sha256'
      || verifiedArchive.checksum.value !== archiveSha256) {
      throw new BackupFailure('remote_archive_integrity_mismatch');
    }
    const manifestKey = `backups/v1/runs/${runId}/manifest.json`;
    const manifestPublishStartedAt = new Date().toISOString();
    const manifest: BackupManifestV1 = {
      schema_version: 1,
      manifest_id: manifestKey,
      run_id: runId,
      storage_namespace_id: config.storageNamespaceId,
      source: {
        logical_database_id: config.logicalDatabaseId,
        postgres_server_version: snapshotRow.postgres_server_version,
        postgis_version: snapshotRow.postgis_version,
        app_build_sha: config.appBuildSha,
        migration_ledger: ledger,
      },
      times_utc: {
        run_started_at: startedAt,
        snapshot_started_at: snapshotAt,
        dump_finished_at: dumpFinishedAt,
        encryption_finished_at: encryptionFinishedAt,
        archive_upload_completed_at: archiveUploadCompletedAt,
        manifest_publish_started_at: manifestPublishStartedAt,
      },
      dump: { format: 'pg_dump-custom', pg_dump_version: versions.pgDumpVersion, no_owner: true, no_privileges: true, result: 'success' },
      encryption: { format: 'age-v1', recipient_key_ids: [config.recipientKeyId], result: 'success', private_identity_available_to_writer: false },
      archive: {
        object_key: archiveKey,
        provider_version_id: archiveIdentity.providerVersionId,
        encrypted_bytes: archiveBytes,
        encrypted_sha256: archiveSha256,
        provider_checksum: verifiedArchive.checksum,
        upload_result: 'success',
        remote_integrity_result: 'verified',
      },
      structural_archive_check: 'deferred_to_controlled_verifier',
      completion_state: 'complete',
    };
    const manifestBytes = Buffer.from(JSON.stringify(manifest), 'utf8');
    const manifestHash = createHash('sha256').update(manifestBytes).digest('hex');
    const manifestIdentity = await storage.publishManifestCreateOnly(manifestKey, manifestBytes);
    if (manifestIdentity.key !== manifestKey || manifestIdentity.storageNamespaceId !== config.storageNamespaceId || !manifestIdentity.providerVersionId) {
      throw new BackupFailure('remote_manifest_identity_mismatch');
    }
    const verifiedManifest = await storage.verifyExactObject(manifestIdentity);
    if (verifiedManifest.identity.key !== manifestIdentity.key
      || verifiedManifest.identity.storageNamespaceId !== manifestIdentity.storageNamespaceId
      || verifiedManifest.identity.providerVersionId !== manifestIdentity.providerVersionId
      || verifiedManifest.bytes !== manifestBytes.length
      || verifiedManifest.checksum.algorithm !== 'sha256'
      || verifiedManifest.checksum.value !== manifestHash) {
      throw new BackupFailure('remote_manifest_integrity_mismatch');
    }
    manifestId = manifestKey;
    result = makeResult({
      state: 'complete', exitCode: 0, reason: 'producer_pipeline_complete', runId, startedAt, startedMono, config,
      snapshotAt, ledger, manifestId, bytes: archiveBytes, sha256: archiveSha256,
    });
  } catch (error) {
    const databaseErrorCode = typeof error === 'object' && error !== null && 'code' in error
      ? String((error as { code?: unknown }).code)
      : undefined;
    const reason = error instanceof BackupFailure
      ? error.reason
      : databaseErrorCode === '57014'
        ? 'snapshot_max_lifetime_exceeded'
      : currentAbortReason(abortController.signal, clientLost, timedOut);
    const preflight = error instanceof BackupFailure && error.preflight;
    result = makeResult({
      state: preflight ? 'preflight_rejected' : 'incomplete', exitCode: preflight ? 2 : 1,
      reason, runId, startedAt, startedMono, config, snapshotAt, ledger, bytes: archiveBytes, sha256: archiveSha256,
    });
    abortController.abort(new Error(reason));
  } finally {
    if (snapshotTimer) clearTimeout(snapshotTimer);
    if (pgDump && pgDumpExit && pgDump.exitCode === null && pgDump.signalCode === null) await terminateChild(pgDump, pgDumpExit);
    if (age && ageExit && age.exitCode === null && age.signalCode === null) await terminateChild(age, ageExit);
    await dumpPipe?.catch(() => undefined);
    await encryptedUploadPipe?.catch(() => undefined);
    if (pgDumpExit) await Promise.race([pgDumpExit.catch(() => undefined), sleep(CHILD_FORCE_KILL_WAIT_MS)]);
    if (ageExit) await Promise.race([ageExit.catch(() => undefined), sleep(CHILD_FORCE_KILL_WAIT_MS)]);
    if (result?.state !== 'complete' && upload) await storage.abortIncompleteUpload(upload).catch(() => undefined);
    if (client) {
      if (clientLost) {
        // A broken session releases its transaction and session locks server-side. Do not
        // enqueue cleanup queries on the dead connection; remove it from the pool instead.
        client.release(new Error('backup_database_connection_lost'));
      } else {
        client.removeListener('error', onClientError);
        if (transactionOpen) await client.query('ROLLBACK').catch(() => undefined);
        if (migrationLockHeld) await client.query('SELECT pg_advisory_unlock($1, $2)', [MIGRATION_ADVISORY_LOCK.namespace, MIGRATION_ADVISORY_LOCK.key]).catch(() => undefined);
        if (backupLockHeld) await client.query('SELECT pg_advisory_unlock($1, $2)', [BACKUP_ADVISORY_LOCK.namespace, BACKUP_ADVISORY_LOCK.key]).catch(() => undefined);
        client.release();
      }
    }
    if (pgpass) await rm(pgpass.directory, { recursive: true, force: true }).catch(() => undefined);
    externalSignal?.removeEventListener('abort', relayExternalAbort);
  }
  return result ?? makeResult({ state: 'incomplete', exitCode: 1, reason: 'backup_pipeline_failed', runId, startedAt, startedMono, config, snapshotAt, ledger, bytes: archiveBytes, sha256: archiveSha256 });
}
