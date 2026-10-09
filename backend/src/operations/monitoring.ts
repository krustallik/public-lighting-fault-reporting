import { isUtcTimestamp } from './contracts.js';

export type MonitoringSeverity = 'info' | 'warning' | 'critical';

export interface MonitoringEvent {
  check_id: string;
  generated_at_utc: string;
  severity: MonitoringSeverity;
  component: string;
  measured_value: number | string | boolean | null;
  threshold: string;
  run_id: string | null;
  next_step: string;
  app_build_sha: string;
  delivery_status: 'not_configured';
}

export interface MonitoringSnapshot {
  nowUtc: string;
  appBuildSha: string;
  latestRecoveryVerifiedSnapshotAtUtc: string | null;
  latestFinalScheduledBackupFailureAtUtc: string | null;
  latestIntegrityFailureAtUtc: string | null;
  latestRetentionSuccessAtUtc: string | null;
  retentionFailureAtUtc: string | null;
  eligibleRetentionBacklogSinceUtc: string | null;
  latestRestoreDrillAtUtc: string | null;
  databaseAvailable: boolean;
  migrationFailed: boolean;
  resourceObservation?: { cpuPercent?: number; rssBytes?: number; freeDiskBytes?: number; observedAtUtc: string };
}

function ageHours(now: string, then: string): number | null {
  const delta = Date.parse(now) - Date.parse(then);
  return Number.isFinite(delta) ? Math.max(0, delta / 3_600_000) : null;
}

function ageDays(now: string, then: string): number | null {
  const delta = Date.parse(now) - Date.parse(then);
  return Number.isFinite(delta) ? Math.max(0, delta / 86_400_000) : null;
}

export function evaluateMonitoring(snapshot: MonitoringSnapshot): MonitoringEvent[] {
  if (!isUtcTimestamp(snapshot.nowUtc)) throw new Error('monitor_clock_invalid');
  if (!/^[a-f0-9]{7,64}$/i.test(snapshot.appBuildSha)) throw new Error('monitor_build_identity_invalid');
  const timestampInputs = [snapshot.latestRecoveryVerifiedSnapshotAtUtc, snapshot.latestFinalScheduledBackupFailureAtUtc,
    snapshot.latestIntegrityFailureAtUtc, snapshot.latestRetentionSuccessAtUtc, snapshot.retentionFailureAtUtc,
    snapshot.eligibleRetentionBacklogSinceUtc, snapshot.latestRestoreDrillAtUtc];
  const nowMs = Date.parse(snapshot.nowUtc);
  if (timestampInputs.some((value) => value !== null && (!isUtcTimestamp(value) || Date.parse(value) > nowMs))) {
    throw new Error('monitor_snapshot_timestamp_invalid');
  }
  if (snapshot.resourceObservation) {
    const { cpuPercent, rssBytes, freeDiskBytes, observedAtUtc } = snapshot.resourceObservation;
    if (!isUtcTimestamp(observedAtUtc) || Date.parse(observedAtUtc) > nowMs || [cpuPercent, rssBytes, freeDiskBytes].some((value) => value !== undefined
      && (!Number.isFinite(value) || value < 0))) throw new Error('monitor_resource_observation_invalid');
  }
  const events: MonitoringEvent[] = [];
  const add = (component: string, severity: MonitoringSeverity, value: number | string | boolean | null, threshold: string, nextStep: string) => {
    events.push({
      check_id: component, generated_at_utc: snapshot.nowUtc, severity, component,
      measured_value: value, threshold, run_id: null, next_step: nextStep,
      app_build_sha: snapshot.appBuildSha, delivery_status: 'not_configured',
    });
  };

  const backupAge = snapshot.latestRecoveryVerifiedSnapshotAtUtc === null
    ? null : ageHours(snapshot.nowUtc, snapshot.latestRecoveryVerifiedSnapshotAtUtc);
  if (backupAge === null) add('recovery_verified_backup_age', 'critical', null, 'verified generation required', 'Verify an exact encrypted generation and its recovery receipt.');
  else if (backupAge > 24) add('recovery_verified_backup_age', 'critical', backupAge, 'RPO exceeded when age >24h', 'Restore/verify the newest valid generation and investigate the final failed schedule.');
  else if (backupAge >= 24) add('recovery_verified_backup_age', 'critical', backupAge, 'critical boundary at >=24h', 'Restore/verify a generation immediately; the RPO boundary has no margin.');
  else if (backupAge > 18) add('recovery_verified_backup_age', 'warning', backupAge, 'warning when age >18h', 'Check backup, integrity verification, and recovery evidence.');

  if (snapshot.latestFinalScheduledBackupFailureAtUtc || snapshot.latestIntegrityFailureAtUtc) {
    add('backup_final_failure', 'critical', snapshot.latestIntegrityFailureAtUtc ?? snapshot.latestFinalScheduledBackupFailureAtUtc,
      'any final scheduled or integrity failure', 'Inspect the secret-free attempt record and retain the previous verified generation.');
  }
  if (snapshot.latestRestoreDrillAtUtc) {
    const drillAge = ageDays(snapshot.nowUtc, snapshot.latestRestoreDrillAtUtc);
    if (drillAge !== null && drillAge > 120) add('restore_drill_age', 'critical', drillAge, 'critical when age >120d', 'Run a target-class recovery drill; do not infer production RTO from CI.');
    else if (drillAge !== null && drillAge > 90) add('restore_drill_age', 'warning', drillAge, 'warning when age >90d', 'Schedule the next recovery drill.');
  }
  if (snapshot.retentionFailureAtUtc) add('retention_run', 'critical', snapshot.retentionFailureAtUtc, 'any retention failure', 'Review the bounded chunk result and retry only after its cause is understood.');
  if (snapshot.eligibleRetentionBacklogSinceUtc) {
    const backlogAge = ageHours(snapshot.nowUtc, snapshot.eligibleRetentionBacklogSinceUtc);
    if (backlogAge !== null && backlogAge > 168) add('retention_backlog', 'critical', backlogAge, 'critical when backlog >7d', 'Investigate bounds, FK references, and lock/timeouts without widening deletion.');
    else if (backlogAge !== null && backlogAge > 24) add('retention_backlog', 'warning', backlogAge, 'warning when backlog >24h', 'Review the safe backlog reason and next bounded run.');
  }
  if (snapshot.latestRetentionSuccessAtUtc) {
    const retentionAge = ageHours(snapshot.nowUtc, snapshot.latestRetentionSuccessAtUtc);
    if (retentionAge !== null && retentionAge > 26) add('retention_last_success', 'warning', retentionAge, 'warning when last success >26h', 'Inspect the retention unit and safe backlog evidence.');
  }
  if (!snapshot.databaseAvailable) add('database_availability', 'critical', false, 'database query unavailable', 'Check PostgreSQL health, disk, and connection availability.');
  if (snapshot.migrationFailed) add('migration_failure', 'critical', true, 'any nonzero migration result', 'Stop rollout and inspect the migration ledger before retry.');
  if (snapshot.resourceObservation) {
    const observation = snapshot.resourceObservation;
    const threshold = 'observation only; target thresholds not validated';
    const nextStep = 'Compare with target-class capacity evidence before activation.';
    if (observation.cpuPercent !== undefined) add('cpu_observation', 'info', observation.cpuPercent, threshold, nextStep);
    if (observation.rssBytes !== undefined) add('memory_observation', 'info', observation.rssBytes, threshold, nextStep);
    if (observation.freeDiskBytes !== undefined) add('free_disk_observation', 'info', observation.freeDiskBytes, threshold, nextStep);
  }
  return events;
}
