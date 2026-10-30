import type { NextFunction, Request, Response } from 'express';
import { listAdminActivityLogs } from '../services/adminActivity.service.js';
import { listImportBatches } from '../services/streetLightsImport.service.js';
import { pool } from '../db/pool.js';
import { AppError } from '../utils/AppError.js';

export async function getActivityLogs(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { limit, offset } = readPage(req, 25);
    const data = await listAdminActivityLogs(limit, offset);
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

export async function getInventoryAuditLogs(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { limit, offset } = readPage(req, 25);
    const [{ rows }, count] = await Promise.all([pool.query(
      `SELECT id, actor_username_snapshot AS admin_username,
              entity_id_snapshot AS entity_id,
              inventory_number_snapshot AS inventory_number,
              action, created_at
         FROM inventory_audit_events
        WHERE import_batch_id IS NULL
        ORDER BY created_at DESC, id DESC
        LIMIT $1 OFFSET $2`, [limit, offset]),
      pool.query<{ total: string }>('SELECT COUNT(*)::text AS total FROM inventory_audit_events WHERE import_batch_id IS NULL')]);
    res.json({ success: true, data: { items: rows, total: Number(count.rows[0]?.total ?? 0), limit, offset } });
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
    const { limit, offset } = readPage(req, 25);
    const items = await listImportBatches(limit, offset);
    const { rows } = await pool.query<{ count: string }>('SELECT COUNT(*)::text AS count FROM import_batches');
    const total = Number(rows[0]?.count ?? 0);
    const data = { items, total, limit, offset, page: Math.floor(offset / limit) + 1, totalPages: Math.ceil(total / limit) || 1 };
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

function readPage(req: Request, defaultLimit: number): { limit: number; offset: number } {
  const limit = req.query.limit === undefined ? defaultLimit : Number(req.query.limit);
  const page = req.query.page === undefined
    ? Math.floor(Number(req.query.offset ?? 0) / limit) + 1
    : Number(req.query.page);
  const offset = (page - 1) * limit;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100 ||
    !Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(offset) || offset < 0) {
    throw new AppError(400, 'Invalid log pagination');
  }
  return { limit, offset };
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
