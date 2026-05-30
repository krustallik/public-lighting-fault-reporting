import type { NextFunction, Request, Response } from 'express';
import * as healthService from '../services/health.service.js';

export async function getHealth(
  _req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const data = await healthService.checkHealth();
    res.json(data);
  } catch (err) {
    next(err);
  }
}
