import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { BackupConfigurationError, parseBackupConfig } from '../backup/config.js';
import { LocalFakeStorageAdapter } from '../backup/localFakeStorage.js';
import { runBackupOnce } from '../backup/runner.js';

const { Pool } = pg;

async function main(): Promise<void> {
  const preflightRunId = randomUUID();
  let config;
  try {
    config = parseBackupConfig(process.env);
  } catch (error) {
    const reason = error instanceof BackupConfigurationError ? error.code : 'backup_configuration_invalid';
    console.log(JSON.stringify({
      result_version: 1,
      state: 'preflight_rejected',
      exit_code: 2,
      reason_code: reason,
      run_id: preflightRunId,
      run_started_at: new Date().toISOString(),
      duration_ms: 0,
    }));
    process.exitCode = 2;
    return;
  }

  const pool = new Pool({
    ...config.database,
    max: 1,
    connectionTimeoutMillis: 5000,
    application_name: 'lighting-backup-offline-test',
  });
  const controller = new AbortController();
  const onSigint = () => controller.abort(new Error('SIGINT'));
  const onSigterm = () => controller.abort(new Error('SIGTERM'));
  process.on('SIGINT', onSigint);
  process.on('SIGTERM', onSigterm);
  try {
    const result = await runBackupOnce({
      config,
      pool,
      storage: new LocalFakeStorageAdapter(config.fakeStorageRoot, config.storageNamespaceId),
      signal: controller.signal,
    });
    console.log(JSON.stringify(result));
    process.exitCode = result.exit_code;
  } catch {
    console.log(JSON.stringify({
      result_version: 1,
      state: 'incomplete',
      exit_code: 1,
      reason_code: 'backup_runtime_setup_failed',
      run_id: preflightRunId,
      run_started_at: new Date().toISOString(),
      duration_ms: 0,
    }));
    process.exitCode = 1;
  } finally {
    process.removeListener('SIGINT', onSigint);
    process.removeListener('SIGTERM', onSigterm);
    await pool.end().catch(() => undefined);
  }
}

await main();
