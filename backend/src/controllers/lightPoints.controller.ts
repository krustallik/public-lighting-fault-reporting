import type { NextFunction, Request, Response } from 'express';
import * as lightPointsService from '../services/lightPoints.service.js';

export async function getAll(
  _req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const data = await lightPointsService.getAllLightPoints();
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
    const data = await lightPointsService.getLightPointById(req.params.id);
    if (!data) {
      res.status(404).json({ success: false, message: 'Light point not found' });
      return;
    }
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}
