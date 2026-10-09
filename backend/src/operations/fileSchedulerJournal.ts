import { constants } from 'node:fs';
import { chmod, lstat, mkdir, open, type FileHandle } from 'node:fs/promises';
import path from 'node:path';
import { isUtcTimestamp } from './contracts.js';
import type { BackupResult, BackupState } from '../backup/runner.js';
import { sanitizeBackupResult } from './fileEvidence.js';
import type { SchedulerJournal, SchedulerJournalEvent } from './scheduler.js';

export const MAX_SCHEDULER_JOURNAL_BYTES = 16 * 1024 * 1024;
const MAX_SCHEDULER_EVENT_BYTES = 64 * 1024;
const BACKUP_STATES = new Set(['complete', 'skipped_overlapping', 'blocked_by_migration', 'incomplete', 'preflight_rejected']);

function parseEvent(line: string): SchedulerJournalEvent {
  if (Buffer.byteLength(line, 'utf8') > MAX_SCHEDULER_EVENT_BYTES) throw new Error('scheduler_journal_record_invalid');
  const value: unknown = JSON.parse(line);
  if (!value || typeof value !== 'object' || (value as { event_version?: unknown }).event_version !== 1) {
    throw new Error('scheduler_journal_record_invalid');
  }
  const record = value as Record<string, unknown>;
  if (record.kind !== 'attempt_started' && record.kind !== 'attempt_finished') throw new Error('scheduler_journal_record_invalid');
  const startedKeys = ['event_version', 'kind', 'slot_id', 'attempt', 'run_id', 'started_at_utc'];
  const finishedKeys = ['event_version', 'kind', 'slot_id', 'attempt', 'run_id', 'finished_at_utc', 'state', 'exit_code', 'reason_code', 'retry_at_utc', 'backup_result'];
  const expectedKeys = record.kind === 'attempt_started' ? startedKeys : finishedKeys;
  if (Object.keys(record).some((key) => !expectedKeys.includes(key))
    || typeof record.slot_id !== 'string' || !isUtcTimestamp(record.slot_id)
    || !Number.isSafeInteger(record.attempt) || Number(record.attempt) < 1 || Number(record.attempt) > 2
    || typeof record.run_id !== 'string' || !/^[a-f0-9-]{16,64}$/i.test(record.run_id)) {
    throw new Error('scheduler_journal_record_invalid');
  }
  if (record.kind === 'attempt_started') {
    if (!isUtcTimestamp(record.started_at_utc)) throw new Error('scheduler_journal_record_invalid');
    return {
      event_version: 1, kind: 'attempt_started', slot_id: record.slot_id, attempt: Number(record.attempt),
      run_id: record.run_id, started_at_utc: record.started_at_utc,
    };
  }
  if (!isUtcTimestamp(record.finished_at_utc) || typeof record.state !== 'string' || !BACKUP_STATES.has(record.state)
    || !Number.isSafeInteger(record.exit_code) || typeof record.reason_code !== 'string' || !/^[a-z0-9_]{1,80}$/.test(record.reason_code)
    || !(record.retry_at_utc === null || isUtcTimestamp(record.retry_at_utc))) throw new Error('scheduler_journal_record_invalid');
  let backupResult: BackupResult | undefined;
  if (record.backup_result !== undefined) {
    try { backupResult = sanitizeBackupResult(record.backup_result); }
    catch { throw new Error('scheduler_journal_record_invalid'); }
    if (backupResult.run_id !== record.run_id || backupResult.state !== record.state
      || backupResult.exit_code !== record.exit_code || backupResult.reason_code !== record.reason_code) {
      throw new Error('scheduler_journal_record_invalid');
    }
  }
  return {
    event_version: 1, kind: 'attempt_finished', slot_id: record.slot_id, attempt: Number(record.attempt),
    run_id: record.run_id, finished_at_utc: record.finished_at_utc, state: record.state as BackupState,
    exit_code: Number(record.exit_code), reason_code: record.reason_code,
    retry_at_utc: record.retry_at_utc, ...(backupResult ? { backup_result: backupResult } : {}),
  };
}

export class FileSchedulerJournal implements SchedulerJournal {
  private readonly filePath: string;

  constructor(
    private readonly stateDirectory: string,
    private readonly syncFile: (handle: FileHandle) => Promise<void> = (handle) => handle.sync(),
    private readonly syncDirectory: (directory: string) => Promise<void> = syncDirectoryEntry,
  ) {
    if (!path.isAbsolute(stateDirectory)) throw new Error('scheduler_state_directory_must_be_absolute');
    this.filePath = path.join(path.resolve(stateDirectory), 'backup-attempts.jsonl');
  }

  async readEvents(): Promise<SchedulerJournalEvent[]> {
    await this.ensureDirectory();
    let contents: Buffer;
    let readHandle;
    try {
      const noFollow = process.platform === 'win32' ? 0 : constants.O_NOFOLLOW;
      readHandle = await open(this.filePath, constants.O_RDONLY | noFollow);
      const info = await readHandle.stat();
      if (!info.isFile() || process.platform !== 'win32' && (info.mode & 0o077) !== 0) throw new Error('scheduler_journal_permissions_invalid');
      contents = await readHandle.readFile();
    }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw new Error('scheduler_journal_read_failed');
    } finally { await readHandle?.close(); }
    if (contents.length > MAX_SCHEDULER_JOURNAL_BYTES) throw new Error('scheduler_journal_size_limit_exceeded');
    return parseCommittedRecords(contents);
  }

  async append(event: SchedulerJournalEvent): Promise<void> {
    await this.ensureDirectory();
    const serializedEvent = JSON.stringify(event);
    parseEvent(serializedEvent);
    const serialized = `${serializedEvent}\n`;
    let handle;
    let created = false;
    try {
      const noFollow = process.platform === 'win32' ? 0 : constants.O_NOFOLLOW;
      try { await lstat(this.filePath); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; created = true; }
      handle = await open(this.filePath, constants.O_RDWR | constants.O_CREAT | noFollow, 0o600);
      await handle.chmod(0o600);
      const info = await handle.stat();
      if (!info.isFile() || (process.platform !== 'win32' && (info.mode & 0o077) !== 0)) throw new Error('scheduler_journal_permissions_invalid');
      if (Buffer.byteLength(serialized, 'utf8') > MAX_SCHEDULER_EVENT_BYTES) throw new Error('scheduler_journal_event_size_limit_exceeded');

      // A missing newline is an uncommitted tail. Remove it before writing
      // another record, otherwise it would turn into malformed middle data.
      const contents = await handle.readFile();
      if (contents.length > MAX_SCHEDULER_JOURNAL_BYTES) throw new Error('scheduler_journal_size_limit_exceeded');
      const committedBytes = contents.lastIndexOf(0x0a) + 1;
      parseCommittedRecords(contents.subarray(0, committedBytes));
      if (committedBytes !== contents.length) {
        await handle.truncate(committedBytes);
        await this.syncFile(handle);
        // Make the repaired file contents durable before appending after them.
        await this.syncDirectory(path.dirname(this.filePath));
      }
      if (committedBytes + Buffer.byteLength(serialized, 'utf8') > MAX_SCHEDULER_JOURNAL_BYTES) {
        throw new Error('scheduler_journal_size_limit_exceeded');
      }
      const appendBytes = Buffer.from(serialized, 'utf8');
      let written = 0;
      while (written < appendBytes.length) {
        const result = await handle.write(appendBytes, written, appendBytes.length - written, committedBytes + written);
        if (result.bytesWritten < 1) throw new Error('scheduler_journal_short_write');
        written += result.bytesWritten;
      }
      await this.syncFile(handle);
      if (created) await this.syncDirectory(path.dirname(this.filePath));
    } catch (error) {
      if (error instanceof Error && ['scheduler_journal_event_size_limit_exceeded', 'scheduler_journal_size_limit_exceeded', 'scheduler_journal_permissions_invalid'].includes(error.message)) throw error;
      throw new Error('scheduler_journal_append_failed', { cause: error });
    } finally { await handle?.close(); }
  }

  private async ensureDirectory(): Promise<void> {
    try {
      const target = path.resolve(this.stateDirectory);
      const missing: string[] = [];
      let cursor = target;
      while (true) {
        try { await lstat(cursor); break; }
        catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
          const parent = path.dirname(cursor);
          if (parent === cursor) throw error;
          missing.push(cursor);
          cursor = parent;
        }
      }
      for (const directory of missing.reverse()) {
        await mkdir(directory, { mode: 0o700 });
        await this.syncDirectory(path.dirname(directory));
      }
      let info = await lstat(this.stateDirectory);
      if (!info.isDirectory() || info.isSymbolicLink()
        || process.platform !== 'win32' && typeof process.getuid === 'function' && info.uid !== process.getuid()) {
        throw new Error('scheduler_state_directory_invalid');
      }
      await chmod(this.stateDirectory, 0o700);
      info = await lstat(this.stateDirectory);
      if (!info.isDirectory() || info.isSymbolicLink()
        || process.platform !== 'win32' && (info.mode & 0o077) !== 0) throw new Error('scheduler_state_directory_invalid');
    } catch { throw new Error('scheduler_state_directory_unavailable'); }
  }
}

function parseCommittedRecords(contents: Buffer): SchedulerJournalEvent[] {
  const lastNewline = contents.lastIndexOf(0x0a);
  const committed = contents.subarray(0, lastNewline + 1).toString('utf8');
  if (!committed) return [];
  const lines = committed.slice(0, -1).split('\n');
  try { return lines.map(parseEvent); }
  catch { throw new Error('scheduler_journal_corrupt'); }
}

async function syncDirectoryEntry(directory: string): Promise<void> {
  // The deployed host units are Linux/systemd. Windows does not expose a
  // directory fsync contract through Node, so local Windows runs are not
  // evidence for host directory-entry durability.
  if (process.platform === 'win32') return;
  const handle = await open(directory, constants.O_RDONLY | (constants.O_DIRECTORY ?? 0));
  try { await handle.sync(); }
  finally { await handle.close(); }
}
