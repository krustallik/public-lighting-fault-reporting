export interface MigrationLedgerRow {
  version: string;
  name: string;
  checksum: string;
}

export interface BackupManifestV1 {
  schema_version: 1;
  manifest_id: string;
  run_id: string;
  storage_namespace_id: string;
  source: {
    logical_database_id: string;
    postgres_server_version: string;
    postgis_version: string;
    app_build_sha: string;
    migration_ledger: MigrationLedgerRow[];
  };
  times_utc: {
    run_started_at: string;
    snapshot_started_at: string;
    dump_finished_at: string;
    encryption_finished_at: string;
    archive_upload_completed_at: string;
    manifest_publish_started_at: string;
  };
  dump: { format: 'pg_dump-custom'; pg_dump_version: string; no_owner: true; no_privileges: true; result: 'success' };
  encryption: {
    format: 'age-v1';
    recipient_key_ids: string[];
    result: 'success';
    private_identity_available_to_writer: false;
  };
  archive: {
    object_key: string;
    provider_version_id: string;
    encrypted_bytes: number;
    encrypted_sha256: string;
    provider_checksum: { algorithm: 'sha256'; value: string };
    upload_result: 'success';
    remote_integrity_result: 'verified';
  };
  structural_archive_check: 'deferred_to_controlled_verifier';
  completion_state: 'complete';
}

export function validateMigrationLedger(rows: MigrationLedgerRow[]): void {
  let previous: string | undefined;
  for (const row of rows) {
    if (!/^\d{4}$/.test(row.version) || !/^[a-z0-9_-]+$/.test(row.name) || !/^[a-f0-9]{64}$/.test(row.checksum)) {
      throw new Error('invalid_snapshot_ledger');
    }
    if (previous !== undefined && previous >= row.version) throw new Error('invalid_snapshot_ledger_order');
    previous = row.version;
  }
}
