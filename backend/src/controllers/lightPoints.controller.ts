import type { NextFunction, Request, Response } from 'express';
import * as lightPointsService from '../services/lightPoints.service.js';

export async function getAll(
  _req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const rawBbox = _req.query.bbox;
    const data = rawBbox === undefined
      ? await lightPointsService.getAllLightPoints()
      : typeof rawBbox === 'string'
        ? await lightPointsService.getLightPointsInViewport(rawBbox.split(',').map(Number))
        : await lightPointsService.getLightPointsInViewport([]);
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
