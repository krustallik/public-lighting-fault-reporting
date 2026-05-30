import type { Response } from 'express';
import { AUTH_COOKIE, authConfig } from '../config/auth.js';

const baseOptions = {
  httpOnly: true,
  secure: authConfig.cookieSecure,
  sameSite: authConfig.cookieSameSite,
  path: '/',
};

export function setAuthCookies(res: Response, accessToken: string, refreshToken: string): void {
  res.cookie(AUTH_COOKIE.access, accessToken, {
    ...baseOptions,
    maxAge: authConfig.accessMaxAgeMs,
  });
  res.cookie(AUTH_COOKIE.refresh, refreshToken, {
    ...baseOptions,
    maxAge: authConfig.refreshMaxAgeMs,
  });
}

export function clearAuthCookies(res: Response): void {
  res.clearCookie(AUTH_COOKIE.access, baseOptions);
  res.clearCookie(AUTH_COOKIE.refresh, baseOptions);
}
