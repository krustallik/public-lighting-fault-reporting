import type { NextFunction, Request, Response } from 'express';
import { AUTH_COOKIE } from '../config/auth.js';
import * as authService from '../services/auth.service.js';
import type { LoginInput } from '../types/auth.js';

export async function login(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { username, password } = req.body as LoginInput;
    if (!username?.trim() || !password) {
      res.status(400).json({ success: false, message: 'Username and password required' });
      return;
    }
    const admin = await authService.login({ username: username.trim(), password }, res);
    res.json({
      success: true,
      data: { id: admin.id, username: admin.username, fullName: admin.fullName },
    });
  } catch (err) {
    next(err);
  }
}

export async function refresh(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const token = req.cookies?.[AUTH_COOKIE.refresh];
    if (!token) {
      res.status(401).json({ success: false, message: 'Refresh token missing' });
      return;
    }
    const admin = await authService.refreshTokens(token, res);
    res.json({
      success: true,
      data: { id: admin.id, username: admin.username, fullName: admin.fullName },
    });
  } catch (err) {
    next(err);
  }
}

export async function logout(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const refreshToken = req.cookies?.[AUTH_COOKIE.refresh];
    await authService.logout(refreshToken, res, req.admin?.id);
    res.json({ success: true, message: 'Logged out' });
  } catch (err) {
    next(err);
  }
}

/** Returns current admin or null — no 401 for unauthenticated checks. */
export async function me(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const token = req.cookies?.[AUTH_COOKIE.access];
    if (!token) {
      res.json({ success: true, data: null });
      return;
    }

    try {
      const admin = await authService.getAdminFromAccessToken(token);
      res.json({ success: true, data: admin });
    } catch {
      res.json({ success: true, data: null });
    }
  } catch (err) {
    next(err);
  }
}
