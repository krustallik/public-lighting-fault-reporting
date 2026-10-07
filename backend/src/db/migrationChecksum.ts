import crypto from 'node:crypto';

/** Normalize repository checkout line endings before hashing migration content. */
export function canonicalizeMigrationSql(sql: string): string {
  return sql.replace(/\r\n?/g, '\n');
}

export function migrationChecksum(sql: string): string {
  return crypto.createHash('sha256').update(canonicalizeMigrationSql(sql), 'utf8').digest('hex');
}
