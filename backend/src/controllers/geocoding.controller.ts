import type { NextFunction, Request, Response } from 'express';
import * as geocodingService from '../services/geocoding.service.js';
import { AppError } from '../utils/AppError.js';

/** On-demand geocoding (e.g. admin tools). Normal UI reads address from DB. */
export async function reverse(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const lat = Number(req.query.lat);
    const lng = Number(req.query.lng);

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      throw new AppError(400, 'Query parameters lat and lng are required');
    }

    const data = await geocodingService.reverseGeocode(lat, lng);
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}
