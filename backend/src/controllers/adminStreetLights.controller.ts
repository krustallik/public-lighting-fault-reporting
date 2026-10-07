import type { NextFunction, Request, Response } from 'express';
import type { CreateLightPointInput, LightPointStatus, UpdateLightPointInput } from '../types/lightPoint.js';
import * as streetLightsService from '../services/adminStreetLights.service.js';
import {
  buildImportPreview,
  confirmImport,
  getImportBatch,
  getImportPreviewPage,
  listImportBatchRows,
  parseImportBuffer,
} from '../services/streetLightsImport.service.js';
import { streamStreetLightsExport } from '../services/streetLightsExport.service.js';
import { AppError } from '../utils/AppError.js';

export async function list(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const data = await streetLightsService.listStreetLights({
      page: Number(req.query.page) || 1,
      limit: Number(req.query.limit) || 20,
      search: String(req.query.search || ''),
      status: req.query.status as LightPointStatus | undefined,
      district: String(req.query.district || ''),
      sortBy: req.query.sortBy as 'id' | 'inventory_number' | 'external_id' | 'address' | 'status' | 'created_at' | 'updated_at',
      sortOrder: req.query.sortOrder === 'desc' ? 'desc' : 'asc',
    });
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

export async function getById(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const data = await streetLightsService.getStreetLightDetail(req.params.id);
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

export async function create(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const body = req.body as CreateLightPointInput & { inventoryNumber?: string };
    const input: CreateLightPointInput = {
      inventory_number: body.inventory_number ?? body.inventoryNumber ?? '',
      external_id: body.external_id ?? null,
      latitude: Number(body.latitude),
      longitude: Number(body.longitude),
      address: body.address,
      district: body.district,
      lamp_type: body.lamp_type,
      status: body.status,
    };
    const data = await streetLightsService.createLightPoint(input, req.admin?.id ?? null, req.admin?.username ?? null);
    res.status(201).json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

export async function update(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const body = req.body as UpdateLightPointInput & { inventoryNumber?: string };
    const input: UpdateLightPointInput = {
      ...body,
      inventory_number: body.inventory_number ?? body.inventoryNumber,
    };
    const data = await streetLightsService.updateLightPoint(req.params.id, input, req.admin?.id ?? null, req.admin?.username ?? null);
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

export async function remove(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    await streetLightsService.deleteLightPoint(req.params.id, req.admin?.id ?? null, req.admin?.username ?? null);
    res.json({ success: true, message: 'Street light deleted' });
  } catch (err) {
    next(err);
  }
}

export async function importPreview(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.file) {
      throw new AppError(400, 'File is required');
    }
    const rows = parseImportBuffer(
      req.file.buffer,
      req.file.mimetype,
      req.file.originalname
    );
    if (!rows.length) {
      throw new AppError(400, 'No valid rows found in file');
    }
    const preview = await buildImportPreview(
      req.admin!.id,
      req.file.originalname,
      rows,
      req.admin!.username,
      Number(req.query.page) || 1,
      Number(req.query.limit) || 50
    );
    res.json({ success: true, data: preview });
  } catch (err) {
    next(err);
  }
}

export async function getImportPreviewRows(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const page = req.query.page === undefined ? 1 : Number(req.query.page);
    const limit = req.query.limit === undefined ? 50 : Number(req.query.limit);
    if (!Number.isSafeInteger(page) || !Number.isSafeInteger(limit)) throw new AppError(400, 'Invalid preview pagination');
    const data = await getImportPreviewPage(req.admin!.id, req.params.previewId, page, limit);
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

export async function importConfirm(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { previewId, allowUpdate } = req.body as {
      previewId?: string;
      allowUpdate?: boolean;
    };
    if (!previewId || typeof allowUpdate !== 'boolean') {
      throw new AppError(400, 'previewId and an explicit allowUpdate boolean are required');
    }
    const data = await confirmImport(req.admin!.id, previewId, allowUpdate);
    res.status(202).json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

export async function getImportStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id <= 0) throw new AppError(400, 'Invalid import batch id');
    const data = await getImportBatch(id);
    if (!data) throw new AppError(404, 'Import batch not found');
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

export async function getImportRows(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id <= 0) throw new AppError(400, 'Invalid import batch id');
    if (!await getImportBatch(id)) throw new AppError(404, 'Import batch not found');
    const limit = req.query.limit === undefined ? 50 : Number(req.query.limit);
    const cursor = req.query.cursor === undefined ? 0 : Number(req.query.cursor);
    if (!Number.isSafeInteger(limit) || !Number.isSafeInteger(cursor)) throw new AppError(400, 'Invalid import row pagination');
    const data = await listImportBatchRows(id, typeof req.query.outcome === 'string' ? req.query.outcome : undefined, limit, cursor);
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

export async function exportFile(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const format = String(req.query.format || 'csv').toLowerCase();
    if (format !== 'csv' && format !== 'json' && format !== 'geojson') {
      throw new AppError(400, 'Invalid export format');
    }
    await streamStreetLightsExport(format, {
      search: String(req.query.search || ''),
      status: req.query.status as LightPointStatus | undefined,
      district: String(req.query.district || ''),
    }, res);
  } catch (err) {
    next(err);
  }
}
