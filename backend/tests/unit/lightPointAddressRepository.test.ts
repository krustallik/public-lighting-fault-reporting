import { beforeEach, describe, expect, it, vi } from 'vitest';

const { poolQuery, clientQuery } = vi.hoisted(() => ({
  poolQuery: vi.fn(),
  clientQuery: vi.fn(),
}));

vi.mock('../../src/db/pool.js', () => ({
  pool: {
    query: poolQuery,
    connect: async () => ({ query: clientQuery, release: vi.fn() }),
  },
}));

import { postgresLightPointAddressRepository as repository } from '../../src/services/lightPointAddressRepository.js';

function queryResult(rows: unknown[] = [], rowCount: number | null = null) {
  return { rows, rowCount };
}

function setTransactionResults(...results: ReturnType<typeof queryResult>[]): void {
  clientQuery.mockReset();
  for (const result of results) clientQuery.mockResolvedValueOnce(result);
}

describe('selected-light address persistence', () => {
  beforeEach(() => {
    poolQuery.mockReset();
    clientQuery.mockReset();
  });

  it('loads an inventory address and normalizes an empty stored value', async () => {
    poolQuery.mockResolvedValueOnce(queryResult([{
      latitude: '48.71640000', longitude: '21.26110000', address: '  Jarná 12, Košice  ',
    }]));
    await expect(repository.findById(7)).resolves.toEqual({
      latitude: 48.7164, longitude: 21.2611, address: 'Jarná 12, Košice',
    });

    poolQuery.mockResolvedValueOnce(queryResult([{
      latitude: '48.71640000', longitude: '21.26110000', address: '   ',
    }]));
    await expect(repository.findById(8)).resolves.toEqual({
      latitude: 48.7164, longitude: 21.2611, address: null,
    });
    poolQuery.mockResolvedValueOnce(queryResult());
    await expect(repository.findById(9)).resolves.toBeNull();
  });

  it.each(['', ' '.repeat(2), 'x'.repeat(501)])('rejects an invalid address before opening a transaction', async (address) => {
    await expect(repository.persistIfMissing({
      id: 1, latitude: 48.7, longitude: 21.2, address,
    })).rejects.toThrow('Invalid geocoded light-point address');
    expect(clientQuery).not.toHaveBeenCalled();
  });

  it('returns missing when the locked point no longer exists', async () => {
    setTransactionResults(queryResult(), queryResult());
    await expect(repository.persistIfMissing({
      id: 1, latitude: 48.7, longitude: 21.2, address: 'Jarná 12',
    })).resolves.toEqual({ status: 'missing' });
    expect(clientQuery).toHaveBeenCalledTimes(3); // BEGIN, SELECT, COMMIT
  });

  it.each([
    { address: null, expected: { status: 'coordinates_changed', address: null } },
    { address: 'Current address', expected: { status: 'coordinates_changed', address: 'Current address' } },
  ] as const)('does not write an address for stale coordinates', async ({ address, expected }) => {
    setTransactionResults(queryResult(), queryResult([{
      inventory_number: 'SYNTHETIC-7', latitude: '48.7', longitude: '21.21', address,
    }]), queryResult());
    await expect(repository.persistIfMissing({
      id: 7, latitude: 48.7, longitude: 21.2, address: 'Stale address',
    })).resolves.toEqual(expected);
    expect(clientQuery).toHaveBeenCalledTimes(3); // BEGIN, SELECT, COMMIT
  });

  it('does not overwrite an address entered by inventory administration', async () => {
    setTransactionResults(queryResult(), queryResult([{
      inventory_number: 'SYNTHETIC-7', latitude: '48.7', longitude: '21.2', address: '  Admin address  ',
    }]), queryResult());
    await expect(repository.persistIfMissing({
      id: 7, latitude: 48.7, longitude: 21.2, address: 'Geocoder result',
    })).resolves.toEqual({ status: 'existing', address: 'Admin address' });
    expect(clientQuery).toHaveBeenCalledTimes(3); // BEGIN, SELECT, COMMIT
  });

  it('reports a deleted row if the conditional update no longer affects it', async () => {
    setTransactionResults(queryResult(), queryResult([{
      inventory_number: 'SYNTHETIC-7', latitude: '48.7', longitude: '21.2', address: null,
    }]), queryResult([], 0), queryResult());
    await expect(repository.persistIfMissing({
      id: 7, latitude: 48.7, longitude: 21.2, address: 'Geocoder result',
    })).resolves.toEqual({ status: 'missing' });
    expect(clientQuery).toHaveBeenCalledTimes(4); // BEGIN, SELECT, UPDATE, COMMIT
  });

  it('stores the address and audit event in one transaction', async () => {
    setTransactionResults(
      queryResult(),
      queryResult([{
        inventory_number: 'SYNTHETIC-7', latitude: '48.7', longitude: '21.2', address: null,
      }]),
      queryResult([], 1),
      queryResult([], 1),
      queryResult()
    );
    await expect(repository.persistIfMissing({
      id: 7, latitude: 48.7, longitude: 21.2, address: '  Geocoder result  ',
    })).resolves.toEqual({ status: 'stored', address: 'Geocoder result' });
    expect(clientQuery.mock.calls.map(([sql]) => String(sql).trim().split(/\s+/)[0])).toEqual([
      'BEGIN', 'SELECT', 'UPDATE', 'INSERT', 'COMMIT',
    ]);
    expect(clientQuery.mock.calls[2][1]).toEqual(['Geocoder result', 7]);
    expect(clientQuery.mock.calls[3][1]).toEqual([
      7,
      'SYNTHETIC-7',
      JSON.stringify({ address: { before: null, after: 'Geocoder result' } }),
    ]);
  });
});
