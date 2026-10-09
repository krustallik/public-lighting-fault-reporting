import { randomUUID } from 'node:crypto';
import type { BackupResult } from '../backup/runner.js';
import type { RestoreReceiptV1 } from './controlledRestore.js';
import type { OperationsRecordV1 } from './contracts.js';
import { isUtcTimestamp } from './contracts.js';

export const SYNTHETIC_SNAPSHOT_TO_LOSS_TARGET_MS = 24 * 60 * 60 * 1000;

export interface SyntheticDataLossEvidence {
  occurred_at_utc: string;
  synthetic_record_removed: true;
}

export interface SyntheticRecoveryDrillResult extends OperationsRecordV1 {
  phase: 'recovery_drill';
  state: 'complete' | 'incomplete';
  evidence: {
    evidence_class: 'synthetic_ci';
    snapshot_started_at_utc: string;
    synthetic_snapshot_to_loss_elapsed_ms: number;
    synthetic_snapshot_to_loss_target_ms: number;
    synthetic_snapshot_to_loss_target_met: boolean;
    synthetic_loss_to_restore_elapsed_ms: number;
    manifest_id: string;
    encrypted_sha256: string;
    loss_event_at_utc: string;
    restore_started_at_utc: string;
    restore_finished_at_utc: string;
  };
  restore_receipt: RestoreReceiptV1;
}

export interface SyntheticRecoveryDrillOptions {
  appBuildSha: string;
  produceBackup: () => Promise<BackupResult>;
  injectSyntheticDataLoss: () => Promise<SyntheticDataLossEvidence>;
  restoreExactArtifact: (manifestId: string) => Promise<RestoreReceiptV1>;
  disposeRestoredDatabase: (receipt: RestoreReceiptV1) => Promise<void>;
  now?: () => Date;
  operationId?: string;
}

function timestamp(value: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || !isUtcTimestamp(value)) {
    throw new Error('recovery_drill_timestamp_invalid');
  }
  return parsed;
}

/** Runs only in a synthetic environment; measured values never claim target-class or production recovery. */
export async function runSyntheticRecoveryDrill(options: SyntheticRecoveryDrillOptions): Promise<SyntheticRecoveryDrillResult> {
  if (process.env.NODE_ENV === 'production') throw new Error('synthetic_recovery_drill_test_mode_only');
  const now = options.now ?? (() => new Date());
  const operationId = options.operationId ?? randomUUID();
  const startedAt = now().toISOString();
  let receipt: RestoreReceiptV1 | undefined;
  let result: SyntheticRecoveryDrillResult | undefined;
  try {
    const backup = await options.produceBackup();
    if (backup.state !== 'complete' || backup.exit_code !== 0 || !backup.manifest_id
      || !backup.archive_encrypted_sha256 || !backup.snapshot_started_at) throw new Error('recovery_drill_backup_not_complete');
    const loss = await options.injectSyntheticDataLoss();
    if (loss.synthetic_record_removed !== true) throw new Error('recovery_drill_loss_event_not_confirmed');
    const lossAt = timestamp(loss.occurred_at_utc);
    const snapshotAt = timestamp(backup.snapshot_started_at);
    if (lossAt < snapshotAt) throw new Error('recovery_drill_loss_before_snapshot');
    receipt = await options.restoreExactArtifact(backup.manifest_id);
    if (receipt.state !== 'complete' || receipt.manifest_id !== backup.manifest_id
      || receipt.encrypted_sha256 !== backup.archive_encrypted_sha256
      || receipt.snapshot_started_at_utc !== backup.snapshot_started_at) throw new Error('recovery_drill_restore_artifact_mismatch');
    const restoreStartedAt = timestamp(receipt.restore_started_at_utc);
    const restoreFinishedAt = timestamp(receipt.restore_finished_at_utc);
    if (restoreStartedAt < lossAt || restoreFinishedAt < restoreStartedAt) throw new Error('recovery_drill_timeline_invalid');
    const snapshotToLossElapsedMs = lossAt - snapshotAt;
    const lossToRestoreElapsedMs = restoreFinishedAt - lossAt;
    result = {
      operations_version: 1,
      phase: 'recovery_drill',
      operation_id: operationId,
      state: 'complete',
      reason_code: 'synthetic_exact_artifact_restore_verified',
      started_at_utc: startedAt,
      finished_at_utc: now().toISOString(),
      app_build_sha: options.appBuildSha,
      evidence: {
        evidence_class: 'synthetic_ci',
        snapshot_started_at_utc: backup.snapshot_started_at,
        synthetic_snapshot_to_loss_elapsed_ms: snapshotToLossElapsedMs,
        synthetic_snapshot_to_loss_target_ms: SYNTHETIC_SNAPSHOT_TO_LOSS_TARGET_MS,
        synthetic_snapshot_to_loss_target_met: snapshotToLossElapsedMs <= SYNTHETIC_SNAPSHOT_TO_LOSS_TARGET_MS,
        synthetic_loss_to_restore_elapsed_ms: lossToRestoreElapsedMs,
        manifest_id: backup.manifest_id,
        encrypted_sha256: backup.archive_encrypted_sha256,
        loss_event_at_utc: loss.occurred_at_utc,
        restore_started_at_utc: receipt.restore_started_at_utc,
        restore_finished_at_utc: receipt.restore_finished_at_utc,
      },
      restore_receipt: receipt,
    };
    return result;
  } catch {
    throw new Error('synthetic_recovery_drill_failed');
  } finally {
    if (receipt) {
      try { await options.disposeRestoredDatabase(receipt); }
      catch { throw new Error('synthetic_recovery_drill_cleanup_failed'); }
    }
  }
}
