import type { BackupResult } from '../backup/runner.js';

export type OperationsPhase = 'backup' | 'restore' | 'recovery_drill' | 'retention' | 'monitoring';
export type OperationsState =
  | 'complete'
  | 'skipped_overlapping'
  | 'blocked_by_migration'
  | 'preflight_rejected'
  | 'incomplete'
  | 'success_with_backlog';

/** Secret-free, versioned envelope shared by C–G evidence records. */
export interface OperationsRecordV1 {
  operations_version: 1;
  phase: OperationsPhase;
  operation_id: string;
  state: OperationsState;
  reason_code: string;
  started_at_utc: string;
  finished_at_utc: string;
  app_build_sha: string;
  artifact?: {
    manifest_id: string;
    archive_key: string;
    archive_provider_version_id: string;
    encrypted_bytes: number;
    encrypted_sha256: string;
    recipient_key_ids: string[];
    snapshot_started_at_utc: string;
  };
  backup_result?: BackupResult;
  evidence?: Record<string, string | number | boolean | null>;
}

export function isSha256(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

export function isUtcTimestamp(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?Z$/.exec(value);
  if (!match) return false;
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, fractionText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const millisecond = Number((fractionText ?? '').padEnd(3, '0'));
  if (year < 1970 || month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59) return false;
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second, millisecond));
  return Number.isFinite(date.getTime()) && date.getUTCFullYear() === year && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day && date.getUTCHours() === hour && date.getUTCMinutes() === minute
    && date.getUTCSeconds() === second && date.getUTCMilliseconds() === millisecond;
}
