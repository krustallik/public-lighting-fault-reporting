import { describe, expect, it } from 'vitest';
import { createAuthCookiePolicy } from '../../src/config/auth.js';

describe('admin authentication cookie policy', () => {
  it('uses separate Secure host-only __Host cookies for production origins', () => {
    const policy = createAuthCookiePolicy('production');
    expect(policy).toEqual({
      access: '__Host-access_token',
      refresh: '__Host-refresh_token',
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
    });
    expect(policy).not.toHaveProperty('domain');
  });

  it('keeps local development cookies usable over HTTP without a shared domain', () => {
    const policy = createAuthCookiePolicy('development');
    expect(policy.access).toBe('access_token');
    expect(policy.refresh).toBe('refresh_token');
    expect(policy.secure).toBe(false);
    expect(policy.httpOnly).toBe(true);
    expect(policy.path).toBe('/');
    expect(policy).not.toHaveProperty('domain');
  });
});
