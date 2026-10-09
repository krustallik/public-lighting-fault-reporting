import { randomUUID } from 'node:crypto';
import type { BackupResult, BackupState } from '../backup/runner.js';
import type { OperationsState } from './contracts.js';
import type { Pool } from 'pg';
import { SCHEDULER_ADVISORY_LOCK } from '../db/advisoryLockIds.js';
import { tryAcquireSessionLock } from './advisoryLock.js';

export const BACKUP_SCHEDULE_UTC_HOURS = Object.freeze([0, 6, 12, 18] as const);
export const BACKUP_RETRY_DELAY_MS = 15 * 60 * 1000;
export const BACKUP_MAX_ATTEMPTS_PER_SLOT = 2;

export interface ScheduledSlot { slot_id: string; scheduled_at_utc: string }

export function latestDueBackupSlot(now: Date): ScheduledSlot {
  if (!Number.isFinite(now.getTime())) throw new Error('scheduler_clock_invalid');
  const date = new Date(now);
  const hour = [...BACKUP_SCHEDULE_UTC_HOURS].reverse().find((candidate) => candidate <= date.getUTCHours());
  if (hour === undefined) throw new Error('scheduler_slot_not_found');
  date.setUTCHours(hour, 0, 0, 0);
  const scheduledAt = date.toISOString();
  return { slot_id: scheduledAt, scheduled_at_utc: scheduledAt };
}

export type SchedulerJournalEvent =
  | { event_version: 1; kind: 'attempt_started'; slot_id: string; attempt: number; run_id: string; started_at_utc: string }
  | {
    event_version: 1;
    kind: 'attempt_finished';
    slot_id: string;
    attempt: number;
    run_id: string;
    finished_at_utc: string;
    state: BackupState;
    exit_code: number;
    reason_code: string;
    retry_at_utc: string | null;
    backup_result?: BackupResult;
  };

export interface SchedulerJournal {
  readEvents(): Promise<SchedulerJournalEvent[]>;
  append(event: SchedulerJournalEvent): Promise<void>;
}

export type SchedulerInvocation =
  | { action: 'attempted'; slot: ScheduledSlot; attempt: number; state: BackupState; exit_code: number; retry_at_utc: string | null; backup_result?: BackupResult }
  | { action: 'already_final'; slot: ScheduledSlot; state: BackupState; exit_code: number }
  | { action: 'skipped_overlapping'; slot: ScheduledSlot; state: 'skipped_overlapping'; exit_code: 10 }
  | { action: 'retry_not_due'; slot: ScheduledSlot; state: BackupState; retry_at_utc: string }
  | { action: 'no_due_slot'; state: 'complete'; exit_code: 0 };

export interface SchedulerRunOptions {
  now: () => Date;
  schedulerPool: Pick<Pool, 'connect'>;
  journal: SchedulerJournal;
  executeBackup: (runId: string) => Promise<BackupResult>;
  createRunId?: () => string;
}

function isRetryable(state: BackupState): boolean {
  return state === 'incomplete' || state === 'blocked_by_migration';
}

function finishedForSlot(events: SchedulerJournalEvent[], slotId: string): SchedulerJournalEvent[] {
  return events.filter((event) => event.kind === 'attempt_finished' && event.slot_id === slotId);
}

function startedWithoutFinish(events: SchedulerJournalEvent[]): Extract<SchedulerJournalEvent, { kind: 'attempt_started' }>[] {
  const starts = events.filter((event): event is Extract<SchedulerJournalEvent, { kind: 'attempt_started' }> => event.kind === 'attempt_started');
  const finishes = new Set(events.filter((event) => event.kind === 'attempt_finished').map((event) => event.run_id));
  return starts.filter((event) => !finishes.has(event.run_id));
}

export async function runScheduledBackup(options: SchedulerRunOptions): Promise<SchedulerInvocation> {
  const now = options.now();
  const slot = latestDueBackupSlot(now);
  const lock = await tryAcquireSessionLock(options.schedulerPool, SCHEDULER_ADVISORY_LOCK);
  if (!lock) return { action: 'skipped_overlapping', slot, state: 'skipped_overlapping', exit_code: 10 };
  try {
    return await runScheduledBackupUnderLock(options);
  } finally {
    await lock.release();
  }
}

async function runScheduledBackupUnderLock(options: SchedulerRunOptions): Promise<SchedulerInvocation> {
  const events = await options.journal.readEvents();
  for (const abandoned of startedWithoutFinish(events)) {
    const retryAt = new Date(Date.parse(abandoned.started_at_utc) + BACKUP_RETRY_DELAY_MS).toISOString();
    await options.journal.append({
      event_version: 1,
      kind: 'attempt_finished',
      // Reconcile the attempt against its original slot. If the service was
      // down across a later slot, the old work is coalesced and must not
      // consume or delay the current slot's attempt.
      slot_id: abandoned.slot_id,
      attempt: abandoned.attempt,
      run_id: abandoned.run_id,
      finished_at_utc: options.now().toISOString(),
      state: 'incomplete',
      exit_code: 1,
      reason_code: 'scheduler_crash_reconciled',
      retry_at_utc: abandoned.attempt < BACKUP_MAX_ATTEMPTS_PER_SLOT ? retryAt : null,
    });
  }

  // A process may wait briefly for its DB connection/journal after the timer
  // fired. Recompute the coalesced due slot once the scheduler lock is held.
  const dueNow = options.now();
  const slot = latestDueBackupSlot(dueNow);
  const finishes = finishedForSlot(await options.journal.readEvents(), slot.slot_id);
  const latest = finishes[finishes.length - 1];
  if (latest?.kind === 'attempt_finished') {
    if (latest.state === 'complete' || latest.attempt >= BACKUP_MAX_ATTEMPTS_PER_SLOT || !isRetryable(latest.state)) {
      return { action: 'already_final', slot, state: latest.state, exit_code: latest.exit_code };
    }
    const retryAt = latest.retry_at_utc ?? new Date(Date.parse(latest.finished_at_utc) + BACKUP_RETRY_DELAY_MS).toISOString();
    if (Date.parse(dueNow.toISOString()) < Date.parse(retryAt)) {
      return { action: 'retry_not_due', slot, state: latest.state, retry_at_utc: retryAt };
    }
  }

  const attempt = (latest?.kind === 'attempt_finished' ? latest.attempt : 0) + 1;
  const runId = (options.createRunId ?? randomUUID)();
  if (!/^[a-f0-9-]{16,64}$/i.test(runId)) throw new Error('scheduler_run_id_invalid');
  const startedAt = options.now().toISOString();
  await options.journal.append({
    event_version: 1, kind: 'attempt_started', slot_id: slot.slot_id, attempt, run_id: runId, started_at_utc: startedAt,
  });

  let result: BackupResult | undefined;
  let resultState: BackupState = 'incomplete';
  let exitCode = 1;
  let reasonCode = 'scheduler_executor_failed';
  try {
    result = await options.executeBackup(runId);
    if (result.run_id !== runId) throw new Error('scheduler_backup_run_identity_mismatch');
    resultState = result.state;
    exitCode = result.exit_code;
    reasonCode = result.reason_code;
  } catch {
    // Do not fabricate an artifact/result identity when the producer throws
    // or returns a result for a different run. The attempt event remains
    // useful, but carries only the scheduler's stable failure reason.
    result = undefined;
    resultState = 'incomplete';
    exitCode = 1;
    reasonCode = 'scheduler_executor_failed';
  }
  const finishedAt = options.now().toISOString();
  const retryAt = attempt < BACKUP_MAX_ATTEMPTS_PER_SLOT && isRetryable(resultState)
    ? new Date(Date.parse(finishedAt) + BACKUP_RETRY_DELAY_MS).toISOString()
    : null;
  await options.journal.append({
    event_version: 1,
    kind: 'attempt_finished',
    slot_id: slot.slot_id,
    attempt,
    run_id: runId,
    finished_at_utc: finishedAt,
    state: resultState,
    exit_code: exitCode,
    reason_code: reasonCode,
    retry_at_utc: retryAt,
    ...(result ? { backup_result: result } : {}),
  });
  return {
    action: 'attempted', slot, attempt, state: resultState, exit_code: exitCode, retry_at_utc: retryAt,
    ...(result ? { backup_result: result } : {}),
  };
}

export function schedulerStateForOperations(result: SchedulerInvocation): OperationsState {
  if (result.action === 'no_due_slot' || result.action === 'already_final' && result.state === 'complete') return 'complete';
  if (result.action === 'skipped_overlapping') return 'skipped_overlapping';
  if (result.action === 'retry_not_due') return result.state;
  if (result.action === 'already_final') return result.state;
  return result.state;
}
