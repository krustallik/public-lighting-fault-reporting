import type { NextFunction, Request, Response } from 'express';
import type { MulterError } from 'multer';
import * as reportsService from '../services/reports.service.js';
import { AppError } from '../utils/AppError.js';

function parseLightPointId(raw: unknown): number | undefined {
  if (raw == null || String(raw).trim() === '') {
    return undefined;
  }

  const numericId = Number(raw);
  if (!Number.isFinite(numericId) || numericId <= 0) {
    throw new AppError(400, 'Invalid light point id');
  }

  return numericId;
}

export async function sendReport(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const files = (req.files as Express.Multer.File[] | undefined) ?? [];
    const lightPointId = parseLightPointId(req.query.lightPointId);
    const result = await reportsService.sendFaultReport(req.body, files, lightPointId);
    res.status(201).json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

export function handleReportUploadError(
  err: unknown,
  _req: Request,
  _res: Response,
  next: NextFunction
): void {
  if (err && typeof err === 'object' && 'code' in err) {
    const multerErr = err as MulterError;
    if (multerErr.code === 'LIMIT_FILE_COUNT') {
      next(new AppError(400, 'Maximum 5 files allowed'));
      return;
    }
    if (multerErr.code === 'LIMIT_FILE_SIZE') {
      next(new AppError(400, 'File too large (max 10 MB)'));
      return;
    }
  }

  next(err);
}
