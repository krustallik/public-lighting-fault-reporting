import type { NextFunction, Request, Response } from 'express';
import type { CreateLightPointInput, LightPointStatus, UpdateLightPointInput } from '../types/lightPoint.js';
import * as streetLightsService from '../services/adminStreetLights.service.js';
import {
  buildImportPreview,
  confirmImport,
  parseImportBuffer,
} from '../services/streetLightsImport.service.js';
import { exportStreetLights } from '../services/streetLightsExport.service.js';
import { logAdminActivity } from '../services/adminActivity.service.js';
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
      sortBy: req.query.sortBy as 'id' | 'external_id' | 'address' | 'status' | 'created_at' | 'updated_at',
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
      external_id: body.external_id ?? body.inventoryNumber ?? null,
      latitude: Number(body.latitude),
      longitude: Number(body.longitude),
      address: body.address,
      district: body.district,
      lamp_type: body.lamp_type,
      status: body.status,
    };
    const data = await streetLightsService.createLightPoint(input);
    if (req.admin) {
      await logAdminActivity(req.admin.id, 'create', 'light_point', data.id, {});
    }
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
      external_id: body.external_id ?? body.inventoryNumber,
    };
    const data = await streetLightsService.updateLightPoint(req.params.id, input);
    if (req.admin) {
      await logAdminActivity(req.admin.id, 'update', 'light_point', data.id, {});
    }
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
    await streetLightsService.deleteLightPoint(req.params.id);
    if (req.admin) {
      await logAdminActivity(req.admin.id, 'delete', 'light_point', Number(req.params.id), {});
    }
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
      rows
    );
    await logAdminActivity(req.admin!.id, 'import_preview', null, null, {
      filename: req.file.originalname,
      totalRows: preview.totalRows,
    });
    res.json({ success: true, data: preview });
  } catch (err) {
    next(err);
  }
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
    if (!previewId) {
      throw new AppError(400, 'previewId is required');
    }
    const data = await confirmImport(req.admin!.id, previewId, Boolean(allowUpdate));
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
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
    const result = await exportStreetLights(format, {
      search: String(req.query.search || ''),
      status: req.query.status as LightPointStatus | undefined,
      district: String(req.query.district || ''),
    });
    res.setHeader('Content-Type', result.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
    res.send(result.body);
  } catch (err) {
    next(err);
  }
}
