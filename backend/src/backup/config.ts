import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { FakeStoragePathError, resolveFakeStorageRoot } from './fakeStoragePath.js';

export const PINNED_AGE_VERSION = 'v1.3.2';
export const PINNED_AGE_ARCHIVE_SHA256 = 'cbe24006683f8eb669266162894b9a522a1af52f2665fbc63a4bb032ed26ac10';
const FORBIDDEN_WRITER_SECRET_ENV = [
  'BACKUP_DB_PASSWORD', 'DB_PASSWORD', 'DB_PASSWORD_FILE', 'DB_ADMIN_PASSWORD', 'DB_ADMIN_PASSWORD_FILE',
  'DB_RUNTIME_PASSWORD', 'DB_RUNTIME_PASSWORD_FILE', 'MIGRATION_DB_PASSWORD', 'MIGRATION_DB_PASSWORD_FILE',
  'DB_BOOTSTRAP_PASSWORD', 'DB_BOOTSTRAP_PASSWORD_FILE', 'JWT_SECRET', 'JWT_SECRET_FILE',
  'GEOAPIFY_API_KEY', 'GEOAPIFY_API_KEY_FILE', 'AUSEMIO_API_KEY', 'ADMIN_INITIAL_PASSWORD',
  'DATABASE_URL', 'PGPASSWORD', 'PGPASSFILE',
  'AGE_IDENTITY_FILE', 'AGE_IDENTITY', 'BACKUP_AGE_IDENTITY_FILE', 'BACKUP_AGE_IDENTITY',
];

export class BackupConfigurationError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'BackupConfigurationError';
  }
}

export interface BackupConfig {
  database: { host: string; port: number; name: string; user: 'lighting_backup'; password: string };
  passwordFile: string;
  maxSnapshotLifetimeMs: number;
  logicalDatabaseId: string;
  storageNamespaceId: string;
  fakeStorageRoot: string;
  ageRecipient: string;
  recipientKeyId: string;
  appBuildSha: string;
  ageBinary: string;
  pgDumpBinary: string;
}

function required(env: Record<string, string | undefined>, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new BackupConfigurationError(`missing_${name.toLowerCase()}`);
  return value;
}

function identifier(value: string, code: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value)) throw new BackupConfigurationError(code);
  return value;
}

function readProtectedPassword(file: string): string {
  try {
    const stat = statSync(file);
    if (!stat.isFile() || stat.size < 1 || stat.size > 4096) throw new Error('invalid');
    if (process.platform !== 'win32' && (stat.mode & 0o077) !== 0) throw new Error('permissions');
    const password = readFileSync(file, 'utf8').replace(/[\r\n]+$/, '');
    if (!password || /[\r\n]/.test(password)) throw new Error('empty');
    return password;
  } catch {
    throw new BackupConfigurationError('invalid_backup_db_password_file');
  }
}

function loopbackHost(host: string): boolean {
  const normalized = host.toLowerCase();
  return normalized === '::1' || normalized === '127.0.0.1';
}

export function parseBackupConfig(env: Record<string, string | undefined>): BackupConfig {
  // There is deliberately no production storage adapter in this checkpoint.
  if (env.NODE_ENV === 'production') throw new BackupConfigurationError('production_backup_adapter_not_configured');
  if (env.BACKUP_TEST_MODE !== 'true' || env.BACKUP_STORAGE_ADAPTER !== 'local-fake') {
    throw new BackupConfigurationError('test_only_fake_storage_required');
  }
  if (FORBIDDEN_WRITER_SECRET_ENV.some((name) => env[name] !== undefined)) {
    throw new BackupConfigurationError('writer_secret_boundary_violation');
  }

  const host = required(env, 'BACKUP_DB_HOST');
  if (!loopbackHost(host)) throw new BackupConfigurationError('backup_test_database_must_be_loopback');
  const portValue = required(env, 'BACKUP_DB_PORT');
  if (!/^\d{1,5}$/.test(portValue) || Number(portValue) < 1 || Number(portValue) > 65535) {
    throw new BackupConfigurationError('invalid_backup_db_port');
  }
  const user = required(env, 'BACKUP_DB_USER');
  if (user !== 'lighting_backup') throw new BackupConfigurationError('backup_db_user_must_be_lighting_backup');
  const databaseName = required(env, 'BACKUP_DB_NAME');
  if (!/^[A-Za-z0-9_][A-Za-z0-9_-]{0,62}$/.test(databaseName)) throw new BackupConfigurationError('invalid_backup_db_name');

  const maxValue = required(env, 'BACKUP_MAX_SNAPSHOT_LIFETIME');
  if (!/^\d+$/.test(maxValue) || !Number.isSafeInteger(Number(maxValue)) || Number(maxValue) < 1 || Number(maxValue) > 2_147_483_647) {
    throw new BackupConfigurationError('invalid_backup_max_snapshot_lifetime');
  }
  const passwordFile = path.resolve(required(env, 'BACKUP_DB_PASSWORD_FILE'));
  const password = readProtectedPassword(passwordFile);
  const ageRecipient = required(env, 'BACKUP_AGE_RECIPIENT');
  if (!/^age1[023456789acdefghjklmnpqrstuvwxyz]{45,}$/.test(ageRecipient)) {
    throw new BackupConfigurationError('invalid_backup_age_recipient');
  }
  const appBuildSha = required(env, 'APP_BUILD_SHA');
  if (!/^[a-f0-9]{7,64}$/i.test(appBuildSha)) throw new BackupConfigurationError('invalid_app_build_sha');
  let fakeStorageRoot: string;
  try {
    fakeStorageRoot = resolveFakeStorageRoot(required(env, 'BACKUP_FAKE_STORAGE_ROOT'));
  } catch (error) {
    if (error instanceof FakeStoragePathError) throw new BackupConfigurationError(error.code);
    throw new BackupConfigurationError('backup_fake_storage_path_unavailable');
  }

  return {
    database: {
      host,
      port: Number(portValue),
      name: databaseName,
      user: 'lighting_backup',
      password,
    },
    passwordFile,
    maxSnapshotLifetimeMs: Number(maxValue),
    logicalDatabaseId: identifier(required(env, 'BACKUP_LOGICAL_DATABASE_ID'), 'invalid_backup_logical_database_id'),
    storageNamespaceId: identifier(required(env, 'BACKUP_STORAGE_NAMESPACE_ID'), 'invalid_backup_storage_namespace_id'),
    fakeStorageRoot,
    ageRecipient,
    recipientKeyId: `sha256:${createHash('sha256').update(ageRecipient, 'utf8').digest('hex')}`,
    appBuildSha: appBuildSha.toLowerCase(),
    ageBinary: env.BACKUP_AGE_BINARY?.trim() || 'age',
    pgDumpBinary: env.BACKUP_PG_DUMP_BINARY?.trim() || 'pg_dump',
  };
}
