import type { NextFunction, Request, Response } from 'express';
import type { AdminLoginInput } from '../types/admin.js';
import type { CreateLightPointInput, UpdateLightPointInput } from '../types/lightPoint.js';
import * as adminService from '../services/admin.service.js';

export async function login(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const result = await adminService.login(req.body as AdminLoginInput);
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

export async function getLightPoints(
  _req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const data = await adminService.getAdminLightPoints();
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

export async function createLightPoint(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const data = await adminService.createLightPoint(req.body as CreateLightPointInput);
    res.status(201).json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

export async function updateLightPoint(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const data = await adminService.updateLightPoint(
      req.params.id,
      req.body as UpdateLightPointInput
    );
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

export async function deleteLightPoint(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    await adminService.deleteLightPoint(req.params.id);
    res.json({ success: true, message: 'Light point deleted' });
  } catch (err) {
    next(err);
  }
}
