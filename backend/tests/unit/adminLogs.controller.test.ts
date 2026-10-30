import { beforeEach, describe, expect, it, vi } from 'vitest';

const dependencies = vi.hoisted(() => ({
  query: vi.fn(), listAdminActivityLogs: vi.fn(), listImportBatches: vi.fn(),
}));
vi.mock('../../src/db/pool.js', () => ({ pool: { query: dependencies.query } }));
vi.mock('../../src/services/adminActivity.service.js', () => ({ listAdminActivityLogs: dependencies.listAdminActivityLogs }));
vi.mock('../../src/services/streetLightsImport.service.js', () => ({ listImportBatches: dependencies.listImportBatches }));

import * as controller from '../../src/controllers/adminLogs.controller.js';

beforeEach(() => {
  Object.values(dependencies).forEach((dependency) => dependency.mockReset());
});

describe('admin operational log response', () => {
  it('returns readable inventory audit references without import duplicates or changed field payloads', async () => {
    dependencies.query.mockResolvedValueOnce({ rows: [{ id: 7, entity_id: 14, inventory_number: 'SYN-14', action: 'update' }] })
      .mockResolvedValueOnce({ rows: [{ total: '1' }] });
    const response = { json: vi.fn() };
    const next = vi.fn();
    await controller.getInventoryAuditLogs({ query: {} } as never, response as never, next);
    expect(response.json).toHaveBeenCalledWith({ success: true, data: { items: [{ id: 7, entity_id: 14, inventory_number: 'SYN-14', action: 'update' }], total: 1, limit: 25, offset: 0 } });
    const [sql] = dependencies.query.mock.calls[0];
    expect(sql).toContain('WHERE import_batch_id IS NULL');
    expect(sql).toContain('inventory_number_snapshot AS inventory_number');
    expect(sql).not.toContain('changed_fields');
    expect(next).not.toHaveBeenCalled();
  });

  it('forwards audit storage failures to the standard handler', async () => {
    const error = new Error('storage failed');
    dependencies.query.mockRejectedValue(error);
    const next = vi.fn();
    await controller.getInventoryAuditLogs({ query: {} } as never, { json: vi.fn() } as never, next);
    expect(next).toHaveBeenCalledWith(error);
  });
});
