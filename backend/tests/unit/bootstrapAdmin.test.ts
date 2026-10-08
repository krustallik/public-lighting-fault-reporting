import type { PoolClient } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import {
  BootstrapAdminError,
  createFirstAdmin,
  validateBootstrapAdminInput,
} from '../../src/services/bootstrapAdmin.service.js';

const validInput = { username: 'synthetic.admin', password: 'synthetic-password-123' };

describe('first administrator bootstrap', () => {
  it('validates explicit username, password and optional full-name bounds', () => {
    expect(validateBootstrapAdminInput({ ...validInput, fullName: ' Synthetic Admin ' })).toEqual({
      ...validInput, fullName: 'Synthetic Admin',
    });
    expect(() => validateBootstrapAdminInput({ ...validInput, username: 'x' }))
      .toThrow(BootstrapAdminError);
    expect(() => validateBootstrapAdminInput({ ...validInput, password: 'short' }))
      .toThrow(BootstrapAdminError);
    expect(() => validateBootstrapAdminInput({ ...validInput, fullName: '  ' }))
      .toThrow(BootstrapAdminError);
  });

  it('takes the transaction-scoped lock and rolls back if the audit insert fails', async () => {
    const client = {
      query: vi.fn(async (query: string) => {
        if (query === 'SELECT id FROM admins LIMIT 1') return { rows: [] };
        if (query.includes('INSERT INTO admins')) return { rows: [{ id: 8 }] };
        if (query.includes('INSERT INTO admin_activity_logs')) throw new Error('synthetic audit failure');
        return { rows: [] };
      }),
      release: vi.fn(),
    } as unknown as PoolClient;
    const database = { connect: vi.fn(async () => client) };

    await expect(createFirstAdmin(database, validInput)).rejects.toMatchObject({ code: 'failed' });
    expect(client.query).toHaveBeenCalledWith('BEGIN');
    expect(client.query).toHaveBeenCalledWith('SELECT pg_advisory_xact_lock($1, $2)', [1_701_669_235, 17]);
    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it('refuses an existing admin without hashing or mutating the database', async () => {
    const query = vi.fn(async (sql: string) => sql === 'SELECT id FROM admins LIMIT 1'
      ? { rows: [{ id: 3 }] }
      : { rows: [] });
    const client = {
      query,
      release: vi.fn(),
    } as unknown as PoolClient;
    await expect(createFirstAdmin({ connect: async () => client }, validInput))
      .rejects.toMatchObject({ code: 'already_initialized' });
    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
    expect(query.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO admins'))).toBe(false);
    expect(client.release).toHaveBeenCalledTimes(1);
  });
});
