import type { NextFunction, Request, Response } from 'express';
import type { ReportPayload } from '../types/report.js';
import * as reportsService from '../services/reports.service.js';

export async function sendReport(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const result = await reportsService.sendFaultReport(req.body as ReportPayload);
    res.status(201).json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}
