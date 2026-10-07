import { describe, expect, it } from 'vitest';
import { migrationChecksum } from '../../src/db/migrationChecksum.js';

describe('migration checksum contract', () => {
  it('normalizes CRLF and lone CR to LF before hashing', () => {
    const lf = 'CREATE TABLE sample (\n  id INTEGER\n);\n';
    const crlf = lf.replace(/\n/g, '\r\n');
    const loneCr = lf.replace(/\n/g, '\r');

    expect(migrationChecksum(crlf)).toBe(migrationChecksum(lf));
    expect(migrationChecksum(loneCr)).toBe(migrationChecksum(lf));
  });

  it('detects actual SQL content changes', () => {
    expect(migrationChecksum('CREATE TABLE sample (id INTEGER);'))
      .not.toBe(migrationChecksum('CREATE TABLE sample (id BIGINT);'));
  });
});
