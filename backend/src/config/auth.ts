import { config } from './index.js';

export const AUTH_COOKIE = {
  access: 'access_token',
  refresh: 'refresh_token',
} as const;

export const authConfig = {
  jwtSecret: process.env.JWT_SECRET || 'dev-only-change-in-production',
  accessExpiresIn: '1h',
  refreshExpiresIn: '30d',
  accessMaxAgeMs: 60 * 60 * 1000,
  refreshMaxAgeMs: 30 * 24 * 60 * 60 * 1000,
  cookieSecure: config.nodeEnv === 'production',
  cookieSameSite: 'lax' as const,
};
