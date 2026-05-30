import type { NextFunction, Request, Response } from 'express';
import { listAdminActivityLogs } from '../services/adminActivity.service.js';
import { listImportBatches } from '../services/streetLightsImport.service.js';
import { pool } from '../db/pool.js';

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
  _req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const data = await listImportBatches(50);
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
