import type { BackupResult } from '../../src/backup/runner.js';
import type { RestoreReceiptV1 } from '../../src/operations/controlledRestore.js';
import type { SyntheticRecoveryDrillOptions } from '../../src/operations/recoveryDrill.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runSyntheticRecoveryDrill } from '../../src/operations/recoveryDrill.js';

const snapshot = '2026-10-01T00:00:00.000Z';
const lossTime = '2026-10-01T00:01:00.000Z';
const restoreStart = '2026-10-01T00:02:00.000Z';
const restoreFinish = '2026-10-01T00:05:00.000Z';
const backup = {
  result_version: 1, state: 'complete', exit_code: 0, reason_code: 'complete',
  run_id: 'synthetic-run-12345678', run_started_at: snapshot, duration_ms: 5,
  manifest_id: 'backups/v1/runs/synthetic/manifest.json',
  archive_encrypted_sha256: 'a'.repeat(64), snapshot_started_at: snapshot,
  recipient_key_id: `sha256:${'b'.repeat(64)}`, app_build_sha: 'abcdef0123456789',
} as BackupResult;
const receipt = {
  result_version: 1, phase: 'restore', state: 'complete', reason_code: 'exact_artifact_restored_and_verified',
  operation_id: 'synthetic-restore-000001', manifest_id: backup.manifest_id!,
  archive_key: 'backups/v1/runs/synthetic/database.pgdump.age', archive_provider_version_id: 'synthetic-version',
  encrypted_bytes: 4, encrypted_sha256: backup.archive_encrypted_sha256!, recipient_key_id: backup.recipient_key_id,
  snapshot_started_at_utc: snapshot, target_database: 'synthetic_restore_target',
  restore_started_at_utc: restoreStart, restore_finished_at_utc: restoreFinish, migration_ledger: [],
  checks: { manifest: true, ciphertext_identity: true, ciphertext_hash: true, recipient: true, postgres16_restore: true,
    canonical_grants: true, migrations_current: true, postgis: true, relational_constraints: true, sequences: true,
    runtime_query: true, additional_data: true }, app_build_sha: 'abcdef0123456789',
} as RestoreReceiptV1;

function options(overrides: Partial<{
  backup: BackupResult;
  loss: { occurred_at_utc: string; synthetic_record_removed: true | false };
  receipt: RestoreReceiptV1;
  dispose: () => Promise<void>;
}> = {}): SyntheticRecoveryDrillOptions {
  return {
    appBuildSha: 'abcdef0123456789',
    now: () => new Date('2026-10-02T00:00:00.000Z'),
    operationId: 'synthetic-recovery-000001',
    produceBackup: async () => overrides.backup ?? backup,
    injectSyntheticDataLoss: async () => (overrides.loss ?? ({ occurred_at_utc: lossTime, synthetic_record_removed: true as const })) as never,
    restoreExactArtifact: async () => overrides.receipt ?? receipt,
    disposeRestoredDatabase: overrides.dispose ?? (async () => undefined),
  };
}

afterEach(() => vi.unstubAllEnvs());

describe('synthetic recovery drill evidence', () => {
  it('refuses to execute in production runtime', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    await expect(runSyntheticRecoveryDrill(options())).rejects.toThrow('synthetic_recovery_drill_test_mode_only');
  });

  it.each([
    ['incomplete state', { state: 'incomplete' }],
    ['nonzero exit', { exit_code: 1 }],
    ['missing manifest', { manifest_id: undefined }],
    ['missing archive digest', { archive_encrypted_sha256: undefined }],
    ['missing snapshot timestamp', { snapshot_started_at: undefined }],
  ])('rejects a backup with %s and skips restore', async (_scenario, change) => {
    const restore = vi.fn(async () => receipt);
    await expect(runSyntheticRecoveryDrill(options({ backup: { ...backup, ...change } as BackupResult })))
      .rejects.toThrow('synthetic_recovery_drill_failed');
    expect(restore).not.toHaveBeenCalled();
  });

  it.each([
    ['unconfirmed data loss', { synthetic_record_removed: false }],
    ['invalid UTC loss time', { occurred_at_utc: '2026-10-01T01:00:00+01:00' }],
    ['loss before snapshot', { occurred_at_utc: '2026-09-30T23:59:59.000Z' }],
  ])('stops before restore for %s', async (_scenario, change) => {
    const restore = vi.fn(async () => receipt);
    await expect(runSyntheticRecoveryDrill(options({ loss: { occurred_at_utc: lossTime, synthetic_record_removed: true, ...change } as never })))
      .rejects.toThrow('synthetic_recovery_drill_failed');
    expect(restore).not.toHaveBeenCalled();
  });

  it.each([
    ['incomplete receipt', { state: 'incomplete' }],
    ['different manifest', { manifest_id: 'other-manifest' }],
    ['different encrypted digest', { encrypted_sha256: 'c'.repeat(64) }],
    ['different source snapshot', { snapshot_started_at_utc: '2026-09-30T00:00:00.000Z' }],
  ])('rejects a restore receipt with %s and still disposes the target', async (_scenario, change) => {
    const dispose = vi.fn(async () => undefined);
    await expect(runSyntheticRecoveryDrill(options({ receipt: { ...receipt, ...change } as RestoreReceiptV1, dispose })))
      .rejects.toThrow('synthetic_recovery_drill_failed');
    expect(dispose).toHaveBeenCalledOnce();
  });

  it('rejects invalid restore timelines and reports a missed synthetic window without claiming success', async () => {
    await expect(runSyntheticRecoveryDrill(options({ receipt: { ...receipt, restore_started_at_utc: '2026-10-01T00:00:59.000Z' } })))
      .rejects.toThrow('synthetic_recovery_drill_failed');
    await expect(runSyntheticRecoveryDrill(options({ receipt: { ...receipt, restore_finished_at_utc: '2026-10-01T00:01:59.000Z' } })))
      .rejects.toThrow('synthetic_recovery_drill_failed');

    const lateLoss = '2026-10-02T00:00:01.000Z';
    const result = await runSyntheticRecoveryDrill(options({
      loss: { occurred_at_utc: lateLoss, synthetic_record_removed: true },
      receipt: { ...receipt, restore_started_at_utc: '2026-10-02T00:01:00.000Z', restore_finished_at_utc: '2026-10-02T00:02:00.000Z' },
    }));
    expect(result.state).toBe('complete');
    expect(result.evidence.synthetic_snapshot_to_loss_target_met).toBe(false);
  });

  it('reports cleanup failure instead of leaving a successful recovery claim', async () => {
    await expect(runSyntheticRecoveryDrill(options({
      dispose: async () => { throw new Error('synthetic cleanup failure'); },
    }))).rejects.toThrow('synthetic_recovery_drill_cleanup_failed');
  });
});
