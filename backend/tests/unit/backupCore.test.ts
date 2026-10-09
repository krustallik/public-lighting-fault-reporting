import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { BackupConfigurationError, parseBackupConfig } from '../../src/backup/config.js';
import { LocalFakeStorageAdapter } from '../../src/backup/localFakeStorage.js';
import { validateMigrationLedger, type MigrationLedgerRow } from '../../src/backup/manifest.js';

const tempDirs: string[] = [];

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'backup-core-unit-'));
  tempDirs.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('backup configuration and manifest contracts', () => {
  it('requires a bounded snapshot lifetime and rejects production fake storage before reading secrets', () => {
    expect(() => parseBackupConfig({ NODE_ENV: 'production' }))
      .toThrowError(new BackupConfigurationError('production_backup_adapter_not_configured'));
    expect(() => parseBackupConfig({ BACKUP_TEST_MODE: 'true', BACKUP_STORAGE_ADAPTER: 'local-fake' }))
      .toThrowError(new BackupConfigurationError('missing_backup_db_host'));
  });

  it('accepts only loopback lighting_backup test configuration with a protected password file', async () => {
    const root = await temporaryDirectory();
    const passwordFile = path.join(root, 'password');
    await writeFile(passwordFile, 'synthetic-password\n', { mode: 0o600 });
    const env = {
      NODE_ENV: 'test',
      BACKUP_TEST_MODE: 'true',
      BACKUP_STORAGE_ADAPTER: 'local-fake',
      BACKUP_DB_HOST: '127.0.0.1',
      BACKUP_DB_PORT: '5432',
      BACKUP_DB_NAME: 'lighting_test',
      BACKUP_DB_USER: 'lighting_backup',
      BACKUP_DB_PASSWORD_FILE: passwordFile,
      BACKUP_MAX_SNAPSHOT_LIFETIME: '5000',
      BACKUP_AGE_RECIPIENT: `age1${'a'.repeat(58)}`,
      APP_BUILD_SHA: '0123456789abcdef',
      BACKUP_LOGICAL_DATABASE_ID: 'test-db',
      BACKUP_STORAGE_NAMESPACE_ID: 'local-ci',
      BACKUP_FAKE_STORAGE_ROOT: path.join(root, 'objects'),
    };
    expect(parseBackupConfig(env)).toMatchObject({
      database: { host: '127.0.0.1', name: 'lighting_test', user: 'lighting_backup', password: 'synthetic-password' },
      maxSnapshotLifetimeMs: 5000,
      logicalDatabaseId: 'test-db',
      storageNamespaceId: 'local-ci',
    });
    expect(() => parseBackupConfig({ ...env, BACKUP_DB_HOST: 'db.internal' }))
      .toThrowError(new BackupConfigurationError('backup_test_database_must_be_loopback'));
    expect(() => parseBackupConfig({ ...env, BACKUP_MAX_SNAPSHOT_LIFETIME: undefined }))
      .toThrowError(new BackupConfigurationError('missing_backup_max_snapshot_lifetime'));
    expect(() => parseBackupConfig({ ...env, BACKUP_MAX_SNAPSHOT_LIFETIME: '2147483648' }))
      .toThrowError(new BackupConfigurationError('invalid_backup_max_snapshot_lifetime'));
    expect(() => parseBackupConfig({ ...env, BACKUP_DB_USER: 'lighting_runtime' }))
      .toThrowError(new BackupConfigurationError('backup_db_user_must_be_lighting_backup'));
    expect(() => parseBackupConfig({ ...env, AGE_IDENTITY_FILE: 'private.key' }))
      .toThrowError(new BackupConfigurationError('writer_secret_boundary_violation'));
    expect(() => parseBackupConfig({ ...env, BACKUP_FAKE_STORAGE_ROOT: path.join(path.parse(root).root, 'unsafe-backup-output') }))
      .toThrowError(new BackupConfigurationError('backup_fake_storage_must_be_under_system_temp'));
  });

  it('rejects unordered or malformed migration ledger rows', () => {
    const rows: MigrationLedgerRow[] = [
      { version: '0001', name: 'initial_schema', checksum: 'a'.repeat(64) },
      { version: '0002', name: 'inventory', checksum: 'b'.repeat(64) },
    ];
    expect(() => validateMigrationLedger(rows)).not.toThrow();
    expect(() => validateMigrationLedger([...rows].reverse())).toThrow('invalid_snapshot_ledger_order');
    expect(() => validateMigrationLedger([{ ...rows[0]!, checksum: 'not-a-checksum' }]))
      .toThrow('invalid_snapshot_ledger');
  });
});

describe('local fake immutable storage', () => {
  it('re-hashes the stored ciphertext and enforces create-only object identity', async () => {
    const root = await temporaryDirectory();
    const adapter = new LocalFakeStorageAdapter(root, 'unit-test');
    const key = 'backups/v1/runs/test/archive.pgdump.age';
    const content = Buffer.from('synthetic-ciphertext');
    const first = await adapter.createImmutableObject(key, 'application/octet-stream');
    first.writable.end(content);
    const identity = await first.finalize();
    const verified = await adapter.verifyExactObject(identity);
    expect(verified.bytes).toBe(content.length);
    expect(verified.checksum).toEqual({ algorithm: 'sha256', value: createHash('sha256').update(content).digest('hex') });
    await expect(adapter.verifyExactObject({ ...identity, providerVersionId: 'different-version' }))
      .rejects.toThrow('object_version_mismatch');

    const collision = await adapter.createImmutableObject(key, 'application/octet-stream');
    collision.writable.end(Buffer.from('replacement'));
    await expect(collision.finalize()).rejects.toMatchObject({ code: 'EEXIST' });
    await adapter.abortIncompleteUpload(collision);
    expect(await readFile(path.join(root, ...key.split('/')))).toEqual(content);
  });

  it('removes partial uploads and leaves an ambiguous finalized archive without a manifest', async () => {
    const root = await temporaryDirectory();
    const partial = new LocalFakeStorageAdapter(root, 'local-test');
    const incomplete = await partial.createImmutableObject('backups/v1/runs/partial/archive.pgdump.age', 'application/octet-stream');
    incomplete.writable.write(Buffer.from('partial'));
    await partial.abortIncompleteUpload(incomplete);
    expect(await readdir(path.join(root, '.incoming'))).toHaveLength(0);

    const ambiguous = new LocalFakeStorageAdapter(root, 'local-test', { failAfterArchiveFinalize: true });
    const upload = await ambiguous.createImmutableObject('backups/v1/runs/orphan/archive.pgdump.age', 'application/octet-stream');
    upload.writable.end(Buffer.from('orphan-ciphertext'));
    await expect(upload.finalize()).rejects.toThrow('synthetic_ambiguous_finalize');
    await ambiguous.abortIncompleteUpload(upload);
    expect(await readFile(path.join(root, 'backups/v1/runs/orphan/archive.pgdump.age'))).toEqual(Buffer.from('orphan-ciphertext'));
    expect(ambiguous.events.some((event) => event.startsWith('published-manifest:'))).toBe(false);
  });

  it('detects stored-object corruption independently of the producer checksum', async () => {
    const root = await temporaryDirectory();
    const adapter = new LocalFakeStorageAdapter(root, 'local-test', { corruptBeforeArchiveVerify: true });
    const upload = await adapter.createImmutableObject('backups/v1/runs/corrupt/archive.pgdump.age', 'application/octet-stream');
    upload.writable.end(Buffer.from('ciphertext'));
    const identity = await upload.finalize();
    const verified = await adapter.verifyExactObject(identity);
    expect(verified.checksum.value).not.toBe(createHash('sha256').update('ciphertext').digest('hex'));
  });

  it('publishes manifest bytes create-only through the same exact-object storage path', async () => {
    const root = await temporaryDirectory();
    await mkdir(root, { recursive: true });
    const adapter = new LocalFakeStorageAdapter(root, 'local-test');
    const key = 'backups/v1/runs/manifest/manifest.json';
    const bytes = Buffer.from('{"schema_version":1}');
    const identity = await adapter.publishManifestCreateOnly(key, bytes);
    expect(await readFile(path.join(root, ...key.split('/')))).toEqual(bytes);
    expect((await adapter.verifyExactObject(identity)).bytes).toBe(bytes.length);
    expect(adapter.events).toContain(`published-manifest:${key}`);
  });

  it('refuses to instantiate the local fake adapter in a production runtime', async () => {
    const root = await temporaryDirectory();
    const original = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      expect(() => new LocalFakeStorageAdapter(root, 'local-test')).toThrow('local_fake_storage_test_only');
    } finally {
      if (original === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = original;
    }
  });
});
