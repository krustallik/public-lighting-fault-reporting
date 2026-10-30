import { beforeEach, describe, expect, it, vi } from 'vitest';

const database = vi.hoisted(() => ({
  connect: vi.fn(),
  hash: vi.fn(),
  query: vi.fn(),
  release: vi.fn(),
}));

vi.mock('../../src/db/pool.js', () => ({ pool: { connect: database.connect } }));
vi.mock('bcrypt', () => ({ default: { hash: database.hash } }));

import { provisionAdmin } from '../../src/services/adminAccount.service.js';

beforeEach(() => {
  Object.values(database).forEach((mock) => mock.mockReset());
  database.connect.mockResolvedValue({ query: database.query, release: database.release });
  database.hash.mockResolvedValue('synthetic-password-hash');
  database.query.mockImplementation(async (sql: string) => {
    if (sql.includes('INSERT INTO admins')) return { rows: [{ id: 42 }] };
    return { rows: [] };
  });
});

describe('provisionAdmin', () => {
  const actor = { id: 7, username: 'existing-admin' };

  it.each([
    [{ username: 'ab', password: 'long-enough-password' }],
    [{ username: 'new-admin', password: 'short' }],
    [{ username: 'new-admin', password: 'x'.repeat(129) }],
    [{ username: 'new-admin', password: 'long-enough-password', fullName: ' ' }],
    [{ username: 'new-admin', password: 'long-enough-password', fullName: 'x'.repeat(201) }],
  ])('rejects invalid fields before connecting', async (input) => {
    await expect(provisionAdmin(input, actor)).rejects.toMatchObject({ status: 400, message: 'Invalid administrator details' });
    expect(database.connect).not.toHaveBeenCalled();
    expect(database.hash).not.toHaveBeenCalled();
  });

  it('stores a hash, nullable optional name, and actor-attributed creation audit in one transaction', async () => {
    await expect(provisionAdmin({ username: '  new-admin  ', password: 'correct-horse-battery-staple' }, actor))
      .resolves.toEqual({ id: 42, username: 'new-admin' });

    expect(database.hash).toHaveBeenCalledWith('correct-horse-battery-staple', 12);
    expect(database.query.mock.calls.map(([sql]) => String(sql).trim().split(/\s+/).slice(0, 2).join(' ')))
      .toEqual(['BEGIN', 'INSERT INTO', 'INSERT INTO', 'COMMIT']);
    expect(database.query.mock.calls[1]?.[1]).toEqual(['new-admin', 'synthetic-password-hash', null]);
    expect(database.query.mock.calls[2]?.[1]).toEqual([actor.id, 42, actor.username]);
    expect(database.release).toHaveBeenCalledOnce();
  });

  it('trims the supplied full name and translates duplicate usernames after rolling back', async () => {
    database.query.mockImplementation(async (sql: string) => {
      if (sql === 'BEGIN') return { rows: [] };
      if (sql.includes('INSERT INTO admins')) return { rows: [{ id: 42 }] };
      if (sql.includes('INSERT INTO admin_activity_logs')) throw Object.assign(new Error('duplicate'), { code: '23505' });
      return { rows: [] };
    });

    await expect(provisionAdmin({ username: 'new-admin', password: 'correct-horse-battery-staple', fullName: '  New Admin  ' }, actor))
      .rejects.toMatchObject({ status: 409, message: 'An administrator with this username already exists' });
    expect(database.query.mock.calls[1]?.[1]).toEqual(['new-admin', 'synthetic-password-hash', 'New Admin']);
    expect(database.query.mock.calls.at(-1)?.[0]).toBe('ROLLBACK');
    expect(database.release).toHaveBeenCalledOnce();
  });

  it('rolls back and rethrows unexpected insertion and audit failures without leaking the client', async () => {
    const error = new Error('audit storage unavailable');
    database.query.mockImplementation(async (sql: string) => {
      if (sql === 'BEGIN') return { rows: [] };
      if (sql.includes('INSERT INTO admin_activity_logs')) throw error;
      if (sql.includes('INSERT INTO admins')) return { rows: [{ id: 42 }] };
      return { rows: [] };
    });

    await expect(provisionAdmin({ username: 'new-admin', password: 'correct-horse-battery-staple' }, actor))
      .rejects.toBe(error);
    expect(database.query.mock.calls.at(-1)?.[0]).toBe('ROLLBACK');
    expect(database.release).toHaveBeenCalledOnce();
  });

  it('rejects an insert without a returned identity and releases the transaction client', async () => {
    database.query.mockImplementation(async (sql: string) => sql === 'BEGIN' ? { rows: [] } : { rows: [] });

    await expect(provisionAdmin({ username: 'new-admin', password: 'correct-horse-battery-staple' }, actor))
      .rejects.toThrow('Admin insert returned no row');
    expect(database.query.mock.calls.at(-1)?.[0]).toBe('ROLLBACK');
    expect(database.release).toHaveBeenCalledOnce();
  });
});
