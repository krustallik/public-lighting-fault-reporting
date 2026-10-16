import { beforeEach, describe, expect, it, vi } from 'vitest';

const dependencies = vi.hoisted(() => ({
  listStreetLights: vi.fn(), getStreetLightDetail: vi.fn(), createLightPoint: vi.fn(), updateLightPoint: vi.fn(),
  deleteLightPoint: vi.fn(), buildImportPreview: vi.fn(), confirmImport: vi.fn(), getImportBatch: vi.fn(),
  getImportPreviewPage: vi.fn(), listImportBatchRows: vi.fn(), parseImportBuffer: vi.fn(), streamStreetLightsExport: vi.fn(),
}));

vi.mock('../../src/services/adminStreetLights.service.js', () => ({
  listStreetLights: dependencies.listStreetLights,
  getStreetLightDetail: dependencies.getStreetLightDetail,
  createLightPoint: dependencies.createLightPoint,
  updateLightPoint: dependencies.updateLightPoint,
  deleteLightPoint: dependencies.deleteLightPoint,
}));
vi.mock('../../src/services/streetLightsImport.service.js', () => ({
  buildImportPreview: dependencies.buildImportPreview,
  confirmImport: dependencies.confirmImport,
  getImportBatch: dependencies.getImportBatch,
  getImportPreviewPage: dependencies.getImportPreviewPage,
  listImportBatchRows: dependencies.listImportBatchRows,
  parseImportBuffer: dependencies.parseImportBuffer,
}));
vi.mock('../../src/services/streetLightsExport.service.js', () => ({ streamStreetLightsExport: dependencies.streamStreetLightsExport }));

import * as controller from '../../src/controllers/adminStreetLights.controller.js';

function response() {
  return { status: vi.fn().mockReturnThis(), json: vi.fn() };
}

function middleware() { return vi.fn(); }

beforeEach(() => {
  Object.values(dependencies).forEach((dependency) => dependency.mockReset());
  dependencies.parseImportBuffer.mockReturnValue([{ inventory_number: 'INV-1' }]);
});

describe('admin street-light HTTP controller contracts', () => {
  it('applies list defaults, passes supported filters, and forwards service failures', async () => {
    dependencies.listStreetLights.mockResolvedValue({ items: [] });
    const defaultResponse = response();
    await controller.list({ query: {} } as never, defaultResponse as never, middleware());
    expect(dependencies.listStreetLights).toHaveBeenLastCalledWith({
      page: 1, limit: 20, search: '', status: undefined, district: '', sortBy: undefined, sortOrder: 'asc',
    });
    expect(defaultResponse.json).toHaveBeenCalledWith({ success: true, data: { items: [] } });

    const next = middleware();
    const failure = new Error('inventory query failed');
    dependencies.listStreetLights.mockRejectedValueOnce(failure);
    await controller.list({ query: { page: '2', limit: '5', search: 'LED', district: 'North', status: 'active', sortBy: 'address', sortOrder: 'desc' } } as never, response() as never, next);
    expect(dependencies.listStreetLights).toHaveBeenLastCalledWith({
      page: 2, limit: 5, search: 'LED', district: 'North', status: 'active', sortBy: 'address', sortOrder: 'desc',
    });
    expect(next).toHaveBeenCalledWith(failure);
  });

  it('forwards point detail and CRUD results while supporting both inventory field names', async () => {
    dependencies.getStreetLightDetail.mockResolvedValue({ id: 4 });
    const detailResponse = response();
    await controller.getById({ params: { id: '4' } } as never, detailResponse as never, middleware());
    expect(detailResponse.json).toHaveBeenCalledWith({ success: true, data: { id: 4 } });

    dependencies.createLightPoint.mockResolvedValue({ id: 5 });
    const createResponse = response();
    await controller.create({
      body: { inventoryNumber: 'CAMEL-5', latitude: '48.7', longitude: '21.2' },
    } as never, createResponse as never, middleware());
    expect(dependencies.createLightPoint).toHaveBeenCalledWith({
      inventory_number: 'CAMEL-5', external_id: null, latitude: 48.7, longitude: 21.2,
      address: undefined, district: undefined, lamp_type: undefined, status: undefined,
    }, null, null);
    expect(createResponse.status).toHaveBeenCalledWith(201);

    dependencies.updateLightPoint.mockResolvedValue({ id: 5, address: 'Updated' });
    const updateResponse = response();
    const actor = { id: 2, username: 'operator' };
    await controller.update({ params: { id: '5' }, body: { inventoryNumber: 'CAMEL-5', address: 'Updated' }, admin: actor } as never, updateResponse as never, middleware());
    expect(dependencies.updateLightPoint).toHaveBeenCalledWith('5', { inventoryNumber: 'CAMEL-5', address: 'Updated', inventory_number: 'CAMEL-5' }, 2, 'operator');
    expect(updateResponse.json).toHaveBeenCalledWith({ success: true, data: { id: 5, address: 'Updated' } });

    dependencies.deleteLightPoint.mockResolvedValue(undefined);
    const deleteResponse = response();
    await controller.remove({ params: { id: '5' } } as never, deleteResponse as never, middleware());
    expect(dependencies.deleteLightPoint).toHaveBeenCalledWith('5', null, null);
    expect(deleteResponse.json).toHaveBeenCalledWith({ success: true, message: 'Street light deleted' });
  });

  it('validates import upload and pagination inputs before delegating', async () => {
    const next = middleware();
    await controller.importPreview({ body: {}, query: {} } as never, response() as never, next);
    expect(next).toHaveBeenLastCalledWith(expect.objectContaining({ status: 400, message: 'File is required' }));

    dependencies.parseImportBuffer.mockReturnValueOnce([]);
    await controller.importPreview({
      file: { buffer: Buffer.from('[]'), mimetype: 'application/json', originalname: 'empty.json' },
      query: {}, admin: { id: 2, username: 'operator' },
    } as never, response() as never, next);
    expect(next).toHaveBeenLastCalledWith(expect.objectContaining({ status: 400, message: 'No valid rows found in file' }));

    dependencies.buildImportPreview.mockResolvedValue({ previewId: 'preview-1' });
    const uploadResponse = response();
    await controller.importPreview({
      file: { buffer: Buffer.from('[]'), mimetype: 'application/json', originalname: 'valid.json' },
      query: { page: '2', limit: '10' }, admin: { id: 2, username: 'operator' },
    } as never, uploadResponse as never, next);
    expect(dependencies.buildImportPreview).toHaveBeenCalledWith(2, 'valid.json', [{ inventory_number: 'INV-1' }], 'operator', 2, 10);
    expect(uploadResponse.json).toHaveBeenCalledWith({ success: true, data: { previewId: 'preview-1' } });

    await controller.getImportPreviewRows({ params: { previewId: 'preview-1' }, query: { page: '1.5' }, admin: { id: 2 } } as never, response() as never, next);
    expect(next).toHaveBeenLastCalledWith(expect.objectContaining({ status: 400, message: 'Invalid preview pagination' }));
    dependencies.getImportPreviewPage.mockResolvedValue({ results: [] });
    const previewRowsResponse = response();
    await controller.getImportPreviewRows({ params: { previewId: 'preview-1' }, query: {}, admin: { id: 2 } } as never, previewRowsResponse as never, next);
    expect(dependencies.getImportPreviewPage).toHaveBeenCalledWith(2, 'preview-1', 1, 50);
    expect(previewRowsResponse.json).toHaveBeenCalledWith({ success: true, data: { results: [] } });
  });

  it('requires explicit import confirmation and validates batch IDs and row pagination', async () => {
    const next = middleware();
    await controller.importConfirm({ body: { previewId: 'preview-1' }, admin: { id: 2 } } as never, response() as never, next);
    expect(next).toHaveBeenLastCalledWith(expect.objectContaining({ status: 400 }));
    dependencies.confirmImport.mockResolvedValue({ batchId: 8 });
    const confirmResponse = response();
    await controller.importConfirm({ body: { previewId: 'preview-1', allowUpdate: false }, admin: { id: 2 } } as never, confirmResponse as never, next);
    expect(dependencies.confirmImport).toHaveBeenCalledWith(2, 'preview-1', false);
    expect(confirmResponse.status).toHaveBeenCalledWith(202);

    await controller.getImportStatus({ params: { id: '-1' } } as never, response() as never, next);
    expect(next).toHaveBeenLastCalledWith(expect.objectContaining({ status: 400 }));
    dependencies.getImportBatch.mockResolvedValueOnce(null).mockResolvedValue({ batchId: 8 });
    await controller.getImportStatus({ params: { id: '8' } } as never, response() as never, next);
    expect(next).toHaveBeenLastCalledWith(expect.objectContaining({ status: 404 }));
    const statusResponse = response();
    await controller.getImportStatus({ params: { id: '8' } } as never, statusResponse as never, next);
    expect(statusResponse.json).toHaveBeenCalledWith({ success: true, data: { batchId: 8 } });

    await controller.getImportRows({ params: { id: '0' }, query: {} } as never, response() as never, next);
    expect(next).toHaveBeenLastCalledWith(expect.objectContaining({ status: 400 }));
    dependencies.getImportBatch.mockResolvedValueOnce(null).mockResolvedValue({ batchId: 8 });
    await controller.getImportRows({ params: { id: '8' }, query: {} } as never, response() as never, next);
    expect(next).toHaveBeenLastCalledWith(expect.objectContaining({ status: 404 }));
    dependencies.listImportBatchRows.mockResolvedValue({ rows: [] });
    const invalidPaginationNext = middleware();
    await controller.getImportRows({ params: { id: '8' }, query: { limit: 'x' } } as never, response() as never, invalidPaginationNext);
    expect(invalidPaginationNext).toHaveBeenCalledWith(expect.objectContaining({ status: 400 }));
    const rowsResponse = response();
    await controller.getImportRows({ params: { id: '8' }, query: { outcome: 'created', limit: '10', cursor: '2' } } as never, rowsResponse as never, next);
    expect(dependencies.listImportBatchRows).toHaveBeenCalledWith(8, 'created', 10, 2);
    expect(rowsResponse.json).toHaveBeenCalledWith({ success: true, data: { rows: [] } });
  });

  it('rejects unsupported export formats and forwards export adapter errors', async () => {
    const next = middleware();
    await controller.exportFile({ query: { format: 'xlsx' } } as never, response() as never, next);
    expect(next).toHaveBeenLastCalledWith(expect.objectContaining({ status: 400, message: 'Invalid export format' }));
    const error = new Error('export database unavailable');
    dependencies.streamStreetLightsExport.mockRejectedValueOnce(error);
    await controller.exportFile({ query: { format: 'JSON', search: 'lamp', status: 'active', district: 'center' } } as never, response() as never, next);
    expect(dependencies.streamStreetLightsExport).toHaveBeenCalledWith('json', { search: 'lamp', status: 'active', district: 'center' }, expect.any(Object));
    expect(next).toHaveBeenLastCalledWith(error);
  });
});
