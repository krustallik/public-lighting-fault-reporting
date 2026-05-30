import type { NextFunction, Request, Response } from 'express';
import { AUTH_COOKIE, getAdminFromAccessToken } from '../services/auth.service.js';
import { AppError } from '../utils/AppError.js';

export async function requireAdmin(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const token = req.cookies?.[AUTH_COOKIE.access];
    if (!token) {
      throw new AppError(401, 'Authentication required');
    }
    req.admin = await getAdminFromAccessToken(token);
    next();
  } catch (err) {
    next(err);
  }
}
