import { config } from './index.js';

export function createAuthCookiePolicy(nodeEnv: string, secureLocalUat = false) {
  const production = nodeEnv === 'production';
  const secure = production || secureLocalUat;
  const prefix = secure ? '__Host-' : '';
  return {
    access: `${prefix}access_token`,
    refresh: `${prefix}refresh_token`,
    httpOnly: true,
    secure,
    sameSite: 'lax' as const,
    path: '/',
  };
}

export const authCookiePolicy = createAuthCookiePolicy(config.nodeEnv, config.localUatSecureCookies);

export const AUTH_COOKIE = {
  access: authCookiePolicy.access,
  refresh: authCookiePolicy.refresh,
} as const;

export const authConfig = {
  jwtSecret: config.jwtSecret,
  accessExpiresIn: '1h',
  refreshExpiresIn: '30d',
  accessMaxAgeMs: 60 * 60 * 1000,
  refreshMaxAgeMs: 30 * 24 * 60 * 60 * 1000,
  cookieSecure: authCookiePolicy.secure,
  cookieSameSite: authCookiePolicy.sameSite,
};
