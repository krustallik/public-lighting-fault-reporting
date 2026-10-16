import bcrypt from 'bcrypt';
import { randomUUID } from 'node:crypto';
import type { Response } from 'express';
import { afterEach, describe, expect, it } from 'vitest';
import { AUTH_COOKIE } from '../../src/config/auth.js';
import { pool } from '../../src/db/pool.js';
import * as authService from '../../src/services/auth.service.js';

const enabled = process.env.PRODUCTION_FOUNDATION_POSTGRES === 'true';
const seededUsers: string[] = [];

async function createAdmin(active = true): Promise<{ id: number; username: string }> {
  const username = `coverage-auth-${randomUUID()}`;
  seededUsers.push(username);
  const passwordHash = await bcrypt.hash('synthetic-auth-password', 4);
  const { rows } = await pool.query<{ id: number }>(
    `INSERT INTO admins (username, password_hash, full_name, is_active)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [username, passwordHash, 'Synthetic Coverage Admin', active]
  );
  return { id: rows[0].id, username };
}

function responseRecorder() {
  const cookies = new Map<string, string>();
  const cleared: string[] = [];
  const response = {
    cookie: (name: string, value: string) => { cookies.set(name, value); return response; },
    clearCookie: (name: string) => { cleared.push(name); return response; },
  };
  return { response: response as unknown as Response, cookies, cleared };
}

afterEach(async () => {
  if (!seededUsers.length) return;
  await pool.query('DELETE FROM admins WHERE username = ANY($1::text[])', [seededUsers.splice(0)]);
});

describe.skipIf(!enabled)('PostgreSQL admin authentication service', () => {
  it('rejects unknown, disabled, and wrong-password login attempts', async () => {
    const disabled = await createAdmin(false);
    const recorder = responseRecorder();

    await expect(authService.login({ username: 'missing-coverage-admin', password: 'synthetic-auth-password' }, recorder.response))
      .rejects.toMatchObject({ status: 401, message: 'Invalid credentials' });
    await expect(authService.login({ username: disabled.username, password: 'synthetic-auth-password' }, recorder.response))
      .rejects.toMatchObject({ status: 401, message: 'Invalid credentials' });
    const active = await createAdmin();
    await expect(authService.login({ username: active.username, password: 'wrong-password' }, recorder.response))
      .rejects.toMatchObject({ status: 401, message: 'Invalid credentials' });
    expect(recorder.cookies.size).toBe(0);
  });

  it('stores hashed refresh sessions, rotates them once, and authenticates the active admin', async () => {
    const admin = await createAdmin();
    const loginResponse = responseRecorder();

    await expect(authService.login({ username: admin.username, password: 'synthetic-auth-password' }, loginResponse.response))
      .resolves.toMatchObject({ id: admin.id, username: admin.username, fullName: 'Synthetic Coverage Admin' });
    const oldRefresh = loginResponse.cookies.get(AUTH_COOKIE.refresh);
    const access = loginResponse.cookies.get(AUTH_COOKIE.access);
    expect(oldRefresh).toBeTruthy();
    expect(access).toBeTruthy();
    expect(loginResponse.cookies.size).toBe(2);
    const tokenHash = await pool.query<{ token_hash: string }>(
      'SELECT token_hash FROM admin_refresh_sessions WHERE admin_id = $1', [admin.id]
    );
    expect(tokenHash.rows).toHaveLength(1);
    expect(tokenHash.rows[0].token_hash).not.toBe(oldRefresh);
    await expect(authService.getAdminFromAccessToken(access!)).resolves.toMatchObject({ id: admin.id, username: admin.username });

    const refreshResponse = responseRecorder();
    await expect(authService.refreshTokens(oldRefresh!, refreshResponse.response)).resolves.toMatchObject({ id: admin.id });
    const newRefresh = refreshResponse.cookies.get(AUTH_COOKIE.refresh);
    const newAccess = refreshResponse.cookies.get(AUTH_COOKIE.access);
    expect(newRefresh).toBeTruthy();
    expect(newRefresh).not.toBe(oldRefresh);
    await expect(authService.getAdminFromAccessToken(newAccess!)).resolves.toMatchObject({ id: admin.id });
    await expect(authService.refreshTokens(oldRefresh!, responseRecorder().response))
      .rejects.toMatchObject({ status: 401, message: 'Refresh session expired or revoked' });

    const sessionStates = await pool.query<{ revoked_at: Date | null }>(
      'SELECT revoked_at FROM admin_refresh_sessions WHERE admin_id = $1 ORDER BY created_at', [admin.id]
    );
    expect(sessionStates.rows).toHaveLength(2);
    expect(sessionStates.rows[0].revoked_at).toBeInstanceOf(Date);
    expect(sessionStates.rows[1].revoked_at).toBeNull();
    const audit = await pool.query<{ action: string }>(
      "SELECT action FROM admin_activity_logs WHERE admin_id = $1 AND action = 'login'", [admin.id]
    );
    expect(audit.rows).toHaveLength(1);
  });

  it('rejects expired and revoked refresh sessions and clears cookies on logout', async () => {
    const admin = await createAdmin();
    const loginResponse = responseRecorder();
    await authService.login({ username: admin.username, password: 'synthetic-auth-password' }, loginResponse.response);
    const refresh = loginResponse.cookies.get(AUTH_COOKIE.refresh)!;
    const payload = authService.verifyAccessToken(loginResponse.cookies.get(AUTH_COOKIE.access)!);
    expect(payload.type).toBe('access');
    expect(() => authService.verifyAccessToken(refresh)).toThrow();

    const session = await pool.query<{ id: string }>(
      'SELECT id FROM admin_refresh_sessions WHERE admin_id = $1', [admin.id]
    );
    await pool.query('UPDATE admin_refresh_sessions SET expires_at = NOW() - interval \'1 second\' WHERE id = $1', [session.rows[0].id]);
    await expect(authService.refreshTokens(refresh, responseRecorder().response))
      .rejects.toMatchObject({ status: 401, message: 'Refresh session expired or revoked' });

    const logoutResponse = responseRecorder();
    await authService.logout('malformed-token', logoutResponse.response, admin.id);
    expect(logoutResponse.cleared).toEqual([AUTH_COOKIE.access, AUTH_COOKIE.refresh]);
    const sessions = await pool.query<{ active: number }>(
      'SELECT COUNT(*)::int AS active FROM admin_refresh_sessions WHERE admin_id = $1 AND revoked_at IS NULL', [admin.id]
    );
    expect(sessions.rows[0].active).toBe(0);

    const anonymousLogout = responseRecorder();
    await authService.logout(undefined, anonymousLogout.response);
    expect(anonymousLogout.cleared).toEqual([AUTH_COOKIE.access, AUTH_COOKIE.refresh]);
  });

  it('rejects a disabled admin after token issuance for both refresh and access lookup', async () => {
    const admin = await createAdmin();
    const recorder = responseRecorder();
    await authService.login({ username: admin.username, password: 'synthetic-auth-password' }, recorder.response);
    await pool.query('UPDATE admins SET is_active = FALSE WHERE id = $1', [admin.id]);

    await expect(authService.getAdminFromAccessToken(recorder.cookies.get(AUTH_COOKIE.access)!))
      .rejects.toMatchObject({ status: 401, message: 'Admin not found' });
    await expect(authService.refreshTokens(recorder.cookies.get(AUTH_COOKIE.refresh)!, responseRecorder().response))
      .rejects.toMatchObject({ status: 401, message: 'Admin not found' });
  });
});
