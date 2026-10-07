import type { NextFunction, Request, Response } from 'express';
import { listAdminActivityLogs } from '../services/adminActivity.service.js';
import { listImportBatches } from '../services/streetLightsImport.service.js';
import { pool } from '../db/pool.js';
import { AppError } from '../utils/AppError.js';

export async function getActivityLogs(
  _req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const data = await listAdminActivityLogs(100);
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

export async function getImportBatches(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const limit = req.query.limit === undefined ? 50 : Number(req.query.limit);
    const offset = req.query.offset === undefined ? 0 : Number(req.query.offset);
    if (!Number.isSafeInteger(limit) || !Number.isSafeInteger(offset) || limit < 1 || offset < 0) {
      throw new AppError(400, 'Invalid import history pagination');
    }
    const items = await listImportBatches(limit, offset);
    const { rows } = await pool.query<{ count: string }>('SELECT COUNT(*)::text AS count FROM import_batches');
    const data = { items, total: Number(rows[0]?.count ?? 0), limit: Math.min(limit, 100), offset };
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

export async function getIntegrationLogs(
  _req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { rows } = await pool.query(
      `SELECT id, reference_code, integration_type, status, error_message, created_at
       FROM integration_logs
       ORDER BY created_at DESC
       LIMIT 100`
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    next(err);
  }
}
