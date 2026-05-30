import bcrypt from 'bcrypt';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { pool } from '../db/pool.js';
import { AUTH_COOKIE, authConfig } from '../config/auth.js';
import type { AdminJwtPayload, AdminUser, LoginInput } from '../types/auth.js';
import { AppError } from '../utils/AppError.js';
import { setAuthCookies, clearAuthCookies } from '../utils/cookies.js';
import type { Response } from 'express';
import { logAdminActivity } from './adminActivity.service.js';

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function signAccessToken(admin: AdminUser): string {
  const payload: AdminJwtPayload = {
    sub: admin.id,
    username: admin.username,
    type: 'access',
  };
  return jwt.sign(payload, authConfig.jwtSecret, { expiresIn: 3600 });
}

function signRefreshToken(admin: AdminUser, jti: string): string {
  const payload: AdminJwtPayload = {
    sub: admin.id,
    username: admin.username,
    type: 'refresh',
    jti,
  };
  return jwt.sign(payload, authConfig.jwtSecret, { expiresIn: '30d' });
}

async function storeRefreshSession(
  adminId: number,
  jti: string,
  refreshToken: string
): Promise<void> {
  const tokenHash = hashToken(refreshToken);
  const expiresAt = new Date(Date.now() + authConfig.refreshMaxAgeMs);

  await pool.query(
    `INSERT INTO admin_refresh_sessions (id, admin_id, token_hash, expires_at)
     VALUES ($1, $2, $3, $4)`,
    [jti, adminId, tokenHash, expiresAt]
  );
}

async function revokeSession(jti: string): Promise<void> {
  await pool.query(
    `UPDATE admin_refresh_sessions SET revoked_at = NOW() WHERE id = $1`,
    [jti]
  );
}

async function findAdminByUsername(username: string) {
  const { rows } = await pool.query<{
    id: number;
    username: string;
    password_hash: string;
    full_name: string | null;
    is_active: boolean;
  }>(
    `SELECT id, username, password_hash, full_name, is_active FROM admins WHERE username = $1`,
    [username]
  );
  return rows[0] ?? null;
}

async function findAdminById(id: number): Promise<AdminUser | null> {
  const { rows } = await pool.query<{ id: number; username: string; full_name: string | null }>(
    `SELECT id, username, full_name FROM admins WHERE id = $1 AND is_active = TRUE`,
    [id]
  );
  const row = rows[0];
  if (!row) return null;
  return { id: row.id, username: row.username, fullName: row.full_name };
}

export async function login(input: LoginInput, res: Response): Promise<AdminUser> {
  const row = await findAdminByUsername(input.username);
  if (!row || !row.is_active) {
    throw new AppError(401, 'Invalid credentials');
  }

  const valid = await bcrypt.compare(input.password, row.password_hash);
  if (!valid) {
    throw new AppError(401, 'Invalid credentials');
  }

  const admin: AdminUser = {
    id: row.id,
    username: row.username,
    fullName: row.full_name,
  };

  const accessToken = signAccessToken(admin);
  const jti = crypto.randomUUID();
  const refreshToken = signRefreshToken(admin, jti);
  await storeRefreshSession(admin.id, jti, refreshToken);

  setAuthCookies(res, accessToken, refreshToken);

  await logAdminActivity(admin.id, 'login', null, null, { username: admin.username });

  return admin;
}

export async function refreshTokens(
  refreshToken: string,
  res: Response
): Promise<AdminUser> {
  let payload: AdminJwtPayload;
  try {
    payload = jwt.verify(refreshToken, authConfig.jwtSecret) as unknown as AdminJwtPayload;
  } catch {
    throw new AppError(401, 'Invalid refresh token');
  }

  if (payload.type !== 'refresh' || !payload.jti) {
    throw new AppError(401, 'Invalid refresh token');
  }

  const tokenHash = hashToken(refreshToken);
  const { rows } = await pool.query<{
    id: string;
    admin_id: number;
    expires_at: Date;
    revoked_at: Date | null;
  }>(
    `SELECT id, admin_id, expires_at, revoked_at FROM admin_refresh_sessions
     WHERE id = $1 AND token_hash = $2`,
    [payload.jti, tokenHash]
  );

  const session = rows[0];
  if (!session || session.revoked_at || session.expires_at < new Date()) {
    throw new AppError(401, 'Refresh session expired or revoked');
  }

  const admin = await findAdminById(session.admin_id);
  if (!admin) {
    throw new AppError(401, 'Admin not found');
  }

  await revokeSession(payload.jti);

  const accessToken = signAccessToken(admin);
  const newJti = crypto.randomUUID();
  const newRefresh = signRefreshToken(admin, newJti);
  await storeRefreshSession(admin.id, newJti, newRefresh);

  setAuthCookies(res, accessToken, newRefresh);

  return admin;
}

export async function logout(
  refreshToken: string | undefined,
  res: Response,
  adminId?: number
): Promise<void> {
  if (refreshToken) {
    try {
      const payload = jwt.verify(refreshToken, authConfig.jwtSecret) as unknown as AdminJwtPayload;
      if (payload.jti) {
        await revokeSession(payload.jti);
      }
    } catch {
      /* ignore invalid token on logout */
    }
  }

  if (adminId) {
    await pool.query(
      `UPDATE admin_refresh_sessions SET revoked_at = NOW()
       WHERE admin_id = $1 AND revoked_at IS NULL`,
      [adminId]
    );
    await logAdminActivity(adminId, 'logout', null, null, {});
  }

  clearAuthCookies(res);
}

export function verifyAccessToken(token: string): AdminJwtPayload {
  const payload = jwt.verify(token, authConfig.jwtSecret) as unknown as AdminJwtPayload;
  if (payload.type !== 'access') {
    throw new AppError(401, 'Invalid access token');
  }
  return payload;
}

export async function getAdminFromAccessToken(token: string): Promise<AdminUser> {
  const payload = verifyAccessToken(token);
  const admin = await findAdminById(payload.sub);
  if (!admin) {
    throw new AppError(401, 'Admin not found');
  }
  return admin;
}

export { AUTH_COOKIE };
